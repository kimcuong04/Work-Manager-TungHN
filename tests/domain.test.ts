import { describe, expect, it } from 'vitest';
import { addDays, diffDays, formatDate, inRange, monthRange, parseDisplayDate, quickRange } from '../src/shared/dates';
import { DEFAULT_THRESHOLDS, computeStatus, describeRemaining, remainingDays, validateThresholds } from '../src/shared/status';
import { buildHaystack, matchesQuery, nameKey, normalizeText } from '../src/shared/text';
import type { ProjectInput } from '../src/shared/types';
import { validateProjectInput, validateWebUrl } from '../src/shared/validation';

const TODAY = '2026-11-16';
const st = (due: string, isCompleted = false, th = DEFAULT_THRESHOLDS) => computeStatus({ dueDate: due, isCompleted }, TODAY, th);

describe('Phân loại trạng thái (SRS 5.1, Phụ lục A, TC-001..TC-008)', () => {
  it('TC-001/002: hạn hôm nay hoặc ngày mai → Khẩn cấp, còn 0/1 ngày', () => {
    expect(st('2026-11-16')).toBe('URGENT');
    expect(remainingDays('2026-11-16', TODAY)).toBe(0);
    expect(st('2026-11-17')).toBe('URGENT');
    expect(remainingDays('2026-11-17', TODAY)).toBe(1);
  });
  it('TC-003/004: còn 2..5 ngày → Cần chú ý', () => {
    expect(st('2026-11-18')).toBe('ATTENTION');
    expect(st('2026-11-21')).toBe('ATTENTION');
  });
  it('TC-005: còn 6 ngày → Mới tiếp nhận', () => {
    expect(st('2026-11-22')).toBe('NEW');
    expect(remainingDays('2026-11-22', TODAY)).toBe(6);
  });
  it('TC-006: quá hạn 1 ngày → Khẩn cấp và hiển thị quá hạn', () => {
    expect(st('2026-11-15')).toBe('URGENT');
    expect(describeRemaining(remainingDays('2026-11-15', TODAY))).toBe('Quá hạn 1 ngày');
  });
  it('TC-007/008: hoàn thành ghi đè trạng thái; bỏ hoàn thành quay về Khẩn cấp nếu đã quá hạn', () => {
    expect(st('2026-11-15', true)).toBe('COMPLETED');
    expect(st('2026-11-15', false)).toBe('URGENT');
  });
  it('TC-013: đổi ngưỡng Khẩn cấp 2 → 3 thì hạn còn 2 ngày thành Khẩn cấp', () => {
    expect(st('2026-11-18', false, { urgent: 3, attention: 5 })).toBe('URGENT');
    expect(st('2026-11-19', false, { urgent: 3, attention: 5 })).toBe('ATTENTION');
  });
  it('tính theo ngày lịch qua tháng/năm', () => {
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1);
    expect(diffDays('2028-03-01', '2028-02-28')).toBe(2);
  });
  it('validate ngưỡng (FR-SET-003)', () => {
    expect(validateThresholds(2, 5)).toBeNull();
    expect(validateThresholds(5, 5)).not.toBeNull();
    expect(validateThresholds(-1, 5)).not.toBeNull();
    expect(validateThresholds(1.5, 5)).not.toBeNull();
  });
});

describe('Tìm kiếm tiếng Việt không dấu (FR-SEARCH-002/004, AC-007, TC-009)', () => {
  it("'thiet ke' khớp 'Thiết kế' và ngược lại", () => {
    expect(matchesQuery(normalizeText('thiet ke'), buildHaystack(['Thiết kế kỹ thuật']))).toBe(true);
    expect(matchesQuery(normalizeText('Thiết Kế'), buildHaystack(['thiet ke co so']))).toBe(true);
  });
  it("TC-009: 'du an abc' khớp 'Dự án ABC'", () => {
    expect(matchesQuery(normalizeText('  du   an abc '), buildHaystack(['Dự án ABC']))).toBe(true);
  });
  it('xử lý đ/Đ và Unicode tổ hợp (NFD)', () => {
    expect(normalizeText('Đường Đô')).toBe('duong do');
    expect(normalizeText('Thie\u0302\u0301t ke\u0302\u0301')).toBe('thiet ke');
  });
  it('fuzzy nhẹ: sai 1 ký tự với từ dài', () => {
    expect(matchesQuery(normalizeText('camrea'), buildHaystack(['Hệ thống camera']))).toBe(false);
    expect(matchesQuery(normalizeText('camara'), buildHaystack(['Hệ thống camera']))).toBe(true);
    expect(matchesQuery(normalizeText('xyz'), buildHaystack(['Hệ thống camera']))).toBe(false);
  });
  it('số và mã model không fuzzy', () => {
    expect(matchesQuery(normalizeText('1099'), buildHaystack(['Dự án 1098']))).toBe(false);
    expect(matchesQuery(normalizeText('p3265'), buildHaystack(['AXIS P3255']))).toBe(false);
    expect(matchesQuery(normalizeText('p3265'), buildHaystack(['AXIS P3265-LVE']))).toBe(true);
  });
  it('so trùng danh mục không phân biệt hoa/thường, trim khoảng trắng', () => {
    expect(nameKey('  Công ty   ABC ')).toBe(nameKey('công ty abc'));
  });
});

describe('Ngày tháng', () => {
  it('hiển thị dd/mm/yyyy, parse nhiều dạng nhập', () => {
    expect(formatDate('2026-11-05')).toBe('05/11/2026');
    expect(parseDisplayDate('5/11/2026')).toBe('2026-11-05');
    expect(parseDisplayDate('05-11-26')).toBe('2026-11-05');
    expect(parseDisplayDate('31/02/2026')).toBeNull();
  });
  it('quick range và khoảng lọc inclusive (TC-WAR-003)', () => {
    expect(quickRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(quickRange('last3', TODAY)).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(inRange('2026-11-01', '2026-11-01', '2026-11-30')).toBe(true);
    expect(inRange('2026-11-30', '2026-11-01', '2026-11-30')).toBe(true);
    expect(inRange('2026-12-01', '2026-11-01', '2026-11-30')).toBe(false);
    expect(inRange(null, '2026-11-01', null)).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('Validate form (FR-FORM-001)', () => {
  const base: ProjectInput = {
    salespersonId: null,
    jobYearId: 'y',
    workCategory: 'PRE_SALES',
    receivedDate: '2026-11-16',
    dueDate: '2026-11-20',
    projectName: 'A',
    clientId: 'c',
    note: '',
    filePath: null,
    fileName: null,
    fileExtension: null,
    priorityPoint: 3,
  };
  it('hợp lệ', () => expect(Object.keys(validateProjectInput(base))).toHaveLength(0));
  it('chỉ bắt buộc STT + tên; EU và các ngày không bắt buộc; ngày tới hạn >= ngày bắt đầu; priority 1..5', () => {
    const e = validateProjectInput({ ...base, projectName: '   ', clientId: '', dueDate: '2026-11-10', priorityPoint: 6, stt: null });
    expect(e.projectName).toBeTruthy();
    expect(e.stt).toBeTruthy();
    expect(e.clientId).toBeUndefined();
    expect(e.dueDate).toBeTruthy();
    expect(e.priorityPoint).toBeTruthy();
    expect(validateProjectInput({ ...base, clientId: null, receivedDate: null, dueDate: null })).toEqual({});
    expect(validateProjectInput({ ...base, stt: 0 }).stt).toBeTruthy();
  });
  it('tên tối đa 200 ký tự; ghi chú tổng hợp nhiều ngày không bị giới hạn ở form', () => {
    expect(validateProjectInput({ ...base, projectName: 'x'.repeat(201) }).projectName).toBeTruthy();
    expect(validateProjectInput({ ...base, note: 'x'.repeat(5001) }).note).toBeUndefined();
  });
  it('TC-010: chỉ nhận .dwg/.txt/.docx/.pdf/.xlsx', () => {
    for (const ext of ['dwg', 'txt', 'docx', 'pdf', 'PDF', 'xlsx'])
      expect(validateProjectInput({ ...base, filePath: `C:\\a.${ext}`, fileName: `a.${ext}`, fileExtension: ext }).file).toBeUndefined();
    expect(validateProjectInput({ ...base, filePath: 'C:\\a.xls', fileName: 'a.xls', fileExtension: 'xls' }).file).toBeTruthy();
    expect(validateProjectInput({ ...base, filePath: 'C:\\a.exe', fileName: 'a.exe', fileExtension: 'exe' }).file).toBeTruthy();
  });
  it('FR-EXP-009: từ chối javascript: và scheme lạ', () => {
    expect(validateWebUrl('javascript:alert(1)')).not.toBeNull();
    expect(validateWebUrl('file:///C:/x')).not.toBeNull();
    expect(validateWebUrl('https://axis.com/docs')).toBeNull();
  });
});
