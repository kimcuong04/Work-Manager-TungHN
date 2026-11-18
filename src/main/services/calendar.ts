import { randomUUID } from 'node:crypto';
import { formatDate } from '../../shared/dates';
import type { CalendarColor, CalendarEvent, CalendarEventInput, CalendarEventKind, CalendarFeedItem, CalendarQuery, Project } from '../../shared/types';
import { hasErrors, validateCalendarEventInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, todayOf, type Ctx } from '../context';

const SELECT_EVENT = `
SELECT e.*, p.project_name AS live_project_name
FROM calendar_events e
LEFT JOIN projects p ON p.id = e.project_id`;

function mapEvent(r: Record<string, any>): CalendarEvent {
  const projectExists = !!r.live_project_name;
  return {
    id: r.id,
    eventDate: r.event_date,
    startTime: strOrNull(r.start_time),
    endTime: strOrNull(r.end_time),
    title: r.title,
    note: str(r.note),
    color: (strOrNull(r.color) as CalendarColor | null) ?? null,
    kind: r.kind,
    projectId: strOrNull(r.project_id),
    projectName: projectExists ? r.live_project_name : strOrNull(r.project_name),
    projectExists,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listCalendarEvents(ctx: Ctx, q: CalendarQuery = {}): CalendarEvent[] {
  const where: string[] = [];
  const params: string[] = [];
  if (q.from) {
    where.push('e.event_date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('e.event_date <= ?');
    params.push(q.to);
  }
  if (q.projectId) {
    where.push('e.project_id = ?');
    params.push(q.projectId);
  }
  const sql = `${SELECT_EVENT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.event_date, e.start_time IS NOT NULL, e.start_time, e.created_at`;
  return ctx.db.all<Record<string, any>>(sql, params).map(mapEvent);
}

function getEvent(ctx: Ctx, id: string): CalendarEvent {
  const r = ctx.db.get<Record<string, any>>(`${SELECT_EVENT} WHERE e.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy sự kiện (có thể đã bị xóa).');
  return mapEvent(r);
}

function normalize(ctx: Ctx, input: CalendarEventInput) {
  const e = validateCalendarEventInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  let projectName: string | null = null;
  if (input.projectId) {
    const p = ctx.db.get<{ project_name: string }>('SELECT project_name FROM projects WHERE id = ?', [input.projectId]);
    if (!p) throw new AppError('Dự án được liên kết không tồn tại.');
    projectName = p.project_name;
  }
  return {
    eventDate: input.eventDate,
    startTime: input.startTime || null,
    endTime: input.startTime ? input.endTime || null : null,
    title: input.title.replace(/\s+/g, ' ').trim(),
    note: (input.note ?? '').replace(/\r\n/g, '\n').trim(),
    color: input.color || null,
    projectId: input.projectId || null,
    projectName,
  };
}

function insertRow(
  ctx: Ctx,
  kind: CalendarEventKind,
  v: { eventDate: string; startTime: string | null; endTime: string | null; title: string; note: string; color: string | null; projectId: string | null; projectName: string | null },
): string {
  const id = randomUUID();
  const stamp = now();
  ctx.db.run(
    `INSERT INTO calendar_events (id, event_date, start_time, end_time, title, note, color, kind, project_id, project_name, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, v.eventDate, v.startTime, v.endTime, v.title, v.note, v.color, kind, v.projectId, v.projectName, stamp, stamp],
  );
  return id;
}

export function createCalendarEvent(ctx: Ctx, input: CalendarEventInput): CalendarEvent {
  const v = normalize(ctx, input);
  let id = '';
  ctx.db.tx(() => {
    id = insertRow(ctx, 'CUSTOM', v);
  });
  return getEvent(ctx, id);
}

/** Sự kiện sinh từ dự án vẫn sửa được (đổi ngày, giờ, ghi chú…), loại sự kiện thì giữ nguyên. */
export function updateCalendarEvent(ctx: Ctx, id: string, input: CalendarEventInput): CalendarEvent {
  getEvent(ctx, id);
  const v = normalize(ctx, input);
  ctx.db.tx(() =>
    ctx.db.run(
      `UPDATE calendar_events SET event_date=?, start_time=?, end_time=?, title=?, note=?, color=?, project_id=?,
        project_name=COALESCE(?, project_name), updated_at=? WHERE id=?`,
      [v.eventDate, v.startTime, v.endTime, v.title, v.note, v.color, v.projectId, v.projectName, now(), id],
    ),
  );
  return getEvent(ctx, id);
}

export function moveCalendarEvent(ctx: Ctx, id: string, eventDate: string): CalendarEvent {
  const ev = getEvent(ctx, id);
  return updateCalendarEvent(ctx, id, { ...ev, eventDate });
}

export function deleteCalendarEvent(ctx: Ctx, id: string): void {
  getEvent(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM calendar_events WHERE id = ?', [id]));
}

/* ---------- Đồng bộ với dự án (gọi bên trong transaction của service dự án) ---------- */

export function addProjectStartEvent(ctx: Ctx, projectId: string, name: string, receivedDate: string): void {
  insertRow(ctx, 'PROJECT_START', {
    eventDate: receivedDate,
    startTime: null,
    endTime: null,
    title: name,
    note: '',
    color: null,
    projectId,
    projectName: name,
  });
}

/**
 * Ngày bắt đầu/tên dự án đổi thì sự kiện "Bắt đầu dự án" đi theo; tiêu đề người dùng đã tự sửa thì giữ.
 * Dự án trước chưa có ngày bắt đầu mà nay có thì thêm sự kiện; xóa ngày bắt đầu thì giữ sự kiện cũ.
 */
export function syncProjectStartEvent(ctx: Ctx, before: Project, after: { projectName: string; receivedDate: string | null }): void {
  const rows = ctx.db.all<{ id: string; title: string; event_date: string }>(
    `SELECT id, title, event_date FROM calendar_events WHERE project_id = ? AND kind = 'PROJECT_START'`,
    [before.id],
  );
  const stamp = now();
  if (!rows.length && !before.receivedDate && after.receivedDate) addProjectStartEvent(ctx, before.id, after.projectName, after.receivedDate);
  for (const r of rows) {
    const title = r.title === before.projectName ? after.projectName : r.title;
    const date = after.receivedDate && r.event_date === before.receivedDate ? after.receivedDate : r.event_date;
    if (title !== r.title || date !== r.event_date)
      ctx.db.run('UPDATE calendar_events SET title = ?, event_date = ?, updated_at = ? WHERE id = ?', [title, date, stamp, r.id]);
  }
  ctx.db.run(`UPDATE calendar_events SET project_name = ? WHERE project_id = ?`, [after.projectName, before.id]);
}

export function hasProjectStartEvent(ctx: Ctx, projectId: string): boolean {
  return ctx.db.scalar<number>(`SELECT COUNT(*) FROM calendar_events WHERE project_id = ? AND kind = 'PROJECT_START'`, [projectId]) > 0;
}

type NameLookup = (table: string, id: string | null) => string;

export interface ChangedProject {
  stt: number;
  projectName: string;
  clientId: string | null;
  siId: string | null;
  brandIds: string[];
  salespersonId: string | null;
  receivedDate: string | null;
  dueDate: string | null;
  priorityPoint: number;
  files: { name: string }[];
}

/** Tóm tắt những gì đổi giữa bản cũ và bản mới của dự án, mỗi dòng một trường. */
export function describeProjectChanges(before: Project, after: ChangedProject, lookup: NameLookup): string[] {
  const lines: string[] = [];
  const cmp = (label: string, a: string, b: string) => {
    if (a !== b) lines.push(`${label}: ${a || '—'} → ${b || '—'}`);
  };
  if (before.stt !== after.stt) lines.push(`STT: ${before.stt} → ${after.stt}`);
  cmp('Tên dự án', before.projectName, after.projectName);
  cmp('Tên SI', before.siName ?? '', lookup('si_partners', after.siId));
  cmp('Hãng', before.brands.map((b) => b.name).join(', '), after.brandIds.map((b) => lookup('brands', b)).join(', '));
  cmp('Sale', before.salespersonName ?? '', lookup('salespersons', after.salespersonId));
  cmp('EU', before.clientName ?? '', lookup('clients', after.clientId));
  cmp('Ngày bắt đầu', formatDate(before.receivedDate), formatDate(after.receivedDate));
  cmp('Ngày tới hạn', formatDate(before.dueDate), formatDate(after.dueDate));
  if (before.priorityPoint !== after.priorityPoint) lines.push(`Priority: ${before.priorityPoint} → ${after.priorityPoint}`);
  cmp('File liên kết', before.files.map((f) => f.name).join(', '), after.files.map((f) => f.name).join(', '));
  return lines;
}

export function addProjectUpdateEvent(ctx: Ctx, projectId: string, name: string, changes: string[]): void {
  insertRow(ctx, 'PROJECT_UPDATE', {
    eventDate: todayOf(ctx),
    startTime: null,
    endTime: null,
    title: name,
    note: changes.length ? changes.join('\n') : 'Ghi nhận tiến độ dự án (không đổi thông tin).',
    color: null,
    projectId,
    projectName: name,
  });
}

export function removeProjectStartEvents(ctx: Ctx, projectId: string): void {
  ctx.db.run(`DELETE FROM calendar_events WHERE project_id = ? AND kind = 'PROJECT_START'`, [projectId]);
}

/**
 * Xóa dự án: bỏ luôn các mục "Bắt đầu / Cập nhật dự án" của nó trên Calendar; sự kiện người dùng tự tạo có liên kết
 * dự án thì giữ lại (chỉ gỡ liên kết).
 */
export function removeProjectEvents(ctx: Ctx, projectId: string): void {
  ctx.db.run(`DELETE FROM calendar_events WHERE project_id = ? AND kind IN ('PROJECT_START', 'PROJECT_UPDATE')`, [projectId]);
  ctx.db.run('UPDATE calendar_events SET project_id = NULL, updated_at = ? WHERE project_id = ?', [now(), projectId]);
}

function localDay(stamp: string): string {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return String(stamp).slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const snippet = (s: string | null | undefined, max = 300) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/**
 * Mục Calendar của Job Freelance và Kinh nghiệm, tính trực tiếp từ dữ liệu nên sửa/xóa job hay kinh nghiệm là
 * Calendar đổi theo ngay. Freelance: ngày bắt đầu + mỗi ngày có ghi chú. Kinh nghiệm: ngày của kinh nghiệm + ngày sửa.
 */
export function listCalendarFeed(ctx: Ctx, q: CalendarQuery = {}): CalendarFeedItem[] {
  const inRange = (d: string | null | undefined): d is string => !!d && (!q.from || d >= q.from) && (!q.to || d <= q.to);
  const out: CalendarFeedItem[] = [];
  const jobs = ctx.db.all<Record<string, any>>(
    `SELECT f.id, f.stt, f.project_name, f.start_date, f.created_at, f.updated_at, h.name AS hirer_name, s.name AS status_name
     FROM freelance_jobs f LEFT JOIN freelance_hirers h ON h.id = f.hirer_id LEFT JOIN freelance_statuses s ON s.id = f.status_id`,
  );
  const jobById = new Map(jobs.map((j) => [j.id as string, j]));
  const jobSub = (j: Record<string, any>) => ['Job Freelance', j.hirer_name && `Bên thuê ${j.hirer_name}`, j.status_name].filter(Boolean).join(' · ');
  for (const j of jobs) {
    if (inRange(j.start_date))
      out.push({ key: `fl-start:${j.id}`, source: 'FREELANCE', kind: 'PROJECT_START', date: j.start_date, title: `${j.stt}. ${j.project_name}`, subtitle: jobSub(j), note: '', targetId: j.id });
  }
  const noteDays = new Set<string>();
  for (const n of ctx.db.all<{ job_id: string; note_date: string; content_text: string }>('SELECT job_id, note_date, content_text FROM freelance_notes')) {
    const j = jobById.get(n.job_id);
    noteDays.add(`${n.job_id}|${n.note_date}`);
    if (!j || !inRange(n.note_date)) continue;
    out.push({ key: `fl-note:${n.job_id}:${n.note_date}`, source: 'FREELANCE', kind: 'PROJECT_UPDATE', date: n.note_date, title: `${j.stt}. ${j.project_name}`, subtitle: jobSub(j), note: `Ghi chú: ${snippet(n.content_text)}`, targetId: j.id });
  }
  for (const j of jobs) {
    const day = localDay(j.updated_at);
    if (day !== localDay(j.created_at) && !noteDays.has(`${j.id}|${day}`) && inRange(day))
      out.push({ key: `fl-edit:${j.id}`, source: 'FREELANCE', kind: 'PROJECT_UPDATE', date: day, title: `${j.stt}. ${j.project_name}`, subtitle: jobSub(j), note: 'Sửa thông tin job', targetId: j.id });
  }
  const exps = ctx.db.all<Record<string, any>>(
    `SELECT e.id, e.brand_id, e.experience_date, e.event, e.device_model, e.project_text, e.created_at, e.updated_at, b.name AS brand_name
     FROM experience_records e JOIN brands b ON b.id = e.brand_id`,
  );
  for (const e of exps) {
    const title = `${e.brand_name}: ${snippet(e.event, 80)}`;
    const subtitle = ['Kinh nghiệm', e.device_model, e.project_text].filter((x) => x && String(x).trim()).join(' · ');
    if (inRange(e.experience_date))
      out.push({ key: `exp:${e.id}`, source: 'EXPERIENCE', kind: 'PROJECT_START', date: e.experience_date, title, subtitle, note: snippet(e.event), targetId: e.id, brandId: e.brand_id });
    const day = localDay(e.updated_at);
    if (day !== localDay(e.created_at) && day !== e.experience_date && inRange(day))
      out.push({ key: `exp-edit:${e.id}`, source: 'EXPERIENCE', kind: 'PROJECT_UPDATE', date: day, title, subtitle, note: 'Đã sửa kinh nghiệm', targetId: e.id, brandId: e.brand_id });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'vi'));
}
