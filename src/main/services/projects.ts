import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectFolderName } from '../../shared/folderName';
import { cleanName } from '../../shared/text';
import type {
  ImportPayload,
  NamedRef,
  Project,
  ProjectCategory,
  ProjectImport,
  ProjectInput,
  ProjectSaved,
  ProjectSaveOptions,
} from '../../shared/types';
import { textToNoteHtml } from '../../shared/noteHtml';
import { LIMITS, fileExtension, hasErrors, validateProjectInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, todayOf, type Ctx } from '../context';
import { ensureProjectFolder, moveProjectFolder, removeIfEmpty, undoFolderMove } from '../integration/folders';
import { addProjectStartEvent, addProjectUpdateEvent, describeProjectChanges, hasProjectStartEvent, removeProjectStartEvents, syncProjectStartEvent } from './calendar';
import { getYear } from './master';
import { deleteUnreferencedImages, noteCalendarLine, projectNoteImageKeys, writeNote, type NoteWrite } from './notes';

const SELECT_PROJECT = `
SELECT p.*, y.job_type, y.year_label,
  c.name AS client_name, si.name AS si_name, d.name AS design_unit_name, s.name AS stage_name,
  sp.name AS salesperson_name, dep.name AS department_name,
  EXISTS (SELECT 1 FROM project_imports i WHERE i.project_id = p.id) AS has_import
FROM projects p
JOIN job_years y ON y.id = p.job_year_id
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN si_partners si ON si.id = p.si_id
LEFT JOIN design_units d ON d.id = p.design_unit_id
LEFT JOIN project_stages s ON s.id = p.stage_id
LEFT JOIN salespersons sp ON sp.id = p.salesperson_id
LEFT JOIN departments dep ON dep.id = sp.department_id`;

function brandsByProject(ctx: Ctx, projectId?: string): Map<string, NamedRef[]> {
  const rows = ctx.db.all<{ project_id: string; id: string; name: string }>(
    `SELECT pb.project_id, b.id, b.name FROM project_brands pb JOIN brands b ON b.id = pb.brand_id
     ${projectId ? 'WHERE pb.project_id = ?' : ''} ORDER BY pb.sort_order, b.name`,
    projectId ? [projectId] : [],
  );
  const m = new Map<string, NamedRef[]>();
  for (const r of rows) {
    const list = m.get(r.project_id) ?? [];
    list.push({ id: r.id, name: r.name });
    m.set(r.project_id, list);
  }
  return m;
}

function mapProject(r: Record<string, any>, brands: NamedRef[]): Project {
  return {
    id: r.id,
    stt: r.stt,
    jobYearId: r.job_year_id,
    jobType: r.job_type,
    yearLabel: r.year_label,
    workCategory: r.work_category,
    receivedDate: strOrNull(r.received_date),
    dueDate: strOrNull(r.due_date),
    projectName: r.project_name,
    clientId: strOrNull(r.client_id),
    clientName: strOrNull(r.client_name),
    siId: strOrNull(r.si_id),
    siName: strOrNull(r.si_name),
    brands,
    designUnitId: strOrNull(r.design_unit_id),
    designUnitName: strOrNull(r.design_unit_name),
    stageId: strOrNull(r.stage_id),
    stageName: strOrNull(r.stage_name),
    salespersonId: strOrNull(r.salesperson_id),
    salespersonName: strOrNull(r.salesperson_name),
    salespersonDepartment: strOrNull(r.department_name),
    folderPath: strOrNull(r.folder_path),
    note: str(r.note),
    filePath: strOrNull(r.file_path),
    fileName: strOrNull(r.file_name),
    fileExtension: strOrNull(r.file_extension),
    priorityPoint: r.priority_point,
    isCompleted: !!r.is_completed,
    completedAt: strOrNull(r.completed_at),
    hasImport: !!r.has_import,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listProjects(ctx: Ctx): Project[] {
  const brands = brandsByProject(ctx);
  return ctx.db.all(`${SELECT_PROJECT} ORDER BY p.stt`).map((r) => mapProject(r, brands.get(r.id as string) ?? []));
}

export function getProject(ctx: Ctx, id: string): Project {
  const r = ctx.db.get(`${SELECT_PROJECT} WHERE p.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy dự án (có thể đã bị xóa).');
  return mapProject(r, brandsByProject(ctx, id).get(id) ?? []);
}

export function nextProjectStt(ctx: Ctx): number {
  return (ctx.db.scalar<number>('SELECT COALESCE(MAX(stt), 0) FROM projects') ?? 0) + 1;
}

function exists(ctx: Ctx, table: string, id: string | null): boolean {
  return !id || ctx.db.scalar<number>(`SELECT COUNT(*) FROM ${table} WHERE id = ?`, [id]) > 0;
}

interface Normalized {
  stt: number;
  jobYearId: string;
  workCategory: ProjectCategory;
  receivedDate: string | null;
  dueDate: string | null;
  projectName: string;
  clientId: string | null;
  siId: string | null;
  brandIds: string[];
  designUnitId: string | null;
  stageId: string | null;
  salespersonId: string | null;
  note: string;
  filePath: string | null;
  fileName: string | null;
  fileExtension: string | null;
  priorityPoint: number;
  folderParent: string | null | undefined;
}

/** Chấp nhận cả dữ liệu từ client cũ (không có STT/SI/Hãng): STT tự cấp, SI/Hãng để trống. */
function normalizeInput(ctx: Ctx, input: ProjectInput, currentId?: string): Normalized {
  const errors = validateProjectInput(input);
  if (hasErrors(errors)) throw new AppError(Object.values(errors).filter(Boolean).join(' '));
  getYear(ctx, input.jobYearId);
  const clientId = strOrNull(input.clientId);
  const siId = strOrNull(input.siId);
  const salespersonId = strOrNull(input.salespersonId);
  if (!exists(ctx, 'clients', clientId)) throw new AppError('EU không tồn tại.');
  if (!exists(ctx, 'si_partners', siId)) throw new AppError('Tên SI không tồn tại.');
  if (!exists(ctx, 'design_units', strOrNull(input.designUnitId))) throw new AppError('Đơn vị thiết kế không tồn tại.');
  if (!exists(ctx, 'project_stages', strOrNull(input.stageId))) throw new AppError('Giai đoạn không tồn tại.');
  if (!exists(ctx, 'salespersons', salespersonId)) throw new AppError('Sale không tồn tại.');
  const brandIds = [...new Set((Array.isArray(input.brandIds) ? input.brandIds : []).filter(Boolean))];
  for (const b of brandIds) if (!exists(ctx, 'brands', b)) throw new AppError('Hãng không tồn tại.');

  let stt = input.stt ?? undefined;
  if (stt === undefined) stt = currentId ? ctx.db.scalar<number>('SELECT stt FROM projects WHERE id = ?', [currentId]) : nextProjectStt(ctx);
  const dup = ctx.db.get<{ project_name: string }>('SELECT project_name FROM projects WHERE stt = ? AND id <> ?', [stt, currentId ?? '']);
  if (dup) throw new AppError(`STT ${stt} đã được dùng cho dự án "${dup.project_name}". Hãy chọn STT khác (gợi ý: ${nextProjectStt(ctx)}).`);

  let filePath = strOrNull(input.filePath);
  let fileName = strOrNull(input.fileName);
  let ext = strOrNull(input.fileExtension);
  if (filePath) {
    ext = fileExtension(filePath);
    if (ext !== 'dwg' && ext !== 'txt') throw new AppError('Chỉ hỗ trợ file .dwg hoặc .txt.');
    fileName = fileName || filePath.split(/[\\/]/).pop() || filePath;
  } else {
    fileName = null;
    ext = null;
  }
  return {
    stt: stt!,
    jobYearId: input.jobYearId,
    workCategory: input.workCategory,
    receivedDate: strOrNull(input.receivedDate),
    dueDate: strOrNull(input.dueDate),
    projectName: cleanName(input.projectName),
    clientId,
    siId,
    brandIds,
    designUnitId: strOrNull(input.designUnitId),
    stageId: strOrNull(input.stageId),
    salespersonId,
    note: (input.note ?? '').replace(/\r\n/g, '\n'),
    filePath,
    fileName,
    fileExtension: ext,
    priorityPoint: input.priorityPoint,
    folderParent: input.folderParent === undefined ? undefined : strOrNull(input.folderParent),
  };
}

function masterName(ctx: Ctx, table: string, id: string | null): string {
  if (!id) return '';
  return ctx.db.scalar<string>(`SELECT name FROM ${table} WHERE id = ?`, [id]) ?? '';
}

function folderNameOf(ctx: Ctx, p: Normalized): string {
  return projectFolderName({
    stt: p.stt,
    projectName: p.projectName,
    siName: masterName(ctx, 'si_partners', p.siId),
    brandNames: p.brandIds.map((b) => masterName(ctx, 'brands', b)),
  });
}

function writeBrands(ctx: Ctx, projectId: string, brandIds: string[]) {
  ctx.db.run('DELETE FROM project_brands WHERE project_id = ?', [projectId]);
  brandIds.forEach((b, i) => ctx.db.run('INSERT INTO project_brands VALUES (?,?,?)', [projectId, b, i]));
}

function rememberRoot(ctx: Ctx, dir: string) {
  ctx.db.run(
    'INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    ['project_root_dir', dir, now()],
  );
}

/**
 * Dự án mới nhập với ngày tới hạn đã qua là việc đã xong (nhập bù) nên lưu luôn ở trạng thái Đã hoàn thành;
 * chỉ dự án có hạn trong tương lai mới chuyển sang Khẩn cấp / quá hạn khi tới hạn.
 * Có `folderParent` thì tạo thư mục "STT.Tên dự án_Tên SI_Hãng" trong đó và nhớ làm nơi lưu mặc định.
 * Ghi chú ban đầu (`opts.noteHtml`, hoặc `note` dạng chữ của client cũ) thành mục ghi chú của hôm nay.
 */
export function createProject(ctx: Ctx, raw: ProjectInput, opts: ProjectSaveOptions = {}): ProjectSaved {
  const p = normalizeInput(ctx, raw);
  if (p.note.length > LIMITS.note) throw new AppError(`Ghi chú tối đa ${LIMITS.note} ký tự.`);
  const id = randomUUID();
  const stamp = now();
  const today = todayOf(ctx);
  const completed = !!p.dueDate && p.dueDate < today;
  const noteHtml = opts.noteHtml ?? (p.note.trim() ? textToNoteHtml(p.note) : undefined);
  const folder = p.folderParent ? ensureProjectFolder(p.folderParent, folderNameOf(ctx, p)) : null;
  try {
    ctx.db.tx(() => {
      ctx.db.run(
        `INSERT INTO projects (id, stt, job_year_id, work_category, received_date, due_date, project_name, client_id, si_id,
          design_unit_id, stage_id, salesperson_id, note, file_path, file_name, file_extension, folder_path, priority_point,
          is_completed, completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?,?,?,?,?)`,
        [id, p.stt, p.jobYearId, p.workCategory, p.receivedDate, p.dueDate, p.projectName, p.clientId, p.siId, p.designUnitId,
          p.stageId, p.salespersonId, p.filePath, p.fileName, p.fileExtension, folder?.path ?? null, p.priorityPoint,
          completed, completed ? stamp : null, stamp, stamp],
      );
      writeBrands(ctx, id, p.brandIds);
      if (p.receivedDate) addProjectStartEvent(ctx, id, p.projectName, p.receivedDate);
      if (noteHtml !== undefined) writeNote(ctx, id, today, noteHtml);
      if (p.folderParent) rememberRoot(ctx, p.folderParent);
    });
  } catch (e) {
    if (folder?.created) removeIfEmpty(folder.path);
    throw e;
  }
  const saved: ProjectSaved = getProject(ctx, id);
  if (folder && !folder.created) saved.notice = `Đã có sẵn thư mục "${path.basename(folder.path)}" — đã liên kết với dự án.`;
  return saved;
}

/**
 * `addToCalendar`: ghi thêm sự kiện "Cập nhật dự án" (tóm tắt thay đổi) vào ngày hôm nay; dự án cũ chưa có
 * sự kiện bắt đầu thì bổ sung luôn. `note` trong input bị bỏ qua: ghi chú chỉ đổi qua `opts.noteHtml` (ngày hôm nay)
 * hoặc saveProjectNote, vì cột `projects.note` là bản tổng hợp từ các ngày.
 * Đổi STT/Tên/SI/Hãng (hoặc nơi lưu) thì thư mục dự án được đổi tên/chuyển theo.
 */
export function updateProject(ctx: Ctx, id: string, raw: ProjectInput, opts: ProjectSaveOptions = {}): ProjectSaved {
  const before = getProject(ctx, id);
  const p = normalizeInput(ctx, raw, id);
  const today = todayOf(ctx);
  const name = folderNameOf(ctx, p);
  let folderPath = before.folderPath;
  let notice: string | undefined;
  let undo: (() => void) | null = null;
  if (before.folderPath) {
    const parent = p.folderParent ?? path.dirname(before.folderPath);
    const move = moveProjectFolder(before.folderPath, path.join(parent, name));
    folderPath = move.path;
    notice = move.notice;
    if (move.moved) undo = () => undoFolderMove(before.folderPath!, move.path);
  } else if (p.folderParent) {
    const created = ensureProjectFolder(p.folderParent, name);
    folderPath = created.path;
    if (created.created) undo = () => removeIfEmpty(created.path);
  }
  let note: NoteWrite = { changed: false, removedKeys: [], html: '' };
  try {
    ctx.db.tx(() => {
      ctx.db.run(
        `UPDATE projects SET stt=?, job_year_id=?, work_category=?, received_date=?, due_date=?, project_name=?, client_id=?, si_id=?,
          design_unit_id=?, stage_id=?, salesperson_id=?, file_path=?, file_name=?, file_extension=?, folder_path=?, priority_point=?, updated_at=?
         WHERE id=?`,
        [p.stt, p.jobYearId, p.workCategory, p.receivedDate, p.dueDate, p.projectName, p.clientId, p.siId, p.designUnitId,
          p.stageId, p.salespersonId, p.filePath, p.fileName, p.fileExtension, folderPath, p.priorityPoint, now(), id],
      );
      writeBrands(ctx, id, p.brandIds);
      syncProjectStartEvent(ctx, before, p);
      if (opts.noteHtml !== undefined) note = writeNote(ctx, id, today, opts.noteHtml);
      if (opts.addToCalendar) {
        if (!hasProjectStartEvent(ctx, id) && p.receivedDate) addProjectStartEvent(ctx, id, p.projectName, p.receivedDate);
        const changes = describeProjectChanges(before, p, (t, v) => masterName(ctx, t, v));
        if (note.changed) changes.push(noteCalendarLine(today, note.html, today));
        addProjectUpdateEvent(ctx, id, p.projectName, changes);
      }
      if (p.folderParent) rememberRoot(ctx, p.folderParent);
    });
  } catch (e) {
    undo?.();
    throw e;
  }
  deleteUnreferencedImages(ctx, note.removedKeys);
  const saved: ProjectSaved = getProject(ctx, id);
  if (notice) saved.notice = notice;
  return saved;
}

/** Tên thư mục mong đợi theo thông tin hiện tại của dự án. */
export function expectedFolderName(ctx: Ctx, id: string): string {
  const p = getProject(ctx, id);
  return projectFolderName({ stt: p.stt, projectName: p.projectName, siName: p.siName, brandNames: p.brands.map((b) => b.name) });
}

/** Tạo thư mục cho dự án chưa có (dự án cũ) hoặc đồng bộ lại tên thư mục (khi lần đổi tên trước bị chặn). */
export function syncProjectFolder(ctx: Ctx, id: string, parent?: string | null): ProjectSaved {
  const p = getProject(ctx, id);
  const name = expectedFolderName(ctx, id);
  let result: { path: string; notice?: string };
  let undo: (() => void) | null = null;
  if (p.folderPath && !parent) {
    const move = moveProjectFolder(p.folderPath, path.join(path.dirname(p.folderPath), name));
    result = move;
    if (move.moved) undo = () => undoFolderMove(p.folderPath!, move.path);
  } else {
    const dir = parent ?? (p.folderPath ? path.dirname(p.folderPath) : null);
    if (!dir) throw new AppError('Chọn nơi lưu thư mục dự án.');
    const created = ensureProjectFolder(dir, name);
    result = { path: created.path, notice: created.created ? undefined : `Đã có sẵn thư mục "${name}" — đã liên kết với dự án.` };
    if (created.created) undo = () => removeIfEmpty(created.path);
  }
  try {
    ctx.db.tx(() => {
      ctx.db.run('UPDATE projects SET folder_path = ?, updated_at = ? WHERE id = ?', [result.path, now(), id]);
      if (parent) rememberRoot(ctx, parent);
    });
  } catch (e) {
    undo?.();
    throw e;
  }
  const saved: ProjectSaved = getProject(ctx, id);
  if (result.notice) saved.notice = result.notice;
  return saved;
}

/** Không đụng tới thư mục trên ổ đĩa (việc chuyển thư mục vào Thùng rác do lớp gọi xử lý trước). */
export function deleteProject(ctx: Ctx, id: string): void {
  const p = getProject(ctx, id);
  const noteImages = projectNoteImageKeys(ctx, id);
  ctx.db.tx(() => {
    removeProjectStartEvents(ctx, id);
    ctx.db.run(
      `UPDATE experience_records SET project_text = COALESCE(NULLIF(project_text,''), ?), updated_at = ? WHERE project_id = ?`,
      [p.projectName, now(), id],
    );
    ctx.db.run('DELETE FROM projects WHERE id = ?', [id]);
  });
  deleteUnreferencedImages(ctx, noteImages);
}

function setCompletedRow(ctx: Ctx, id: string, completed: boolean, stamp: string) {
  ctx.db.run(
    `UPDATE projects SET is_completed = ?, completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE NULL END, updated_at = ? WHERE id = ?`,
    [completed, completed, stamp, stamp, id],
  );
}

export function setProjectCompleted(ctx: Ctx, id: string, completed: boolean): Project {
  const p = getProject(ctx, id);
  if (p.isCompleted !== completed) ctx.db.tx(() => setCompletedRow(ctx, id, completed, now()));
  return getProject(ctx, id);
}

export function applyBoardChanges(ctx: Ctx, changes: { id: string; completed: boolean }[]): void {
  if (!Array.isArray(changes)) throw new AppError('Dữ liệu không hợp lệ.');
  for (const c of changes) getProject(ctx, c.id);
  const stamp = now();
  ctx.db.tx(() => changes.forEach((c) => setCompletedRow(ctx, c.id, !!c.completed, stamp)));
}

export function moveProject(ctx: Ctx, id: string, jobYearId: string, category: ProjectCategory): Project {
  getProject(ctx, id);
  getYear(ctx, jobYearId);
  if (category !== 'PRE_SALES' && category !== 'POST_SALES') throw new AppError('Nhóm đích không hợp lệ.');
  ctx.db.tx(() =>
    ctx.db.run('UPDATE projects SET job_year_id = ?, work_category = ?, updated_at = ? WHERE id = ?', [jobYearId, category, now(), id]),
  );
  return getProject(ctx, id);
}

/* ---------------- Import XLSX ---------------- */

export function getProjectImport(ctx: Ctx, projectId: string): ProjectImport | null {
  const imp = ctx.db.get<Record<string, any>>('SELECT * FROM project_imports WHERE project_id = ?', [projectId]);
  if (!imp) return null;
  return {
    id: imp.id,
    projectId: imp.project_id,
    sourceFileName: imp.source_file_name,
    sourcePath: strOrNull(imp.source_path),
    sheetNames: JSON.parse(imp.sheet_names || '[]'),
    importedAt: imp.imported_at,
    status: imp.status,
    info: ctx.db
      .all<Record<string, any>>('SELECT * FROM imported_project_info WHERE project_import_id = ? ORDER BY display_order', [imp.id])
      .map((r) => ({ fieldKey: r.field_key, fieldLabel: r.field_label, fieldValue: str(r.field_value) })),
    requirements: ctx.db
      .all<Record<string, any>>('SELECT * FROM imported_requirements WHERE project_import_id = ? ORDER BY sort_order', [imp.id])
      .map((r) => ({ roundNumber: r.round_number, content: str(r.content), createdDate: strOrNull(r.created_date) })),
    items: ctx.db
      .all<Record<string, any>>('SELECT * FROM imported_items WHERE project_import_id = ? ORDER BY sort_order', [imp.id])
      .map((r) => ({ model: str(r.model), brand: str(r.brand), description: str(r.description) })),
  };
}

function validatePayload(p: ImportPayload) {
  if (!p || typeof p.sourceFileName !== 'string') throw new AppError('Dữ liệu import không hợp lệ.');
  if (!Array.isArray(p.info) || !Array.isArray(p.requirements) || !Array.isArray(p.items))
    throw new AppError('Dữ liệu import không hợp lệ.');
  const hasData =
    p.info.some((r) => str(r.fieldValue).trim()) || p.requirements.length > 0 || p.items.length > 0;
  if (!hasData) throw new AppError('Không có dữ liệu nào được map. Hãy kiểm tra lại vùng dữ liệu và mapping.');
}

/** Ghi toàn bộ trong một transaction: lỗi giữa chừng thì dữ liệu import cũ được giữ nguyên. */
export function commitImport(ctx: Ctx, projectId: string, payload: ImportPayload): ProjectImport {
  getProject(ctx, projectId);
  validatePayload(payload);
  const importId = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM project_imports WHERE project_id = ?', [projectId]);
    ctx.db.run('INSERT INTO project_imports VALUES (?,?,?,?,?,?,?)', [
      importId, projectId, payload.sourceFileName, payload.sourcePath, JSON.stringify(payload.sheetNames ?? []), stamp, 'IMPORTED',
    ]);
    payload.info.forEach((r, i) =>
      ctx.db.run('INSERT INTO imported_project_info VALUES (?,?,?,?,?,?)', [
        randomUUID(), importId, str(r.fieldKey), str(r.fieldLabel), str(r.fieldValue), i,
      ]),
    );
    payload.requirements.forEach((r, i) =>
      ctx.db.run('INSERT INTO imported_requirements VALUES (?,?,?,?,?,?)', [
        randomUUID(), importId, Number(r.roundNumber) || i + 1, str(r.content), strOrNull(r.createdDate), i,
      ]),
    );
    payload.items.forEach((r, i) =>
      ctx.db.run('INSERT INTO imported_items VALUES (?,?,?,?,?,?)', [randomUUID(), importId, str(r.model), str(r.brand), str(r.description), i]),
    );
    if (payload.workbookSignature && Array.isArray(payload.mappings) && payload.mappings.length) {
      ctx.db.run('DELETE FROM import_column_mappings WHERE workbook_signature = ?', [payload.workbookSignature]);
      for (const m of payload.mappings)
        ctx.db.run('INSERT OR REPLACE INTO import_column_mappings VALUES (?,?,?,?)', [
          payload.workbookSignature, str(m.sheetName), str(m.sourceColumn), str(m.targetField),
        ]);
    }
    ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [stamp, projectId]);
  });
  return getProjectImport(ctx, projectId)!;
}

export function removeImport(ctx: Ctx, projectId: string): void {
  getProject(ctx, projectId);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM project_imports WHERE project_id = ?', [projectId]);
    ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [now(), projectId]);
  });
}

export function savedMappings(ctx: Ctx, signature: string) {
  return ctx.db
    .all<Record<string, any>>('SELECT * FROM import_column_mappings WHERE workbook_signature = ?', [signature])
    .map((r) => ({ sheetName: r.sheet_name, sourceColumn: r.source_column, targetField: r.target_field }));
}
