import { BULK_FIELDS, bulkRowRuleErrors, isBulkMapping, parseBulkValue, splitNames } from '../../shared/bulkImport';
import { textToNoteHtml } from '../../shared/noteHtml';
import { nameKey } from '../../shared/text';
import type { BulkImportResult, BulkImportSpec, BulkTarget, BulkValue, MasterKind, ProjectCategory } from '../../shared/types';
import { validateFreelanceInput, validateMasterName, validateProjectInput, validateWarrantyInput } from '../../shared/validation';
import { AppError, type Ctx } from '../context';
import { removeIfEmpty } from '../integration/folders';
import { createFreelance } from './freelance';
import { createMaster, getYear, listMaster } from './master';
import { createProject } from './projects';
import { createWarranty } from './records';

const TARGETS: BulkTarget[] = ['PRE_SALES', 'POST_SALES', 'WARRANTY', 'FREELANCE'];
const MAX_ROWS = 20_000;

interface Prepared {
  rowNumber: number;
  values: Record<string, BulkValue>;
  stt: number | null;
}

const text = (v: BulkValue | undefined): string => (v === null || v === undefined ? '' : String(v).trim());

const MASTER_FIELDS: Record<string, string> = {
  si: 'Tên SI',
  brand: 'Hãng',
  sale: 'Sale',
  eu: 'EU',
  status: 'Tình trạng',
  hirer: 'Bên thuê',
  payment: 'Trạng thái thanh toán',
};

/** Chạy trước các luật của form (độ dài, quan hệ ngày…) để dòng sai bị bỏ qua thay vì làm hỏng cả lần import. */
function formErrors(target: BulkTarget, v: Record<string, BulkValue>): string[] {
  const out: string[] = [];
  for (const [k, label] of Object.entries(MASTER_FIELDS)) {
    const names = k === 'brand' ? splitNames(text(v[k])) : text(v[k]) ? [text(v[k])] : [];
    for (const n of names) {
      const err = validateMasterName(n);
      if (err) out.push(`${label}: ${err}`);
    }
  }
  const e =
    target === 'WARRANTY'
      ? validateWarrantyInput({
          jobYearId: 'x',
          model: text(v.model),
          brandId: null,
          ipAddress: text(v.ipAddress),
          username: text(v.username),
          password: text(v.password),
          macAddress: text(v.macAddress),
          serialNumber: text(v.serialNumber),
          receivedDate: text(v.receivedDate) || null,
          testedDate: text(v.testedDate) || null,
          customerReport: text(v.customerReport),
          inspection: text(v.inspection),
          result: text(v.result),
          resolution: text(v.resolution),
          caseNumber: text(v.caseNumber),
          images: [],
        })
      : target === 'FREELANCE'
        ? validateFreelanceInput({
            projectName: text(v.projectName),
            hirerId: null,
            startDate: text(v.startDate) || null,
            statusId: null,
            paymentStatusId: null,
          })
        : validateProjectInput({
            jobYearId: 'x',
            workCategory: target,
            receivedDate: text(v.receivedDate) || null,
            dueDate: text(v.dueDate) || null,
            projectName: text(v.projectName),
            clientId: null,
            salespersonId: null,
            note: '',
            filePath: null,
            fileName: null,
            fileExtension: null,
            priorityPoint: typeof v.priority === 'number' ? v.priority : 1,
          });
  for (const m of Object.values(e)) if (m && !out.includes(m)) out.push(m);
  return out;
}

/**
 * Nhập nhiều dòng từ .xlsx. Dòng lỗi (thiếu Tên, sai ngày, trùng STT…) bị bỏ qua và báo lại; các dòng hợp lệ được ghi
 * trong một transaction — lỗi bất ngờ giữa chừng thì không dòng nào được ghi. Tên SI / Hãng / Sale / EU / Tình trạng
 * khớp theo tên (không phân biệt hoa thường, dấu cách), chưa có thì thêm vào danh mục.
 */
export function bulkImport(ctx: Ctx, spec: BulkImportSpec): BulkImportResult {
  if (!spec || !TARGETS.includes(spec.target)) throw new AppError('Loại dữ liệu import không hợp lệ.');
  if (!Array.isArray(spec.rows) || spec.rows.length > MAX_ROWS) throw new AppError('Dữ liệu import không hợp lệ.');
  const target = spec.target;
  const isProject = target === 'PRE_SALES' || target === 'POST_SALES';
  if (target !== 'FREELANCE') {
    const year = getYear(ctx, String(spec.jobYearId ?? ''));
    if (year.jobType !== 'MAIN') throw new AppError('Chỉ import Pre-sales / Post-sales / Warranty vào Job Chính.');
  }
  const fields = BULK_FIELDS[target];
  const result: BulkImportResult = {
    created: 0,
    skipped: [],
    newMasters: [],
    notices: [],
  };

  // Warranty: STT duy nhất trong năm; dự án Job Chính: trong từng danh sách (năm × nhóm); Job Freelance: cả bảng.
  const usedStt = new Set<number>(
    (target === 'WARRANTY'
      ? ctx.db.all<{ stt: number }>('SELECT stt FROM warranty_records WHERE job_year_id = ?', [String(spec.jobYearId)])
      : isProject
        ? ctx.db.all<{ stt: number }>('SELECT stt FROM projects WHERE job_year_id = ? AND work_category = ?', [String(spec.jobYearId), target])
        : ctx.db.all<{ stt: number }>('SELECT stt FROM freelance_jobs')
    ).map((r) => r.stt),
  );
  const prepared: Prepared[] = [];
  const seen = new Map<number, number>();
  for (const row of spec.rows) {
    const rowNumber = Number(row?.rowNumber) || 0;
    const values: Record<string, BulkValue> = {};
    const errors: string[] = [];
    for (const f of fields) {
      const raw = row?.values?.[f.key];
      if (raw === undefined || raw === null || raw === '') continue;
      const { value, error } = parseBulkValue(f, typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw));
      values[f.key] = value;
      if (error) errors.push(error);
    }
    errors.push(...bulkRowRuleErrors(target, values));
    if (!errors.length) errors.push(...formErrors(target, values));
    const stt = typeof values.stt === 'number' ? values.stt : null;
    if (stt !== null) {
      if (usedStt.has(stt)) errors.push(`STT ${stt} đã có trong hệ thống.`);
      else if (seen.has(stt)) errors.push(`STT ${stt} trùng với dòng ${seen.get(stt)}.`);
    }
    if (errors.length) {
      result.skipped.push({ rowNumber, error: errors.join(' ') });
      continue;
    }
    if (stt !== null) seen.set(stt, rowNumber);
    prepared.push({ rowNumber, values, stt });
  }
  {
    const taken = new Set([...usedStt, ...seen.keys()]);
    let next = Math.max(0, ...taken) + 1;
    for (const p of prepared)
      if (p.stt === null) {
        while (taken.has(next)) next++;
        p.stt = next;
        taken.add(next++);
      }
  }

  const masterCache = new Map<MasterKind, Map<string, string>>();
  const masterId = (kind: MasterKind, name: string): string | null => {
    const n = name.trim();
    if (!n) return null;
    let byKey = masterCache.get(kind);
    if (!byKey) {
      byKey = new Map(listMaster(ctx, kind).map((m) => [nameKey(m.name), m.id]));
      masterCache.set(kind, byKey);
    }
    const key = nameKey(n);
    const found = byKey.get(key);
    if (found) return found;
    const created = createMaster(ctx, kind, n);
    byKey.set(key, created.id);
    result.newMasters.push({ kind, name: created.name });
    return created.id;
  };

  const createdFolders: string[] = [];
  try {
    ctx.db.tx(() => {
      for (const p of prepared) {
        const v = p.values;
        const note = text(v.note);
        if (isProject) {
          const saved = createProject(
            ctx,
            {
              stt: p.stt,
              jobYearId: spec.jobYearId!,
              workCategory: target as ProjectCategory,
              receivedDate: text(v.receivedDate) || null,
              dueDate: text(v.dueDate) || null,
              projectName: text(v.projectName),
              clientId: masterId('clients', text(v.eu)),
              siId: masterId('siPartners', text(v.si)),
              brandIds: splitNames(text(v.brand)).map((b) => masterId('brands', b)!),
              salespersonId: masterId('salespersons', text(v.sale)),
              folderParent: spec.folderParent || undefined,
              note: '',
              filePath: null,
              fileName: null,
              fileExtension: null,
              priorityPoint: typeof v.priority === 'number' ? v.priority : 1,
            },
            { noteHtml: note ? textToNoteHtml(note) : undefined },
          );
          if (saved.folderPath && !saved.notice) createdFolders.push(saved.folderPath);
          if (saved.notice) result.notices.push(`Dòng ${p.rowNumber}: ${saved.notice}`);
        } else if (target === 'WARRANTY') {
          createWarranty(ctx, {
            stt: p.stt ?? undefined,
            jobYearId: spec.jobYearId!,
            model: text(v.model),
            brandId: masterId('brands', splitNames(text(v.brand))[0] ?? ''),
            siId: masterId('siPartners', text(v.si)),
            ipAddress: text(v.ipAddress),
            username: text(v.username),
            password: text(v.password) || undefined,
            macAddress: text(v.macAddress),
            serialNumber: text(v.serialNumber),
            receivedDate: text(v.receivedDate) || null,
            testedDate: text(v.testedDate) || null,
            customerReport: text(v.customerReport),
            inspection: text(v.inspection),
            result: text(v.result),
            resolution: text(v.resolution),
            caseNumber: text(v.caseNumber),
            images: [],
          });
        } else {
          createFreelance(
            ctx,
            {
              stt: p.stt,
              projectName: text(v.projectName),
              hirerId: masterId('freelanceHirers', text(v.hirer)),
              startDate: text(v.startDate) || null,
              statusId: masterId('freelanceStatuses', text(v.status)),
              paymentStatusId: masterId('freelancePaymentStatuses', text(v.payment)),
            },
            { noteHtml: note ? textToNoteHtml(note) : undefined },
          );
        }
        result.created++;
      }
      if (spec.workbookSignature && Array.isArray(spec.mappings)) {
        const own = spec.mappings.filter((m) => m && isBulkMapping(target, m)).slice(0, 200);
        ctx.db.run('DELETE FROM import_column_mappings WHERE workbook_signature = ? AND target_field LIKE ?', [spec.workbookSignature, `bulk.${target}.%`]);
        for (const m of own)
          ctx.db.run('INSERT OR REPLACE INTO import_column_mappings VALUES (?,?,?,?)', [
            spec.workbookSignature,
            String(m.sheetName).slice(0, 200),
            String(m.sourceColumn).slice(0, 20),
            String(m.targetField).slice(0, 120),
          ]);
      }
    });
  } catch (e) {
    for (const dir of createdFolders) removeIfEmpty(dir);
    throw e;
  }
  return result;
}
