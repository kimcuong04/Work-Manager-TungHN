import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { imagePath, importImageBuffer } from '../src/main/integration/images';
import { bulkImport } from '../src/main/services/bulkImport';
import * as equipment from '../src/main/services/equipment';
import * as freelance from '../src/main/services/freelance';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import { referencedImageKeys } from '../src/main/services/records';
import { getSettings, updateSettings } from '../src/main/services/settings';
import * as todos from '../src/main/services/todos';
import type { EquipmentInput, EquipmentLoanInput, ProjectInput } from '../src/shared/types';
import { validateEquipmentLoanInput } from '../src/shared/validation';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let ctx: Ctx;
let year: string;
beforeEach(async () => {
  ctx = await makeCtx();
  year = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
});

const item = (over: Partial<EquipmentInput> = {}): EquipmentInput => ({
  productName: 'Camera P1375',
  categoryId: null,
  brandId: null,
  serialNumber: '',
  description: '',
  handoverDate: null,
  condition: '',
  images: [],
  ...over,
});
const loan = (over: Partial<EquipmentLoanInput> = {}): EquipmentLoanInput => ({
  siId: null,
  salespersonId: null,
  borrowDate: '2026-11-01',
  dueDate: null,
  returnDate: null,
  reason: '',
  returnCondition: '',
  images: [],
  ...over,
});
const project = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  jobYearId: year,
  workCategory: 'PRE_SALES',
  receivedDate: null,
  dueDate: null,
  projectName: 'Dự án',
  clientId: null,
  salespersonId: null,
  note: '',
  filePath: null,
  fileName: null,
  fileExtension: null,
  priorityPoint: 3,
  ...over,
});

describe('Nâng cấp v1.8 → v1.9', () => {
  it('"Ngày trả" sau hôm nay thành Ngày hẹn trả; ngày mượn hiện tại nhập tay thành lần mượn; thêm danh mục mới', async () => {
    const file = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 8));
    old.tx(() => {
      old.run("INSERT INTO equipment_items (id, stt, product_name, created_at, updated_at) VALUES ('a', 1, 'Camera A', 't', 't')");
      old.run("INSERT INTO equipment_loans (id, equipment_id, borrow_date, return_date, reason, return_condition, created_at, updated_at) VALUES ('la', 'a', '2026-01-02', '2099-01-10', 'Demo', '', 't', 't')");
      old.run("INSERT INTO equipment_items (id, stt, product_name, current_borrow_date, current_due_date, created_at, updated_at) VALUES ('b', 2, 'Switch B', '2026-01-05', '2026-01-20', 't', 't')");
      old.run("INSERT INTO equipment_items (id, stt, product_name, created_at, updated_at) VALUES ('c', 3, 'NVR C', 't', 't')");
      old.run("INSERT INTO equipment_loans (id, equipment_id, borrow_date, return_date, reason, return_condition, created_at, updated_at) VALUES ('lc', 'c', '2026-01-01', '2026-01-03', '', 'Tốt', 't', 't')");
    });
    old.close();
    const db = await Db.open(file);
    expect(SCHEMA_VERSION).toBe(9);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(9);
    const c2 = { ...ctx, db };
    const [c, b, a] = equipment.listEquipment(c2);
    expect([a.currentBorrowDate, a.currentDueDate, a.loans[0].dueDate, a.loans[0].returnDate]).toEqual(['2026-01-02', '2099-01-10', '2099-01-10', null]);
    expect([b.currentBorrowDate, b.currentDueDate, b.loans.length, b.loans[0].dueDate]).toEqual(['2026-01-05', '2026-01-20', 1, '2026-01-20']);
    expect([c.currentBorrowDate, c.loans[0].returnDate]).toEqual([null, '2026-01-03']);
    expect(master.listMaster(c2, 'freelancePaymentStatuses').map((m) => [m.name, m.color])).toEqual([
      ['Chưa thanh toán', '#ef4444'],
      ['Đã đặt cọc', '#f59e0b'],
      ['Đã thanh toán', '#22c55e'],
    ]);
    expect(master.listMaster(c2, 'freelanceStatuses').find((m) => m.name === 'Hoàn thành')?.color).toBe('#22c55e');
    expect(todos.listTodos(c2, TEST_TODAY)).toEqual([]);
  });
});

describe('Kho thiết bị: lần mượn, Đã hoàn trả, Quá hạn', () => {
  it('phải bấm Đã hoàn trả lần trước mới thêm được lần mượn sau', () => {
    const a = equipment.createEquipment(ctx, item());
    expect([a.currentBorrowDate, a.currentDueDate]).toEqual([null, null]);
    let r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-01', dueDate: '2026-11-10' }));
    expect([r.currentBorrowDate, r.currentDueDate]).toEqual(['2026-11-01', '2026-11-10']);
    expect(() => equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-11' }))).toThrow(/Đã hoàn trả.*trước khi thêm lần mượn mới/);
    // Đã hoàn trả: ghi Ngày trả thực tế → về kho.
    r = equipment.saveEquipmentLoan(ctx, a.id, r.loans[0].id, { ...loan({ borrowDate: '2026-11-01', dueDate: '2026-11-10' }), returnDate: '2026-11-12' });
    expect([r.currentBorrowDate, r.currentDueDate, r.loans[0].dueDate, r.loans[0].returnDate]).toEqual([null, null, '2026-11-10', '2026-11-12']);
    r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ borrowDate: '2026-11-13', dueDate: '2026-11-20' }));
    expect(r.loans.map((l) => [l.borrowDate, l.returnDate])).toEqual([
      ['2026-11-13', null],
      ['2026-11-01', '2026-11-12'],
    ]);
    // Mở lại lần đã trả trong khi đang có lần mượn khác → chặn.
    expect(() => equipment.saveEquipmentLoan(ctx, a.id, r.loans[1].id, loan({ borrowDate: '2026-11-01' }))).toThrow(/chưa hoàn trả/);
    // Xóa lần mượn đang mở → về kho.
    r = equipment.deleteEquipmentLoan(ctx, r.loans[0].id);
    expect(r.currentBorrowDate).toBeNull();
  });

  it('Ngày hẹn trả / Ngày trả thực tế: không trước Ngày mượn; ngày trả thực tế không sau hôm nay', () => {
    expect(validateEquipmentLoanInput(loan({ dueDate: '2026-10-30' })).dueDate).toBeTruthy();
    expect(validateEquipmentLoanInput(loan({ returnDate: '2026-10-30' })).returnDate).toBeTruthy();
    expect(validateEquipmentLoanInput(loan({ returnDate: '2026-11-20' }), '2026-11-16').returnDate).toMatch(/sau hôm nay/);
    const a = equipment.createEquipment(ctx, item());
    expect(() => equipment.saveEquipmentLoan(ctx, a.id, null, loan({ returnDate: '2026-12-01' }))).toThrow(/sau hôm nay/);
  });

  it('ảnh của từng lần mượn: lưu, bỏ ảnh, xóa lần mượn / thiết bị thì xóa file', () => {
    const img1 = importImageBuffer(ctx, PNG, 'luc-muon.png');
    const img2 = importImageBuffer(ctx, PNG, 'luc-tra.png');
    const a = equipment.createEquipment(ctx, item());
    let r = equipment.saveEquipmentLoan(ctx, a.id, null, loan({ images: [img1] }));
    expect(r.loans[0].images.map((i) => i.fileName)).toEqual(['luc-muon.png']);
    expect(referencedImageKeys(ctx).has(img1.storageKey)).toBe(true);
    r = equipment.saveEquipmentLoan(ctx, a.id, r.loans[0].id, { ...loan(), returnDate: '2026-11-05', images: [img2] });
    expect(r.loans[0].images.map((i) => i.fileName)).toEqual(['luc-tra.png']);
    expect(fs.existsSync(imagePath(ctx, img1.storageKey))).toBe(false);
    equipment.deleteEquipment(ctx, a.id);
    expect(fs.existsSync(imagePath(ctx, img2.storageKey))).toBe(false);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM equipment_loan_images')).toBe(0);
  });

  it('Phân loại: danh mục riêng của Kho thiết bị, đang dùng thì phải gỡ / thay khi xóa', () => {
    const cam = master.createMaster(ctx, 'equipmentCategories', 'Camera');
    const sw = master.createMaster(ctx, 'equipmentCategories', 'Switch');
    const a = equipment.createEquipment(ctx, item({ categoryId: cam.id }));
    expect(a.categoryName).toBe('Camera');
    expect(master.listMaster(ctx, 'equipmentCategories').find((m) => m.id === cam.id)!.usageCount).toBe(1);
    master.deleteMaster(ctx, 'equipmentCategories', cam.id, { replaceWithId: sw.id });
    expect(equipment.getEquipment(ctx, a.id).categoryName).toBe('Switch');
    expect(() => equipment.createEquipment(ctx, item({ categoryId: 'khong-co' }))).toThrow(/Phân loại/);
  });
});

describe('Job Freelance: Trạng thái thanh toán và màu', () => {
  it('chọn / đổi Trạng thái thanh toán; màu của Tình trạng đổi được', () => {
    const [unpaid, , paid] = master.listMaster(ctx, 'freelancePaymentStatuses');
    const j = freelance.createFreelance(ctx, { projectName: 'Logo', hirerId: null, startDate: null, statusId: null, paymentStatusId: unpaid.id });
    expect([j.paymentStatusName, j.paymentStatusColor]).toEqual(['Chưa thanh toán', '#ef4444']);
    expect(freelance.setFreelancePaymentStatus(ctx, j.id, paid.id).paymentStatusName).toBe('Đã thanh toán');
    // Đổi Tình trạng không làm mất Trạng thái thanh toán.
    const st = master.listMaster(ctx, 'freelanceStatuses')[0];
    expect(freelance.setFreelanceStatus(ctx, j.id, st.id).paymentStatusName).toBe('Đã thanh toán');
    expect(master.setMasterColor(ctx, 'freelanceStatuses', st.id, '#0EA5E9').color).toBe('#0ea5e9');
    expect(freelance.getFreelance(ctx, j.id).statusColor).toBe('#0ea5e9');
    expect(master.setMasterColor(ctx, 'freelanceStatuses', st.id, null).color).toBeNull();
    expect(() => master.setMasterColor(ctx, 'freelanceStatuses', st.id, 'red')).toThrow(/Màu/);
    expect(() => master.setMasterColor(ctx, 'brands', st.id, '#000000')).toThrow(/không có màu/);
    expect(() => freelance.createFreelance(ctx, { projectName: 'X', hirerId: null, startDate: null, statusId: null, paymentStatusId: 'khong-co' })).toThrow(/thanh toán/);
  });

  it('import xlsx nhận cột Trạng thái thanh toán (thêm vào danh mục nếu chưa có)', () => {
    const res = bulkImport(ctx, {
      target: 'FREELANCE',
      rows: [
        { rowNumber: 2, values: { projectName: 'Web A', payment: 'đã thanh toán' } },
        { rowNumber: 3, values: { projectName: 'Web B', payment: 'Trả góp' } },
      ],
    });
    expect(res.created).toBe(2);
    expect(freelance.listFreelance(ctx).map((j) => j.paymentStatusName)).toEqual(['Đã thanh toán', 'Trả góp']);
  });
});

describe('Tên workspace', () => {
  it('mặc định My Workspace; đổi được, bỏ trống thì về mặc định, tối đa 40 ký tự', () => {
    expect(getSettings(ctx).workspaceName).toBe('My Workspace');
    expect(updateSettings(ctx, { workspaceName: '  Kho  dự án  Tùng ' }).workspaceName).toBe('Kho dự án Tùng');
    expect(updateSettings(ctx, { workspaceName: '   ' }).workspaceName).toBe('My Workspace');
    expect(() => updateSettings(ctx, { workspaceName: 'x'.repeat(41) })).toThrow(/40/);
  });
});

describe('To-do list', () => {
  it('thêm dự án Pre/Post-sales và job Freelance theo ngày, không trùng; sắp xếp; Đã hoàn thành; xóa theo dự án', () => {
    const p1 = projects.createProject(ctx, project({ projectName: 'Kho Bình Dương' }));
    const p2 = projects.createProject(ctx, project({ projectName: 'Nhà máy Long An', workCategory: 'POST_SALES' }));
    const f1 = freelance.createFreelance(ctx, { projectName: 'Logo quán cà phê', hirerId: null, startDate: null, statusId: null });
    let list = todos.addTodos(ctx, TEST_TODAY, [
      { kind: 'MAIN', targetId: p1.id },
      { kind: 'FREELANCE', targetId: f1.id },
      { kind: 'MAIN', targetId: p2.id },
      { kind: 'MAIN', targetId: p1.id },
    ]);
    expect(list.map((t) => [t.kind, t.title, t.scope])).toEqual([
      ['MAIN', 'Kho Bình Dương', `Pre-sales ${master.listYears(ctx).find((y) => y.id === year)!.yearLabel}`],
      ['FREELANCE', 'Logo quán cà phê', 'Job Freelance'],
      ['MAIN', 'Nhà máy Long An', `Post-sales ${master.listYears(ctx).find((y) => y.id === year)!.yearLabel}`],
    ]);
    expect(todos.addTodos(ctx, TEST_TODAY, [{ kind: 'MAIN', targetId: p1.id }])).toHaveLength(3);
    expect(todos.listTodos(ctx, '2026-11-17')).toEqual([]);

    list = todos.reorderTodos(ctx, TEST_TODAY, [list[2].id, list[0].id, list[1].id]);
    expect(list.map((t) => t.title)).toEqual(['Nhà máy Long An', 'Kho Bình Dương', 'Logo quán cà phê']);

    list = todos.setTodoDone(ctx, list[0].id, true);
    expect(list.map((t) => [t.title, !!t.doneAt])).toEqual([
      ['Kho Bình Dương', false],
      ['Logo quán cà phê', false],
      ['Nhà máy Long An', true],
    ]);
    list = todos.setTodoDone(ctx, list[2].id, false);
    expect(list.map((t) => t.title)).toEqual(['Kho Bình Dương', 'Logo quán cà phê', 'Nhà máy Long An']);

    projects.deleteProject(ctx, p1.id);
    expect(todos.listTodos(ctx, TEST_TODAY).map((t) => t.title)).toEqual(['Logo quán cà phê', 'Nhà máy Long An']);
    list = todos.deleteTodo(ctx, todos.listTodos(ctx, TEST_TODAY)[0].id);
    expect(list.map((t) => t.title)).toEqual(['Nhà máy Long An']);
    expect(() => todos.addTodos(ctx, TEST_TODAY, [{ kind: 'MAIN', targetId: 'khong-co' }])).toThrow(/Pre-sales/);
    expect(() => todos.listTodos(ctx, '2026-02-30')).toThrow(/không hợp lệ/);
  });
});
