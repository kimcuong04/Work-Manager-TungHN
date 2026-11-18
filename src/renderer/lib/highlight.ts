import { useEffect } from 'react';

const NAME = 'ppm-search';
const EVENT = 'ppm:highlight';
const MAX_RANGES = 400;
const MAX_WAIT_MS = 4000;

let pending: string | null = null;

/** Gọi ngay trước khi mở một kết quả tìm kiếm: trang đích sẽ tô sáng `text` (không phân biệt dấu, hoa thường). */
export function requestHighlight(text: string): void {
  pending = text.trim() || null;
  window.dispatchEvent(new Event(EVENT));
}

const fold = (c: string) =>
  c
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

function findRanges(root: Node, query: string): Range[] {
  const q = fold(query).replace(/\s+/g, ' ');
  if (!q) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script, style, .topbar, .gsearch-results') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n && out.length < MAX_RANGES; n = walker.nextNode()) {
    const text = n.nodeValue ?? '';
    if (text.length < q.length) continue;
    let folded = '';
    const map: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const f = fold(text[i]).replace(/\s/g, ' ');
      for (const ch of f) {
        folded += ch;
        map.push(i);
      }
    }
    for (let at = folded.indexOf(q); at >= 0 && out.length < MAX_RANGES; at = folded.indexOf(q, at + q.length)) {
      const r = document.createRange();
      r.setStart(n, map[at]);
      r.setEnd(n, map[at + q.length - 1] + 1);
      out.push(r);
    }
  }
  return out;
}

type Registry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
const registry = (): Registry | null => (typeof CSS !== 'undefined' && 'highlights' in CSS ? (CSS as unknown as { highlights: Registry }).highlights : null);
const HighlightCtor = (): (new (...r: Range[]) => unknown) | null => (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight ?? null;

/**
 * Gắn một lần trong layout: sau khi mở kết quả tìm kiếm, chờ trang đích hiện dữ liệu rồi tô sáng từ khóa và cuộn tới
 * chỗ đầu tiên. Bấm chuột bất kỳ đâu thì bỏ tô sáng. Dùng CSS Custom Highlight nên không đụng vào DOM của React.
 */
export function useSearchHighlight(): void {
  useEffect(() => {
    let timer = 0;
    let active = false;
    const clear = () => {
      window.clearTimeout(timer);
      pending = null;
      if (active) registry()?.delete(NAME);
      active = false;
    };
    const run = () => {
      const query = pending;
      const reg = registry();
      const Ctor = HighlightCtor();
      if (!query || !reg || !Ctor) return;
      window.clearTimeout(timer);
      reg.delete(NAME);
      const started = Date.now();
      let last = -1;
      const tick = () => {
        if (pending !== query) return;
        const ranges = findRanges(document.querySelector('main.content') ?? document.body, query);
        const stable = ranges.length > 0 && ranges.length === last;
        last = ranges.length;
        if (stable || (ranges.length > 0 && Date.now() - started > MAX_WAIT_MS)) {
          reg.set(NAME, new Ctor(...ranges));
          active = true;
          pending = null;
          const first = ranges.find((r) => r.getBoundingClientRect().width > 0);
          first?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        if (Date.now() - started > MAX_WAIT_MS) {
          pending = null;
          return;
        }
        timer = window.setTimeout(tick, 150);
      };
      timer = window.setTimeout(tick, 250);
    };
    const onDown = () => {
      if (active) clear();
    };
    window.addEventListener(EVENT, run);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener(EVENT, run);
      document.removeEventListener('pointerdown', onDown, true);
      clear();
    };
  }, []);
}
