import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { formatDate, isValidISODate } from '../../shared/dates';
import { NOTE_HTML_MAX, isNoteEmpty, noteHtmlToText, noteImageKeys, noteSnippet, sanitizeNoteHtml } from '../../shared/noteHtml';
import type { DayNote, FreelanceNote, ProjectNote, ProjectNoteInput } from '../../shared/types';
import { AppError, now, todayOf, type Ctx } from '../context';
import { assertStorageKey, deleteImageFiles, imageExists, imagePath } from '../integration/images';
import { addProjectStartEvent, addProjectUpdateEvent, hasProjectStartEvent } from './calendar';
import { referencedImageKeys } from './records';

const DERIVED_MAX = 20_000;
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Bảng ghi chú theo ngày của một loại đối tượng (dự án Job Chính, job Freelance). */
export interface NoteStore {
  notes: string;
  images: string;
  owner: string;
  parent: string;
  missing: string;
}

export const PROJECT_NOTES: NoteStore = {
  notes: 'project_notes',
  images: 'project_note_images',
  owner: 'project_id',
  parent: 'projects',
  missing: 'Không tìm thấy dự án (có thể đã bị xóa).',
};

export const FREELANCE_NOTES: NoteStore = {
  notes: 'freelance_notes',
  images: 'freelance_note_images',
  owner: 'job_id',
  parent: 'freelance_jobs',
  missing: 'Không tìm thấy job Freelance (có thể đã bị xóa).',
};

function mapDayNote(r: Record<string, any>): DayNote {
  return {
    id: r.id,
    noteDate: r.note_date,
    html: r.content_html,
    text: r.content_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapNote(r: Record<string, any>): ProjectNote {
  return { ...mapDayNote(r), projectId: r.project_id };
}

function mapFreelanceNote(r: Record<string, any>): FreelanceNote {
  return { ...mapDayNote(r), jobId: r.job_id };
}

function listNotes(ctx: Ctx, store: NoteStore, ownerId: string): Record<string, any>[] {
  return ctx.db.all<Record<string, any>>(`SELECT * FROM ${store.notes} WHERE ${store.owner} = ? ORDER BY note_date DESC`, [ownerId]);
}

export function listProjectNotes(ctx: Ctx, projectId: string): ProjectNote[] {
  return listNotes(ctx, PROJECT_NOTES, projectId).map(mapNote);
}

export function listFreelanceNotes(ctx: Ctx, jobId: string): FreelanceNote[] {
  return listNotes(ctx, FREELANCE_NOTES, jobId).map(mapFreelanceNote);
}

function noteKeys(ctx: Ctx, store: NoteStore, noteId: string): string[] {
  return ctx.db.all<{ storage_key: string }>(`SELECT storage_key FROM ${store.images} WHERE note_id = ?`, [noteId]).map((r) => r.storage_key);
}

/** Cột `note` của bảng cha giữ bản chữ thuần của mọi ngày (mới nhất trước) để tìm kiếm và hiển thị tóm tắt. */
function refreshDerivedNoteOf(ctx: Ctx, store: NoteStore, ownerId: string): void {
  const text = ctx.db
    .all<{ note_date: string; content_text: string }>(`SELECT note_date, content_text FROM ${store.notes} WHERE ${store.owner} = ? ORDER BY note_date DESC`, [ownerId])
    .map((r) => `${formatDate(r.note_date)}: ${r.content_text}`)
    .join('\n\n')
    .slice(0, DERIVED_MAX);
  ctx.db.run(`UPDATE ${store.parent} SET note = ?, updated_at = ? WHERE id = ?`, [text, now(), ownerId]);
}

export function refreshDerivedNote(ctx: Ctx, projectId: string): void {
  refreshDerivedNoteOf(ctx, PROJECT_NOTES, projectId);
}

export interface NoteWrite {
  changed: boolean;
  /** Ảnh không còn trong ghi chú này: xóa file sau khi commit nếu không nơi nào khác dùng. */
  removedKeys: string[];
  html: string;
}

/** Tạo/sửa/xóa (khi rỗng) ghi chú của một ngày. Phải gọi bên trong transaction. */
export function writeDayNote(ctx: Ctx, store: NoteStore, ownerId: string, noteDate: string, rawHtml: string): NoteWrite {
  if (!isValidISODate(noteDate)) throw new AppError('Ngày ghi chú không hợp lệ.');
  if (noteDate > todayOf(ctx)) throw new AppError('Không ghi chú cho ngày trong tương lai.');
  const html = sanitizeNoteHtml(rawHtml);
  if (html.length > NOTE_HTML_MAX) throw new AppError('Ghi chú quá dài, hãy tách bớt sang ngày khác.');
  const existing = ctx.db.get<Record<string, any>>(`SELECT * FROM ${store.notes} WHERE ${store.owner} = ? AND note_date = ?`, [ownerId, noteDate]);
  const oldKeys = existing ? noteKeys(ctx, store, existing.id) : [];

  if (isNoteEmpty(html)) {
    if (!existing) return { changed: false, removedKeys: [], html: '' };
    ctx.db.run(`DELETE FROM ${store.notes} WHERE id = ?`, [existing.id]);
    refreshDerivedNoteOf(ctx, store, ownerId);
    return { changed: true, removedKeys: oldKeys, html: '' };
  }
  if (existing && existing.content_html === html) return { changed: false, removedKeys: [], html };

  const keys = noteImageKeys(html);
  for (const k of keys) {
    assertStorageKey(k);
    if (!imageExists(ctx, k)) throw new AppError('Có ảnh trong ghi chú không còn trong kho ảnh, hãy dán lại ảnh đó.');
  }
  const stamp = now();
  const text = noteHtmlToText(html);
  const id = existing?.id ?? randomUUID();
  if (existing) ctx.db.run(`UPDATE ${store.notes} SET content_html = ?, content_text = ?, updated_at = ? WHERE id = ?`, [html, text, stamp, id]);
  else ctx.db.run(`INSERT INTO ${store.notes} VALUES (?,?,?,?,?,?,?)`, [id, ownerId, noteDate, html, text, stamp, stamp]);
  ctx.db.run(`DELETE FROM ${store.images} WHERE note_id = ?`, [id]);
  keys.forEach((k, i) => {
    let size = 0;
    try {
      size = fs.statSync(imagePath(ctx, k)).size;
    } catch {
      /* đã kiểm tra tồn tại ở trên */
    }
    ctx.db.run(`INSERT INTO ${store.images} VALUES (?,?,?,?,?,?,?,?)`, [randomUUID(), id, k, k, MIME[k.split('.').pop()!] ?? 'image/png', size, i, stamp]);
  });
  refreshDerivedNoteOf(ctx, store, ownerId);
  return { changed: true, removedKeys: oldKeys.filter((k) => !keys.includes(k)), html };
}

export function writeNote(ctx: Ctx, projectId: string, noteDate: string, rawHtml: string): NoteWrite {
  return writeDayNote(ctx, PROJECT_NOTES, projectId, noteDate, rawHtml);
}

/** Một ảnh có thể được copy sang ghi chú khác, nên chỉ xóa file khi không còn bảng nào tham chiếu. */
export function deleteUnreferencedImages(ctx: Ctx, keys: string[]): void {
  if (!keys.length) return;
  const refs = referencedImageKeys(ctx);
  deleteImageFiles(
    ctx,
    keys.filter((k) => !refs.has(k)),
  );
}

export function noteCalendarLine(noteDate: string, html: string, today: string): string {
  const label = noteDate === today ? 'Ghi chú hôm nay' : `Ghi chú ngày ${formatDate(noteDate)}`;
  return html ? `${label}: ${noteSnippet(html)}` : `${label}: đã xóa`;
}

function ownerName(ctx: Ctx, store: NoteStore, ownerId: string): string {
  const name = ctx.db.scalar<string>(`SELECT project_name FROM ${store.parent} WHERE id = ?`, [ownerId]);
  if (!name) throw new AppError(store.missing);
  return name;
}

export function saveProjectNote(ctx: Ctx, projectId: string, input: ProjectNoteInput, opts: { addToCalendar?: boolean } = {}): ProjectNote | null {
  const name = ownerName(ctx, PROJECT_NOTES, projectId);
  let res: NoteWrite = { changed: false, removedKeys: [], html: '' };
  ctx.db.tx(() => {
    res = writeNote(ctx, projectId, input.noteDate, input.html);
    if (opts.addToCalendar) {
      if (!hasProjectStartEvent(ctx, projectId)) {
        const received = ctx.db.scalar<string>('SELECT received_date FROM projects WHERE id = ?', [projectId]);
        addProjectStartEvent(ctx, projectId, name, received);
      }
      addProjectUpdateEvent(ctx, projectId, name, [noteCalendarLine(input.noteDate, res.html, todayOf(ctx))]);
    }
  });
  deleteUnreferencedImages(ctx, res.removedKeys);
  const row = ctx.db.get<Record<string, any>>('SELECT * FROM project_notes WHERE project_id = ? AND note_date = ?', [projectId, input.noteDate]);
  return row ? mapNote(row) : null;
}

export function saveFreelanceNote(ctx: Ctx, jobId: string, input: ProjectNoteInput): FreelanceNote | null {
  ownerName(ctx, FREELANCE_NOTES, jobId);
  let res: NoteWrite = { changed: false, removedKeys: [], html: '' };
  ctx.db.tx(() => {
    res = writeDayNote(ctx, FREELANCE_NOTES, jobId, input.noteDate, input.html);
  });
  deleteUnreferencedImages(ctx, res.removedKeys);
  const row = ctx.db.get<Record<string, any>>('SELECT * FROM freelance_notes WHERE job_id = ? AND note_date = ?', [jobId, input.noteDate]);
  return row ? mapFreelanceNote(row) : null;
}

function deleteNote(ctx: Ctx, store: NoteStore, id: string): void {
  const row = ctx.db.get<Record<string, string>>(`SELECT ${store.owner} AS owner FROM ${store.notes} WHERE id = ?`, [id]);
  if (!row) throw new AppError('Không tìm thấy ghi chú (có thể đã bị xóa).');
  const keys = noteKeys(ctx, store, id);
  ctx.db.tx(() => {
    ctx.db.run(`DELETE FROM ${store.notes} WHERE id = ?`, [id]);
    refreshDerivedNoteOf(ctx, store, row.owner);
  });
  deleteUnreferencedImages(ctx, keys);
}

export function deleteProjectNote(ctx: Ctx, id: string): void {
  deleteNote(ctx, PROJECT_NOTES, id);
}

export function deleteFreelanceNote(ctx: Ctx, id: string): void {
  deleteNote(ctx, FREELANCE_NOTES, id);
}

export function noteImageKeysOf(ctx: Ctx, store: NoteStore, ownerId: string): string[] {
  return ctx.db
    .all<{ storage_key: string }>(`SELECT i.storage_key FROM ${store.images} i JOIN ${store.notes} n ON n.id = i.note_id WHERE n.${store.owner} = ?`, [ownerId])
    .map((r) => r.storage_key);
}

export function projectNoteImageKeys(ctx: Ctx, projectId: string): string[] {
  return noteImageKeysOf(ctx, PROJECT_NOTES, projectId);
}
