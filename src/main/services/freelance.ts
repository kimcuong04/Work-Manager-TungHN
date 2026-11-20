import { randomUUID } from 'node:crypto';
import { textToNoteHtml } from '../../shared/noteHtml';
import { cleanName } from '../../shared/text';
import type { CompanionPayment, CompanionPaymentInput, FreelanceInput, FreelanceJob, FreelanceSaveOptions } from '../../shared/types';
import { hasErrors, validateCompanionPayment, validateFreelanceInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, todayOf, type Ctx } from '../context';
import { deleteImageFiles } from '../integration/images';
import { loadImages, syncImages, type ImageTable } from './records';
import { FREELANCE_NOTES, deleteUnreferencedImages, noteImageKeysOf, writeDayNote, type NoteWrite } from './notes';

const SELECT_FREELANCE = `
SELECT f.*, s.name AS status_name, s.color AS status_color, h.name AS hirer_name, ps.name AS payment_status_name, ps.color AS payment_status_color,
  (SELECT COUNT(*) FROM freelance_companion_payments cp WHERE cp.job_id = f.id) AS companion_payment_count
FROM freelance_jobs f
LEFT JOIN freelance_statuses s ON s.id = f.status_id
LEFT JOIN freelance_hirers h ON h.id = f.hirer_id
LEFT JOIN freelance_payment_statuses ps ON ps.id = f.payment_status_id`;

type Companion = { id: string; name: string };

/** Người đồng hành theo job (theo thứ tự chọn); `jobId` để lọc một job. */
function companionsByJob(ctx: Ctx, jobId?: string): Map<string, Companion[]> {
  const rows = ctx.db.all<{ job_id: string; id: string; name: string }>(
    `SELECT jc.job_id, c.id, c.name FROM freelance_job_companions jc JOIN freelance_companions c ON c.id = jc.companion_id
     ${jobId ? 'WHERE jc.job_id = ?' : ''} ORDER BY jc.sort_order, c.name`,
    jobId ? [jobId] : [],
  );
  const map = new Map<string, Companion[]>();
  for (const r of rows) map.set(r.job_id, [...(map.get(r.job_id) ?? []), { id: r.id, name: r.name }]);
  return map;
}

function mapJob(r: Record<string, any>, companions: Companion[] = []): FreelanceJob {
  return {
    id: r.id,
    stt: r.stt,
    projectName: r.project_name,
    hirerId: strOrNull(r.hirer_id),
    hirer: str(r.hirer_name),
    startDate: strOrNull(r.start_date),
    statusId: strOrNull(r.status_id),
    statusName: strOrNull(r.status_name),
    paymentStatusId: strOrNull(r.payment_status_id),
    paymentStatusName: strOrNull(r.payment_status_name),
    statusColor: strOrNull(r.status_color),
    paymentStatusColor: strOrNull(r.payment_status_color),
    companions,
    companionPaymentCount: Number(r.companion_payment_count) || 0,
    note: str(r.note),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listFreelance(ctx: Ctx): FreelanceJob[] {
  const companions = companionsByJob(ctx);
  return ctx.db.all(`${SELECT_FREELANCE} ORDER BY f.stt`).map((r) => mapJob(r, companions.get(r.id as string)));
}

export function getFreelance(ctx: Ctx, id: string): FreelanceJob {
  const r = ctx.db.get(`${SELECT_FREELANCE} WHERE f.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy job Freelance (có thể đã bị xóa).');
  return mapJob(r, companionsByJob(ctx, id).get(id));
}

export function nextFreelanceStt(ctx: Ctx): number {
  return (ctx.db.scalar<number>('SELECT COALESCE(MAX(stt), 0) FROM freelance_jobs') ?? 0) + 1;
}

interface Normalized {
  stt: number;
  projectName: string;
  hirerId: string | null;
  startDate: string | null;
  statusId: string | null;
  paymentStatusId: string | null;
  companionIds: string[] | undefined;
}

export function normalizeFreelance(ctx: Ctx, input: FreelanceInput, currentId?: string): Normalized {
  const errors = validateFreelanceInput(input);
  if (hasErrors(errors)) throw new AppError(Object.values(errors).filter(Boolean).join(' '));
  const statusId = strOrNull(input.statusId);
  if (statusId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_statuses WHERE id = ?', [statusId])) throw new AppError('Tình trạng không tồn tại.');
  const hirerId = strOrNull(input.hirerId);
  if (hirerId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_hirers WHERE id = ?', [hirerId])) throw new AppError('Bên thuê không tồn tại.');
  const paymentStatusId = strOrNull(input.paymentStatusId);
  if (paymentStatusId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_payment_statuses WHERE id = ?', [paymentStatusId]))
    throw new AppError('Trạng thái thanh toán không tồn tại.');
  let companionIds: string[] | undefined;
  if (input.companionIds !== undefined) {
    if (!Array.isArray(input.companionIds) || input.companionIds.length > 50) throw new AppError('Danh sách người đồng hành không hợp lệ (tối đa 50 người).');
    companionIds = [...new Set(input.companionIds.map(String).filter(Boolean))];
    for (const c of companionIds)
      if (!ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_companions WHERE id = ?', [c])) throw new AppError('Người đồng hành không tồn tại.');
  }
  let stt = input.stt ?? undefined;
  if (stt === undefined) stt = currentId ? ctx.db.scalar<number>('SELECT stt FROM freelance_jobs WHERE id = ?', [currentId]) : nextFreelanceStt(ctx);
  const dup = ctx.db.get<{ project_name: string }>('SELECT project_name FROM freelance_jobs WHERE stt = ? AND id <> ?', [stt, currentId ?? '']);
  if (dup) throw new AppError(`STT ${stt} đã được dùng cho job "${dup.project_name}". Hãy chọn STT khác (gợi ý: ${nextFreelanceStt(ctx)}).`);
  return {
    stt: stt!,
    projectName: cleanName(input.projectName),
    hirerId,
    startDate: strOrNull(input.startDate),
    statusId,
    paymentStatusId,
    companionIds,
  };
}

/** Thay danh sách người đồng hành; không bỏ được người đã có lần thanh toán trong job (xóa các lần thanh toán trước). */
function writeCompanions(ctx: Ctx, jobId: string, ids: string[] | undefined) {
  if (ids === undefined) return;
  const current = ctx.db.all<{ companion_id: string; name: string }>(
    'SELECT jc.companion_id, c.name FROM freelance_job_companions jc JOIN freelance_companions c ON c.id = jc.companion_id WHERE jc.job_id = ?',
    [jobId],
  );
  for (const c of current) {
    if (ids.includes(c.companion_id)) continue;
    const paid = ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_companion_payments WHERE job_id = ? AND companion_id = ?', [jobId, c.companion_id]) ?? 0;
    if (paid) throw new AppError(`${c.name} đã có ${paid} lần thanh toán trong job này — xóa các lần thanh toán đó trước khi bỏ khỏi job.`);
  }
  ctx.db.run('DELETE FROM freelance_job_companions WHERE job_id = ?', [jobId]);
  ids.forEach((c, i) => ctx.db.run('INSERT INTO freelance_job_companions (job_id, companion_id, sort_order) VALUES (?,?,?)', [jobId, c, i]));
}

/** `noteHtml` (hoặc ghi chú dạng chữ khi import) thành mục ghi chú của hôm nay. */
export function createFreelance(ctx: Ctx, input: FreelanceInput, opts: FreelanceSaveOptions = {}): FreelanceJob {
  const f = normalizeFreelance(ctx, input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run(
      'INSERT INTO freelance_jobs (id, stt, project_name, hirer_id, start_date, status_id, payment_status_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, f.stt, f.projectName, f.hirerId, f.startDate, f.statusId, f.paymentStatusId, '', stamp, stamp],
    );
    writeCompanions(ctx, id, f.companionIds);
    if (opts.noteHtml !== undefined) writeDayNote(ctx, FREELANCE_NOTES, id, todayOf(ctx), opts.noteHtml);
  });
  return getFreelance(ctx, id);
}

export function updateFreelance(ctx: Ctx, id: string, input: FreelanceInput, opts: FreelanceSaveOptions = {}): FreelanceJob {
  getFreelance(ctx, id);
  const f = normalizeFreelance(ctx, input, id);
  let note: NoteWrite = { changed: false, removedKeys: [], html: '' };
  ctx.db.tx(() => {
    ctx.db.run('UPDATE freelance_jobs SET stt=?, project_name=?, hirer_id=?, start_date=?, status_id=?, payment_status_id=?, updated_at=? WHERE id=?', [
      f.stt,
      f.projectName,
      f.hirerId,
      f.startDate,
      f.statusId,
      f.paymentStatusId,
      now(),
      id,
    ]);
    writeCompanions(ctx, id, f.companionIds);
    if (opts.noteHtml !== undefined) note = writeDayNote(ctx, FREELANCE_NOTES, id, todayOf(ctx), opts.noteHtml);
  });
  deleteUnreferencedImages(ctx, note.removedKeys);
  return getFreelance(ctx, id);
}

const inputOf = (job: FreelanceJob): FreelanceInput => ({
  stt: job.stt,
  projectName: job.projectName,
  hirerId: job.hirerId,
  startDate: job.startDate,
  statusId: job.statusId,
  paymentStatusId: job.paymentStatusId,
});

export function setFreelanceStatus(ctx: Ctx, id: string, statusId: string | null): FreelanceJob {
  return updateFreelance(ctx, id, { ...inputOf(getFreelance(ctx, id)), statusId });
}

export function setFreelancePaymentStatus(ctx: Ctx, id: string, paymentStatusId: string | null): FreelanceJob {
  return updateFreelance(ctx, id, { ...inputOf(getFreelance(ctx, id)), paymentStatusId });
}

const paymentImageKeys = (ctx: Ctx, jobId: string) =>
  ctx.db
    .all<{ storage_key: string }>('SELECT i.storage_key FROM freelance_payment_images i JOIN freelance_companion_payments p ON p.id = i.payment_id WHERE p.job_id = ?', [jobId])
    .map((r) => r.storage_key);

export function deleteFreelance(ctx: Ctx, id: string): void {
  getFreelance(ctx, id);
  const keys = noteImageKeysOf(ctx, FREELANCE_NOTES, id);
  const paid = paymentImageKeys(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM freelance_jobs WHERE id = ?', [id]));
  deleteUnreferencedImages(ctx, keys);
  deleteImageFiles(ctx, paid);
}

/** Xóa nhiều job Freelance (kèm ghi chú, ảnh) trong một transaction; id không còn tồn tại thì bỏ qua. */
export function deleteFreelances(ctx: Ctx, ids: string[]): number {
  const found = [...new Set(ids)].filter((id) => ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_jobs WHERE id = ?', [id]) > 0);
  const keys = found.flatMap((id) => noteImageKeysOf(ctx, FREELANCE_NOTES, id));
  const paid = found.flatMap((id) => paymentImageKeys(ctx, id));
  ctx.db.tx(() => found.forEach((id) => ctx.db.run('DELETE FROM freelance_jobs WHERE id = ?', [id])));
  deleteUnreferencedImages(ctx, keys);
  deleteImageFiles(ctx, paid);
  return found.length;
}

/* ---------------- Người đồng hành: các lần thanh toán ---------------- */

const PAYMENT_IMG: ImageTable = { table: 'freelance_payment_images', owner: 'payment_id' };

function mapPayment(r: Record<string, any>, images: CompanionPayment['images']): CompanionPayment {
  return {
    id: r.id,
    jobId: r.job_id,
    companionId: r.companion_id,
    paidDate: r.paid_date,
    amount: Number(r.amount),
    note: str(r.note),
    images,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Các lần thanh toán cho người đồng hành của một job, mới nhất trước (lọc theo một người nếu có `companionId`). */
export function listCompanionPayments(ctx: Ctx, jobId: string, companionId?: string): CompanionPayment[] {
  getFreelance(ctx, jobId);
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT * FROM freelance_companion_payments WHERE job_id = ? ${companionId ? 'AND companion_id = ?' : ''} ORDER BY paid_date DESC, created_at DESC`,
    companionId ? [jobId, companionId] : [jobId],
  );
  const imgs = loadImages(ctx, PAYMENT_IMG, rows.map((r) => r.id));
  return rows.map((r) => mapPayment(r, imgs.get(r.id) ?? []));
}

function getPayment(ctx: Ctx, id: string): CompanionPayment {
  const r = ctx.db.get<Record<string, any>>('SELECT * FROM freelance_companion_payments WHERE id = ?', [id]);
  if (!r) throw new AppError('Không tìm thấy lần thanh toán này (có thể đã bị xóa).');
  return mapPayment(r, loadImages(ctx, PAYMENT_IMG, [id]).get(id) ?? []);
}

function checkPayment(input: CompanionPaymentInput) {
  const e = validateCompanionPayment(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
}

/** Ghi một lần thanh toán cho người đồng hành của job; ngày thanh toán là hôm nay (tự ghi). */
export function addCompanionPayment(ctx: Ctx, jobId: string, companionId: string, input: CompanionPaymentInput): CompanionPayment {
  getFreelance(ctx, jobId);
  if (!ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_job_companions WHERE job_id = ? AND companion_id = ?', [jobId, companionId]))
    throw new AppError('Người này không còn là người đồng hành của job.');
  checkPayment(input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run(
      'INSERT INTO freelance_companion_payments (id, job_id, companion_id, paid_date, amount, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, jobId, companionId, todayOf(ctx), input.amount, String(input.note ?? '').trim(), stamp, stamp],
    );
    syncImages(ctx, PAYMENT_IMG, id, input.images);
    ctx.db.run('UPDATE freelance_jobs SET updated_at = ? WHERE id = ?', [stamp, jobId]);
  });
  return getPayment(ctx, id);
}

/** Sửa số tiền / ghi chú / ảnh của một lần thanh toán (ngày ghi giữ nguyên). */
export function updateCompanionPayment(ctx: Ctx, id: string, input: CompanionPaymentInput): CompanionPayment {
  const p = getPayment(ctx, id);
  checkPayment(input);
  const stamp = now();
  let removed: string[] = [];
  ctx.db.tx(() => {
    ctx.db.run('UPDATE freelance_companion_payments SET amount = ?, note = ?, updated_at = ? WHERE id = ?', [input.amount, String(input.note ?? '').trim(), stamp, id]);
    removed = syncImages(ctx, PAYMENT_IMG, id, input.images);
    ctx.db.run('UPDATE freelance_jobs SET updated_at = ? WHERE id = ?', [stamp, p.jobId]);
  });
  deleteImageFiles(ctx, removed);
  return getPayment(ctx, id);
}

export function deleteCompanionPayment(ctx: Ctx, id: string): void {
  const p = getPayment(ctx, id);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM freelance_companion_payments WHERE id = ?', [id]);
    ctx.db.run('UPDATE freelance_jobs SET updated_at = ? WHERE id = ?', [now(), p.jobId]);
  });
  deleteImageFiles(ctx, p.images.map((i) => i.storageKey));
}

export function freelanceNoteFromText(text: string): string | undefined {
  return text.trim() ? textToNoteHtml(text.trim()) : undefined;
}
