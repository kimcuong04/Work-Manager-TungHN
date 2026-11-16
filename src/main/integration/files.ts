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
export function writeXlsx(target: string, sheetName: string, rows: (string | number | null)[][]): string {
  if (!Array.isArray(rows) || !rows.length || rows.length > 200_000 || !rows.every(Array.isArray)) throw new AppError('Dữ liệu xuất không hợp lệ.');
  const clean = rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v))));
  const ws = XLSX.utils.aoa_to_sheet(clean);
  const widths = clean[0].map((_, c) => Math.min(60, Math.max(8, ...clean.slice(0, 500).map((r) => String(r[c] ?? '').length + 2))));
  ws['!cols'] = widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').replace(/[[\]*?/\\:]/g, ' ').slice(0, 31));
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  fs.renameSync(tmp, target);
  return target;
}
