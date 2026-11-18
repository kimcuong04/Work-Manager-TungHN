import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import * as equipment from '../src/main/services/equipment';
import * as master from '../src/main/services/master';
import type { EquipmentInput } from '../src/shared/types';
import { validateEquipmentInput } from '../src/shared/validation';
import { makeCtx, tmpDir } from './helpers';

let ctx: Ctx;
beforeEach(async () => {
  ctx = await makeCtx();
});

const item = (over: Partial<EquipmentInput> = {}): EquipmentInput => ({
  productName: 'Camera P1375',
  brandId: null,
  serialNumber: '',
  categoryId: null,
  description: '',
  handoverDate: null,
  condition: '',
  images: [],
  ...over,
});

describe('Nâng cấp v1.7 → v1.8', () => {
  it('thiết bị cũ giữ nguyên, Mô tả trống và chưa có Ngày nhận bàn giao', async () => {
    const file = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 7));
    old.tx(() =>
      old.run("INSERT INTO equipment_items (id, stt, product_name, serial_number, condition, created_at, updated_at) VALUES ('e1', 3, 'Switch', 'SN1', 'Tốt', 't', 't')"),
    );
    old.close();
    const db = await Db.open(file);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    const [r] = equipment.listEquipment({ ...ctx, db });
    expect([r.stt, r.productName, r.serialNumber, r.condition, r.description, r.handoverDate]).toEqual([3, 'Switch', 'SN1', 'Tốt', '', null]);
  });
});

describe('Kho thiết bị: Mô tả, Ngày nhận bàn giao', () => {
  it('lưu và sửa trực tiếp trên thiết bị, không phụ thuộc lịch sử mượn/trả', () => {
    expect(validateEquipmentInput(item({ handoverDate: '2026-02-30' })).handoverDate).toBeTruthy();
    expect(validateEquipmentInput(item({ description: 'x'.repeat(10001) })).description).toBeTruthy();
    let r = equipment.createEquipment(ctx, item({ description: '  Camera PTZ 4K\r\nkèm nguồn  ', handoverDate: '2026-10-20' }));
    expect([r.description, r.handoverDate]).toEqual(['Camera PTZ 4K\nkèm nguồn', '2026-10-20']);
    r = equipment.saveEquipmentLoan(ctx, r.id, null, { siId: null, salespersonId: null, borrowDate: '2026-11-01', dueDate: null, returnDate: '2026-11-05', reason: '', returnCondition: 'Tốt', images: [] });
    expect([r.description, r.handoverDate]).toEqual(['Camera PTZ 4K\nkèm nguồn', '2026-10-20']);
    r = equipment.updateEquipment(ctx, r.id, item({ description: 'Camera PTZ', handoverDate: null }));
    expect([r.description, r.handoverDate]).toEqual(['Camera PTZ', null]);
  });

  it('Sale trong lịch sử mượn chỉ có tên, không kèm Phòng ban', () => {
    const dept = master.createMaster(ctx, 'departments', 'Kinh doanh 1');
    const sale = master.createMaster(ctx, 'salespersons', 'Hùng');
    master.setSalespersonDepartment(ctx, sale.id, dept.id);
    const a = equipment.createEquipment(ctx, item());
    const r = equipment.saveEquipmentLoan(ctx, a.id, null, { siId: null, salespersonId: sale.id, borrowDate: '2026-11-01', dueDate: null, returnDate: null, reason: '', returnCondition: '', images: [] });
    expect(r.loans[0]).toMatchObject({ salespersonId: sale.id, salespersonName: 'Hùng' });
    expect(r.loans[0]).not.toHaveProperty('salespersonDepartment');
  });
});
