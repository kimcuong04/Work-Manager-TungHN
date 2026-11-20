import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { cleanName } from '../../shared/text';
import type { ImportPayload, LinkedFile, ProjectImport, TempEvent, TempEventInput } from '../../shared/types';
import { hasErrors, validateEventInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, todayOf, type Ctx } from '../context';
import * as imports from './imports';
import { EVENT_NOTES, deleteUnreferencedImages, noteImageKeysOf, writeDayNote } from './notes';
import { normalizeFiles } from './projects';

const SELECT_EVENT = `
SELECT e.*, b.name AS brand_name, (SELECT COUNT(*) FROM temp_event_imports i WHERE i.event_id = e.id) AS import_count
FROM temp_events e
LEFT JOIN brands b ON b.id = e.brand_id`;

function filesByEvent(ctx: Ctx, eventId?: string): Map<string, LinkedFile[]> {
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT event_id, file_path, file_name, file_extension FROM temp_event_files ${eventId ? 'WHERE event_id = ?' : ''} ORDER BY sort_order, created_at`,
    eventId ? [eventId] : [],
  );
  const map = new Map<string, LinkedFile[]>();
  for (const r of rows) map.set(r.event_id, [...(map.get(r.event_id) ?? []), { path: r.file_path, name: r.file_name, extension: r.file_extension }]);
  return map;
}

function mapEvent(r: Record<string, any>, files: LinkedFile[]): TempEvent {
  return {
    id: r.id,
    stt: r.stt,
    name: r.name,
    eventDate: strOrNull(r.event_date),
    brandId: strOrNull(r.brand_id),
    brandName: strOrNull(r.brand_name),
    note: str(r.note),
    folderPath: strOrNull(r.folder_path),
    files,
    importCount: Number(r.import_count) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Bảng Sự kiện tạm thời theo STT. */
export function listEvents(ctx: Ctx): TempEvent[] {
  const files = filesByEvent(ctx);
  return ctx.db.all<Record<string, any>>(`${SELECT_EVENT} ORDER BY e.stt`).map((r) => mapEvent(r, files.get(r.id) ?? []));
}

export function getEvent(ctx: Ctx, id: string): TempEvent {
  const r = ctx.db.get<Record<string, any>>(`${SELECT_EVENT} WHERE e.id = ?`, [id]);
  if (!r) throw new AppError(EVENT_NOTES.missing);
  return mapEvent(r, filesByEvent(ctx, id).get(id) ?? []);
}

export function nextEventStt(ctx: Ctx): number {
  return (ctx.db.scalar<number>('SELECT COALESCE(MAX(stt), 0) FROM temp_events') ?? 0) + 1;
}

function normalize(ctx: Ctx, input: TempEventInput, currentId?: string) {
  const e = validateEventInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  const brandId = strOrNull(input.brandId);
  if (brandId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM brands WHERE id = ?', [brandId])) throw new AppError('Hãng không tồn tại.');
  let stt = input.stt ?? undefined;
  if (stt === undefined) stt = currentId ? ctx.db.scalar<number>('SELECT stt FROM temp_events WHERE id = ?', [currentId]) : nextEventStt(ctx);
  const dup = ctx.db.get<{ name: string }>('SELECT name FROM temp_events WHERE stt = ? AND id <> ?', [stt, currentId ?? '']);
  if (dup) throw new AppError(`STT ${stt} đã được dùng cho sự kiện "${dup.name}". Hãy chọn STT khác (gợi ý: ${nextEventStt(ctx)}).`);
  return { stt: stt!, name: cleanName(input.name), eventDate: strOrNull(input.eventDate), brandId };
}

/** `noteHtml`: ghi chú ban đầu thành mục ghi chú của hôm nay. */
export function createEvent(ctx: Ctx, input: TempEventInput, opts: { noteHtml?: string } = {}): TempEvent {
  const v = normalize(ctx, input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run('INSERT INTO temp_events (id, stt, name, event_date, brand_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [
      id, v.stt, v.name, v.eventDate, v.brandId, '', stamp, stamp,
    ]);
    if (opts.noteHtml !== undefined) writeDayNote(ctx, EVENT_NOTES, id, todayOf(ctx), opts.noteHtml);
  });
  return getEvent(ctx, id);
}

export function updateEvent(ctx: Ctx, id: string, input: TempEventInput): TempEvent {
  getEvent(ctx, id);
  const v = normalize(ctx, input, id);
  ctx.db.tx(() =>
    ctx.db.run('UPDATE temp_events SET stt = ?, name = ?, event_date = ?, brand_id = ?, updated_at = ? WHERE id = ?', [v.stt, v.name, v.eventDate, v.brandId, now(), id]),
  );
  return getEvent(ctx, id);
}

/** Xóa sự kiện cùng ghi chú (kèm ảnh), danh sách file liên kết và các bảng import (file trên máy giữ nguyên). */
export function deleteEvent(ctx: Ctx, id: string): void {
  getEvent(ctx, id);
  const keys = noteImageKeysOf(ctx, EVENT_NOTES, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM temp_events WHERE id = ?', [id]));
  deleteUnreferencedImages(ctx, keys);
}

/** Thay toàn bộ danh sách file liên kết (.dwg, .txt, .docx, .pdf, .xlsx) của sự kiện. */
export function setEventFiles(ctx: Ctx, id: string, list: LinkedFile[]): TempEvent {
  getEvent(ctx, id);
  const files = normalizeFiles(list);
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM temp_event_files WHERE event_id = ?', [id]);
    files.forEach((f, i) =>
      ctx.db.run('INSERT INTO temp_event_files (id, event_id, file_path, file_name, file_extension, sort_order, created_at) VALUES (?,?,?,?,?,?,?)', [
        randomUUID(), id, f.path, f.name, f.extension, i, stamp,
      ]),
    );
    ctx.db.run('UPDATE temp_events SET updated_at = ? WHERE id = ?', [stamp, id]);
  });
  return getEvent(ctx, id);
}

/** Liên kết (hoặc bỏ liên kết khi null) một thư mục có sẵn trên máy; app không tạo / đổi tên / xóa thư mục này. */
export function setEventFolder(ctx: Ctx, id: string, folder: string | null): TempEvent {
  getEvent(ctx, id);
  const p = strOrNull(folder);
  if (p) {
    let ok = false;
    try {
      ok = fs.statSync(p).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) throw new AppError('Thư mục không tồn tại — hãy chọn lại.');
  }
  ctx.db.tx(() => ctx.db.run('UPDATE temp_events SET folder_path = ?, updated_at = ? WHERE id = ?', [p, now(), id]));
  return getEvent(ctx, id);
}

/* ---------------- Import xlsx của sự kiện (tab sheet, như dự án) ---------------- */

export const listEventImports = (ctx: Ctx, eventId: string): ProjectImport[] => imports.listImports(ctx, imports.EVENT_IMPORTS, eventId);
export const commitEventImport = (ctx: Ctx, eventId: string, payload: ImportPayload, replaceImportId: string | null = null): ProjectImport =>
  imports.commitImport(ctx, imports.EVENT_IMPORTS, eventId, payload, replaceImportId);
export const removeEventImport = (ctx: Ctx, eventId: string, importId: string): void => imports.removeImport(ctx, imports.EVENT_IMPORTS, eventId, importId);
export const renameEventImport = (ctx: Ctx, eventId: string, importId: string, name: string): ProjectImport =>
  imports.renameImport(ctx, imports.EVENT_IMPORTS, eventId, importId, name);
export const reorderEventImports = (ctx: Ctx, eventId: string, ids: string[]): ProjectImport[] => imports.reorderImports(ctx, imports.EVENT_IMPORTS, eventId, ids);
