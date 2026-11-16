import { addDays, diffDays } from '../../shared/dates';
import type { CalendarColor, CalendarEvent, CalendarEventKind } from '../../shared/types';
import type { ProjectView } from './projects';

export type CalView = 'day' | 'week' | 'month' | 'agenda';
export type LayerKey = CalendarEventKind | 'DUE';

export const VIEW_LABEL: Record<CalView, string> = { day: 'Ngày', week: 'Tuần', month: 'Tháng', agenda: 'Lịch trình' };
export const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const WEEKDAY_LONG = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
export const AGENDA_DAYS = 60;

export const LAYER_LABEL: Record<LayerKey, string> = {
  PROJECT_START: 'Bắt đầu dự án',
  PROJECT_UPDATE: 'Cập nhật dự án',
  CUSTOM: 'Sự kiện khác',
  DUE: 'Hạn chót dự án',
};
export const LAYER_COLOR: Record<LayerKey, CalendarColor | 'due'> = {
  PROJECT_START: 'sage',
  PROJECT_UPDATE: 'blue',
  CUSTOM: 'purple',
  DUE: 'due',
};
export const COLOR_LABEL: Record<CalendarColor, string> = {
  sage: 'Xanh lá',
  blue: 'Xanh dương',
  teal: 'Xanh ngọc',
  amber: 'Vàng cam',
  red: 'Đỏ',
  purple: 'Tím',
  gray: 'Xám',
};

/** 0 = Thứ Hai … 6 = Chủ Nhật. */
export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function shiftMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Lưới tháng luôn 6 tuần (42 ô) bắt đầu từ Thứ Hai để chiều cao lịch không nhảy giữa các tháng. */
export function monthGrid(anchor: string): string[] {
  const start = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function viewRange(view: CalView, anchor: string): { from: string; to: string; days: string[] } {
  if (view === 'month') {
    const days = monthGrid(anchor);
    return { from: days[0], to: days[41], days };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return { from: days[0], to: days[6], days };
  }
  if (view === 'day') return { from: anchor, to: anchor, days: [anchor] };
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(anchor, i));
  return { from: days[0], to: days[days.length - 1], days };
}

export function shiftAnchor(view: CalView, anchor: string, dir: -1 | 1): string {
  if (view === 'month') return shiftMonths(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  if (view === 'day') return addDays(anchor, dir);
  return addDays(anchor, AGENDA_DAYS * dir);
}

const MONTH_NAME = (m: number) => `Tháng ${m}`;

export function viewTitle(view: CalView, anchor: string): string {
  const [y, m, d] = anchor.split('-').map(Number);
  if (view === 'month') return `${MONTH_NAME(m)}, ${y}`;
  if (view === 'day') return `${WEEKDAY_LONG[weekdayIndex(anchor)]}, ${d} ${MONTH_NAME(m).toLowerCase()}, ${y}`;
  const { from, to } = viewRange(view, anchor);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (fy === ty && fm === tm) return `${fd} – ${td} ${MONTH_NAME(fm).toLowerCase()}, ${fy}`;
  if (fy === ty) return `${fd}/${fm} – ${td}/${tm}, ${fy}`;
  return `${fd}/${fm}/${fy} – ${td}/${tm}/${ty}`;
}

export interface CalItem {
  key: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  color: CalendarColor | 'due';
  layer: LayerKey;
  event?: CalendarEvent;
  project?: ProjectView;
}

export function eventItem(e: CalendarEvent): CalItem {
  return {
    key: e.id,
    date: e.eventDate,
    startTime: e.startTime,
    endTime: e.endTime,
    title: e.title,
    color: e.color ?? LAYER_COLOR[e.kind],
    layer: e.kind,
    event: e,
  };
}

export function dueItem(p: ProjectView): CalItem {
  return { key: `due:${p.id}`, date: p.dueDate, startTime: null, endTime: null, title: p.projectName, color: 'due', layer: 'DUE', project: p };
}

/** Sắp xếp trong ngày: mục cả ngày trước, rồi theo giờ bắt đầu. */
export function compareItems(a: CalItem, b: CalItem): number {
  if (!a.startTime !== !b.startTime) return a.startTime ? 1 : -1;
  return (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title, 'vi');
}

export function groupByDate(items: CalItem[]): Map<string, CalItem[]> {
  const m = new Map<string, CalItem[]>();
  for (const it of items) {
    const list = m.get(it.date) ?? [];
    list.push(it);
    m.set(it.date, list);
  }
  for (const list of m.values()) list.sort(compareItems);
  return m;
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const c = Math.max(0, Math.min(23 * 60 + 59, min));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

export function timeLabel(it: Pick<CalItem, 'startTime' | 'endTime'>): string {
  if (!it.startTime) return 'Cả ngày';
  return it.endTime ? `${it.startTime} – ${it.endTime}` : it.startTime;
}

export interface Placed {
  item: CalItem;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Xếp các sự kiện có giờ thành nhiều làn khi trùng thời gian (giống lưới tuần của Google Calendar). */
export function layoutTimed(items: CalItem[], hourPx: number): Placed[] {
  const spans = items
    .filter((i) => i.startTime)
    .map((item) => {
      const start = toMinutes(item.startTime!);
      const end = Math.max(start + 30, item.endTime ? toMinutes(item.endTime) : start + 60);
      return { item, start, end };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: { item: CalItem; start: number; end: number; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster)
      out.push({ item: c.item, top: (c.start / 60) * hourPx, height: Math.max(((c.end - c.start) / 60) * hourPx, hourPx / 2), lane: c.lane, lanes });
    cluster = [];
  };
  for (const s of spans) {
    if (s.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.end > s.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...s, lane });
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  if (cluster.length) flush();
  return out;
}

export function isPast(date: string, today: string): boolean {
  return diffDays(date, today) < 0;
}
