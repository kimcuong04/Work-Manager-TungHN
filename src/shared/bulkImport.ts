import { isValidISODate } from './dates';
import { nameKey } from './text';
import type { BulkRowInput, BulkTarget, BulkValue, CellValue, ColumnMappingRecord, WorkbookSheet } from './types';
import { cellText, colIndex, colName, matchesAlias, toDateValue } from './xlsxMapping';

export type BulkFieldType = 'text' | 'int' | 'date' | 'priority';

export interface BulkField {
  key: string;
  label: string;
  aliases: string[];
  type: BulkFieldType;
  required?: boolean;
  hint?: string;
}

const STT: BulkField = {
  key: 'stt',
  label: 'STT',
  aliases: ['stt', 'so thu tu', 'tt', 'no', 'so tt'],
  type: 'int',
  hint: 'Bỏ trống = tự đánh số tiếp theo',
};
const NOTE: BulkField = {
  key: 'note',
  label: 'Ghi chú',
  aliases: ['ghi chu', 'note', 'notes', 'chu thich'],
  type: 'text',
  hint: 'Thành ghi chú của hôm nay',
};
const NAME: BulkField = {
  key: 'projectName',
  label: 'Tên dự án',
  aliases: ['ten du an', 'du an', 'project', 'project name', 'ten cong trinh', 'cong trinh', 'ten job', 'job'],
  type: 'text',
  required: true,
};
const SI: BulkField = {
  key: 'si',
  label: 'Tên SI',
  aliases: ['ten si', 'si', 'si name', 'nha tich hop', 'system integrator'],
  type: 'text',
};
const BRAND: BulkField = {
  key: 'brand',
  label: 'Hãng',
  aliases: ['hang', 'brand', 'brands', 'hang san xuat', 'nha san xuat', 'manufacturer'],
  type: 'text',
};
const START_DATE = ['ngay bat dau', 'bat dau', 'start date', 'ngay tiep nhan', 'ngay nhan', 'received date'];

const PROJECT_FIELDS: BulkField[] = [
  STT,
  NAME,
  SI,
  { ...BRAND, label: 'Hãng', hint: 'Nhiều hãng cách nhau bởi dấu phẩy' },
  {
    key: 'sale',
    label: 'Sale',
    aliases: ['sale', 'sales', 'sale phu trach', 'sales phu trach', 'nguoi phu trach'],
    type: 'text',
  },
  {
    key: 'eu',
    label: 'EU',
    aliases: ['eu', 'end user', 'cdt', 'chu dau tu', 'khach hang', 'client', 'customer'],
    type: 'text',
  },
  {
    key: 'receivedDate',
    label: 'Ngày bắt đầu',
    aliases: START_DATE,
    type: 'date',
  },
  {
    key: 'dueDate',
    label: 'Ngày tới hạn',
    aliases: ['ngay toi han', 'toi han', 'han', 'deadline', 'ngay deadline', 'due date', 'ngay het han', 'han hoan thanh'],
    type: 'date',
  },
  {
    key: 'priority',
    label: 'Priority',
    aliases: ['priority', 'priority point', 'uu tien', 'do uu tien'],
    type: 'priority',
    hint: '1–5, bỏ trống = 3',
  },
  NOTE,
];

export const BULK_FIELDS: Record<BulkTarget, BulkField[]> = {
  PRE_SALES: PROJECT_FIELDS,
  POST_SALES: PROJECT_FIELDS,
  WARRANTY: [
    STT,
    {
      key: 'caseNumber',
      label: 'Case no',
      aliases: ['case no', 'case', 'case number', 'so case', 'ma case', 'rma', 'rma no'],
      type: 'text',
      hint: 'Cần Case no hoặc Model',
    },
    {
      key: 'model',
      label: 'Model',
      aliases: ['model', 'ma thiet bi', 'ma san pham', 'part number', 'model no'],
      type: 'text',
      hint: 'Cần Case no hoặc Model',
    },
    BRAND,
    SI,
    {
      key: 'ipAddress',
      label: 'IP',
      aliases: ['ip', 'ip address', 'dia chi ip'],
      type: 'text',
    },
    {
      key: 'username',
      label: 'User',
      aliases: ['user', 'username', 'user name', 'tai khoan', 'ten dang nhap'],
      type: 'text',
    },
    {
      key: 'password',
      label: 'Pass',
      aliases: ['pass', 'password', 'mat khau', 'pwd'],
      type: 'text',
      hint: 'Được mã hóa khi lưu',
    },
    {
      key: 'macAddress',
      label: 'MAC',
      aliases: ['mac', 'mac address', 'dia chi mac'],
      type: 'text',
    },
    {
      key: 'serialNumber',
      label: 'Serial number',
      aliases: ['serial', 'serial number', 'serial no', 'sn', 's n', 'so serial', 'so seri', 'seri'],
      type: 'text',
    },
    {
      key: 'receivedDate',
      label: 'Ngày nhận',
      aliases: ['ngay nhan', 'ngay tiep nhan', 'received date', 'ngay nhan hang'],
      type: 'date',
    },
    {
      key: 'testedDate',
      label: 'Ngày test',
      aliases: ['ngay test', 'ngay kiem tra', 'tested date', 'test date'],
      type: 'date',
    },
    {
      key: 'customerReport',
      label: 'Khách hàng báo',
      aliases: ['khach hang bao', 'khach bao', 'loi khach bao', 'customer report', 'mo ta loi', 'hien tuong'],
      type: 'text',
    },
    {
      key: 'inspection',
      label: 'Kiểm tra',
      aliases: ['kiem tra', 'inspection'],
      type: 'text',
    },
    {
      key: 'result',
      label: 'Kết quả',
      aliases: ['ket qua', 'result'],
      type: 'text',
    },
    {
      key: 'resolution',
      label: 'Xử lý',
      aliases: ['xu ly', 'huong xu ly', 'resolution', 'giai phap'],
      type: 'text',
    },
  ],
  FREELANCE: [
    STT,
    NAME,
    {
      key: 'hirer',
      label: 'Bên thuê',
      aliases: ['ben thue', 'nguoi thue', 'khach hang', 'khach', 'client', 'customer', 'ben a'],
      type: 'text',
    },
    {
      key: 'startDate',
      label: 'Ngày bắt đầu',
      aliases: START_DATE,
      type: 'date',
    },
    {
      key: 'status',
      label: 'Tình trạng',
      aliases: ['tinh trang', 'trang thai', 'status'],
      type: 'text',
      hint: 'Khớp theo tên; chưa có thì thêm vào danh mục',
    },
    NOTE,
  ],
};

export const BULK_TARGET_LABEL: Record<BulkTarget, string> = {
  PRE_SALES: 'Pre-sales',
  POST_SALES: 'Post-sales',
  WARRANTY: 'Warranty',
  FREELANCE: 'Job Freelance',
};

export interface BulkConfig {
  sheet: string;
  headerRow: number;
  /** Dòng cuối (index 0) của vùng dữ liệu. */
  endRow: number;
  columns: Record<string, number | undefined>;
}

export interface BulkRowPreview extends BulkRowInput {
  errors: string[];
  /** Lưu ý không chặn import (vd số đầu tên bị trùng nên sẽ tự cấp STT mới). */
  warnings: string[];
}

export interface BulkBuildOptions {
  /** Pre/Post-sales, Freelance: dòng không có STT thì lấy số ở đầu Tên dự án ("01. ABC" → STT 1, tên "ABC"). */
  sttFromName?: boolean;
}

const NAME_STT_RE = /^\s*(\d{1,6})\s*[.)\-–:]\s*([^\d\s][\s\S]*)$/;

/** "01. Bristish Center" → { stt: 1, name: "Bristish Center" }; "3.5 inch" hay tên không có số đầu → null. */
export function splitNameStt(name: string): { stt: number; name: string } | null {
  const m = NAME_STT_RE.exec(name ?? '');
  if (!m) return null;
  const stt = Number(m[1]);
  const rest = m[2].trim();
  return stt >= 1 && rest ? { stt, name: rest } : null;
}

/** Tỉ lệ dòng có số ở đầu Tên dự án — dùng để tự bật "Lấy STT từ số đầu tên" khi file không có cột STT. */
export function nameSttRatio(sheet: WorkbookSheet | undefined, config: BulkConfig): number {
  const c = config.columns.projectName;
  if (!sheet || c === undefined || c < 0) return 0;
  let total = 0;
  let hit = 0;
  for (let r = config.headerRow + 1; r <= Math.min(config.endRow, sheet.rows.length - 1); r++) {
    const name = cellText(sheet.rows[r]?.[c]);
    if (!name) continue;
    total++;
    if (splitNameStt(name)) hit++;
  }
  return total ? hit / total : 0;
}

/** Dòng nào trong 50 dòng đầu có nhiều tiêu đề khớp nhất (ưu tiên dòng có cột bắt buộc) thì là dòng header. */
export function detectBulkHeader(sheet: WorkbookSheet, fields: BulkField[]): { headerRow: number; columns: Record<string, number> } | null {
  let best: {
    headerRow: number;
    columns: Record<string, number>;
    score: number;
  } | null = null;
  const maxRow = Math.min(sheet.rows.length, 50);
  for (let r = 0; r < maxRow; r++) {
    const columns: Record<string, number> = {};
    (sheet.rows[r] ?? []).forEach((v, c) => {
      const f = fields.find((d) => columns[d.key] === undefined && matchesAlias(v, d.aliases));
      if (f) columns[f.key] = c;
    });
    const n = Object.keys(columns).length;
    if (!n) continue;
    const score = n + (fields.some((f) => f.required && columns[f.key] !== undefined) ? 100 : 0);
    if (!best || score > best.score) best = { headerRow: r, columns, score };
  }
  return best ? { headerRow: best.headerRow, columns: best.columns } : null;
}

export function lastDataRow(sheet: WorkbookSheet, headerRow: number, cols: number[]): number {
  const valid = cols.filter((c) => c >= 0);
  let last = headerRow;
  for (let r = headerRow + 1; r < sheet.rows.length; r++) if (valid.some((c) => cellText(sheet.rows[r]?.[c]) !== '')) last = r;
  return last;
}

export function autoBulkConfig(sheets: WorkbookSheet[], fields: BulkField[]): BulkConfig {
  let pick: {
    sheet: WorkbookSheet;
    headerRow: number;
    columns: Record<string, number>;
  } | null = null;
  for (const sheet of sheets) {
    const d = detectBulkHeader(sheet, fields);
    if (d && (!pick || Object.keys(d.columns).length > Object.keys(pick.columns).length)) pick = { sheet, ...d };
  }
  if (!pick) {
    const sheet = sheets.find((s) => s.rowCount > 0) ?? sheets[0];
    return {
      sheet: sheet?.name ?? '',
      headerRow: 0,
      endRow: Math.max(0, (sheet?.rowCount ?? 1) - 1),
      columns: {},
    };
  }
  return {
    sheet: pick.sheet.name,
    headerRow: pick.headerRow,
    endRow: lastDataRow(pick.sheet, pick.headerRow, Object.values(pick.columns)),
    columns: pick.columns,
  };
}

/** Giá trị đã chuẩn hóa: chữ đã trim, số nguyên, ngày ISO. Trả về lỗi nếu không đọc được. */
export function parseBulkValue(field: BulkField, raw: CellValue | undefined): { value: BulkValue; error?: string } {
  const text = cellText(raw);
  if (!text) return { value: null };
  if (field.type === 'text') return { value: text };
  if (field.type === 'date') {
    const iso = toDateValue(raw);
    return iso && isValidISODate(iso)
      ? { value: iso }
      : {
          value: null,
          error: `${field.label} "${text}" không phải ngày hợp lệ (dd/mm/yyyy).`,
        };
  }
  const n = typeof raw === 'number' ? raw : Number(text.replace(/\s/g, ''));
  if (field.type === 'int')
    return Number.isInteger(n) && n >= 1 && n <= 999999
      ? { value: n }
      : {
          value: null,
          error: `${field.label} "${text}" phải là số nguyên dương.`,
        };
  return Number.isInteger(n) && n >= 1 && n <= 5 ? { value: n } : { value: null, error: `${field.label} "${text}" phải từ 1 đến 5.` };
}

/** Lỗi theo luật của từng loại (bắt buộc, quan hệ giữa các trường), không gồm lỗi đọc giá trị. */
export function bulkRowRuleErrors(target: BulkTarget, values: Record<string, BulkValue>): string[] {
  const errors: string[] = [];
  const has = (k: string) => values[k] !== null && values[k] !== undefined && String(values[k]).trim() !== '';
  if (target === 'WARRANTY') {
    if (!has('model') && !has('caseNumber')) errors.push('Cần ít nhất Model hoặc Case no.');
  } else if (!has('projectName')) errors.push('Thiếu Tên dự án.');
  if ((target === 'PRE_SALES' || target === 'POST_SALES') && has('receivedDate') && has('dueDate') && String(values.dueDate) < String(values.receivedDate))
    errors.push('Ngày tới hạn trước Ngày bắt đầu.');
  return errors;
}

/**
 * Đọc các dòng dữ liệu theo mapping. Dòng trống ở mọi cột đã map bị bỏ qua. `usedStt` là STT đã có trong hệ thống
 * (để báo trùng ngay ở bước xem trước).
 */
export function buildBulkRows(
  target: BulkTarget,
  sheet: WorkbookSheet | undefined,
  config: BulkConfig,
  usedStt: Set<number> = new Set(),
  opts: BulkBuildOptions = {},
): BulkRowPreview[] {
  if (!sheet) return [];
  const fields = BULK_FIELDS[target];
  const mapped = fields.filter((f) => config.columns[f.key] !== undefined && config.columns[f.key]! >= 0);
  if (!mapped.length) return [];
  const out: BulkRowPreview[] = [];
  const seenStt = new Map<number, number>();
  const end = Math.min(config.endRow, sheet.rows.length - 1);
  for (let r = config.headerRow + 1; r <= end; r++) {
    const row = sheet.rows[r] ?? [];
    if (mapped.every((f) => cellText(row[config.columns[f.key]!]) === '')) continue;
    const values: Record<string, BulkValue> = {};
    const errors: string[] = [];
    for (const f of mapped) {
      const { value, error } = parseBulkValue(f, row[config.columns[f.key]!]);
      values[f.key] = value;
      if (error) errors.push(error);
    }
    const warnings: string[] = [];
    if (opts.sttFromName && target !== 'WARRANTY' && (values.stt === null || values.stt === undefined) && typeof values.projectName === 'string') {
      const split = splitNameStt(values.projectName);
      if (split) {
        values.projectName = split.name;
        if (usedStt.has(split.stt) || seenStt.has(split.stt)) {
          values.stt = null;
          warnings.push(
            usedStt.has(split.stt)
              ? `Số ${split.stt} ở đầu tên đã có trong hệ thống — sẽ tự cấp STT mới.`
              : `Số ${split.stt} ở đầu tên trùng với dòng ${seenStt.get(split.stt)} — sẽ tự cấp STT mới.`,
          );
        } else values.stt = split.stt;
      }
    }
    errors.push(...bulkRowRuleErrors(target, values));
    const stt = typeof values.stt === 'number' ? values.stt : null;
    if (stt !== null) {
      if (usedStt.has(stt)) errors.push(`STT ${stt} đã có trong hệ thống.`);
      else if (seenStt.has(stt)) errors.push(`STT ${stt} trùng với dòng ${seenStt.get(stt)}.`);
      else seenStt.set(stt, r + 1);
    }
    out.push({ rowNumber: r + 1, values, errors, warnings });
  }
  return out;
}

/** Tách danh sách Hãng: "Axis, Hikvision; Bosch" → 3 hãng (bỏ trùng không phân biệt hoa thường/dấu cách). */
export function splitNames(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,;\n|]+/)
    .map((x) => x.trim())
    .filter((x) => {
      const k = nameKey(x);
      if (!x || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const MAP_PREFIX = (target: BulkTarget) => `bulk.${target}.`;

export function bulkConfigToMappings(target: BulkTarget, config: BulkConfig): ColumnMappingRecord[] {
  const pre = MAP_PREFIX(target);
  const out: ColumnMappingRecord[] = [
    {
      sheetName: config.sheet,
      sourceColumn: String(config.headerRow),
      targetField: `${pre}headerRow`,
    },
  ];
  for (const [k, c] of Object.entries(config.columns))
    if (c !== undefined && c >= 0)
      out.push({
        sheetName: config.sheet,
        sourceColumn: colName(c),
        targetField: `${pre}col.${k}`,
      });
  return out;
}

export function bulkConfigFromMappings(target: BulkTarget, sheets: WorkbookSheet[], records: ColumnMappingRecord[]): BulkConfig | null {
  const pre = MAP_PREFIX(target);
  const head = records.find((r) => r.targetField === `${pre}headerRow`);
  const sheet = head && sheets.find((s) => s.name === head.sheetName);
  if (!head || !sheet) return null;
  const columns: Record<string, number> = {};
  for (const r of records) if (r.targetField.startsWith(`${pre}col.`)) columns[r.targetField.slice(pre.length + 4)] = colIndex(r.sourceColumn);
  if (!Object.keys(columns).length) return null;
  const headerRow = Number(head.sourceColumn) || 0;
  return {
    sheet: sheet.name,
    headerRow,
    endRow: lastDataRow(sheet, headerRow, Object.values(columns)),
    columns,
  };
}

export function isBulkMapping(target: BulkTarget, record: ColumnMappingRecord): boolean {
  return record.targetField.startsWith(MAP_PREFIX(target));
}
