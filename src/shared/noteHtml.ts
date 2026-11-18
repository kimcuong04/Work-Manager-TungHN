/**
 * Ghi chú dự án lưu dạng HTML có định dạng (đậm, nghiêng, màu, danh sách, bảng…) và ảnh trong kho ảnh của app.
 * Lọc theo danh sách cho phép, dùng chung cho main (khi lưu) và renderer (khi dán/hiển thị); không cần DOM.
 */

export const IMAGE_KEY_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;
export const NOTE_HTML_MAX = 300_000;

const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'head', 'title', 'svg', 'math', 'select', 'textarea', 'button', 'xml'];
const ALLOWED = new Set([
  'p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote',
  'span', 'mark', 'a', 'img', 'code', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'sub', 'sup',
]);
const RENAME: Record<string, string> = { font: 'span', strike: 's', del: 's', h1: 'h2', h5: 'h4', h6: 'h4', section: 'div', article: 'div' };
const VOID = new Set(['br', 'img', 'hr']);
const STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line']);
const STYLE_VALUE_RE = /^[#a-zA-Z0-9(),.\s%-]+$/;

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos' || k === '#39') return "'";
    if (k === 'nbsp') return ' ';
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ảnh trong ghi chú: độ rộng (px) khi người dùng kéo / nhập tỉ lệ, và căn lề. */
export const IMAGE_WIDTH_MIN = 16;
export const IMAGE_WIDTH_MAX = 4000;
export const IMAGE_SCALE_MIN = 0.05;
export const IMAGE_SCALE_MAX = 5;
export type ImageAlign = 'left' | 'center' | 'right';
export const IMAGE_ALIGNS: ImageAlign[] = ['left', 'center', 'right'];

/** Tỉ lệ ảnh nhập tay: số thập phân (dấu chấm hoặc phẩy), tối đa 2 chữ số sau dấu, trong [0.05, 5]; sai thì null. */
export function parseImageScale(raw: string): number | null {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= IMAGE_SCALE_MIN && n <= IMAGE_SCALE_MAX ? n : null;
}

export function noteImageSrc(key: string): string {
  return `ppm-img://full/${encodeURIComponent(key)}`;
}

function imageKeyFrom(src: string | undefined, dataKey: string | undefined): string | null {
  if (dataKey && IMAGE_KEY_RE.test(dataKey)) return dataKey;
  const m = /^ppm-img:\/\/(?:full|thumb)\/([^?#]+)$/i.exec((src ?? '').trim());
  if (!m) return null;
  try {
    const key = decodeURIComponent(m[1]);
    return IMAGE_KEY_RE.test(key) ? key : null;
  } catch {
    return null;
  }
}

function cleanStyle(raw: string): string {
  const out: string[] = [];
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !value || value.length > 60) continue;
    if (!STYLE_VALUE_RE.test(value) || /url|expression|var\(/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join('; ');
}

/** Trả về chuỗi thuộc tính đã lọc; `null` = bỏ hẳn thẻ (ví dụ ảnh không thuộc kho ảnh của app). */
function cleanAttrs(tag: string, original: string, raw: string): string | null {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  if (tag === 'img') {
    const key = imageKeyFrom(attrs.src, attrs['data-key']);
    if (!key) return null;
    let img = ` src="${escAttr(noteImageSrc(key))}" data-key="${escAttr(key)}" alt=""`;
    const width = Number(attrs.width);
    if (/^\d{2,4}$/.test(attrs.width ?? '') && width >= IMAGE_WIDTH_MIN && width <= IMAGE_WIDTH_MAX) img += ` width="${width}"`;
    const scale = parseImageScale(attrs['data-scale'] ?? '');
    if (scale !== null && scale !== 1) img += ` data-scale="${scale}"`;
    if (IMAGE_ALIGNS.includes(attrs['data-align'] as ImageAlign)) img += ` data-align="${attrs['data-align']}"`;
    return img;
  }
  let out = '';
  if (tag === 'a') {
    const href = (attrs.href ?? '').trim();
    if (/^https?:\/\//i.test(href)) {
      try {
        out += ` href="${escAttr(new URL(href).toString())}"`;
      } catch {
        /* link hỏng: giữ chữ, bỏ link */
      }
    }
    return out;
  }
  let style = attrs.style ? cleanStyle(attrs.style) : '';
  if (original === 'font' && attrs.color && STYLE_VALUE_RE.test(attrs.color)) style = [`color: ${attrs.color}`, style].filter(Boolean).join('; ');
  if (style) out += ` style="${escAttr(style)}"`;
  if (tag === 'td' || tag === 'th')
    for (const k of ['colspan', 'rowspan']) if (/^\d{1,3}$/.test(attrs[k] ?? '')) out += ` ${k}="${attrs[k]}"`;
  return out;
}

export function sanitizeNoteHtml(input: string | null | undefined): string {
  let html = String(input ?? '')
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[^>]*>/g, '');
  for (const t of DROP_WITH_CONTENT) html = html.replace(new RegExp(`<${t}\\b[\\s\\S]*?(<\\/${t}\\s*>|$)`, 'gi'), '');
  const out: string[] = [];
  const stack: string[] = [];
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    out.push(escText(html.slice(last, m.index)));
    last = m.index! + m[0].length;
    const original = m[2].toLowerCase();
    const tag = RENAME[original] ?? original;
    if (!ALLOWED.has(tag)) continue;
    if (m[1] === '/') {
      const at = stack.lastIndexOf(tag);
      if (at >= 0) while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const attrs = cleanAttrs(tag, original, m[3]);
    if (attrs === null) continue;
    out.push(`<${tag}${attrs}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  out.push(escText(html.slice(last)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').trim();
}

/** Chữ thuần để tìm kiếm, hiển thị tóm tắt và ghi vào Calendar. */
export function noteHtmlToText(html: string): string {
  const text = html
    .replace(/<img\b[^>]*>/gi, ' [ảnh] ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h\d|tr|blockquote|pre|ul|ol|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function noteImageKeys(html: string): string[] {
  const keys = new Set<string>();
  for (const m of html.matchAll(/data-key="([^"]+)"/g)) if (IMAGE_KEY_RE.test(m[1])) keys.add(m[1]);
  return [...keys];
}

export function isNoteEmpty(html: string): boolean {
  const clean = sanitizeNoteHtml(html);
  return noteImageKeys(clean).length === 0 && !noteHtmlToText(clean).replace(/\[ảnh\]/g, '').trim();
}

export function textToNoteHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? `<div>${escText(line.replace(/&/g, '&amp;'))}</div>` : '<div><br></div>'))
    .join('');
}

/** Một dòng ngắn để hiển thị/ghi Calendar. */
export function noteSnippet(html: string, max = 300): string {
  const s = noteHtmlToText(html).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
