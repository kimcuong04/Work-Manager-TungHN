import { isWebLink } from './webLink';

/** Một đoạn của ghi chú: chữ thường, hoặc link (`url`) hiển thị bằng `text`. */
export interface NoteSegment {
  text: string;
  url?: string;
}

const TRAIL = /[.,;:!?'"»)\]]+$/;
const TOKEN = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)|\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/**
 * Ghi chú có chèn link: `[Tên hiển thị](link)` hoặc link dán thẳng (bắt đầu bằng http://, https:// hoặc www.).
 * Link không hợp lệ (vd `javascript:`) giữ nguyên là chữ.
 */
export function parseLinkNote(text: string): NoteSegment[] {
  const s = String(text ?? '');
  const out: NoteSegment[] = [];
  const push = (seg: NoteSegment) => {
    const last = out[out.length - 1];
    if (!seg.url && last && !last.url) last.text += seg.text;
    else if (seg.text) out.push(seg);
  };
  let at = 0;
  for (const m of s.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    push({ text: s.slice(at, start) });
    if (m[1] !== undefined) {
      const url = m[2];
      push(isWebLink(url) ? { text: m[1], url } : { text: m[0] });
      at = start + m[0].length;
    } else {
      const raw = m[0];
      const url = raw.replace(TRAIL, '');
      push(isWebLink(url) ? { text: url, url } : { text: url });
      at = start + url.length;
    }
  }
  push({ text: s.slice(at) });
  return out;
}

export const hasNoteLink = (text: string) => parseLinkNote(text).some((s) => s.url);

/** Đoạn chèn vào ghi chú cho một link: `[Tên](link)`, hoặc chỉ link nếu không đặt tên. */
export function linkMarkup(label: string, url: string): string {
  const u = String(url ?? '')
    .trim()
    .replace(/\s/g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  const l = String(label ?? '')
    .replace(/[[\]\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return l && l !== u ? `[${l}](${u})` : u;
}
