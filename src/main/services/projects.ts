import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectFolderName } from '../../shared/folderName';
import { cleanName } from '../../shared/text';
import type {
  ImportPayload,
  LinkedFile,
  NamedRef,
  Project,
  ProjectCategory,
  ProjectImport,
  ProjectInput,
  ProjectSaved,
  ProjectSaveOptions,
} from '../../shared/types';
import { textToNoteHtml } from '../../shared/noteHtml';
import { LINK_FILE_EXTENSIONS, LINK_FILE_LABEL } from '../../shared/types';
import { LIMITS, fileExtension, hasErrors, validateProjectInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, todayOf, type Ctx } from '../context';
import { assertDirectory, ensureProjectFolder, moveProjectFolder, removeIfEmpty, undoFolderMove } from '../integration/folders';
import * as imports from './imports';
import { addProjectStartEvent, addProjectUpdateEvent, describeProjectChanges, hasProjectStartEvent, removeProjectEvents, syncProjectStartEvent } from './calendar';
import { getYear } from './master';
import { deleteUnreferencedImages, noteCalendarLine, projectNoteImageKeys, writeNote, type NoteWrite } from './notes';

const SELECT_PROJECT = `
SELECT p.*, y.job_type, y.year_label,
  c.name AS client_name, si.name AS si_name,
  sp.name AS salesperson_name, dep.name AS department_name,
  EXISTS (SELECT 1 FROM project_imports i WHERE i.project_id = p.id) AS has_import
FROM projects p
JOIN job_years y ON y.id = p.job_year_id
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN si_partners si ON si.id = p.si_id
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

function filesByProject(ctx: Ctx, projectId?: string): Map<string, LinkedFile[]> {
  const rows = ctx.db.all<{ project_id: string; file_path: string; file_name: string; file_extension: string }>(
    `SELECT project_id, file_path, file_name, file_extension FROM project_files ${projectId ? 'WHERE project_id = ?' : ''} ORDER BY sort_order, created_at`,
    projectId ? [projectId] : [],
  );
  const m = new Map<string, LinkedFile[]>();
  for (const r of rows) {
    const list = m.get(r.project_id) ?? [];
    list.push({ path: r.file_path, name: r.file_name, extension: r.file_extension });
    m.set(r.project_id, list);
  }
  return m;
}

function mapProject(r: Record<string, any>, brands: NamedRef[], files: LinkedFile[]): Project {
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
    salespersonId: strOrNull(r.salesperson_id),
    salespersonName: strOrNull(r.salesperson_name),
    salespersonDepartment: strOrNull(r.department_name),
    folderPath: strOrNull(r.folder_path),
    folderAuto: r.folder_auto === undefined || r.folder_auto === null ? true : !!r.folder_auto,
    note: str(r.note),
    erpLink: str(r.erp_link),
    files,
    filePath: files[0]?.path ?? null,
    fileName: files[0]?.name ?? null,
    fileExtension: files[0]?.extension ?? null,
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
  const files = filesByProject(ctx);
  return ctx.db.all(`${SELECT_PROJECT} ORDER BY p.stt`).map((r) => mapProject(r, brands.get(r.id as string) ?? [], files.get(r.id as string) ?? []));
}

export function getProject(ctx: Ctx, id: string): Project {
  const r = ctx.db.get(`${SELECT_PROJECT} WHERE p.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy dự án (có thể đã bị xóa).');
  return mapProject(r, brandsByProject(ctx, id).get(id) ?? [], filesByProject(ctx, id).get(id) ?? []);
}

/** STT đánh riêng cho từng danh sách (năm × Pre-sales/Post-sales): STT lớn nhất trong danh sách đó + 1. */
export function nextProjectStt(ctx: Ctx, jobYearId: string, category: ProjectCategory): number {
  return (
    (ctx.db.scalar<number>('SELECT COALESCE(MAX(stt), 0) FROM projects WHERE job_year_id = ? AND work_category = ?', [jobYearId, category]) ?? 0) + 1
  );
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
  salespersonId: string | null;
  note: string;
  erpLink: string | undefined;
  files: LinkedFile[];
  priorityPoint: number;
  folderParent: string | null | undefined;
  folderLink: string | null;
}

/** Chấp nhận cả dữ liệu từ client cũ (không có STT/SI/Hãng): STT tự cấp, SI/Hãng để trống. */
function normalizeInput(ctx: Ctx, input: ProjectInput, currentId?: string): Normalized {
  const errors = validateProjectInput(input);
  if (hasErrors(errors)) throw new AppError(Object.values(errors).filter(Boolean).join(' '));
  if (getYear(ctx, input.jobYearId).jobType !== 'MAIN') throw new AppError('Job Freelance không có Pre-sales / Post-sales — dùng bảng Job Freelance.');
  const clientId = strOrNull(input.clientId);
  const siId = strOrNull(input.siId);
  const salespersonId = strOrNull(input.salespersonId);
  if (!exists(ctx, 'clients', clientId)) throw new AppError('EU không tồn tại.');
  if (!exists(ctx, 'si_partners', siId)) throw new AppError('Tên SI không tồn tại.');
  if (!exists(ctx, 'salespersons', salespersonId)) throw new AppError('Sale không tồn tại.');
  const brandIds = [...new Set((Array.isArray(input.brandIds) ? input.brandIds : []).filter(Boolean))];
  for (const b of brandIds) if (!exists(ctx, 'brands', b)) throw new AppError('Hãng không tồn tại.');

  let stt = input.stt ?? undefined;
  const cur = currentId ? ctx.db.get<{ stt: number; job_year_id: string; work_category: string }>('SELECT stt, job_year_id, work_category FROM projects WHERE id = ?', [currentId]) : null;
  if (stt === undefined)
    stt = cur && cur.job_year_id === input.jobYearId && cur.work_category === input.workCategory ? cur.stt : nextProjectStt(ctx, input.jobYearId, input.workCategory);
  const dup = ctx.db.get<{ project_name: string }>('SELECT project_name FROM projects WHERE stt = ? AND job_year_id = ? AND work_category = ? AND id <> ?', [
    stt,
    input.jobYearId,
    input.workCategory,
    currentId ?? '',
  ]);
  if (dup)
    throw new AppError(
      `STT ${stt} đã được dùng cho dự án "${dup.project_name}" trong cùng danh sách. Hãy chọn STT khác (gợi ý: ${nextProjectStt(ctx, input.jobYearId, input.workCategory)}).`,
    );

  const files = normalizeFiles(input.files ?? (strOrNull(input.filePath) ? [{ path: input.filePath!, name: input.fileName ?? '', extension: '' }] : []));
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
    salespersonId,
    note: (input.note ?? '').replace(/\r\n/g, '\n'),
    erpLink: input.erpLink === undefined ? undefined : String(input.erpLink ?? '').trim(),
    files,
    priorityPoint: input.priorityPoint,
    folderParent: input.folderParent === undefined ? undefined : strOrNull(input.folderParent),
    folderLink: strOrNull(input.folderLink),
  };
}

/** Chuẩn hóa danh sách file liên kết: đúng đuôi cho phép, bỏ trùng đường dẫn (không phân biệt hoa thường). */
export function normalizeFiles(list: LinkedFile[]): LinkedFile[] {
  if (!Array.isArray(list)) throw new AppError('Danh sách file liên kết không hợp lệ.');
  if (list.length > 50) throw new AppError('Tối đa 50 file liên kết cho một dự án.');
  const seen = new Set<string>();
  const out: LinkedFile[] = [];
  for (const f of list) {
    const filePath = strOrNull(f?.path);
    if (!filePath) continue;
    const ext = fileExtension(filePath);
    if (!LINK_FILE_EXTENSIONS.includes(ext)) throw new AppError(`Chỉ hỗ trợ file ${LINK_FILE_LABEL}.`);
    const key = filePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: filePath, name: strOrNull(f.name) ?? filePath.split(/[\\/]/).pop() ?? filePath, extension: ext });
  }
  return out;
}

/** Ghi danh sách file liên kết; cột projects.file_* giữ bản sao file đầu tiên cho dữ liệu cũ. */
function writeFiles(ctx: Ctx, projectId: string, files: LinkedFile[]) {
  ctx.db.run('DELETE FROM project_files WHERE project_id = ?', [projectId]);
  const stamp = now();
  files.forEach((f, i) =>
    ctx.db.run('INSERT INTO project_files (id, project_id, file_path, file_name, file_extension, sort_order, created_at) VALUES (?,?,?,?,?,?,?)', [
      randomUUID(),
      projectId,
      f.path,
      f.name,
      f.extension,
      i,
      stamp,
    ]),
  );
  ctx.db.run('UPDATE projects SET file_path = ?, file_name = ?, file_extension = ? WHERE id = ?', [files[0]?.path ?? null, files[0]?.name ?? null, files[0]?.extension ?? null, projectId]);
}

/** Thay danh sách file liên kết của dự án (thêm / gỡ / thay từng file ở trang chi tiết). */
export function setProjectFiles(ctx: Ctx, id: string, list: LinkedFile[]): Project {
  getProject(ctx, id);
  const files = normalizeFiles(list);
  ctx.db.tx(() => {
    writeFiles(ctx, id, files);
    ctx.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [now(), id]);
  });
  return getProject(ctx, id);
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
  if (p.folderLink) assertDirectory(p.folderLink);
  const folder = p.folderLink ? null : p.folderParent ? ensureProjectFolder(p.folderParent, folderNameOf(ctx, p)) : null;
  try {
    ctx.db.tx(() => {
      ctx.db.run(
        `INSERT INTO projects (id, stt, job_year_id, work_category, received_date, due_date, project_name, client_id, si_id,
          salesperson_id, note, folder_path, priority_point,
          is_completed, completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?,?)`,
        [id, p.stt, p.jobYearId, p.workCategory, p.receivedDate, p.dueDate, p.projectName, p.clientId, p.siId,
          p.salespersonId, p.folderLink ?? folder?.path ?? null, p.priorityPoint,
          completed, completed ? stamp : null, stamp, stamp],
      );
      writeFiles(ctx, id, p.files);
      if (p.erpLink) ctx.db.run('UPDATE projects SET erp_link = ? WHERE id = ?', [p.erpLink, id]);
      if (p.folderLink) ctx.db.run('UPDATE projects SET folder_auto = 0 WHERE id = ?', [id]);
      writeBrands(ctx, id, p.brandIds);
      if (p.receivedDate) addProjectStartEvent(ctx, id, p.projectName, p.receivedDate);
      if (noteHtml !== undefined) writeNote(ctx, id, today, noteHtml);
      if (p.folderParent && !p.folderLink) rememberRoot(ctx, p.folderParent);
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
  if (before.folderPath && !before.folderAuto) {
    // Thư mục có sẵn do người dùng liên kết: giữ nguyên tên và vị trí.
  } else if (before.folderPath) {
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
          salesperson_id=?, folder_path=?, priority_point=?, updated_at=?
         WHERE id=?`,
        [p.stt, p.jobYearId, p.workCategory, p.receivedDate, p.dueDate, p.projectName, p.clientId, p.siId,
          p.salespersonId, folderPath, p.priorityPoint, now(), id],
      );
      writeFiles(ctx, id, p.files);
      if (p.erpLink !== undefined) ctx.db.run('UPDATE projects SET erp_link = ? WHERE id = ?', [p.erpLink, id]);
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
  if (p.folderPath && !p.folderAuto) throw new AppError('Thư mục của dự án này là thư mục có sẵn được liên kết — ứng dụng không tự đổi tên.');
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

/** Liên kết thư mục có sẵn (không tạo/đổi tên gì trên ổ đĩa) hoặc bỏ liên kết (`dir` = null, thư mục vẫn giữ nguyên). */
export function setProjectFolderLink(ctx: Ctx, id: string, dir: string | null): ProjectSaved {
  getProject(ctx, id);
  if (dir) assertDirectory(dir);
  ctx.db.tx(() =>
    ctx.db.run('UPDATE projects SET folder_path = ?, folder_auto = ?, updated_at = ? WHERE id = ?', [dir || null, dir ? 0 : 1, now(), id]),
  );
  return getProject(ctx, id);
}

function deleteProjectRow(ctx: Ctx, p: Project): void {
  removeProjectEvents(ctx, p.id);
  ctx.db.run(
    `UPDATE experience_records SET project_text = COALESCE(NULLIF(project_text,''), ?), updated_at = ? WHERE project_id = ?`,
    [p.projectName, now(), p.id],
  );
  ctx.db.run('DELETE FROM projects WHERE id = ?', [p.id]);
}

/** Không đụng tới thư mục trên ổ đĩa (việc chuyển thư mục vào Thùng rác do lớp gọi xử lý trước). */
export function deleteProject(ctx: Ctx, id: string): void {
  deleteProjects(ctx, [id]);
}

/** Xóa nhiều dự án trong một transaction; id không còn tồn tại thì bỏ qua. Trả về số dự án đã xóa. */
export function deleteProjects(ctx: Ctx, ids: string[]): number {
  const list = [...new Set(ids)].map((id) => {
    const r = ctx.db.get(`${SELECT_PROJECT} WHERE p.id = ?`, [id]);
    return r ? mapProject(r, [], []) : null;
  });
  const found = list.filter((p): p is Project => !!p);
  if (ids.length === 1 && !found.length) throw new AppError('Không tìm thấy dự án (có thể đã bị xóa).');
  const noteImages = found.flatMap((p) => projectNoteImageKeys(ctx, p.id));
  ctx.db.tx(() => found.forEach((p) => deleteProjectRow(ctx, p)));
  deleteUnreferencedImages(ctx, noteImages);
  return found.length;
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
  if (getYear(ctx, jobYearId).jobType !== 'MAIN') throw new AppError('Job Freelance không có Pre-sales / Post-sales.');
  if (category !== 'PRE_SALES' && category !== 'POST_SALES') throw new AppError('Nhóm đích không hợp lệ.');
  const p = getProject(ctx, id);
  if (p.jobYearId === jobYearId && p.workCategory === category) return p;
  // STT đã có người dùng ở danh sách đích thì lấy số tiếp theo của danh sách đó.
  const taken = ctx.db.scalar<number>('SELECT COUNT(*) FROM projects WHERE job_year_id = ? AND work_category = ? AND stt = ?', [jobYearId, category, p.stt]) > 0;
  const stt = taken ? nextProjectStt(ctx, jobYearId, category) : p.stt;
  ctx.db.tx(() =>
    ctx.db.run('UPDATE projects SET job_year_id = ?, work_category = ?, stt = ?, updated_at = ? WHERE id = ?', [jobYearId, category, stt, now(), id]),
  );
  return getProject(ctx, id);
}

/* ---------------- Import XLSX (dùng chung với Sự kiện tạm thời, xem imports.ts) ---------------- */

/** Các bảng thiết bị đã import của dự án theo thứ tự tab (trái → phải); mỗi lần import / import thêm là một bảng. */
export function listProjectImports(ctx: Ctx, projectId: string): ProjectImport[] {
  return imports.listImports(ctx, imports.PROJECT_IMPORTS, projectId);
}

/** Thêm một bảng import mới cho dự án; có `replaceImportId` thì thay đúng bảng đó (Import lại). */
export function commitImport(ctx: Ctx, projectId: string, payload: ImportPayload, replaceImportId: string | null = null): ProjectImport {
  return imports.commitImport(ctx, imports.PROJECT_IMPORTS, projectId, payload, replaceImportId);
}

/** Gỡ một bảng import khỏi dự án (dự án và file .xlsx gốc không bị ảnh hưởng). */
export function removeImport(ctx: Ctx, projectId: string, importId: string): void {
  imports.removeImport(ctx, imports.PROJECT_IMPORTS, projectId, importId);
}

/** Đổi tên tab của một bảng import (không trùng tên tab khác trong dự án, không phân biệt hoa/thường). */
export function renameImport(ctx: Ctx, projectId: string, importId: string, name: string): ProjectImport {
  return imports.renameImport(ctx, imports.PROJECT_IMPORTS, projectId, importId, name);
}

/** Xếp lại thứ tự tab: `ids` phải là đủ các bảng import hiện có của dự án, mỗi bảng một lần. */
export function reorderImports(ctx: Ctx, projectId: string, ids: string[]): ProjectImport[] {
  return imports.reorderImports(ctx, imports.PROJECT_IMPORTS, projectId, ids);
}

export function savedMappings(ctx: Ctx, signature: string) {
  return ctx.db
    .all<Record<string, any>>('SELECT * FROM import_column_mappings WHERE workbook_signature = ?', [signature])
    .map((r) => ({ sheetName: r.sheet_name, sourceColumn: r.source_column, targetField: r.target_field }));
}
