import { randomUUID } from 'node:crypto';
import { cleanName } from '../../shared/text';
import type {
  ImportPayload,
  Project,
  ProjectCategory,
  ProjectImport,
  ProjectInput,
} from '../../shared/types';
import { fileExtension, hasErrors, validateProjectInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, type Ctx } from '../context';
import { getYear } from './master';

const SELECT_PROJECT = `
SELECT p.*, y.job_type, y.year_label,
  c.name AS client_name, d.name AS design_unit_name, s.name AS stage_name,
  EXISTS (SELECT 1 FROM project_imports i WHERE i.project_id = p.id) AS has_import
FROM projects p
JOIN job_years y ON y.id = p.job_year_id
JOIN clients c ON c.id = p.client_id
LEFT JOIN design_units d ON d.id = p.design_unit_id
LEFT JOIN project_stages s ON s.id = p.stage_id`;

function mapProject(r: Record<string, any>): Project {
  return {
    id: r.id,
    jobYearId: r.job_year_id,
    jobType: r.job_type,
    yearLabel: r.year_label,
    workCategory: r.work_category,
    receivedDate: r.received_date,
    dueDate: r.due_date,
    projectName: r.project_name,
    clientId: r.client_id,
    clientName: r.client_name,
    designUnitId: strOrNull(r.design_unit_id),
    designUnitName: strOrNull(r.design_unit_name),
    stageId: strOrNull(r.stage_id),
    stageName: strOrNull(r.stage_name),
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
  return ctx.db.all(SELECT_PROJECT).map(mapProject);
}

export function getProject(ctx: Ctx, id: string): Project {
  const r = ctx.db.get(`${SELECT_PROJECT} WHERE p.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy dự án (có thể đã bị xóa).');
  return mapProject(r);
}

function exists(ctx: Ctx, table: string, id: string | null): boolean {
  return !id || ctx.db.scalar<number>(`SELECT COUNT(*) FROM ${table} WHERE id = ?`, [id]) > 0;
}

function normalizeInput(ctx: Ctx, input: ProjectInput): ProjectInput {
  const errors = validateProjectInput(input);
  if (hasErrors(errors)) throw new AppError(Object.values(errors).filter(Boolean).join(' '));
  getYear(ctx, input.jobYearId);
  if (!exists(ctx, 'clients', input.clientId)) throw new AppError('CĐT không tồn tại.');
  if (!exists(ctx, 'design_units', input.designUnitId)) throw new AppError('Đơn vị thiết kế không tồn tại.');
  if (!exists(ctx, 'project_stages', input.stageId)) throw new AppError('Giai đoạn không tồn tại.');
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
    ...input,
    projectName: cleanName(input.projectName),
    note: (input.note ?? '').replace(/\r\n/g, '\n'),
    filePath,
    fileName,
    fileExtension: ext,
  };
}

export function createProject(ctx: Ctx, raw: ProjectInput): Project {
  const p = normalizeInput(ctx, raw);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() =>
    ctx.db.run(
      `INSERT INTO projects (id, job_year_id, work_category, received_date, due_date, project_name, client_id,
        design_unit_id, note, stage_id, file_path, file_name, file_extension, priority_point, is_completed,
        completed_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,?)`,
      [id, p.jobYearId, p.workCategory, p.receivedDate, p.dueDate, p.projectName, p.clientId, p.designUnitId, p.note,
        p.stageId, p.filePath, p.fileName, p.fileExtension, p.priorityPoint, stamp, stamp],
    ),
  );
  return getProject(ctx, id);
}

export function updateProject(ctx: Ctx, id: string, raw: ProjectInput): Project {
  getProject(ctx, id);
  const p = normalizeInput(ctx, raw);
  ctx.db.tx(() =>
    ctx.db.run(
      `UPDATE projects SET job_year_id=?, work_category=?, received_date=?, due_date=?, project_name=?, client_id=?,
        design_unit_id=?, note=?, stage_id=?, file_path=?, file_name=?, file_extension=?, priority_point=?, updated_at=?
       WHERE id=?`,
      [p.jobYearId, p.workCategory, p.receivedDate, p.dueDate, p.projectName, p.clientId, p.designUnitId, p.note,
        p.stageId, p.filePath, p.fileName, p.fileExtension, p.priorityPoint, now(), id],
    ),
  );
  return getProject(ctx, id);
}

/** Không xóa file gốc trên ổ đĩa; Experience giữ project_text snapshot. */
export function deleteProject(ctx: Ctx, id: string): void {
  const p = getProject(ctx, id);
  ctx.db.tx(() => {
    ctx.db.run(
      `UPDATE experience_records SET project_text = COALESCE(NULLIF(project_text,''), ?), updated_at = ? WHERE project_id = ?`,
      [p.projectName, now(), id],
    );
    ctx.db.run('DELETE FROM projects WHERE id = ?', [id]);
  });
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
