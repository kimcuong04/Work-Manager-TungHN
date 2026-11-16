import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { formatDate, isValidISODate } from '../../shared/dates';
import { NOTE_HTML_MAX, isNoteEmpty, noteHtmlToText, noteImageKeys, noteSnippet, sanitizeNoteHtml } from '../../shared/noteHtml';
import type { ProjectNote, ProjectNoteInput } from '../../shared/types';
import { AppError, now, todayOf, type Ctx } from '../context';
import { assertStorageKey, deleteImageFiles, imageExists, imagePath } from '../integration/images';
import { addProjectStartEvent, addProjectUpdateEvent, hasProjectStartEvent } from './calendar';
import { referencedImageKeys } from './records';

const DERIVED_MAX = 20_000;
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function mapNote(r: Record<string, any>): ProjectNote {
  return {
    id: r.id,
    projectId: r.project_id,
    noteDate: r.note_date,
    html: r.content_html,
    text: r.content_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function projectName(ctx: Ctx, projectId: string): string {
  const name = ctx.db.scalar<string>('SELECT project_name FROM projects WHERE id = ?', [projectId]);
  if (!name) throw new AppError('Không tìm thấy dự án (có thể đã bị xóa).');
  return name;
}

export function listProjectNotes(ctx: Ctx, projectId: string): ProjectNote[] {
  return ctx.db.all<Record<string, any>>('SELECT * FROM project_notes WHERE project_id = ? ORDER BY note_date DESC', [projectId]).map(mapNote);
}

function noteKeys(ctx: Ctx, noteId: string): string[] {
  return ctx.db.all<{ storage_key: string }>('SELECT storage_key FROM project_note_images WHERE note_id = ?', [noteId]).map((r) => r.storage_key);
}

/** Cột `projects.note` giữ bản chữ thuần của mọi ngày (mới nhất trước) để tìm kiếm và hiển thị tóm tắt. */
export function refreshDerivedNote(ctx: Ctx, projectId: string): void {
  const text = ctx.db
    .all<{ note_date: string; content_text: string }>('SELECT note_date, content_text FROM project_notes WHERE project_id = ? ORDER BY note_date DESC', [projectId])
    .map((r) => `${formatDate(r.note_date)}: ${r.content_text}`)
    .join('\n\n')
    .slice(0, DERIVED_MAX);
  ctx.db.run('UPDATE projects SET note = ?, updated_at = ? WHERE id = ?', [text, now(), projectId]);
}

export interface NoteWrite {
  changed: boolean;
  /** Ảnh không còn trong ghi chú này: xóa file sau khi commit nếu không nơi nào khác dùng. */
  removedKeys: string[];
  html: string;
}

/** Tạo/sửa/xóa (khi rỗng) ghi chú của một ngày. Phải gọi bên trong transaction. */
export function writeNote(ctx: Ctx, projectId: string, noteDate: string, rawHtml: string): NoteWrite {
  if (!isValidISODate(noteDate)) throw new AppError('Ngày ghi chú không hợp lệ.');
  if (noteDate > todayOf(ctx)) throw new AppError('Không ghi chú cho ngày trong tương lai.');
  const html = sanitizeNoteHtml(rawHtml);
  if (html.length > NOTE_HTML_MAX) throw new AppError('Ghi chú quá dài, hãy tách bớt sang ngày khác.');
  const existing = ctx.db.get<Record<string, any>>('SELECT * FROM project_notes WHERE project_id = ? AND note_date = ?', [projectId, noteDate]);
  const oldKeys = existing ? noteKeys(ctx, existing.id) : [];

  if (isNoteEmpty(html)) {
    if (!existing) return { changed: false, removedKeys: [], html: '' };
    ctx.db.run('DELETE FROM project_notes WHERE id = ?', [existing.id]);
    refreshDerivedNote(ctx, projectId);
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
  if (existing) ctx.db.run('UPDATE project_notes SET content_html = ?, content_text = ?, updated_at = ? WHERE id = ?', [html, text, stamp, id]);
  else ctx.db.run('INSERT INTO project_notes VALUES (?,?,?,?,?,?,?)', [id, projectId, noteDate, html, text, stamp, stamp]);
  ctx.db.run('DELETE FROM project_note_images WHERE note_id = ?', [id]);
  keys.forEach((k, i) => {
    let size = 0;
    try {
      size = fs.statSync(imagePath(ctx, k)).size;
    } catch {
      /* đã kiểm tra tồn tại ở trên */
    }
    ctx.db.run('INSERT INTO project_note_images VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), id, k, k, MIME[k.split('.').pop()!] ?? 'image/png', size, i, stamp]);
  });
  refreshDerivedNote(ctx, projectId);
  return { changed: true, removedKeys: oldKeys.filter((k) => !keys.includes(k)), html };
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

export function saveProjectNote(ctx: Ctx, projectId: string, input: ProjectNoteInput, opts: { addToCalendar?: boolean } = {}): ProjectNote | null {
  const name = projectName(ctx, projectId);
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

export function deleteProjectNote(ctx: Ctx, id: string): void {
  const row = ctx.db.get<{ project_id: string }>('SELECT project_id FROM project_notes WHERE id = ?', [id]);
  if (!row) throw new AppError('Không tìm thấy ghi chú (có thể đã bị xóa).');
  const keys = noteKeys(ctx, id);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM project_notes WHERE id = ?', [id]);
    refreshDerivedNote(ctx, row.project_id);
  });
  deleteUnreferencedImages(ctx, keys);
}

export function projectNoteImageKeys(ctx: Ctx, projectId: string): string[] {
  return ctx.db
    .all<{ storage_key: string }>('SELECT i.storage_key FROM project_note_images i JOIN project_notes n ON n.id = i.note_id WHERE n.project_id = ?', [projectId])
    .map((r) => r.storage_key);
}
