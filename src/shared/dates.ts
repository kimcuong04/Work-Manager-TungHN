const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function nowStamp(): string {
  return new Date().toISOString();
}

export function isValidISODate(s: string | null | undefined): s is string {
  if (!s) return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Số ngày lịch từ `from` tới `to` (bỏ qua giờ). */
export function diffDays(to: string, from: string): number {
  return utcDay(to) - utcDay(from);
}

export function addDays(iso: string, n: number): string {
  const dt = new Date((utcDay(iso) + n) * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso || !isValidISODate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso || !isValidISODate(iso)) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function formatDateTime(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Nhận "16/11/2026", "16-11-2026", "16.11.2026", "16/11/26" hoặc ISO; trả về ISO hoặc null. */
export function parseDisplayDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (isValidISODate(s)) return s;
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3].length === 2) y += 2000;
  const iso = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return isValidISODate(iso) ? iso : null;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

export type QuickRangeKey = 'thisMonth' | 'lastMonth' | 'last3' | 'last6' | 'thisYear';

export const QUICK_RANGE_LABEL: Record<QuickRangeKey, string> = {
  thisMonth: 'Tháng này',
  lastMonth: 'Tháng trước',
  last3: '3 tháng gần nhất',
  last6: '6 tháng gần nhất',
  thisYear: 'Năm nay',
};

/** "3/6 tháng gần nhất" tính cả tháng hiện tại. */
export function quickRange(key: QuickRangeKey, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const shift = (back: number) => {
    const t = y * 12 + (m - 1) - back;
    return { year: Math.floor(t / 12), month: (t % 12) + 1 };
  };
  switch (key) {
    case 'thisMonth':
      return monthRange(y, m);
    case 'lastMonth': {
      const p = shift(1);
      return monthRange(p.year, p.month);
    }
    case 'last3':
    case 'last6': {
      const p = shift(key === 'last3' ? 2 : 5);
      return { from: monthRange(p.year, p.month).from, to: monthRange(y, m).to };
    }
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

export function inRange(iso: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

/** Excel serial date (1900 date system) -> ISO. */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Math.round((serial - 25569) * DAY_MS);
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
