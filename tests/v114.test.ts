import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { imagePath, importImageBuffer } from '../src/main/integration/images';
import * as events from '../src/main/services/events';
import * as freelance from '../src/main/services/freelance';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as passwords from '../src/main/services/passwords';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import * as todos from '../src/main/services/todos';
import { linkMarkup, parseLinkNote } from '../src/shared/linkNote';
import { importTabBase } from '../src/shared/validation';
import { detectItemsInSheet } from '../src/shared/xlsxMapping';
import { TODO_NO_DATE, type ImportPayload, type ProjectInput, type WarrantyInput } from '../src/shared/types';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let ctx: Ctx;
let year: string;
beforeEach(async () => {
  ctx = await makeCtx();
  year = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
});

const input = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  jobYearId: year,
  workCategory: 'PRE_SALES',
  receivedDate: null,
  dueDate: null,
  projectName: 'Dự án',
  clientId: null,
  salespersonId: null,
  note: '',
  priorityPoint: 3,
  ...over,
});
const payload = (file: string, models: string[]): ImportPayload => ({
  sourceFileName: file,
  sourcePath: `C:\\BOQ\\${file}`,
  sheetNames: ['Equipment'],
  workbookSignature: '',
  info: [],
  requirements: [],
  items: models.map((m) => ({ model: m, brand: 'Axis', description: '' })),
  mappings: [],
});
const warranty = (over: Partial<WarrantyInput> = {}): WarrantyInput => ({
  jobYearId: year,
  model: 'P3265',
  brandId: null,
  ipAddress: '',
  username: '',
  macAddress: '',
  serialNumber: '',
  receivedDate: null,
  testedDate: null,
  customerReport: '',
  inspection: '',
  result: '',
  resolution: '',
  caseNumber: '',
  images: [],
  ...over,
});

describe('Nâng cấp v1.13 → v1.14', () => {
  it('dữ liệu cũ giữ nguyên; các trường mới có giá trị mặc định', async () => {
    const f = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(f, MIGRATIONS.slice(0, 13));
    const y = master.listYears({ ...ctx, db: old }).find((x) => x.jobType === 'MAIN')!.id;
    old.tx(() => {
      old.run("INSERT INTO projects (id, stt, job_year_id, work_category, project_name, note, priority_point, created_at, updated_at) VALUES ('p1', 1, ?, 'PRE_SALES', 'Cũ', '', 3, 't', 't')", [y]);
      old.run("INSERT INTO password_entries (id, site_name, username, password_encrypted, site_url, created_at, updated_at) VALUES ('pw1', 'Mail', 'me', 'aes:x', NULL, 't', 't')");
      old.run(
        "INSERT INTO warranty_records (id, stt, job_year_id, model, created_at, updated_at) VALUES ('w1', 1, ?, 'P1375', 't', 't')",
        [y],
      );
      old.run("INSERT INTO freelance_jobs (id, stt, project_name, note, created_at, updated_at) VALUES ('fl1', 1, 'Logo', '', 't', 't')");
      old.run("INSERT INTO todo_items (id, todo_date, title, sort_order, created_at, updated_at) VALUES ('td1', ?, 'Gọi khách', 0, 't', 't')", [TEST_TODAY]);
    });
    old.close();
    const db = await Db.open(f);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(14);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    const c = { ...ctx, db };
    expect(projects.getProject(c, 'p1').erpLink).toBe('');
    expect(passwords.listPasswords(c)[0]).toMatchObject({ siteName: 'Mail', note: '' });
    expect(records.listWarranty(c, y)[0]).toMatchObject({ model: 'P1375', projectId: null, projectEntryId: null, projectName: null });
    expect(freelance.getFreelance(c, 'fl1')).toMatchObject({ companions: [], companionPaymentCount: 0 });
    expect(todos.listTodos(c, TEST_TODAY).map((t) => t.title)).toEqual(['Gọi khách']);
    expect(todos.listTodos(c, TODO_NO_DATE)).toEqual([]);
    expect(events.listEvents(c)).toEqual([]);
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
  });
});

describe('To-do: Vô thời hạn và kéo sang ngày khác', () => {
  it('thêm việc Vô thời hạn; chuyển qua lại giữa các ngày, đặt đúng vị trí; không chuyển trùng dự án', () => {
    const tomorrow = '2026-11-17';
    todos.addTodoTask(ctx, TEST_TODAY, 'A');
    todos.addTodoTask(ctx, TEST_TODAY, 'B');
    const undated = todos.addTodoTask(ctx, TODO_NO_DATE, 'Đọc tài liệu');
    expect(undated.map((t) => [t.title, t.todoDate])).toEqual([['Đọc tài liệu', '']]);
    expect(todos.listTodosRange(ctx, TEST_TODAY, tomorrow).map((t) => t.title)).toEqual(['A', 'B']);

    const b = todos.listTodos(ctx, TEST_TODAY).find((t) => t.title === 'B')!;
    let res = todos.moveTodo(ctx, b.id, TODO_NO_DATE, 0);
    expect(res[TEST_TODAY].map((t) => t.title)).toEqual(['A']);
    expect(res[TODO_NO_DATE].map((t) => t.title)).toEqual(['B', 'Đọc tài liệu']);

    const doc = res[TODO_NO_DATE][1];
    res = todos.moveTodo(ctx, doc.id, tomorrow, 5);
    expect(res[tomorrow].map((t) => [t.title, t.todoDate])).toEqual([['Đọc tài liệu', tomorrow]]);
    res = todos.moveTodo(ctx, res[tomorrow][0].id, TEST_TODAY, 0);
    expect(res[TEST_TODAY].map((t) => t.title)).toEqual(['Đọc tài liệu', 'A']);

    const p = projects.createProject(ctx, input());
    todos.addTodos(ctx, TEST_TODAY, [{ kind: 'MAIN', targetId: p.id }]);
    todos.addTodos(ctx, TODO_NO_DATE, [{ kind: 'MAIN', targetId: p.id }]);
    const inNoDate = todos.listTodos(ctx, TODO_NO_DATE).find((t) => t.targetId === p.id)!;
    expect(() => todos.moveTodo(ctx, inNoDate.id, TEST_TODAY, 0)).toThrow(/đã có trong To-do 16\/11\/2026/);
    expect(todos.addTodos(ctx, TODO_NO_DATE, [{ kind: 'MAIN', targetId: p.id }]).filter((t) => t.targetId === p.id)).toHaveLength(1);
    expect(() => todos.listTodos(ctx, '2026-13-01')).toThrow(/không hợp lệ/);
    expect(() => todos.listTodosRange(ctx, '', TEST_TODAY)).toThrow(/không hợp lệ/);
  });
});

describe('Ghi chú có link', () => {
  it('nhận [Tên](link) và link dán thẳng; bỏ dấu câu cuối; link lạ giữ là chữ', () => {
    expect(parseLinkNote('Xem [Wiki](https://wiki.vn/a) hoặc https://maps.google.com/x?q=1. Xong')).toEqual([
      { text: 'Xem ' },
      { text: 'Wiki', url: 'https://wiki.vn/a' },
      { text: ' hoặc ' },
      { text: 'https://maps.google.com/x?q=1', url: 'https://maps.google.com/x?q=1' },
      { text: '. Xong' },
    ]);
    expect(parseLinkNote('[x](javascript:alert(1))').every((s) => !s.url)).toBe(true);
    expect(parseLinkNote('www.axis.com')).toEqual([{ text: 'www.axis.com', url: 'www.axis.com' }]);
    expect(linkMarkup(' Bản đồ ', 'https://maps.google.com/a b(c)')).toBe('[Bản đồ](https://maps.google.com/a%20b%28c%29)');
    expect(linkMarkup('', 'axis.com')).toBe('axis.com');
  });

  it('Password lưu Ghi chú; sửa không gửi note thì giữ nguyên', () => {
    const p = passwords.createPassword(ctx, { siteName: 'ERP', username: 'cuong', password: 'x', url: '', note: ' SSO, xem [hướng dẫn](https://wiki.vn) ' });
    expect(p.note).toBe('SSO, xem [hướng dẫn](https://wiki.vn)');
    expect(passwords.updatePassword(ctx, p.id, { siteName: 'ERP 2', username: 'cuong', url: '' }).note).toBe(p.note);
    expect(passwords.updatePassword(ctx, p.id, { siteName: 'ERP 2', username: 'cuong', url: '', note: '' }).note).toBe('');
  });
});

describe('Kiến thức', () => {
  it('Website - App - Địa điểm: thêm / sửa / xóa; Phân loại để trống được; Tên bắt buộc', () => {
    const a = records.createPlace(ctx, { category: 'WEBSITE', name: '  Tra cứu   bảo hành ', note: 'https://axis.com/warranty' });
    const b = records.createPlace(ctx, { category: null, name: 'Kho Bắc Ninh', note: '' });
    expect(records.listPlaces(ctx).map((x) => [x.name, x.category])).toEqual([
      ['Tra cứu bảo hành', 'WEBSITE'],
      ['Kho Bắc Ninh', null],
    ]);
    expect(records.updatePlace(ctx, b.id, { category: 'PLACE', name: 'Kho Bắc Ninh', note: '[Bản đồ](https://maps.google.com/x)' }).category).toBe('PLACE');
    expect(() => records.createPlace(ctx, { category: null, name: ' ', note: '' })).toThrow(/Tên/);
    expect(() => records.createPlace(ctx, { category: 'SHOP' as never, name: 'x', note: '' })).toThrow(/Phân loại/);
    records.deletePlace(ctx, a.id);
    expect(records.listPlaces(ctx).map((x) => x.name)).toEqual(['Kho Bắc Ninh']);
  });

  it('xóa Hãng khỏi Kiến thức: chưa dùng ở đâu thì xóa hẳn; còn dùng thì chỉ ẩn; bài chuyển sang Kiến thức chung hoặc xóa luôn', () => {
    const k = (brandId: string | null, title: string) =>
      records.createKnowledge(ctx, { brandId, knowledgeDate: TEST_TODAY, title, deviceModel: '', content: '', webUrl: '', images: [] });
    const lone = master.createMaster(ctx, 'brands', 'Hãng riêng');
    k(lone.id, 'Bài 1');
    let r = records.removeKnowledgeBrand(ctx, lone.id, false);
    expect(r).toEqual({ deletedBrand: true, moved: 1, deleted: 0 });
    expect(master.listMaster(ctx, 'brands').some((b) => b.id === lone.id)).toBe(false);
    expect(records.listKnowledge(ctx, null).map((x) => x.title)).toEqual(['Bài 1']);

    const used = master.createMaster(ctx, 'brands', 'Axis');
    projects.createProject(ctx, input({ brandIds: [used.id] }));
    const img = importImageBuffer(ctx, PNG, 'a.png');
    records.createKnowledge(ctx, { brandId: used.id, knowledgeDate: TEST_TODAY, title: 'Bài 2', deviceModel: '', content: '', webUrl: '', images: [img] });
    r = records.removeKnowledgeBrand(ctx, used.id, true);
    expect(r).toEqual({ deletedBrand: false, moved: 0, deleted: 1 });
    expect(fs.existsSync(imagePath(ctx, img.storageKey))).toBe(false);
    const hidden = master.listMaster(ctx, 'brands').find((b) => b.id === used.id)!;
    expect([hidden.knowledgeHidden, hidden.knowledgeCount, hidden.usageCount]).toEqual([true, 0, 1]);

    // "Thêm Hãng" trùng tên Hãng đang ẩn thì hiện lại; viết bài cho Hãng cũng hiện lại.
    expect(records.addKnowledgeBrand(ctx, 'axis').id).toBe(used.id);
    expect(master.listMaster(ctx, 'brands').find((b) => b.id === used.id)!.knowledgeHidden).toBe(false);
    expect(() => records.addKnowledgeBrand(ctx, 'AXIS')).toThrow(/đã tồn tại/);
    records.removeKnowledgeBrand(ctx, used.id, false);
    k(used.id, 'Bài 3');
    expect(master.listMaster(ctx, 'brands').find((b) => b.id === used.id)).toMatchObject({ knowledgeHidden: false, knowledgeCount: 1 });
  });
});

describe('Pre/Post-sales: Link ERP', () => {
  it('không bắt buộc; phải là link; client cũ không gửi thì giữ nguyên; đổi link được ghi vào Calendar', () => {
    const p = projects.createProject(ctx, input({ erpLink: ' https://erp.congty.vn/du-an/12 ' }));
    expect(p.erpLink).toBe('https://erp.congty.vn/du-an/12');
    expect(() => projects.createProject(ctx, input({ erpLink: 'không phải link' }))).toThrow(/Link ERP/);
    expect(projects.updateProject(ctx, p.id, input({ projectName: 'Đổi tên' })).erpLink).toBe(p.erpLink);
    expect(projects.updateProject(ctx, p.id, input({ erpLink: '' }), { addToCalendar: true }).erpLink).toBe('');
    const ev = ctx.db.scalar<string>("SELECT note FROM calendar_events WHERE project_id = ? AND kind = 'PROJECT_UPDATE'", [p.id]);
    expect(ev).toMatch(/Link ERP: https:\/\/erp\.congty\.vn\/du-an\/12 → —/);
  });
});

describe('Warranty: Dự án', () => {
  it('chọn dự án Pre/Post-sales hoặc mục danh mục "Dự án (Warranty)"; xóa dự án thì bỏ liên kết', () => {
    const p = projects.createProject(ctx, input({ projectName: 'Nhà máy A' }));
    const w = records.createWarranty(ctx, warranty({ projectId: p.id }));
    expect(w).toMatchObject({ projectId: p.id, projectEntryId: null, projectName: `${p.stt}. Nhà máy A` });
    const m = master.createMaster(ctx, 'warrantyProjects', 'Showroom B');
    const w2 = records.updateWarranty(ctx, w.id, warranty({ projectEntryId: m.id }));
    expect(w2).toMatchObject({ projectId: null, projectEntryId: m.id, projectName: 'Showroom B' });
    expect(records.updateWarranty(ctx, w.id, warranty()).projectEntryId).toBe(m.id);
    expect(() => records.updateWarranty(ctx, w.id, warranty({ projectId: p.id, projectEntryId: m.id }))).toThrow(/một Dự án/);
    expect(master.listMaster(ctx, 'warrantyProjects')[0].usageCount).toBe(1);
    master.deleteMaster(ctx, 'warrantyProjects', m.id, { unlink: true });
    expect(records.listWarranty(ctx, year)[0].projectEntryId).toBeNull();

    records.updateWarranty(ctx, w.id, warranty({ projectId: p.id }));
    projects.deleteProject(ctx, p.id);
    expect(records.listWarranty(ctx, year)[0]).toMatchObject({ projectId: null, projectName: null });
  });
});

describe('Job Freelance: Người đồng hành và các lần thanh toán', () => {
  it('nhiều người đồng hành; ghi thanh toán theo ngày hôm nay kèm ảnh; bảng tổng hợp đếm số lần', () => {
    const an = master.createMaster(ctx, 'freelanceCompanions', 'An');
    const binh = master.createMaster(ctx, 'freelanceCompanions', 'Bình');
    const job = freelance.createFreelance(ctx, { projectName: 'Shopdrawing', hirerId: null, startDate: null, statusId: null, companionIds: [binh.id, an.id, binh.id] });
    expect(job.companions.map((c) => c.name)).toEqual(['Bình', 'An']);

    const img = importImageBuffer(ctx, PNG, 'bien-lai.png');
    const p1 = freelance.addCompanionPayment(ctx, job.id, an.id, { amount: 1_500_000, note: 'Đợt 1', images: [img] });
    expect(p1).toMatchObject({ paidDate: TEST_TODAY, amount: 1_500_000, note: 'Đợt 1' });
    freelance.addCompanionPayment(ctx, job.id, an.id, { amount: 500_000, note: '', images: [] });
    freelance.addCompanionPayment(ctx, job.id, binh.id, { amount: 2_000_000, note: '', images: [] });
    expect(freelance.listFreelance(ctx).find((j) => j.id === job.id)!.companionPaymentCount).toBe(3);
    expect(freelance.listCompanionPayments(ctx, job.id, an.id).map((p) => p.amount).sort()).toEqual([1_500_000, 500_000].sort());
    expect(() => freelance.addCompanionPayment(ctx, job.id, an.id, { amount: 0, note: '', images: [] })).toThrow(/số tiền/i);
    expect(() => freelance.addCompanionPayment(ctx, job.id, an.id, { amount: 1.5, note: '', images: [] })).toThrow(/số tiền/i);

    const outsider = master.createMaster(ctx, 'freelanceCompanions', 'Cường');
    expect(() => freelance.addCompanionPayment(ctx, job.id, outsider.id, { amount: 1, note: '', images: [] })).toThrow(/không còn là người đồng hành/);
    // Không bỏ được người đã có thanh toán; sửa job từ client cũ (không gửi danh sách) thì giữ nguyên.
    expect(() => freelance.updateFreelance(ctx, job.id, { projectName: 'Shopdrawing', hirerId: null, startDate: null, statusId: null, companionIds: [binh.id] })).toThrow(/An đã có 2 lần thanh toán/);
    expect(freelance.setFreelanceStatus(ctx, job.id, null).companions).toHaveLength(2);
    expect(() => master.deleteMaster(ctx, 'freelanceCompanions', an.id, null)).toThrow(/Deactivate/);

    const edited = freelance.updateCompanionPayment(ctx, p1.id, { amount: 1_600_000, note: 'Đợt 1 (sửa)', images: [] });
    expect([edited.amount, edited.paidDate, edited.images]).toEqual([1_600_000, TEST_TODAY, []]);
    expect(fs.existsSync(imagePath(ctx, img.storageKey))).toBe(false);
    freelance.deleteCompanionPayment(ctx, p1.id);
    expect(freelance.getFreelance(ctx, job.id).companionPaymentCount).toBe(2);

    freelance.deleteFreelance(ctx, job.id);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_companion_payments')).toBe(0);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_job_companions')).toBe(0);
  });
});

describe('Sự kiện tạm thời', () => {
  it('thêm / sửa / xóa; STT tự cấp và không trùng; Hãng dùng chung; ghi chú ban đầu thành ghi chú hôm nay', () => {
    const brand = master.createMaster(ctx, 'brands', 'Hikvision');
    const e = events.createEvent(ctx, { name: ' Triển lãm  Secutech ', eventDate: TEST_TODAY, brandIds: [brand.id] }, { noteHtml: '<div>Mang 3 camera demo</div>' });
    expect(e).toMatchObject({ stt: 1, name: 'Triển lãm Secutech', brands: [{ id: brand.id, name: 'Hikvision' }], eventDate: TEST_TODAY });
    expect(e.note).toMatch(/Mang 3 camera demo/);
    const e2 = events.createEvent(ctx, { name: 'Hội thảo', eventDate: null, brandIds: [] });
    expect(e2.stt).toBe(2);
    expect(() => events.updateEvent(ctx, e2.id, { stt: 1, name: 'Hội thảo', eventDate: null, brandIds: [] })).toThrow(/STT 1 đã được dùng/);
    expect(() => events.createEvent(ctx, { name: '', eventDate: null, brandIds: [] })).toThrow(/Tên event/);
    expect(master.listMaster(ctx, 'brands').find((b) => b.id === brand.id)!.usageCount).toBe(1);

    notes.saveEventNote(ctx, e.id, { noteDate: '2026-11-15', html: '<div>Chuẩn bị</div>' });
    expect(notes.listEventNotes(ctx, e.id).map((n) => n.noteDate)).toEqual([TEST_TODAY, '2026-11-15']);
    expect(events.getEvent(ctx, e.id).note).toMatch(/Chuẩn bị/);

    const dir = tmpDir();
    const f1 = { path: path.join(dir, 'ke-hoach.docx'), name: 'ke-hoach.docx', extension: 'docx' };
    expect(events.setEventFiles(ctx, e.id, [f1, { ...f1 }]).files.map((f) => f.name)).toEqual(['ke-hoach.docx']);
    expect(() => events.setEventFiles(ctx, e.id, [{ path: 'C:\\x.exe', name: 'x.exe', extension: 'exe' }])).toThrow(/Chỉ hỗ trợ file/);
    expect(events.setEventFolder(ctx, e.id, dir).folderPath).toBe(dir);
    expect(() => events.setEventFolder(ctx, e.id, path.join(dir, 'khong-co'))).toThrow(/không tồn tại/);
    expect(events.setEventFolder(ctx, e.id, null).folderPath).toBeNull();

    events.deleteEvent(ctx, e.id);
    expect(events.listEvents(ctx).map((x) => x.name)).toEqual(['Hội thảo']);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM temp_event_notes')).toBe(0);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM temp_event_files')).toBe(0);
  });

  it('import nhiều bảng xlsx dạng tab sheet: thêm, đổi tên, đổi thứ tự, import lại, gỡ — tách biệt với dự án', () => {
    const e = events.createEvent(ctx, { name: 'Demo', eventDate: null, brandIds: [] });
    const a = events.commitEventImport(ctx, e.id, payload('BOQ.xlsx', ['P1375']));
    const b = events.commitEventImport(ctx, e.id, payload('BOQ.xlsx', ['M3086', 'Q6135']));
    expect(events.listEventImports(ctx, e.id).map((i) => [i.name, i.items.length, i.projectId])).toEqual([
      ['BOQ', 1, e.id],
      ['BOQ (2)', 2, e.id],
    ]);
    events.renameEventImport(ctx, e.id, b.id, 'Camera');
    expect(events.reorderEventImports(ctx, e.id, [b.id, a.id]).map((i) => i.name)).toEqual(['Camera', 'BOQ']);
    const b2 = events.commitEventImport(ctx, e.id, payload('Camera-v2.xlsx', ['Q6135']), b.id);
    expect(events.listEventImports(ctx, e.id).map((i) => [i.id, i.name])).toEqual([
      [b2.id, 'Camera'],
      [a.id, 'BOQ'],
    ]);
    expect(events.getEvent(ctx, e.id).importCount).toBe(2);
    const p = projects.createProject(ctx, input());
    expect(projects.listProjectImports(ctx, p.id)).toEqual([]);
    expect(() => events.removeEventImport(ctx, e.id, 'khong-co')).toThrow(/Không tìm thấy bảng import/);
    expect(() => projects.removeImport(ctx, p.id, a.id)).toThrow(/Không tìm thấy bảng import/);
    expect(() => events.commitEventImport(ctx, e.id, { ...payload('x.xlsx', []), info: [{ fieldKey: 'k', fieldLabel: 'K', fieldValue: 'v' }] })).toThrow(/Chỉ import được bảng thông tin các thiết bị/);
    events.removeEventImport(ctx, e.id, a.id);
    expect(events.listEventImports(ctx, e.id).map((i) => i.name)).toEqual(['Camera']);
    events.deleteEvent(ctx, e.id);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM temp_event_imported_items')).toBe(0);
  });
});

describe('Priority Point: 5 là cao nhất', () => {
  it('nâng cấp đảo giá trị cũ (1 cao nhất → 5) để giữ đúng mức ưu tiên đã chọn', async () => {
    const f = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(f, MIGRATIONS.slice(0, 14));
    const y = master.listYears({ ...ctx, db: old }).find((x) => x.jobType === 'MAIN')!.id;
    old.tx(() => {
      [1, 2, 3, 4, 5].forEach((prio, i) =>
        old.run('INSERT INTO projects (id, stt, job_year_id, work_category, project_name, note, priority_point, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [
          `p${prio}`, i + 1, y, 'PRE_SALES', `Cũ P${prio}`, '', prio, 't', 't',
        ]),
      );
    });
    old.close();
    const db = await Db.open(f);
    const c = { ...ctx, db };
    expect(projects.listProjects(c).map((p) => [p.id, p.priorityPoint])).toEqual([
      ['p1', 5],
      ['p2', 4],
      ['p3', 3],
      ['p4', 2],
      ['p5', 1],
    ]);
  });
});

describe('Import cùng một file nhiều lần (mỗi lần một sheet)', () => {
  it('tên tab theo "file - sheet"; import lại giữ tên tự đặt theo sheet mới; nhận diện bảng trong đúng sheet được chọn', () => {
    const p = projects.createProject(ctx, input());
    const two = (sheet: string, models: string[]) => ({ ...payload('BOQ 2 sheet.xlsx', models), sheetNames: [sheet], tabName: importTabBase('BOQ 2 sheet.xlsx', sheet) });
    const a = projects.commitImport(ctx, p.id, two('Camera', ['P1375']));
    const b = projects.commitImport(ctx, p.id, two('Switch', ['GS950']));
    projects.commitImport(ctx, p.id, two('Camera', ['P1377']));
    expect(projects.listProjectImports(ctx, p.id).map((i) => [i.name, i.sheetNames[0]])).toEqual([
      ['BOQ 2 sheet - Camera', 'Camera'],
      ['BOQ 2 sheet - Switch', 'Switch'],
      ['BOQ 2 sheet - Camera (2)', 'Camera'],
    ]);
    const b2 = projects.commitImport(ctx, p.id, { ...payload('BOQ moi.xlsx', ['GS970']), sheetNames: ['Switch'] }, b.id);
    expect(b2.name).toBe('BOQ moi');
    projects.renameImport(ctx, p.id, a.id, 'Camera tầng 1');
    expect(projects.commitImport(ctx, p.id, two('Camera', ['P1380']), a.id).name).toBe('Camera tầng 1');
    expect(importTabBase('a.xlsx', '  ')).toBe('a');

    const sheet = (name: string, rows: unknown[][]) => ({ name, rows: rows as never, rowCount: rows.length, colCount: 3, truncated: false });
    const found = detectItemsInSheet(sheet('Switch', [['Danh sách switch'], [], ['Model', 'Hãng', 'Mô tả'], ['GS950', 'Allied', '24 port'], ['GS970', 'Allied', '48 port']]));
    expect(found).toMatchObject({ sheet: 'Switch', headerRow: 2, endRow: 4, columns: { model: 0, brand: 1, description: 2 } });
    expect(detectItemsInSheet(sheet('Ghi chú', [['Không có bảng'], ['abc']]))).toBeNull();
  });
});
