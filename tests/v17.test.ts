import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { imagePath, importImageBuffer } from '../src/main/integration/images';
import * as equipment from '../src/main/services/equipment';
import * as master from '../src/main/services/master';
import { referencedImageKeys } from '../src/main/services/records';
import { globalSearch } from '../src/main/services/search';
import type { EquipmentInput, EquipmentLoanInput } from '../src/shared/types';
import { validateEquipmentInput, validateEquipmentLoanInput } from '../src/shared/validation';
import { makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let ctx: Ctx;
beforeEach(async () => {
  ctx = await makeCtx();
});

const item = (over: Partial<EquipmentInput> = {}): EquipmentInput => ({
  productName: 'Camera P1375',
  brandId: null,
  serialNumber: '',
  description: '',
  handoverDate: null,
  condition: '',
  currentBorrowDate: null,
  currentDueDate: null,
  images: [],
  ...over,
});
const loan = (over: Partial<EquipmentLoanInput> = {}): EquipmentLoanInput => ({
  siId: null,
  salespersonId: null,
  borrowDate: '2026-11-01',
  returnDate: null,
  reason: '',
  returnCondition: '',
  ...over,
});

describe('Nâng cấp v1.6 → v1.7', () => {
  it('thêm bảng Kho thiết bị, dữ liệu cũ giữ nguyên', async () => {
    const file = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 6));
    old.tx(() => old.run("INSERT INTO freelance_jobs (id, stt, project_name, created_at, updated_at) VALUES ('f1', 1, 'Logo', 't', 't')"));
    old.close();
    const db = await Db.open(file);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(db.scalar<number>('SELECT COUNT(*) FROM freelance_jobs')).toBe(1);
    expect(equipment.listEquipment({ ...ctx, db })).toEqual([]);
  });
});

describe('Kho thiết bị', () => {
  it('Tên sp và STT bắt buộc; STT tự +1, không trùng trong cả kho', () => {
    expect(validateEquipmentInput(item({ productName: '  ' })).productName).toBeTruthy();
    expect(validateEquipmentInput(item({ stt: null })).stt).toBeTruthy();
    expect(validateEquipmentInput(item({ currentBorrowDate: '2026-11-10', currentDueDate: '2026-11-09' })).currentDueDate).toBeTruthy();
    const a = equipment.createEquipment(ctx, item());
    const b = equipment.createEquipment(ctx, item({ productName: 'Switch 24 port' }));
    expect([a.stt, b.stt]).toEqual([1, 2]);
    expect(equipment.nextEquipmentStt(ctx)).toBe(3);
    expect(() => equipment.createEquipment(ctx, item({ stt: 1 }))).toThrow(/STT 1 đã dùng/);
    expect(() => equipment.updateEquipment(ctx, b.id, item({ stt: 1, productName: 'x' }))).toThrow(/STT 1/);
    // Sửa mà không gửi STT thì giữ STT cũ.
    expect(equipment.updateEquipment(ctx, b.id, item({ productName: 'Switch 48 port' })).stt).toBe(2);
    expect(equipment.listEquipment(ctx).map((x) => x.stt)).toEqual([2, 1]);
  });

  it('Hãng dùng chung Master Data với Job Chính: đang dùng thì không xóa được', () => {
    const brand = master.createMaster(ctx, 'brands', 'Axis');
    const a = equipment.createEquipment(ctx, item({ brandId: brand.id, serialNumber: 'ACCC8E01' }));
    expect(a.brandName).toBe('Axis');
    expect(master.listMaster(ctx, 'brands').find((b) => b.id === brand.id)!.usageCount).toBe(1);
    expect(() => master.deleteMaster(ctx, 'brands', brand.id, null)).toThrow(/Deactivate/);
    expect(() => equipment.createEquipment(ctx, item({ brandId: 'khong-co' }))).toThrow(/Hãng/);
  });

  it('log mượn/trả: Ngày mượn bắt buộc, Ngày trả không trước Ngày mượn; mới nhất trước', () => {
    expect(validateEquipmentLoanInput(loan({ borrowDate: '' })).borrowDate).toBeTruthy();
    expect(validateEquipmentLoanInput(loan({ returnDate: '2026-10-31' })).returnDate).toBeTruthy();
    const a = equipment.createEquipment(ctx, item());
    expect(() => equipment.saveEquipmentLoan(ctx, a.id, null, loan({ returnDate: '2026-10-01' }))).toThrow(/Ngày trả/);
    const si = master.createMaster(ctx, 'siPartners', 'SI Viettel');
    const sale = master.createMaster(ctx, 'salespersons', 'Hùng');
    equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-09-01', returnDate: '2026-09-10', siId: si.id, reason: 'Demo', returnCondition: 'Tốt' }));
    const r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-01', salespersonId: sale.id, reason: 'POC khách' }));
    expect(r.loans.map((l) => [l.borrowDate, l.returnDate, l.siName, l.salespersonName, l.reason])).toEqual([
      ['2026-11-01', null, null, 'Hùng', 'POC khách'],
      ['2026-09-01', '2026-09-10', 'SI Viettel', null, 'Demo'],
    ]);
    expect(master.listMaster(ctx, 'siPartners').find((m) => m.id === si.id)!.usageCount).toBe(1);
    expect(() => equipment.saveEquipmentLoan(ctx, a.id, null, loan({ siId: 'khong-co' }))).toThrow(/Tên SI/);
  });

  it('lần mượn hiện tại cập nhật Ngày mượn / hẹn trả; ghi nhận trả thì xóa và Tình trạng lấy theo lần trả mới nhất', () => {
    const a = equipment.createEquipment(ctx, item({ condition: 'Mới 100%' }));
    let r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-01' }), { setCurrent: { dueDate: '2026-11-15' } });
    expect([r.currentBorrowDate, r.currentDueDate, r.condition]).toEqual(['2026-11-01', '2026-11-15', 'Mới 100%']);
    expect(() => equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-05' }), { setCurrent: { dueDate: '2026-11-01' } })).toThrow(/hẹn trả/);

    const open = r.loans[0];
    r = equipment.saveEquipmentLoan(ctx, a.id, open.id, { ...loan(), returnDate: '2026-11-12', returnCondition: 'Trầy nhẹ vỏ' }, { clearCurrent: true });
    expect([r.currentBorrowDate, r.currentDueDate, r.condition]).toEqual([null, null, 'Trầy nhẹ vỏ']);
    expect(r.loans).toHaveLength(1);

    // Sửa một lần trả cũ hơn không ghi đè Tình trạng hiện tại.
    r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-08-01', returnDate: '2026-08-05', returnCondition: 'Hỏng nguồn' }));
    expect(r.condition).toBe('Trầy nhẹ vỏ');
    // Tình trạng vẫn sửa tay được.
    r = equipment.updateEquipment(ctx, a.id, { ...item(), productName: r.productName, condition: 'Đã thay vỏ' });
    expect(r.condition).toBe('Đã thay vỏ');
    // Lần trả không ghi Tình trạng khi trả thì giữ nguyên.
    r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-13', returnDate: '2026-11-14' }));
    expect(r.condition).toBe('Đã thay vỏ');
    // Không tick → ngày hiện tại không đổi.
    r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-16' }));
    expect(r.currentBorrowDate).toBeNull();

    const n = r.loans.length;
    r = equipment.deleteEquipmentLoan(ctx, r.loans[0].id);
    expect(r.loans).toHaveLength(n - 1);
    expect(r.condition).toBe('Đã thay vỏ');
    const other = equipment.createEquipment(ctx, item({ productName: 'Khác' }));
    expect(() => equipment.saveEquipmentLoan(ctx, other.id, r.loans[0].id, loan())).toThrow(/Không tìm thấy lần mượn/);
  });

  it('xóa thiết bị xóa luôn ảnh và lịch sử mượn/trả; xóa nhiều trong một lần', () => {
    const img = importImageBuffer(ctx, PNG, 'thiet-bi.png');
    const a = equipment.createEquipment(ctx, item({ images: [img] }));
    expect(a.images.map((i) => i.fileName)).toEqual(['thiet-bi.png']);
    expect(referencedImageKeys(ctx).has(img.storageKey)).toBe(true);
    equipment.saveEquipmentLoan(ctx, a.id, null, loan());
    equipment.deleteEquipment(ctx, a.id);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM equipment_loans')).toBe(0);
    expect(fs.existsSync(imagePath(ctx, img.storageKey))).toBe(false);
    const ids = [equipment.createEquipment(ctx, item()).id, equipment.createEquipment(ctx, item()).id];
    expect(equipment.deleteEquipments(ctx, [...ids, 'khong-co'])).toBe(2);
    expect(equipment.listEquipment(ctx)).toEqual([]);
  });

  it('Tìm kiếm toàn cục ra thiết bị theo Serial, Hãng, Tên sp và Tên SI đã mượn', () => {
    const brand = master.createMaster(ctx, 'brands', 'Hikvision');
    const si = master.createMaster(ctx, 'siPartners', 'SI An Phát');
    const a = equipment.createEquipment(ctx, item({ productName: 'NVR 16 kênh', brandId: brand.id, serialNumber: 'HK-778899' }));
    equipment.saveEquipmentLoan(ctx, a.id, null, loan({ siId: si.id }));
    const kinds = (hits: { kind: string; title: string }[]) => hits.filter((h) => h.kind === 'equipment').map((h) => h.title);
    expect(kinds(globalSearch(ctx, { mode: 'serial', text: '778899' }))).toEqual(['1. NVR 16 kênh']);
    expect(kinds(globalSearch(ctx, { mode: 'brand', text: 'hikvision' }))).toEqual(['1. NVR 16 kênh']);
    expect(kinds(globalSearch(ctx, { mode: 'model', text: 'nvr 16' }))).toEqual(['1. NVR 16 kênh']);
    expect(kinds(globalSearch(ctx, { mode: 'si', text: 'an phat' }))).toEqual(['1. NVR 16 kênh']);
    expect(kinds(globalSearch(ctx, { mode: 'name', text: 'nvr' }))).toEqual([]);
  });
});
