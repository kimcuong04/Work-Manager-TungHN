import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '../src/main/integration/files';
import { autoDetect, buildImport, configFromMappings, configToMappings } from '../src/shared/xlsxMapping';
import { tmpDir, writeWorkbook } from './helpers';

const dir = tmpDir('ppm-xlsx-');

describe('Import XLSX — template 3 sheet (TC-XLSX-001/003/004)', () => {
  const file = writeWorkbook(path.join(dir, 'template.xlsx'), {
    'Project Info': [
      ['Field', 'Value'],
      ['Tên Dự án', 'Chuỗi cửa hàng XYZ'],
      ['Tên SI', 'SI Alpha'],
      ['Sales phụ trách', 'Nguyễn A'],
      ['Hãng', 'VCA, Veracity'],
      ['Ngày nhận', '16/11/2026'],
      ['Ngày deadline', '30/11/2026'],
      ['Ngày hoàn thành', ''],
    ],
    Requirements: [
      ['Round', 'Content', 'Date'],
      [2, 'Bổ sung license\nnhận diện khuôn mặt', '20/11/2026'],
      [1, 'Báo giá camera AI cho 55 cửa hàng', '16/11/2026'],
    ],
    Equipment: [
      ['Model', 'Brand', 'Description'],
      ['IPAi685S-MR', 'VCA', 'Cam VCA'],
      ['VCAfaceIP', 'VCA', 'Bản quyền phần mềm nhận diện khuôn mặt — mô tả rất dài '.repeat(5)],
      ['COLDSTORE 2U', 'Veracity', 'Máy chủ VMS quản lý 55 camera/cửa hàng'],
    ],
  });

  it('đọc workbook, tự nhận diện cả ba vùng và build đúng dữ liệu', () => {
    const wb = readWorkbook(file, 20, 20000);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Project Info', 'Requirements', 'Equipment']);
    const { config, notes } = autoDetect(wb.sheets);
    expect(notes).toEqual([]);
    const out = buildImport(wb.sheets, config);
    const info = Object.fromEntries(out.info.map((r) => [r.fieldKey, r.fieldValue]));
    expect(info.imported_project_name).toBe('Chuỗi cửa hàng XYZ');
    expect(info.si_name).toBe('SI Alpha');
    expect(info.received_date).toBe('2026-11-16');
    expect(info.completion_date).toBe('');
    expect(out.requirements.map((r) => r.roundNumber)).toEqual([1, 2]);
    expect(out.requirements[1].content).toContain('\n');
    expect(out.requirements[0].createdDate).toBe('2026-11-16');
    expect(out.items).toHaveLength(3);
    expect(out.items[2]).toEqual({ model: 'COLDSTORE 2U', brand: 'Veracity', description: 'Máy chủ VMS quản lý 55 camera/cửa hàng' });
  });

  it('mapping lưu lại tái tạo được cấu hình', () => {
    const wb = readWorkbook(file, 20, 20000);
    const { config } = autoDetect(wb.sheets);
    const restored = configFromMappings(wb.sheets, configToMappings(config))!;
    expect(buildImport(wb.sheets, restored)).toEqual(buildImport(wb.sheets, config));
  });
});

describe('Import XLSX — một sheet dạng biểu mẫu', () => {
  const file = writeWorkbook(path.join(dir, 'single.xlsx'), {
    'Báo giá': [
      ['THÔNG TIN DỰ ÁN'],
      ['Tên Dự án:', 'Kho lạnh ABC'],
      ['Sales phụ trách:', 'Trần B'],
      ['Ngày deadline:', '25/12/2026'],
      [],
      ['Nội dung yêu cầu'],
      ['Lần 1', 'Khảo sát hiện trạng'],
      [null, 'Đề xuất phương án camera'],
      ['Lần 2', 'Điều chỉnh số lượng'],
      [],
      ['STT', 'Model / Mã thiết bị', 'Hãng', 'Mô tả'],
      [1, 'AXIS P3265', 'Axis', 'Dome camera'],
      [2, 'AT-GS950', 'Allied Telesis', 'Switch PoE'],
    ],
  });

  it('nhận diện key-value, các lần yêu cầu (gộp dòng tiếp nối) và bảng thiết bị', () => {
    const wb = readWorkbook(file, 20, 20000);
    const { config } = autoDetect(wb.sheets);
    const out = buildImport(wb.sheets, config);
    expect(out.info.find((r) => r.fieldKey === 'imported_project_name')?.fieldValue).toBe('Kho lạnh ABC');
    expect(out.info.find((r) => r.fieldKey === 'deadline_date')?.fieldValue).toBe('2026-12-25');
    expect(out.requirements).toEqual([
      { roundNumber: 1, content: 'Khảo sát hiện trạng\nĐề xuất phương án camera', createdDate: null },
      { roundNumber: 2, content: 'Điều chỉnh số lượng', createdDate: null },
    ]);
    expect(out.items.map((i) => i.model)).toEqual(['AXIS P3265', 'AT-GS950']);
  });
});

describe('Import XLSX — tên cột lạ / file lỗi (TC-XLSX-002/005/006)', () => {
  it('không tự map sai khi header không nhận diện được', () => {
    const file = writeWorkbook(path.join(dir, 'odd.xlsx'), { Sheet1: [['Cột X', 'Cột Y'], ['a', 'b']] });
    const wb = readWorkbook(file, 20, 20000);
    const { config, notes } = autoDetect(wb.sheets);
    expect(config.items.enabled).toBe(false);
    expect(config.info.enabled).toBe(false);
    expect(notes.length).toBeGreaterThan(0);
    const out = buildImport(wb.sheets, config);
    expect(out.items).toHaveLength(0);
  });
  it('từ chối .xls/.csv và file hỏng', () => {
    const csv = path.join(dir, 'a.csv');
    fs.writeFileSync(csv, 'a,b');
    expect(() => readWorkbook(csv, 20, 20000)).toThrow(/\.xlsx/);
    const broken = path.join(dir, 'broken.xlsx');
    fs.writeFileSync(broken, 'not a zip');
    expect(() => readWorkbook(broken, 20, 20000)).toThrow();
  });
  it('cảnh báo và cắt bớt khi vượt giới hạn dòng (FR-XLSX-011)', () => {
    const rows = [['Model', 'Hãng'], ...Array.from({ length: 30 }, (_, i) => [`M${i}`, 'X'])];
    const file = writeWorkbook(path.join(dir, 'big.xlsx'), { Equipment: rows });
    const wb = readWorkbook(file, 20, 10);
    expect(wb.sheets[0].truncated).toBe(true);
    expect(wb.warnings.length).toBe(1);
  });
});
