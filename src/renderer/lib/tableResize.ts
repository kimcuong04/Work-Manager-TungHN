import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readLocal, writeLocal } from './persist';

interface Sizes {
  cols: Record<string, number>;
  rows: Record<string, number>;
}

const EDGE = 5;
const MIN_COL = 44;
const MAX_FIT = 480;
const MIN_ROW = 30;

const storeKey = (key: string) => `tbl-size:${key}`;

function loadSizes(key: string): Sizes {
  const v = readLocal<Partial<Sizes> | null>(storeKey(key), null);
  return { cols: { ...(v?.cols ?? {}) }, rows: { ...(v?.rows ?? {}) } };
}

const headerCells = (table: HTMLTableElement): HTMLTableCellElement[] => Array.from(table.tHead?.rows[0]?.cells ?? []);

/** Khóa cột: `data-col` nếu có, không thì nhãn tiêu đề (bỏ mũi tên sắp xếp), cột trống theo vị trí. */
function colKey(th: HTMLTableCellElement): string {
  if (th.dataset.col) return th.dataset.col;
  const label = (th.textContent ?? '').replace(/[▲▼]/g, '').trim();
  return label || `#${th.cellIndex}`;
}

/** Bề rộng tự nhiên (vừa nội dung, tối đa MAX_FIT) của các cột, đo tạm ở chế độ bảng tự co giãn. */
function measureNatural(table: HTMLTableElement, ths: HTMLTableCellElement[]): number[] {
  const prev = { layout: table.style.tableLayout, width: table.style.width };
  const widths = ths.map((th) => th.style.width);
  table.style.tableLayout = 'auto';
  table.style.width = 'max-content';
  ths.forEach((th) => (th.style.width = ''));
  const out = ths.map((th) => Math.round(Math.min(MAX_FIT, Math.max(MIN_COL, th.getBoundingClientRect().width))));
  ths.forEach((th, i) => (th.style.width = widths[i]));
  table.style.tableLayout = prev.layout;
  table.style.width = prev.width;
  return out;
}

function applyCols(table: HTMLTableElement, sizes: Sizes): boolean {
  const ths = headerCells(table);
  if (!Object.keys(sizes.cols).length) {
    if (table.classList.contains('tbl-sized')) {
      ths.forEach((th) => (th.style.width = ''));
      table.style.tableLayout = '';
      table.style.width = '';
      table.classList.remove('tbl-sized');
    }
    return false;
  }
  let changed = false;
  const missing = ths.filter((th) => sizes.cols[colKey(th)] === undefined);
  if (missing.length) {
    measureNatural(table, missing).forEach((w, i) => (sizes.cols[colKey(missing[i])] = w));
    changed = true;
  }
  let total = 0;
  for (const th of ths) {
    const w = sizes.cols[colKey(th)];
    th.style.width = `${w}px`;
    total += w;
  }
  table.classList.add('tbl-sized');
  table.style.tableLayout = 'fixed';
  table.style.width = `${total}px`;
  return changed;
}

function applyRows(table: HTMLTableElement, sizes: Sizes) {
  for (const tbody of Array.from(table.tBodies))
    for (const tr of Array.from(tbody.rows)) {
      const id = tr.dataset.row;
      const h = id ? sizes.rows[id] : undefined;
      if (h) {
        tr.style.height = `${h}px`;
        tr.style.setProperty('--row-h', `${h}px`);
        tr.classList.add('row-sized');
      } else if (tr.classList.contains('row-sized')) {
        tr.style.height = '';
        tr.style.removeProperty('--row-h');
        tr.classList.remove('row-sized');
      }
    }
}

type Zone = { kind: 'col'; th: HTMLTableCellElement } | { kind: 'row'; tr: HTMLTableRowElement } | null;

function zoneAt(table: HTMLTableElement, e: MouseEvent): Zone {
  // Sau khi kéo, click/dblclick có target là <table> (pointer capture) nên phải tìm ô theo tọa độ chuột.
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('th, td') as HTMLTableCellElement | null;
  if (!cell || cell.closest('table') !== table) return null;
  const tr = cell.parentElement as HTMLTableRowElement;
  if (tr.parentElement === table.tHead) {
    const r = cell.getBoundingClientRect();
    if (r.right - e.clientX <= EDGE) return { kind: 'col', th: cell };
    const prev = cell.previousElementSibling as HTMLTableCellElement | null;
    if (prev && e.clientX - r.left <= EDGE) return { kind: 'col', th: prev };
    return null;
  }
  const r = tr.getBoundingClientRect();
  if (r.bottom - e.clientY <= EDGE && tr.dataset.row) return { kind: 'row', tr };
  const prev = tr.previousElementSibling as HTMLTableRowElement | null;
  if (prev?.dataset.row && e.clientY - r.top <= EDGE) return { kind: 'row', tr: prev };
  return null;
}

/**
 * Kéo mép phải tiêu đề cột để đổi độ rộng cột, kéo mép dưới một dòng (cần `data-row` trên `<tr>`) để đổi chiều cao
 * dòng; bấm đúp vào mép để trả về kích thước tự nhiên. Kích thước lưu theo `key` của bảng. Trả về callback ref cho
 * `<table>`.
 */
export function useTableResize(key: string): (el: HTMLTableElement | null) => void {
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const sizes = useRef<Sizes>(loadSizes(key));
  const loadedKey = useRef(key);
  if (loadedKey.current !== key) {
    loadedKey.current = key;
    sizes.current = loadSizes(key);
  }

  useLayoutEffect(() => {
    if (!table) return;
    if (applyCols(table, sizes.current)) writeLocal(storeKey(key), sizes.current);
    applyRows(table, sizes.current);
  });

  useEffect(() => {
    if (!table) return;
    const save = () => writeLocal(storeKey(loadedKey.current), sizes.current);
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (applyCols(table, sizes.current)) save();
        applyRows(table, sizes.current);
      });
    });
    observer.observe(table, { childList: true, subtree: true });

    let drag: { zone: NonNullable<Zone>; start: number; size: number; moved: boolean } | null = null;
    let swallowClick = false;
    const setCursor = (z: Zone) => {
      table.classList.toggle('rs-col', z?.kind === 'col');
      table.classList.toggle('rs-row', z?.kind === 'row');
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return setCursor(zoneAt(table, e));
      const d = drag.zone.kind === 'col' ? e.clientX - drag.start : e.clientY - drag.start;
      if (Math.abs(d) > 2) drag.moved = true;
      if (drag.zone.kind === 'col') {
        sizes.current.cols[colKey(drag.zone.th)] = Math.round(Math.max(MIN_COL, drag.size + d));
        applyCols(table, sizes.current);
      } else {
        sizes.current.rows[drag.zone.tr.dataset.row!] = Math.round(Math.max(MIN_ROW, drag.size + d));
        applyRows(table, sizes.current);
      }
    };
    const onDown = (e: PointerEvent) => {
      swallowClick = false;
      if (e.button !== 0) return;
      const z = zoneAt(table, e);
      if (!z) return;
      e.preventDefault();
      swallowClick = true;
      if (z.kind === 'col') {
        if (!table.classList.contains('tbl-sized')) {
          const ths = headerCells(table);
          ths.forEach((th) => (sizes.current.cols[colKey(th)] = Math.round(th.getBoundingClientRect().width)));
        }
        drag = { zone: z, start: e.clientX, size: sizes.current.cols[colKey(z.th)] ?? z.th.getBoundingClientRect().width, moved: false };
      } else {
        drag = { zone: z, start: e.clientY, size: z.tr.getBoundingClientRect().height, moved: false };
      }
      table.setPointerCapture(e.pointerId);
      table.classList.add('rs-dragging');
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      if (table.hasPointerCapture(e.pointerId)) table.releasePointerCapture(e.pointerId);
      table.classList.remove('rs-dragging');
      if (drag.moved) save();
      drag = null;
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onDblClick = (e: MouseEvent) => {
      const z = zoneAt(table, e);
      if (!z) return;
      e.stopPropagation();
      e.preventDefault();
      if (z.kind === 'col') {
        const [w] = measureNatural(table, [z.th]);
        sizes.current.cols[colKey(z.th)] = w;
        applyCols(table, sizes.current);
      } else {
        delete sizes.current.rows[z.tr.dataset.row!];
        applyRows(table, sizes.current);
      }
      save();
    };
    const onLeave = () => !drag && setCursor(null);
    table.addEventListener('pointermove', onMove);
    table.addEventListener('pointerdown', onDown);
    table.addEventListener('pointerup', onUp);
    table.addEventListener('pointercancel', onUp);
    table.addEventListener('pointerleave', onLeave);
    table.addEventListener('click', onClick, true);
    table.addEventListener('dblclick', onDblClick, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      table.removeEventListener('pointermove', onMove);
      table.removeEventListener('pointerdown', onDown);
      table.removeEventListener('pointerup', onUp);
      table.removeEventListener('pointercancel', onUp);
      table.removeEventListener('pointerleave', onLeave);
      table.removeEventListener('click', onClick, true);
      table.removeEventListener('dblclick', onDblClick, true);
    };
  }, [table]);

  return setTable;
}
