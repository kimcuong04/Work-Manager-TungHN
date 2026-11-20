import { randomUUID } from 'node:crypto';
import { cleanName } from '../../shared/text';
import type { ImportPayload, ProjectImport } from '../../shared/types';
import { IMPORT_TAB_NAME_MAX, defaultImportTabName, importTabBase, uniqueImportTabName, validateImportTabName } from '../../shared/validation';
import { AppError, now, str, strOrNull, type Ctx } from '../context';

/**
 * Nơi lưu các bảng thiết bị import (xem như tab sheet): dự án Pre/Post-sales hoặc Sự kiện tạm thời. Dự án còn có thêm
 * bảng thông tin / yêu cầu từ bản import cũ (`extras`).
 */
export interface ImportStore {
  table: string;
  owner: string;
  items: string;
  itemOwner: string;
  ownerTable: string;
  extras: boolean;
  missingOwner: string;
}

export const PROJECT_IMPORTS: ImportStore = {
  table: 'project_imports',
  owner: 'project_id',
  items: 'imported_items',
  itemOwner: 'project_import_id',
  ownerTable: 'projects',
  extras: true,
  missingOwner: 'Không tìm thấy dự án (có thể đã bị xóa).',
};

export const EVENT_IMPORTS: ImportStore = {
  table: 'temp_event_imports',
  owner: 'event_id',
  items: 'temp_event_imported_items',
  itemOwner: 'import_id',
  ownerTable: 'temp_events',
  extras: false,
  missingOwner: 'Không tìm thấy sự kiện (có thể đã bị xóa).',
};

function assertOwner(ctx: Ctx, s: ImportStore, ownerId: string) {
  if (!ctx.db.scalar<number>(`SELECT COUNT(*) FROM ${s.ownerTable} WHERE id = ?`, [ownerId])) throw new AppError(s.missingOwner);
}

function mapImport(ctx: Ctx, s: ImportStore, imp: Record<string, any>): ProjectImport {
  return {
    id: imp.id,
    projectId: imp[s.owner],
    name: imp.tab_name || defaultImportTabName(imp.source_file_name),
    sortOrder: Number(imp.sort_order) || 0,
    sourceFileName: imp.source_file_name,
    sourcePath: strOrNull(imp.source_path),
    sheetNames: JSON.parse(imp.sheet_names || '[]'),
    importedAt: imp.imported_at,
    status: imp.status,
    info: s.extras
      ? ctx.db
          .all<Record<string, any>>('SELECT * FROM imported_project_info WHERE project_import_id = ? ORDER BY display_order', [imp.id])
          .map((r) => ({ fieldKey: r.field_key, fieldLabel: r.field_label, fieldValue: str(r.field_value) }))
      : [],
    requirements: s.extras
      ? ctx.db
          .all<Record<string, any>>('SELECT * FROM imported_requirements WHERE project_import_id = ? ORDER BY sort_order', [imp.id])
          .map((r) => ({ roundNumber: r.round_number, content: str(r.content), createdDate: strOrNull(r.created_date) }))
      : [],
    items: ctx.db
      .all<Record<string, any>>(`SELECT * FROM ${s.items} WHERE ${s.itemOwner} = ? ORDER BY sort_order`, [imp.id])
      .map((r) => ({ model: str(r.model), brand: str(r.brand), description: str(r.description) })),
  };
}

/** Các bảng import theo thứ tự tab (trái → phải); mỗi lần import / import thêm là một bảng. */
export function listImports(ctx: Ctx, s: ImportStore, ownerId: string): ProjectImport[] {
  return ctx.db
    .all<Record<string, any>>(`SELECT * FROM ${s.table} WHERE ${s.owner} = ? ORDER BY sort_order, imported_at, rowid`, [ownerId])
    .map((r) => mapImport(ctx, s, r));
}

function tabNames(ctx: Ctx, s: ImportStore, ownerId: string, exceptId: string | null): string[] {
  return ctx.db
    .all<{ tab_name: string }>(`SELECT tab_name FROM ${s.table} WHERE ${s.owner} = ? AND id <> ?`, [ownerId, exceptId ?? ''])
    .map((r) => r.tab_name);
}

/** Tên tab vẫn là tên tự đặt theo file / sheet cũ (chưa đổi tay) thì Import lại sẽ đặt theo file mới. */
function isAutoTabName(name: string, old: ProjectImport): boolean {
  const bases = [defaultImportTabName(old.sourceFileName), ...old.sheetNames.map((sh) => importTabBase(old.sourceFileName, sh))];
  const m = / \((\d+)\)$/.exec(name);
  return bases.some((base) => name === base || (!!m && name === base.slice(0, IMPORT_TAB_NAME_MAX - m[0].length).trimEnd() + m[0]));
}

function getImport(ctx: Ctx, s: ImportStore, ownerId: string, importId: string): ProjectImport {
  const r = ctx.db.get<Record<string, any>>(`SELECT * FROM ${s.table} WHERE id = ? AND ${s.owner} = ?`, [importId, ownerId]);
  if (!r) throw new AppError('Không tìm thấy bảng import này (có thể đã bị gỡ).');
  return mapImport(ctx, s, r);
}

function validatePayload(p: ImportPayload) {
  if (!p || typeof p.sourceFileName !== 'string') throw new AppError('Dữ liệu import không hợp lệ.');
  if (!Array.isArray(p.info) || !Array.isArray(p.requirements) || !Array.isArray(p.items))
    throw new AppError('Dữ liệu import không hợp lệ.');
  const hasData =
    p.info.some((r) => str(r.fieldValue).trim()) || p.requirements.length > 0 || p.items.length > 0;
  if (!hasData) throw new AppError('Không có dữ liệu nào được map. Hãy kiểm tra lại vùng dữ liệu và mapping.');
}

/**
 * Thêm một bảng import mới (tab nối vào cuối); có `replaceImportId` thì thay đúng bảng đó (Import lại, giữ vị trí tab).
 * Ghi toàn bộ trong một transaction: lỗi giữa chừng thì các bảng import cũ được giữ nguyên.
 */
export function commitImport(ctx: Ctx, s: ImportStore, ownerId: string, payload: ImportPayload, replaceImportId: string | null = null): ProjectImport {
  assertOwner(ctx, s, ownerId);
  validatePayload(payload);
  if (!s.extras && (payload.info.length || payload.requirements.length)) throw new AppError('Chỉ import được bảng thông tin các thiết bị.');
  const old = replaceImportId ? getImport(ctx, s, ownerId, replaceImportId) : null;
  const others = tabNames(ctx, s, ownerId, old?.id ?? null);
  const proposed = cleanName(String(payload.tabName ?? '')).slice(0, IMPORT_TAB_NAME_MAX).trim();
  const name = old && !isAutoTabName(old.name, old) ? old.name : uniqueImportTabName(proposed || defaultImportTabName(payload.sourceFileName), others);
  const order = old ? old.sortOrder : (ctx.db.scalar<number>(`SELECT MAX(sort_order) FROM ${s.table} WHERE ${s.owner} = ?`, [ownerId]) ?? -1) + 1;
  const importId = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    if (old) ctx.db.run(`DELETE FROM ${s.table} WHERE id = ? AND ${s.owner} = ?`, [old.id, ownerId]);
    ctx.db.run(
      `INSERT INTO ${s.table} (id, ${s.owner}, source_file_name, source_path, sheet_names, imported_at, status, tab_name, sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
      [importId, ownerId, payload.sourceFileName, payload.sourcePath, JSON.stringify(payload.sheetNames ?? []), stamp, 'IMPORTED', name, order],
    );
    if (s.extras) {
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
    }
    payload.items.forEach((r, i) =>
      ctx.db.run(`INSERT INTO ${s.items} (id, ${s.itemOwner}, model, brand, description, sort_order) VALUES (?,?,?,?,?,?)`, [
        randomUUID(), importId, str(r.model), str(r.brand), str(r.description), i,
      ]),
    );
    if (payload.workbookSignature && Array.isArray(payload.mappings) && payload.mappings.length) {
      ctx.db.run('DELETE FROM import_column_mappings WHERE workbook_signature = ?', [payload.workbookSignature]);
      for (const m of payload.mappings)
        ctx.db.run('INSERT OR REPLACE INTO import_column_mappings VALUES (?,?,?,?)', [
          payload.workbookSignature, str(m.sheetName), str(m.sourceColumn), str(m.targetField),
        ]);
    }
    ctx.db.run(`UPDATE ${s.ownerTable} SET updated_at = ? WHERE id = ?`, [stamp, ownerId]);
  });
  return getImport(ctx, s, ownerId, importId);
}

/** Gỡ một bảng import (chủ sở hữu và file .xlsx gốc không bị ảnh hưởng). */
export function removeImport(ctx: Ctx, s: ImportStore, ownerId: string, importId: string): void {
  assertOwner(ctx, s, ownerId);
  getImport(ctx, s, ownerId, importId);
  ctx.db.tx(() => {
    ctx.db.run(`DELETE FROM ${s.table} WHERE id = ? AND ${s.owner} = ?`, [importId, ownerId]);
    ctx.db.run(`UPDATE ${s.ownerTable} SET updated_at = ? WHERE id = ?`, [now(), ownerId]);
  });
}

/** Đổi tên tab của một bảng import (không trùng tên tab khác cùng chủ sở hữu, không phân biệt hoa/thường). */
export function renameImport(ctx: Ctx, s: ImportStore, ownerId: string, importId: string, name: string): ProjectImport {
  getImport(ctx, s, ownerId, importId);
  const err = validateImportTabName(name, tabNames(ctx, s, ownerId, importId));
  if (err) throw new AppError(err);
  ctx.db.tx(() => ctx.db.run(`UPDATE ${s.table} SET tab_name = ? WHERE id = ? AND ${s.owner} = ?`, [cleanName(name), importId, ownerId]));
  return getImport(ctx, s, ownerId, importId);
}

/** Xếp lại thứ tự tab: `ids` phải là đủ các bảng import hiện có, mỗi bảng một lần. */
export function reorderImports(ctx: Ctx, s: ImportStore, ownerId: string, ids: string[]): ProjectImport[] {
  assertOwner(ctx, s, ownerId);
  const current = ctx.db.all<{ id: string }>(`SELECT id FROM ${s.table} WHERE ${s.owner} = ?`, [ownerId]).map((r) => r.id);
  const list = Array.isArray(ids) ? ids.map(String) : [];
  if (list.length !== current.length || new Set(list).size !== list.length || !list.every((id) => current.includes(id)))
    throw new AppError('Danh sách bảng import đã thay đổi — hãy tải lại trang rồi thử lại.');
  ctx.db.tx(() => list.forEach((id, i) => ctx.db.run(`UPDATE ${s.table} SET sort_order = ? WHERE id = ? AND ${s.owner} = ?`, [i, id, ownerId])));
  return listImports(ctx, s, ownerId);
}
