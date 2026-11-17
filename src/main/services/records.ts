import { randomUUID } from 'node:crypto';
import type {
  ExperienceInput,
  ExperienceRecord,
  ImageRef,
  KnowledgeInput,
  KnowledgeRecord,
  WarrantyInput,
  WarrantyRecord,
} from '../../shared/types';
import { hasErrors, validateExperienceInput, validateKnowledgeInput, validateWarrantyInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, type Ctx } from '../context';
import { assertStorageKey, deleteImageFiles, imageExists } from '../integration/images';
import { getYear } from './master';

type ImageTable =
  | { table: 'warranty_images'; owner: 'warranty_record_id' }
  | { table: 'experience_images'; owner: 'experience_id' }
  | { table: 'knowledge_images'; owner: 'knowledge_id' };
const WARRANTY_IMG: ImageTable = { table: 'warranty_images', owner: 'warranty_record_id' };
const EXPERIENCE_IMG: ImageTable = { table: 'experience_images', owner: 'experience_id' };
const KNOWLEDGE_IMG: ImageTable = { table: 'knowledge_images', owner: 'knowledge_id' };

function loadImages(ctx: Ctx, t: ImageTable, ownerIds: string[]): Map<string, ImageRef[]> {
  const map = new Map<string, ImageRef[]>();
  if (!ownerIds.length) return map;
  const rows = ctx.db.all<Record<string, any>>(`SELECT * FROM ${t.table} ORDER BY sort_order, created_at`);
  const wanted = new Set(ownerIds);
  for (const r of rows) {
    const owner = r[t.owner] as string;
    if (!wanted.has(owner)) continue;
    const list = map.get(owner) ?? [];
    list.push({ storageKey: r.storage_key, fileName: r.file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes });
    map.set(owner, list);
  }
  return map;
}

/** Đồng bộ danh sách ảnh; trả về các storage key bị bỏ để xóa file sau khi commit. */
function syncImages(ctx: Ctx, t: ImageTable, ownerId: string, images: ImageRef[]): string[] {
  if (!Array.isArray(images)) throw new AppError('Danh sách ảnh không hợp lệ.');
  const existing = ctx.db.all<{ storage_key: string }>(`SELECT storage_key FROM ${t.table} WHERE ${t.owner} = ?`, [ownerId]);
  const keep = new Set(images.map((i) => i.storageKey));
  const removed = existing.map((e) => e.storage_key).filter((k) => !keep.has(k));
  ctx.db.run(`DELETE FROM ${t.table} WHERE ${t.owner} = ?`, [ownerId]);
  const stamp = now();
  images.forEach((img, i) => {
    assertStorageKey(img.storageKey);
    if (!imageExists(ctx, img.storageKey)) throw new AppError(`Ảnh "${img.fileName}" không còn trong kho ảnh, hãy thêm lại.`);
    ctx.db.run(`INSERT INTO ${t.table} VALUES (?,?,?,?,?,?,?,?)`, [
      randomUUID(), ownerId, img.storageKey, str(img.fileName).slice(0, 255), str(img.mimeType), Number(img.sizeBytes) || 0, i, stamp,
    ]);
  });
  return removed;
}

/* ---------------- Warranty ---------------- */

const SELECT_WARRANTY = `
SELECT w.*, y.job_type, y.year_label, b.name AS brand_name, si.name AS si_name
FROM warranty_records w
JOIN job_years y ON y.id = w.job_year_id
LEFT JOIN brands b ON b.id = w.brand_id
LEFT JOIN si_partners si ON si.id = w.si_id`;

function mapWarranty(r: Record<string, any>, images: ImageRef[]): WarrantyRecord {
  return {
    id: r.id,
    stt: r.stt,
    jobYearId: r.job_year_id,
    jobType: r.job_type,
    yearLabel: r.year_label,
    model: str(r.model),
    brandId: strOrNull(r.brand_id),
    brandName: strOrNull(r.brand_name),
    siId: strOrNull(r.si_id),
    siName: strOrNull(r.si_name),
    ipAddress: str(r.ip_address),
    username: str(r.username),
    hasPassword: !!r.password_encrypted,
    macAddress: str(r.mac_address),
    serialNumber: str(r.serial_number),
    receivedDate: strOrNull(r.received_date),
    testedDate: strOrNull(r.tested_date),
    customerReport: str(r.customer_report),
    inspection: str(r.inspection),
    result: str(r.result),
    resolution: str(r.resolution),
    caseNumber: str(r.case_number),
    images,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listWarranty(ctx: Ctx, jobYearId: string): WarrantyRecord[] {
  const rows = ctx.db.all<Record<string, any>>(`${SELECT_WARRANTY} WHERE w.job_year_id = ? ORDER BY w.stt DESC`, [jobYearId]);
  const imgs = loadImages(ctx, WARRANTY_IMG, rows.map((r) => r.id));
  return rows.map((r) => mapWarranty(r, imgs.get(r.id) ?? []));
}

function getWarranty(ctx: Ctx, id: string): WarrantyRecord {
  const r = ctx.db.get<Record<string, any>>(`${SELECT_WARRANTY} WHERE w.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy Warranty Record.');
  return mapWarranty(r, loadImages(ctx, WARRANTY_IMG, [id]).get(id) ?? []);
}

export function nextWarrantyStt(ctx: Ctx, jobYearId: string): number {
  return (ctx.db.scalar<number>('SELECT COALESCE(MAX(stt), 0) FROM warranty_records WHERE job_year_id = ?', [jobYearId]) ?? 0) + 1;
}

/** STT duy nhất trong năm: bỏ trống (undefined) thì giữ STT cũ khi sửa cùng năm, hoặc lấy STT lớn nhất + 1. */
function resolveWarrantyStt(ctx: Ctx, input: WarrantyInput, currentId?: string): number {
  let stt = input.stt ?? undefined;
  if (stt === undefined && currentId) {
    const cur = ctx.db.get<{ stt: number; job_year_id: string }>('SELECT stt, job_year_id FROM warranty_records WHERE id = ?', [currentId]);
    if (cur && cur.job_year_id === input.jobYearId) stt = cur.stt;
  }
  if (stt === undefined) return nextWarrantyStt(ctx, input.jobYearId);
  const dup = ctx.db.get<{ model: string | null; case_number: string | null }>(
    'SELECT model, case_number FROM warranty_records WHERE job_year_id = ? AND stt = ? AND id <> ?',
    [input.jobYearId, stt, currentId ?? ''],
  );
  if (dup)
    throw new AppError(`STT ${stt} đã dùng cho bản ghi "${dup.model || dup.case_number || 'khác'}" trong năm này. Hãy chọn STT khác (gợi ý: ${nextWarrantyStt(ctx, input.jobYearId)}).`);
  return stt;
}

function checkWarranty(ctx: Ctx, input: WarrantyInput) {
  const e = validateWarrantyInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  if (getYear(ctx, input.jobYearId).jobType !== 'MAIN') throw new AppError('Job Freelance không có Warranty.');
  if (input.brandId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM brands WHERE id = ?', [input.brandId]))
    throw new AppError('Hãng không tồn tại.');
  if (input.siId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM si_partners WHERE id = ?', [input.siId]))
    throw new AppError('Tên SI không tồn tại.');
}

const t = (s: string) => s.replace(/\r\n/g, '\n').trim();

export function createWarranty(ctx: Ctx, input: WarrantyInput): WarrantyRecord {
  checkWarranty(ctx, input);
  const stt = resolveWarrantyStt(ctx, input);
  const id = randomUUID();
  const stamp = now();
  // Duplicate: chép mật khẩu đã mã hóa của bản gốc, không cần giải mã.
  const copied =
    input.password === undefined && input.copyPasswordFrom
      ? ctx.db.scalar<string | null>('SELECT password_encrypted FROM warranty_records WHERE id = ?', [input.copyPasswordFrom]) ?? null
      : null;
  const pwd = input.password ? ctx.platform.encrypt(input.password) : copied;
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO warranty_records (id, stt, job_year_id, model, brand_id, ip_address, username, password_encrypted, mac_address,
        serial_number, received_date, tested_date, customer_report, inspection, result, resolution, case_number, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, stt, input.jobYearId, t(input.model), input.brandId, t(input.ipAddress), t(input.username), pwd, t(input.macAddress),
        t(input.serialNumber), input.receivedDate, input.testedDate, t(input.customerReport), t(input.inspection), t(input.result),
        t(input.resolution), t(input.caseNumber), stamp, stamp],
    );
    ctx.db.run('UPDATE warranty_records SET si_id = ? WHERE id = ?', [input.siId || null, id]);
    syncImages(ctx, WARRANTY_IMG, id, input.images);
  });
  return getWarranty(ctx, id);
}

export function updateWarranty(ctx: Ctx, id: string, input: WarrantyInput): WarrantyRecord {
  getWarranty(ctx, id);
  checkWarranty(ctx, input);
  const stt = resolveWarrantyStt(ctx, input, id);
  let removed: string[] = [];
  ctx.db.tx(() => {
    ctx.db.run('UPDATE warranty_records SET stt = ? WHERE id = ?', [stt, id]);
    ctx.db.run(
      `UPDATE warranty_records SET job_year_id=?, model=?, brand_id=?, ip_address=?, username=?, mac_address=?, serial_number=?,
        received_date=?, tested_date=?, customer_report=?, inspection=?, result=?, resolution=?, case_number=?, updated_at=? WHERE id=?`,
      [input.jobYearId, t(input.model), input.brandId, t(input.ipAddress), t(input.username), t(input.macAddress), t(input.serialNumber),
        input.receivedDate, input.testedDate, t(input.customerReport), t(input.inspection), t(input.result), t(input.resolution),
        t(input.caseNumber), now(), id],
    );
    if (input.password !== undefined)
      ctx.db.run('UPDATE warranty_records SET password_encrypted = ? WHERE id = ?', [input.password ? ctx.platform.encrypt(input.password) : null, id]);
    if (input.siId !== undefined) ctx.db.run('UPDATE warranty_records SET si_id = ? WHERE id = ?', [input.siId || null, id]);
    removed = syncImages(ctx, WARRANTY_IMG, id, input.images);
  });
  deleteImageFiles(ctx, removed);
  return getWarranty(ctx, id);
}

export function deleteWarranty(ctx: Ctx, id: string): void {
  const rec = getWarranty(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM warranty_records WHERE id = ?', [id]));
  deleteImageFiles(ctx, rec.images.map((i) => i.storageKey));
}

/** Xóa nhiều Warranty Record (kèm ảnh) trong một transaction; id không còn tồn tại thì bỏ qua. */
export function deleteWarranties(ctx: Ctx, ids: string[]): number {
  const found = [...new Set(ids)].filter((id) => ctx.db.scalar<number>('SELECT COUNT(*) FROM warranty_records WHERE id = ?', [id]) > 0);
  const images = loadImages(ctx, WARRANTY_IMG, found);
  ctx.db.tx(() => found.forEach((id) => ctx.db.run('DELETE FROM warranty_records WHERE id = ?', [id])));
  deleteImageFiles(ctx, [...images.values()].flat().map((i) => i.storageKey));
  return found.length;
}

export function revealWarrantyPassword(ctx: Ctx, id: string): string {
  const row = ctx.db.get<{ password_encrypted: string | null }>('SELECT password_encrypted FROM warranty_records WHERE id = ?', [id]);
  if (!row) throw new AppError('Không tìm thấy Warranty Record.');
  if (!row.password_encrypted) return '';
  try {
    return ctx.platform.decrypt(row.password_encrypted);
  } catch {
    throw new AppError('Không giải mã được mật khẩu (dữ liệu có thể được khôi phục từ máy khác).');
  }
}

/* ---------------- Experience ---------------- */

const SELECT_EXPERIENCE = `
SELECT e.*, b.name AS brand_name, p.project_name AS linked_project_name
FROM experience_records e
JOIN brands b ON b.id = e.brand_id
LEFT JOIN projects p ON p.id = e.project_id`;

function mapExperience(r: Record<string, any>, images: ImageRef[]): ExperienceRecord {
  const projectExists = !!r.linked_project_name;
  return {
    id: r.id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    experienceDate: r.experience_date,
    projectId: strOrNull(r.project_id),
    projectText: projectExists ? r.linked_project_name : strOrNull(r.project_text),
    projectExists,
    deviceModel: str(r.device_model),
    event: str(r.event),
    webUrl: str(r.web_url),
    localPath: str(r.local_path),
    images,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listExperience(ctx: Ctx, brandId: string | null): ExperienceRecord[] {
  const rows = brandId
    ? ctx.db.all<Record<string, any>>(`${SELECT_EXPERIENCE} WHERE e.brand_id = ? ORDER BY e.experience_date DESC, e.created_at DESC`, [brandId])
    : ctx.db.all<Record<string, any>>(`${SELECT_EXPERIENCE} ORDER BY e.experience_date DESC`);
  const imgs = loadImages(ctx, EXPERIENCE_IMG, rows.map((r) => r.id));
  return rows.map((r) => mapExperience(r, imgs.get(r.id) ?? []));
}

function getExperience(ctx: Ctx, id: string): ExperienceRecord {
  const r = ctx.db.get<Record<string, any>>(`${SELECT_EXPERIENCE} WHERE e.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy Experience.');
  return mapExperience(r, loadImages(ctx, EXPERIENCE_IMG, [id]).get(id) ?? []);
}

function prepareExperience(ctx: Ctx, input: ExperienceInput) {
  const e = validateExperienceInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  if (!ctx.db.scalar<number>('SELECT COUNT(*) FROM brands WHERE id = ?', [input.brandId])) throw new AppError('Hãng không tồn tại.');
  let projectText = input.projectText?.trim() || null;
  if (input.projectId) {
    const p = ctx.db.get<{ project_name: string }>('SELECT project_name FROM projects WHERE id = ?', [input.projectId]);
    if (!p) throw new AppError('Project được liên kết không tồn tại.');
    projectText = p.project_name;
  }
  return { projectText, webUrl: input.webUrl.trim(), localPath: (input.localPath ?? '').trim() || null };
}

export function createExperience(ctx: Ctx, input: ExperienceInput): ExperienceRecord {
  const { projectText, webUrl, localPath } = prepareExperience(ctx, input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO experience_records (id, brand_id, experience_date, project_id, project_text, device_model, event, web_url, local_path, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.brandId, input.experienceDate, input.projectId, projectText, t(input.deviceModel), t(input.event), webUrl, localPath, stamp, stamp],
    );
    syncImages(ctx, EXPERIENCE_IMG, id, input.images);
  });
  return getExperience(ctx, id);
}

export function updateExperience(ctx: Ctx, id: string, input: ExperienceInput): ExperienceRecord {
  getExperience(ctx, id);
  const { projectText, webUrl, localPath } = prepareExperience(ctx, input);
  let removed: string[] = [];
  ctx.db.tx(() => {
    ctx.db.run(
      `UPDATE experience_records SET brand_id=?, experience_date=?, project_id=?, project_text=?, device_model=?, event=?, web_url=?, local_path=?, updated_at=? WHERE id=?`,
      [input.brandId, input.experienceDate, input.projectId, projectText, t(input.deviceModel), t(input.event), webUrl, localPath, now(), id],
    );
    removed = syncImages(ctx, EXPERIENCE_IMG, id, input.images);
  });
  deleteImageFiles(ctx, removed);
  return getExperience(ctx, id);
}

export function deleteExperience(ctx: Ctx, id: string): void {
  const rec = getExperience(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM experience_records WHERE id = ?', [id]));
  deleteImageFiles(ctx, rec.images.map((i) => i.storageKey));
}

/* ---------------- Kiến thức ---------------- */

const SELECT_KNOWLEDGE = `
SELECT k.*, b.name AS brand_name
FROM knowledge_records k
LEFT JOIN brands b ON b.id = k.brand_id`;

function mapKnowledge(r: Record<string, any>, images: ImageRef[]): KnowledgeRecord {
  return {
    id: r.id,
    brandId: strOrNull(r.brand_id),
    brandName: strOrNull(r.brand_name),
    knowledgeDate: r.knowledge_date,
    title: str(r.title),
    deviceModel: str(r.device_model),
    content: str(r.content),
    webUrl: str(r.web_url),
    localPath: str(r.local_path),
    images,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** `brandId`: undefined = tất cả, null = Kiến thức chung (không gắn Hãng). */
export function listKnowledge(ctx: Ctx, brandId?: string | null): KnowledgeRecord[] {
  const order = 'ORDER BY k.knowledge_date DESC, k.created_at DESC';
  const rows =
    brandId === undefined
      ? ctx.db.all<Record<string, any>>(`${SELECT_KNOWLEDGE} ${order}`)
      : brandId === null
        ? ctx.db.all<Record<string, any>>(`${SELECT_KNOWLEDGE} WHERE k.brand_id IS NULL ${order}`)
        : ctx.db.all<Record<string, any>>(`${SELECT_KNOWLEDGE} WHERE k.brand_id = ? ${order}`, [brandId]);
  const imgs = loadImages(ctx, KNOWLEDGE_IMG, rows.map((r) => r.id));
  return rows.map((r) => mapKnowledge(r, imgs.get(r.id) ?? []));
}

function getKnowledge(ctx: Ctx, id: string): KnowledgeRecord {
  const r = ctx.db.get<Record<string, any>>(`${SELECT_KNOWLEDGE} WHERE k.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy mục Kiến thức.');
  return mapKnowledge(r, loadImages(ctx, KNOWLEDGE_IMG, [id]).get(id) ?? []);
}

function checkKnowledge(ctx: Ctx, input: KnowledgeInput) {
  const e = validateKnowledgeInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  if (input.brandId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM brands WHERE id = ?', [input.brandId])) throw new AppError('Hãng không tồn tại.');
}

export function createKnowledge(ctx: Ctx, input: KnowledgeInput): KnowledgeRecord {
  checkKnowledge(ctx, input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO knowledge_records (id, brand_id, knowledge_date, title, device_model, content, web_url, local_path, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, input.brandId || null, input.knowledgeDate, t(input.title), t(input.deviceModel), t(input.content), input.webUrl.trim(), (input.localPath ?? '').trim() || null, stamp, stamp],
    );
    syncImages(ctx, KNOWLEDGE_IMG, id, input.images);
  });
  return getKnowledge(ctx, id);
}

export function updateKnowledge(ctx: Ctx, id: string, input: KnowledgeInput): KnowledgeRecord {
  getKnowledge(ctx, id);
  checkKnowledge(ctx, input);
  let removed: string[] = [];
  ctx.db.tx(() => {
    ctx.db.run(
      `UPDATE knowledge_records SET brand_id=?, knowledge_date=?, title=?, device_model=?, content=?, web_url=?, local_path=?, updated_at=? WHERE id=?`,
      [input.brandId || null, input.knowledgeDate, t(input.title), t(input.deviceModel), t(input.content), input.webUrl.trim(), (input.localPath ?? '').trim() || null, now(), id],
    );
    removed = syncImages(ctx, KNOWLEDGE_IMG, id, input.images);
  });
  deleteImageFiles(ctx, removed);
  return getKnowledge(ctx, id);
}

export function deleteKnowledge(ctx: Ctx, id: string): void {
  const rec = getKnowledge(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM knowledge_records WHERE id = ?', [id]));
  deleteImageFiles(ctx, rec.images.map((i) => i.storageKey));
}

/**
 * Mọi bảng có cột `storage_key` đều được coi là bảng ảnh: tự quét theo schema để bảng ảnh thêm sau
 * (ví dụ ảnh cho Project) không bị bước dọn ảnh mồ côi lúc khởi động xóa nhầm.
 */
export function referencedImageKeys(ctx: Ctx): Set<string> {
  const keys = new Set<string>();
  const tables = ctx.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  for (const { name } of tables) {
    const cols = ctx.db.all<{ name: string }>(`PRAGMA table_info("${name.replace(/"/g, '""')}")`);
    if (!cols.some((c) => c.name === 'storage_key')) continue;
    for (const r of ctx.db.all<{ storage_key: string }>(`SELECT storage_key FROM "${name.replace(/"/g, '""')}"`)) keys.add(r.storage_key);
  }
  return keys;
}
