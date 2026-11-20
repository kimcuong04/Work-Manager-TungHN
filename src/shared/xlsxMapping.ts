import { excelSerialToISO, isValidISODate, parseDisplayDate } from './dates';
import { normalizeText } from './text';
import type {
  CellValue,
  ColumnMappingRecord,
  ImportedInfoRow,
  ImportedItem,
  ImportedRequirement,
  WorkbookSheet,
} from './types';

export type InfoField =
  | 'imported_project_name'
  | 'si_name'
  | 'sales_owner'
  | 'brands'
  | 'received_date'
  | 'deadline_date'
  | 'completion_date';
export type ReqField = 'round' | 'content' | 'date';
export type ItemField = 'model' | 'brand' | 'description';

interface FieldDef<K extends string> {
  key: K;
  label: string;
  aliases: string[];
  isDate?: boolean;
}

export const INFO_FIELDS: FieldDef<InfoField>[] = [
  { key: 'imported_project_name', label: 'Tên Dự án', aliases: ['ten du an', 'du an', 'project', 'project name', 'ten cong trinh', 'cong trinh'] },
  { key: 'si_name', label: 'Tên SI', aliases: ['ten si', 'si', 'si name', 'nha tich hop', 'system integrator'] },
  { key: 'sales_owner', label: 'Sales phụ trách', aliases: ['sales phu trach', 'sale phu trach', 'sales', 'sale', 'sales owner', 'nguoi phu trach'] },
  { key: 'brands', label: 'Hãng', aliases: ['hang', 'brand', 'brands', 'hang san xuat', 'nha san xuat'] },
  { key: 'received_date', label: 'Ngày nhận', aliases: ['ngay nhan', 'ngay tiep nhan', 'received date', 'received'], isDate: true },
  { key: 'deadline_date', label: 'Ngày deadline', aliases: ['ngay deadline', 'deadline', 'ngay het han', 'han hoan thanh', 'due date'], isDate: true },
  { key: 'completion_date', label: 'Ngày hoàn thành', aliases: ['ngay hoan thanh', 'hoan thanh', 'completion date', 'completed date'], isDate: true },
];

export const REQ_FIELDS: FieldDef<ReqField>[] = [
  { key: 'round', label: 'Lần (Round)', aliases: ['lan', 'round', 'lan yeu cau', 'so lan'] },
  { key: 'content', label: 'Nội dung (Content)', aliases: ['noi dung', 'noi dung yeu cau', 'content', 'yeu cau', 'requirement', 'requirements'] },
  { key: 'date', label: 'Ngày (Date)', aliases: ['ngay', 'date', 'ngay ghi nhan', 'ngay yeu cau', 'created date'], isDate: true },
];

export const ITEM_FIELDS: FieldDef<ItemField>[] = [
  { key: 'model', label: 'Model / Mã thiết bị', aliases: ['model', 'ma thiet bi', 'ma san pham', 'ma hang', 'ma vat tu', 'part number', 'part no', 'p n', 'model no'] },
  { key: 'brand', label: 'Hãng', aliases: ['hang', 'brand', 'hang san xuat', 'nha san xuat', 'manufacturer'] },
  { key: 'description', label: 'Mô tả', aliases: ['mo ta', 'description', 'dien giai', 'mo ta san pham', 'noi dung cung cap', 'chi tiet'] },
];

export interface InfoConfig {
  enabled: boolean;
  sheet: string;
  keyCol: number;
  valueCol: number;
  startRow: number;
  endRow: number;
  fieldRows: Partial<Record<InfoField, number>>;
  includeExtra: boolean;
}

export interface TableConfig<F extends string> {
  enabled: boolean;
  sheet: string;
  /** -1 = không có dòng header; dữ liệu bắt đầu từ headerRow + 1. */
  headerRow: number;
  endRow: number;
  columns: Partial<Record<F, number>>;
}

export interface RequirementConfig extends TableConfig<ReqField> {
  mergeContinuation: boolean;
}

export type ItemConfig = TableConfig<ItemField>;

export interface ImportConfig {
  info: InfoConfig;
  requirements: RequirementConfig;
  items: ItemConfig;
}

export interface BuiltImport {
  info: ImportedInfoRow[];
  requirements: ImportedRequirement[];
  items: ImportedItem[];
  warnings: string[];
}

export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  return v.replace(/\r\n?/g, '\n').trim();
}

function cell(sheet: WorkbookSheet, r: number, c: number | undefined): CellValue | undefined {
  if (c === undefined || c < 0) return undefined;
  return sheet.rows[r]?.[c];
}

export function labelKey(v: CellValue | undefined): string {
  if (typeof v !== 'string') return '';
  return normalizeText(v)
    .replace(/[^a-z0-9/()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Khớp nhãn với alias: bằng nhau, hoặc một vế khi tách theo "/" hoặc "(" bằng alias. */
export function matchesAlias(v: CellValue | undefined, aliases: string[]): boolean {
  const k = labelKey(v);
  if (!k || k.length > 60) return false;
  const parts = [k, ...k.split(/[/()]/)].map((p) => p.replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  return parts.some((p) => aliases.includes(p));
}

function toDateValue(v: CellValue | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  if (isValidISODate(s)) return s;
  return parseDisplayDate(s);
}

function dateOrText(v: CellValue | undefined): string {
  return toDateValue(v) ?? cellText(v);
}

export function getSheet(sheets: WorkbookSheet[], name: string): WorkbookSheet | undefined {
  return sheets.find((s) => s.name === name);
}

function rowIsEmpty(sheet: WorkbookSheet, r: number, cols: number[]): boolean {
  return cols.every((c) => cellText(cell(sheet, r, c)) === '');
}

/** Tự xác định dòng cuối của bảng: dừng khi gặp 2 dòng trống liên tiếp ở các cột đã map. */
export function detectTableEnd(sheet: WorkbookSheet, headerRow: number, cols: number[]): number {
  const valid = cols.filter((c) => c >= 0);
  if (!valid.length) return headerRow;
  let last = headerRow;
  let blanks = 0;
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    if (rowIsEmpty(sheet, r, valid)) {
      if (++blanks >= 2) break;
    } else {
      blanks = 0;
      last = r;
    }
  }
  return last;
}

function findHeaderRow<F extends string>(
  sheet: WorkbookSheet,
  defs: FieldDef<F>[],
  required: F[],
  anyOf: F[],
  skipRows: Set<number>,
): { row: number; columns: Partial<Record<F, number>> } | null {
  const maxRow = Math.min(sheet.rows.length, 200);
  for (let r = 0; r < maxRow; r++) {
    if (skipRows.has(r)) continue;
    const row = sheet.rows[r] ?? [];
    const columns: Partial<Record<F, number>> = {};
    row.forEach((v, c) => {
      for (const d of defs) {
        if (columns[d.key] === undefined && matchesAlias(v, d.aliases)) {
          columns[d.key] = c;
          break;
        }
      }
    });
    if (required.every((k) => columns[k] !== undefined) && (!anyOf.length || anyOf.some((k) => columns[k] !== undefined)))
      return { row: r, columns };
  }
  return null;
}

function sortSheetsByHint(sheets: WorkbookSheet[], hints: string[]): WorkbookSheet[] {
  const score = (s: WorkbookSheet) => (hints.some((h) => normalizeText(s.name).includes(h)) ? 0 : 1);
  return [...sheets].sort((a, b) => score(a) - score(b));
}

function emptyConfig(first: string): ImportConfig {
  return {
    info: { enabled: false, sheet: first, keyCol: 0, valueCol: 1, startRow: 0, endRow: 0, fieldRows: {}, includeExtra: false },
    requirements: { enabled: false, sheet: first, headerRow: 0, endRow: 0, columns: {}, mergeContinuation: true },
    items: { enabled: false, sheet: first, headerRow: 0, endRow: 0, columns: {} },
  };
}

function detectRoundLabels(sheet: WorkbookSheet, skip: Set<number>): RequirementConfig | null {
  const maxCol = Math.min(10, sheet.colCount);
  for (let c = 0; c < maxCol; c++) {
    const rows: number[] = [];
    for (let r = 0; r < sheet.rows.length; r++) {
      if (skip.has(r)) continue;
      const k = labelKey(cell(sheet, r, c));
      if (/^(lan|round)\s*\d+$/.test(k)) rows.push(r);
    }
    if (!rows.length) continue;
    let contentCol = -1;
    for (let cc = c + 1; cc < c + 6 && contentCol < 0; cc++) {
      if (rows.some((r) => cellText(cell(sheet, r, cc)) !== '' || cellText(cell(sheet, r + 1, cc)) !== '')) contentCol = cc;
    }
    if (contentCol < 0) continue;
    let end = rows[rows.length - 1];
    while (
      end + 1 < sheet.rows.length &&
      !skip.has(end + 1) &&
      cellText(cell(sheet, end + 1, c)) === '' &&
      cellText(cell(sheet, end + 1, contentCol)) !== ''
    )
      end++;
    return {
      enabled: true,
      sheet: sheet.name,
      headerRow: rows[0] - 1,
      endRow: end,
      columns: { round: c, content: contentCol },
      mergeContinuation: true,
    };
  }
  return null;
}

function detectInfo(sheet: WorkbookSheet, skip: Set<number>): InfoConfig | null {
  const maxCol = Math.min(10, sheet.colCount);
  let best: InfoConfig | null = null;
  let bestCount = 0;
  for (let c = 0; c < maxCol; c++) {
    const fieldRows: Partial<Record<InfoField, number>> = {};
    for (let r = 0; r < Math.min(sheet.rows.length, 200); r++) {
      if (skip.has(r)) continue;
      const v = cell(sheet, r, c);
      for (const d of INFO_FIELDS) {
        if (fieldRows[d.key] === undefined && matchesAlias(v, d.aliases)) {
          fieldRows[d.key] = r;
          break;
        }
      }
    }
    const matched = Object.values(fieldRows) as number[];
    if (matched.length < 2 || matched.length <= bestCount) continue;
    let valueCol = c + 1;
    let bestHits = -1;
    for (let vc = c + 1; vc < c + 6; vc++) {
      const hits = matched.filter((r) => cellText(cell(sheet, r, vc)) !== '').length;
      if (hits > bestHits) {
        bestHits = hits;
        valueCol = vc;
      }
    }
    bestCount = matched.length;
    best = {
      enabled: true,
      sheet: sheet.name,
      keyCol: c,
      valueCol,
      startRow: Math.min(...matched),
      endRow: Math.max(...matched),
      fieldRows,
      includeExtra: false,
    };
  }
  return best;
}

/** Auto-detect: chỉ map khi nhãn header khớp alias; không đoán khi không chắc (TC-XLSX-002). */
/** Tự nhận diện bảng thiết bị trong đúng một sheet (khi người dùng chọn sheet để import); null = không thấy header. */
export function detectItemsInSheet(sheet: WorkbookSheet): ItemConfig | null {
  const h = findHeaderRow(sheet, ITEM_FIELDS, ['model'], ['brand', 'description'], new Set());
  if (!h) return null;
  return { enabled: true, sheet: sheet.name, headerRow: h.row, endRow: detectTableEnd(sheet, h.row, Object.values(h.columns) as number[]), columns: h.columns };
}

export function autoDetect(sheets: WorkbookSheet[]): { config: ImportConfig; notes: string[] } {
  const notes: string[] = [];
  const config = emptyConfig(sheets[0]?.name ?? '');
  const reserved = new Map<string, Set<number>>();
  const reserve = (sheet: string, from: number, to: number) => {
    const set = reserved.get(sheet) ?? new Set<number>();
    for (let r = Math.max(0, from); r <= to; r++) set.add(r);
    reserved.set(sheet, set);
  };
  const skipOf = (sheet: string) => reserved.get(sheet) ?? new Set<number>();

  for (const s of sortSheetsByHint(sheets, ['equipment', 'thiet bi', 'vat tu', 'san pham'])) {
    const h = findHeaderRow(s, ITEM_FIELDS, ['model'], ['brand', 'description'], skipOf(s.name));
    if (!h) continue;
    const endRow = detectTableEnd(s, h.row, Object.values(h.columns) as number[]);
    config.items = { enabled: true, sheet: s.name, headerRow: h.row, endRow, columns: h.columns };
    reserve(s.name, h.row, endRow);
    break;
  }
  if (!config.items.enabled) notes.push('Không nhận diện được bảng thiết bị — cần chọn vùng và map cột thủ công.');

  let req: RequirementConfig | null = null;
  for (const s of sortSheetsByHint(sheets, ['requirement', 'yeu cau'])) {
    const h = findHeaderRow(s, REQ_FIELDS, ['content'], ['round', 'date'], skipOf(s.name));
    if (h) {
      const endRow = detectTableEnd(s, h.row, Object.values(h.columns) as number[]);
      req = { enabled: true, sheet: s.name, headerRow: h.row, endRow, columns: h.columns, mergeContinuation: true };
      break;
    }
    req = detectRoundLabels(s, skipOf(s.name));
    if (req) break;
  }
  if (req) {
    config.requirements = req;
    reserve(req.sheet, req.headerRow, req.endRow);
  } else notes.push('Không nhận diện được Nội dung yêu cầu — cần map thủ công nếu workbook có phần này.');

  for (const s of sortSheetsByHint(sheets, ['project info', 'thong tin', 'info'])) {
    const info = detectInfo(s, skipOf(s.name));
    if (info) {
      config.info = info;
      break;
    }
  }
  if (!config.info.enabled) notes.push('Không nhận diện được Bảng thông tin dự án — cần map thủ công.');
  return { config, notes };
}

export function buildImport(sheets: WorkbookSheet[], config: ImportConfig): BuiltImport {
  const warnings: string[] = [];
  const info: ImportedInfoRow[] = [];
  const requirements: ImportedRequirement[] = [];
  const items: ImportedItem[] = [];

  const ic = config.info;
  const infoSheet = getSheet(sheets, ic.sheet);
  if (ic.enabled && infoSheet) {
    const used = new Set<number>();
    for (const d of INFO_FIELDS) {
      const r = ic.fieldRows[d.key];
      let value = '';
      if (r !== undefined && r >= 0) {
        used.add(r);
        const raw = cell(infoSheet, r, ic.valueCol);
        value = d.isDate ? dateOrText(raw) : cellText(raw);
      }
      info.push({ fieldKey: d.key, fieldLabel: d.label, fieldValue: value });
    }
    const unmapped: string[] = [];
    for (let r = ic.startRow; r <= ic.endRow; r++) {
      if (used.has(r)) continue;
      const key = cellText(cell(infoSheet, r, ic.keyCol));
      if (!key) continue;
      const value = cellText(cell(infoSheet, r, ic.valueCol));
      if (ic.includeExtra) info.push({ fieldKey: `extra_${r + 1}`, fieldLabel: key, fieldValue: value });
      else unmapped.push(key);
    }
    if (unmapped.length) warnings.push(`Thông tin dự án: ${unmapped.length} dòng không map được (${unmapped.slice(0, 5).join(', ')}${unmapped.length > 5 ? '…' : ''}).`);
  }

  const rc = config.requirements;
  const reqSheet = getSheet(sheets, rc.sheet);
  if (rc.enabled && reqSheet) {
    if (rc.columns.content === undefined) warnings.push('Nội dung yêu cầu: chưa chọn cột Nội dung.');
    else {
      type Draft = { round: number | null; content: string[]; date: string | null; order: number };
      const drafts: Draft[] = [];
      let orphan = 0;
      for (let r = rc.headerRow + 1; r <= rc.endRow; r++) {
        const content = cellText(cell(reqSheet, r, rc.columns.content));
        const roundRaw = cellText(cell(reqSheet, r, rc.columns.round));
        const m = /(\d+)/.exec(roundRaw);
        const round = m ? Number(m[1]) : null;
        const date = rc.columns.date !== undefined ? toDateValue(cell(reqSheet, r, rc.columns.date)) : null;
        const hasRound = rc.columns.round !== undefined && roundRaw !== '';
        if (!content && !hasRound) continue;
        if (!hasRound && rc.columns.round !== undefined && rc.mergeContinuation && drafts.length) {
          if (content) drafts[drafts.length - 1].content.push(content);
          continue;
        }
        if (!hasRound && rc.columns.round !== undefined && !rc.mergeContinuation && content) orphan++;
        drafts.push({ round, content: content ? [content] : [], date, order: drafts.length });
      }
      const filled = drafts.filter((d) => d.content.join('').trim() !== '');
      if (filled.length < drafts.length) warnings.push(`Nội dung yêu cầu: bỏ qua ${drafts.length - filled.length} lần không có nội dung.`);
      if (orphan) warnings.push(`Nội dung yêu cầu: ${orphan} dòng không có số lần được tách thành lần riêng.`);
      filled.sort((a, b) => (a.round ?? Infinity) - (b.round ?? Infinity) || a.order - b.order);
      const seen = new Set<number>();
      let next = 1;
      for (const d of filled) {
        let n = d.round ?? next;
        while (seen.has(n)) n++;
        seen.add(n);
        next = n + 1;
        requirements.push({ roundNumber: n, content: d.content.join('\n'), createdDate: d.date });
      }
    }
  }

  const tc = config.items;
  const itemSheet = getSheet(sheets, tc.sheet);
  if (tc.enabled && itemSheet) {
    if (tc.columns.model === undefined && tc.columns.description === undefined)
      warnings.push('Thiết bị: cần map ít nhất cột Model hoặc Mô tả.');
    else {
      for (let r = tc.headerRow + 1; r <= tc.endRow; r++) {
        const model = cellText(cell(itemSheet, r, tc.columns.model));
        const brand = cellText(cell(itemSheet, r, tc.columns.brand));
        const description = cellText(cell(itemSheet, r, tc.columns.description));
        if (!model && !brand && !description) continue;
        items.push({ model, brand, description });
      }
    }
  }

  for (const s of sheets) if (s.truncated) warnings.push(`Sheet "${s.name}" vượt giới hạn dòng, chỉ đọc ${s.rows.length} dòng đầu.`);
  return { info, requirements, items, warnings };
}

export function configToMappings(config: ImportConfig): ColumnMappingRecord[] {
  const out: ColumnMappingRecord[] = [];
  const add = (sheetName: string, sourceColumn: string, targetField: string) => out.push({ sheetName, sourceColumn, targetField });
  const { info, requirements: rq, items } = config;
  add(info.sheet, info.enabled ? '1' : '0', 'info.enabled');
  if (info.enabled) {
    add(info.sheet, colName(info.keyCol), 'info.keyCol');
    add(info.sheet, colName(info.valueCol), 'info.valueCol');
    add(info.sheet, String(info.startRow), 'info.startRow');
    add(info.sheet, String(info.endRow), 'info.endRow');
    add(info.sheet, info.includeExtra ? '1' : '0', 'info.includeExtra');
    for (const [k, r] of Object.entries(info.fieldRows)) if (r !== undefined) add(info.sheet, String(r), `info.field.${k}`);
  }
  for (const [prefix, t] of [['req', rq], ['item', items]] as const) {
    add(t.sheet, t.enabled ? '1' : '0', `${prefix}.enabled`);
    if (!t.enabled) continue;
    add(t.sheet, String(t.headerRow), `${prefix}.headerRow`);
    for (const [k, c] of Object.entries(t.columns)) if (c !== undefined) add(t.sheet, colName(c as number), `${prefix}.col.${k}`);
  }
  add(rq.sheet, rq.mergeContinuation ? '1' : '0', 'req.merge');
  return out;
}

export function configFromMappings(sheets: WorkbookSheet[], records: ColumnMappingRecord[]): ImportConfig | null {
  if (!records.length || !sheets.length) return null;
  const find = (field: string) => records.find((r) => r.targetField === field);
  const config = emptyConfig(sheets[0].name);
  const sheetOk = (name: string | undefined) => !!name && !!getSheet(sheets, name);

  const ie = find('info.enabled');
  if (ie && ie.sourceColumn === '1' && sheetOk(ie.sheetName)) {
    const fieldRows: Partial<Record<InfoField, number>> = {};
    for (const r of records) if (r.targetField.startsWith('info.field.')) fieldRows[r.targetField.slice(11) as InfoField] = Number(r.sourceColumn);
    config.info = {
      enabled: true,
      sheet: ie.sheetName,
      keyCol: colIndex(find('info.keyCol')?.sourceColumn ?? 'A'),
      valueCol: colIndex(find('info.valueCol')?.sourceColumn ?? 'B'),
      startRow: Number(find('info.startRow')?.sourceColumn ?? 0),
      endRow: Number(find('info.endRow')?.sourceColumn ?? 0),
      fieldRows,
      includeExtra: find('info.includeExtra')?.sourceColumn === '1',
    };
  }
  for (const prefix of ['req', 'item'] as const) {
    const en = find(`${prefix}.enabled`);
    if (!en || en.sourceColumn !== '1' || !sheetOk(en.sheetName)) continue;
    const columns: Record<string, number> = {};
    for (const r of records) if (r.targetField.startsWith(`${prefix}.col.`)) columns[r.targetField.slice(prefix.length + 5)] = colIndex(r.sourceColumn);
    const headerRow = Number(find(`${prefix}.headerRow`)?.sourceColumn ?? 0);
    const sheet = getSheet(sheets, en.sheetName)!;
    const endRow = detectTableEnd(sheet, headerRow, Object.values(columns));
    if (prefix === 'req')
      config.requirements = { enabled: true, sheet: en.sheetName, headerRow, endRow, columns, mergeContinuation: find('req.merge')?.sourceColumn !== '0' };
    else config.items = { enabled: true, sheet: en.sheetName, headerRow, endRow, columns };
  }
  return config.info.enabled || config.requirements.enabled || config.items.enabled ? config : null;
}

/** Chữ ký cấu trúc workbook: tên sheet + vị trí các nhãn khớp alias. Dùng để tái sử dụng mapping. */
export function workbookSignature(sheets: WorkbookSheet[]): string {
  const allAliases = [...INFO_FIELDS, ...REQ_FIELDS, ...ITEM_FIELDS].flatMap((d) => d.aliases);
  const parts: string[] = [];
  for (const s of sheets) {
    parts.push(`#${s.name}`);
    for (let r = 0; r < Math.min(s.rows.length, 60); r++) {
      (s.rows[r] ?? []).forEach((v, c) => {
        if (c < 15 && matchesAlias(v, allAliases)) parts.push(`${r}:${c}:${labelKey(v)}`);
      });
    }
  }
  let h = 0x811c9dc5;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v1-${h.toString(16)}-${sheets.length}`;
}

export { toDateValue };
