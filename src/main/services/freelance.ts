import { randomUUID } from 'node:crypto';
import { textToNoteHtml } from '../../shared/noteHtml';
import { cleanName } from '../../shared/text';
import type { FreelanceInput, FreelanceJob, FreelanceSaveOptions } from '../../shared/types';
import { hasErrors, validateFreelanceInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, todayOf, type Ctx } from '../context';
import { FREELANCE_NOTES, deleteUnreferencedImages, noteImageKeysOf, writeDayNote, type NoteWrite } from './notes';

const SELECT_FREELANCE = `
SELECT f.*, s.name AS status_name, s.color AS status_color, h.name AS hirer_name, ps.name AS payment_status_name, ps.color AS payment_status_color
FROM freelance_jobs f
LEFT JOIN freelance_statuses s ON s.id = f.status_id
LEFT JOIN freelance_hirers h ON h.id = f.hirer_id
LEFT JOIN freelance_payment_statuses ps ON ps.id = f.payment_status_id`;

function mapJob(r: Record<string, any>): FreelanceJob {
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
    note: str(r.note),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listFreelance(ctx: Ctx): FreelanceJob[] {
  return ctx.db.all(`${SELECT_FREELANCE} ORDER BY f.stt`).map(mapJob);
}

export function getFreelance(ctx: Ctx, id: string): FreelanceJob {
  const r = ctx.db.get(`${SELECT_FREELANCE} WHERE f.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy job Freelance (có thể đã bị xóa).');
  return mapJob(r);
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
  };
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

export function deleteFreelance(ctx: Ctx, id: string): void {
  getFreelance(ctx, id);
  const keys = noteImageKeysOf(ctx, FREELANCE_NOTES, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM freelance_jobs WHERE id = ?', [id]));
  deleteUnreferencedImages(ctx, keys);
}

/** Xóa nhiều job Freelance (kèm ghi chú, ảnh) trong một transaction; id không còn tồn tại thì bỏ qua. */
export function deleteFreelances(ctx: Ctx, ids: string[]): number {
  const found = [...new Set(ids)].filter((id) => ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_jobs WHERE id = ?', [id]) > 0);
  const keys = found.flatMap((id) => noteImageKeysOf(ctx, FREELANCE_NOTES, id));
  ctx.db.tx(() => found.forEach((id) => ctx.db.run('DELETE FROM freelance_jobs WHERE id = ?', [id])));
  deleteUnreferencedImages(ctx, keys);
  return found.length;
}

export function freelanceNoteFromText(text: string): string | undefined {
  return text.trim() ? textToNoteHtml(text.trim()) : undefined;
}
