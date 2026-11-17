import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { toISODate } from '../../shared/dates';
import type { CellValue, FileCheck, WorkbookData, WorkbookSheet } from '../../shared/types';
import { fileExtension } from '../../shared/validation';
import { workbookSignature } from '../../shared/xlsxMapping';
import { AppError } from '../context';

export function checkFile(filePath: string): FileCheck {
  if (!filePath || !path.isAbsolute(filePath)) return { exists: false, accessible: false, message: 'Đường dẫn không hợp lệ.' };
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { exists: false, accessible: false, message: 'Đường dẫn không phải file.' };
  } catch {
    return { exists: false, accessible: false, message: 'File không tồn tại hoặc đã bị di chuyển/đổi tên.' };
  }
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return { exists: true, accessible: true };
  } catch {
    return { exists: true, accessible: false, message: 'Không có quyền đọc file.' };
  }
}

function toCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toISODate(v);
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

export function readWorkbook(filePath: string, maxMb: number, maxRows: number): Omit<WorkbookData, 'savedMappings'> {
  if (fileExtension(filePath) !== 'xlsx') throw new AppError('Chỉ hỗ trợ file Excel .xlsx (không hỗ trợ .xls, .csv).');
  const check = checkFile(filePath);
  if (!check.accessible) throw new AppError(check.message ?? 'Không đọc được file.');
  const size = fs.statSync(filePath).size;
  if (size > maxMb * 1024 * 1024)
    throw new AppError(`Workbook quá lớn (${(size / 1024 / 1024).toFixed(1)} MB). Giới hạn hiện tại là ${maxMb} MB (đổi trong Settings).`);

  const buf = fs.readFileSync(filePath);
  // SheetJS đọc được cả text/CSV đổi đuôi; .xlsx thật luôn là gói ZIP ("PK\x03\x04").
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    throw new AppError('Workbook được bảo vệ bằng mật khẩu hoặc là định dạng .xls cũ — hãy lưu lại thành .xlsx không mật khẩu.');
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04)
    throw new AppError('File bị hỏng hoặc không phải workbook .xlsx hợp lệ.');
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false, dense: true });
  } catch {
    throw new AppError('File bị hỏng hoặc không phải workbook .xlsx hợp lệ.');
  }
  if (!wb.SheetNames.length) throw new AppError('Workbook không có worksheet nào.');

  const warnings: string[] = [];
  const sheets: WorkbookSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws?.['!ref'];
    if (!ref) return { name, rows: [], rowCount: 0, colCount: 0, truncated: false };
    const range = XLSX.utils.decode_range(ref);
    const fullRows = range.e.r + 1;
    const truncated = fullRows > maxRows;
    const endRow = truncated ? maxRows - 1 : range.e.r;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
      range: { s: { r: 0, c: 0 }, e: { r: endRow, c: range.e.c } },
    });
    const rows = raw.map((r) => (Array.isArray(r) ? r.map(toCell) : []));
    while (rows.length && rows[rows.length - 1].every((c) => c === null || c === '')) rows.pop();
    const colCount = rows.reduce((m, r) => {
      let last = r.length - 1;
      while (last >= 0 && (r[last] === null || r[last] === '')) last--;
      return Math.max(m, last + 1);
    }, 0);
    if (truncated) warnings.push(`Sheet "${name}" có ${fullRows} dòng, vượt giới hạn ${maxRows} dòng — chỉ đọc ${maxRows} dòng đầu.`);
    return { name, rows: rows.map((r) => r.slice(0, colCount)), rowCount: rows.length, colCount, truncated };
  });
  if (sheets.every((s) => s.rowCount === 0)) throw new AppError('Workbook không có dữ liệu.');

  return {
    fileName: path.basename(filePath),
    filePath,
    sizeBytes: size,
    signature: workbookSignature(sheets),
    sheets,
    warnings,
  };
}

/** Xuất một bảng (dòng đầu là tiêu đề) ra file .xlsx, độ rộng cột theo nội dung. */
/** Dấu "/" trong định dạng Excel bị thay bằng dấu ngăn cách ngày của máy (vd "." ở máy Đức) nên phải escape. */
export const XLSX_DATE_FORMAT = 'mm\\/dd\\/yyyy';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Số ngày kiểu Excel (gốc 30/12/1899), tính theo UTC để không lệch ngày theo múi giờ. */
function excelSerial(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 + 25_569;
}

const WRAP_XF = '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>';

/**
 * Bản SheetJS miễn phí không ghi kiểu ô, nên thêm một kiểu "Wrap text + căn trên" vào styles.xml rồi gán cho các ô
 * nhiều dòng — nếu không Excel hiện cả ghi chú trên một dòng.
 */
function applyWrap(buf: Buffer, cells: string[]): Buffer {
  if (!cells.length) return buf;
  const zip = XLSX.CFB.read(buf, { type: 'buffer' });
  const entry = (name: string) => zip.FileIndex[zip.FullPaths.findIndex((p: string) => p.endsWith(name))];
  const styles = entry('xl/styles.xml');
  const sheet = entry('xl/worksheets/sheet1.xml');
  if (!styles || !sheet) return buf;
  let st = Buffer.from(styles.content as Uint8Array).toString('utf8');
  const m = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(st);
  if (!m) return buf;
  const idx = Number(m[1]);
  st = st.replace(m[0], `<cellXfs count="${idx + 1}">${m[2]}${WRAP_XF}</cellXfs>`);
  let sh = Buffer.from(sheet.content as Uint8Array).toString('utf8');
  const want = new Set(cells);
  sh = sh.replace(/<c r="([A-Z]+\d+)"((?: [a-z:]+="[^"]*")*)>/g, (all, ref: string, attrs: string) =>
    want.has(ref) ? `<c r="${ref}"${attrs.replace(/ s="\d+"/, '')} s="${idx}">` : all,
  );
  styles.content = Buffer.from(st, 'utf8');
  styles.size = (styles.content as Buffer).length;
  sheet.content = Buffer.from(sh, 'utf8');
  sheet.size = (sheet.content as Buffer).length;
  return Buffer.from(XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer', compression: true }) as Uint8Array);
}

const CELL_MAX = 32_000;

export function writeXlsx(target: string, sheetName: string, rows: (string | number | null)[][], dateColumns: number[] = [], wrapColumns: number[] = []): string {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200_000 || !rows.every(Array.isArray)) throw new AppError('Dữ liệu xuất không hợp lệ.');
  const clean = rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v).slice(0, CELL_MAX))));
  const wraps = new Set(Array.isArray(wrapColumns) ? wrapColumns.filter((c) => Number.isInteger(c) && c >= 0) : []);
  const dates = new Set(Array.isArray(dateColumns) ? dateColumns.filter((c) => Number.isInteger(c) && c >= 0) : []);
  const ws = XLSX.utils.aoa_to_sheet(clean);
  for (let r = 1; r < clean.length; r++) {
    for (const c of dates) {
      const v = clean[r][c];
      const serial = typeof v === 'string' ? excelSerial(v) : null;
      if (serial !== null) ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v: serial, z: XLSX_DATE_FORMAT };
    }
  }
  const widths = clean[0].map((_, c) =>
    dates.has(c)
      ? Math.max(12, String(clean[0][c]).length + 2)
      : wraps.has(c)
        ? 70
        : Math.min(60, Math.max(8, ...clean.slice(0, 500).map((r) => String(r[c] ?? '').length + 2))),
  );
  const wrapCells: string[] = [];
  for (let r = 1; r < clean.length; r++) for (const c of wraps) if (typeof clean[r][c] === 'string' && String(clean[r][c]).includes('\n')) wrapCells.push(XLSX.utils.encode_cell({ r, c }));
  ws['!cols'] = widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').replace(/[[\]*?/\\:]/g, ' ').slice(0, 31));
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, applyWrap(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, wrapCells));
  fs.renameSync(tmp, target);
  return target;
}
