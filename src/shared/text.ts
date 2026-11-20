/** Bỏ dấu tiếng Việt, chuẩn hóa Unicode, viết thường, gộp khoảng trắng. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hóa tên danh mục để so trùng: trim, gộp khoảng trắng, không phân biệt hoa/thường (giữ dấu). */
export function nameKey(input: string): string {
  return input.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
}

export function cleanName(input: string): string {
  return input.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Mọi từ trong query phải xuất hiện trong haystack (đã chuẩn hóa).
 * Từ thuần chữ cái dài >= 4 ký tự chấp nhận sai 1 ký tự (fuzzy nhẹ); số và mã model phải khớp chính xác.
 */
export function matchesQuery(normalizedQuery: string, normalizedHaystack: string): boolean {
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(' ');
  let words: string[] | null = null;
  for (const t of tokens) {
    if (normalizedHaystack.includes(t)) continue;
    if (t.length < 4 || !/^[a-z]+$/.test(t)) return false;
    words ??= normalizedHaystack.split(/[^a-z0-9]+/);
    if (!words.some((w) => w.length >= 3 && /^[a-z]+$/.test(w) && withinOneEdit(t, w))) return false;
  }
  return true;
}

const foldChar = (c: string) =>
  c
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

/**
 * Đoạn trích quanh chỗ khớp từ khóa (không phân biệt dấu / hoa thường) để hiện trong kết quả tìm kiếm; không thấy
 * nguyên cụm thì lấy quanh từ đầu tiên, vẫn không thấy thì lấy đầu đoạn văn.
 */
export function matchExcerpt(text: string, query: string, radius = 60): string {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim();
  const q = normalizeText(query);
  if (!src) return '';
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < src.length; i++)
    for (const ch of foldChar(src[i])) {
      folded += ch;
      map.push(i);
    }
  let at = q ? folded.indexOf(q) : -1;
  let len = q.length;
  if (at < 0 && q) {
    const first = q.split(' ')[0];
    at = folded.indexOf(first);
    len = first.length;
  }
  if (at < 0) return src.length > radius * 2 ? `${src.slice(0, radius * 2).trimEnd()}…` : src;
  const start = Math.max(0, map[at] - radius);
  const end = Math.min(src.length, (map[at + len - 1] ?? map[at]) + 1 + radius);
  return `${start > 0 ? '…' : ''}${src.slice(start, end).trim()}${end < src.length ? '…' : ''}`;
}

export function buildHaystack(parts: (string | null | undefined)[]): string {
  return normalizeText(parts.filter(Boolean).join(' | '));
}

export function compareVi(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { sensitivity: 'base', numeric: true });
}
