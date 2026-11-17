import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { createHandlers } from '../src/main/handlers';
import { importImageBuffer } from '../src/main/integration/images';
import { bulkImport } from '../src/main/services/bulkImport';
import * as calendar from '../src/main/services/calendar';
import * as freelance from '../src/main/services/freelance';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as passwords from '../src/main/services/passwords';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import { referencedImageKeys } from '../src/main/services/records';
import { globalSearch } from '../src/main/services/search';
import { autoBulkConfig, buildBulkRows, BULK_FIELDS, bulkConfigFromMappings, bulkConfigToMappings } from '../src/shared/bulkImport';
import type { MasterKind, WorkbookSheet } from '../src/shared/types';
import { isWebLink } from '../src/shared/webLink';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let ctx: Ctx;
let mainYear: string;

beforeEach(async () => {
  ctx = await makeCtx();
  mainYear = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
});

const sheet = (name: string, rows: (string | number | null)[][]): WorkbookSheet => ({
  name,
  rows,
  rowCount: rows.length,
  colCount: Math.max(...rows.map((r) => r.length)),
  truncated: false,
});

describe('Nâng cấp v1.4 → v1.5: Job Freelance thành bảng riêng', () => {
  it('chuyển dự án Freelance cũ (giữ STT, tên, ngày, ghi chú, ảnh), Warranty sang Job Chính, xóa năm Freelance', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 4));
    const mainY = old.scalar<string>("SELECT id FROM job_years WHERE job_type = 'MAIN'");
    const freeY = old.scalar<string>("SELECT id FROM job_years WHERE job_type = 'FREELANCE'");
    const label = old.scalar<string>("SELECT year_label FROM job_years WHERE job_type = 'FREELANCE'");
    old.tx(() => {
      old.exec("INSERT INTO job_years VALUES ('fy-old','FREELANCE','2024',2024,'t','t')");
      old.exec("INSERT INTO clients VALUES ('c1','Anh Bình',0,1,'t','t')");
      old.exec("INSERT INTO si_partners VALUES ('s1','SI Alpha',0,1,'t','t')");
      old.exec("INSERT INTO brands VALUES ('b1','Axis',0,1,'t','t')");
      const ins = `INSERT INTO projects (id, stt, job_year_id, work_category, received_date, due_date, project_name, client_id, si_id, priority_point,
        is_completed, note, folder_path, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      old.run(ins, ['m1', 1, mainY, 'PRE_SALES', '2026-10-01', '2026-12-01', 'Dự án chính', null, null, 3, 0, '', null, '2026-10-01T03:00:00Z', 't']);
      old.run(ins, ['f1', 2, freeY, 'POST_SALES', '2026-09-01', '2026-09-30', 'Thiết kế web', 'c1', 's1', 2, 1, '', 'D:\\Jobs\\2.Thiết kế web', '2026-09-01T03:00:00Z', 't']);
      old.run(ins, ['f2', 5, 'fy-old', 'PRE_SALES', null, null, 'Bản vẽ shop', null, 's1', 3, 0, '', null, '2024-05-01T03:00:00Z', 't']);
      old.exec("INSERT INTO project_brands VALUES ('f1','b1',0)");
      old.exec("INSERT INTO project_notes VALUES ('n1','f1','2026-09-05','<div>Đã gửi demo</div>','Đã gửi demo','t','t')");
      old.exec("INSERT INTO project_note_images VALUES ('ni1','n1','11111111-1111-1111-1111-111111111111.png','a.png','image/png',10,0,'t')");
      old.exec("INSERT INTO project_imports VALUES ('i1','f1','tb.xlsx',NULL,'[]','t','IMPORTED')");
      old.exec("INSERT INTO imported_items VALUES ('it1','i1','DS-2CD','Hik','Camera',0)");
      old.exec("INSERT INTO calendar_events VALUES ('e1','2026-09-01',NULL,NULL,'Thiết kế web','',NULL,'PROJECT_START','f1','Thiết kế web','t','t')");
      old.exec("INSERT INTO experience_records (id, brand_id, experience_date, project_id, project_text, event, created_at, updated_at) VALUES ('x1','b1','2026-09-02','f1',NULL,'Lỗi PoE','t','t')");
      old.exec(`INSERT INTO warranty_records (id, job_year_id, model, created_at, updated_at) VALUES ('w1','${freeY}','M3007','t','t')`);
      old.exec("INSERT INTO warranty_records (id, job_year_id, model, created_at, updated_at) VALUES ('w2','fy-old','P1375','t','t')");
    });
    old.close();

    const db = await Db.open(file);
    const c = { ...ctx, db };
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(master.listYears(c).every((y) => y.jobType === 'MAIN')).toBe(true);
    expect(projects.listProjects(c).map((p) => p.id)).toEqual(['m1']);

    const jobs = freelance.listFreelance(c);
    expect(jobs.map((j) => [j.stt, j.projectName, j.hirer, j.startDate, j.statusName])).toEqual([
      [2, 'Thiết kế web', 'Anh Bình', '2026-09-01', 'Hoàn thành'],
      [5, 'Bản vẽ shop', 'SI Alpha', null, 'Đang làm'],
    ]);
    const fnotes = notes.listFreelanceNotes(c, 'f1');
    expect(fnotes.map((n) => n.noteDate)).toContain('2026-09-05');
    const info = fnotes.find((n) => n.text.includes('Chuyển từ Job Freelance'))!;
    expect(info.text).toContain('Tên SI: SI Alpha');
    expect(info.text).toContain('Hãng: Axis');
    expect(info.text).toContain('Ngày tới hạn: 30/09/2026');
    expect(info.text).toContain('Thư mục dự án: D:\\Jobs\\2.Thiết kế web');
    expect(info.text).toContain('DS-2CD – Hik – Camera');
    expect(jobs[0].note).toContain('Đã gửi demo');
    expect(referencedImageKeys(c).has('11111111-1111-1111-1111-111111111111.png')).toBe(true);
    expect(master.listMaster(c, 'freelanceStatuses').map((s) => s.name)).toEqual(['Mới nhận', 'Đang làm', 'Tạm dừng', 'Hoàn thành', 'Đã hủy']);

    const w1Year = master.getYear(c, db.scalar<string>("SELECT job_year_id FROM warranty_records WHERE id = 'w1'"));
    const w2Year = master.getYear(c, db.scalar<string>("SELECT job_year_id FROM warranty_records WHERE id = 'w2'"));
    expect([w1Year.jobType, w1Year.yearLabel]).toEqual(['MAIN', label]);
    expect([w2Year.jobType, w2Year.yearLabel]).toEqual(['MAIN', '2024']);
    expect(calendar.listCalendarEvents(c, {}).find((e) => e.id === 'e1')).toBeUndefined();
    expect(calendar.listCalendarFeed(c, { from: '2026-09-01', to: '2026-09-01' }).filter((i) => i.kind === 'PROJECT_START')).toMatchObject([{ source: 'FREELANCE', kind: 'PROJECT_START', title: '2. Thiết kế web' }]);
    expect(records.listExperience(c, 'b1')[0].projectText).toBe('2. Thiết kế web (Job Freelance)');
  });

  it('cài mới: có danh mục Tình trạng, không có năm Freelance', () => {
    expect(master.listMaster(ctx, 'freelanceStatuses')).toHaveLength(5);
    expect(master.listYears(ctx).filter((y) => y.jobType === 'FREELANCE')).toHaveLength(0);
    expect(freelance.listFreelance(ctx)).toEqual([]);
  });
});

describe('Job Freelance', () => {
  it('STT tự +1, trùng STT bị chặn, chỉ bắt buộc STT + Tên; ghi chú hôm nay khi tạo', () => {
    const doing = master.listMaster(ctx, 'freelanceStatuses')[1];
    const a = freelance.createFreelance(ctx, { projectName: 'Logo quán cà phê', hirerId: master.createMaster(ctx, 'freelanceHirers', 'Chị Hoa').id, startDate: '2026-11-01', statusId: doing.id }, { noteHtml: '<div>Gửi 3 phương án</div>' });
    expect(a).toMatchObject({ stt: 1, hirer: 'Chị Hoa', statusName: 'Đang làm' });
    expect(a.note).toContain('16/11/2026: Gửi 3 phương án');
    const b = freelance.createFreelance(ctx, { stt: 7, projectName: 'Web bán hàng', hirerId: null, startDate: null, statusId: null });
    expect(b).toMatchObject({ stt: 7, hirerId: null, startDate: null, statusId: null });
    expect(freelance.nextFreelanceStt(ctx)).toBe(8);
    expect(() => freelance.createFreelance(ctx, { stt: 7, projectName: 'X', hirerId: null, startDate: null, statusId: null })).toThrow(/STT 7 đã được dùng/);
    expect(() => freelance.createFreelance(ctx, { stt: null, projectName: 'X', hirerId: null, startDate: null, statusId: null })).toThrow(/Bắt buộc nhập STT/);
    expect(() => freelance.createFreelance(ctx, { projectName: '  ', hirerId: null, startDate: null, statusId: null })).toThrow(/Tên dự án/);
    expect(() => freelance.createFreelance(ctx, { projectName: 'X', hirerId: null, startDate: '31/02/2026', statusId: null })).toThrow(/Ngày không hợp lệ/);
  });

  it('STT của Job Freelance độc lập với Job Chính', () => {
    projects.createProject(ctx, {
      stt: 1, jobYearId: mainYear, workCategory: 'PRE_SALES', receivedDate: null, dueDate: null, projectName: 'Dự án chính', clientId: null,
      salespersonId: null, note: '', filePath: null, fileName: null, fileExtension: null, priorityPoint: 3,
    });
    expect(freelance.createFreelance(ctx, { stt: 1, projectName: 'Job 1', hirerId: null, startDate: null, statusId: null }).stt).toBe(1);
  });

  it('ghi chú theo ngày: sửa ngày cũ, xóa khi rỗng, ảnh dọn khi xóa job', () => {
    const j = freelance.createFreelance(ctx, { projectName: 'Job ảnh', hirerId: null, startDate: null, statusId: null });
    const img = importImageBuffer(ctx, PNG, 'a.png');
    notes.saveFreelanceNote(ctx, j.id, { noteDate: '2026-11-10', html: `<div>Bản nháp</div><img data-key="${img.storageKey}">` });
    notes.saveFreelanceNote(ctx, j.id, { noteDate: TEST_TODAY, html: '<div>Chốt</div>' });
    expect(notes.listFreelanceNotes(ctx, j.id).map((n) => n.noteDate)).toEqual([TEST_TODAY, '2026-11-10']);
    expect(freelance.getFreelance(ctx, j.id).note.startsWith('16/11/2026: Chốt')).toBe(true);
    expect(() => notes.saveFreelanceNote(ctx, j.id, { noteDate: '2026-12-01', html: 'x' })).toThrow(/tương lai/);
    expect(notes.saveFreelanceNote(ctx, j.id, { noteDate: TEST_TODAY, html: '' })).toBeNull();
    expect(notes.listFreelanceNotes(ctx, j.id)).toHaveLength(1);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(true);
    freelance.deleteFreelance(ctx, j.id);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_notes')).toBe(0);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(false);
  });

  it('Tình trạng: sắp xếp lên/xuống, xóa đang dùng thì gán lại hoặc gỡ; danh mục Job Chính không sắp được', () => {
    const [st0, st1] = master.listMaster(ctx, 'freelanceStatuses');
    master.moveMaster(ctx, 'freelanceStatuses', st1.id, -1);
    expect(master.listMaster(ctx, 'freelanceStatuses').slice(0, 2).map((s) => s.id)).toEqual([st1.id, st0.id]);
    const j = freelance.createFreelance(ctx, { projectName: 'J', hirerId: null, startDate: null, statusId: st0.id });
    expect(() => master.deleteMaster(ctx, 'freelanceStatuses', st0.id, null)).toThrow(/đang được 1 mục/);
    master.deleteMaster(ctx, 'freelanceStatuses', st0.id, { replaceWithId: st1.id });
    expect(freelance.getFreelance(ctx, j.id).statusName).toBe(st1.name);
    expect(freelance.setFreelanceStatus(ctx, j.id, null).statusId).toBeNull();
    master.createMaster(ctx, 'clients', 'A');
    expect(() => master.moveMaster(ctx, 'clients' as MasterKind, master.listMaster(ctx, 'clients')[0].id, 1)).toThrow(/theo tên/);
  });

  it('tìm theo Tên dự án ra cả Job Freelance', () => {
    freelance.createFreelance(ctx, { projectName: 'Thiết kế nội thất căn hộ', hirerId: master.createMaster(ctx, 'freelanceHirers', 'Anh Nam').id, startDate: '2026-10-01', statusId: null });
    const hits = globalSearch(ctx, { mode: 'name', text: 'noi that' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'freelance', title: '1. Thiết kế nội thất căn hộ', workCategory: null });
    expect(globalSearch(ctx, { mode: 'name', text: 'noi that', from: '2026-11-01' })).toHaveLength(0);
  });

  it('không tạo được Pre/Post-sales hay Warranty cho năm Freelance (dữ liệu cũ)', () => {
    ctx.db.exec("INSERT INTO job_years VALUES ('fy','FREELANCE','2026',2026,'t','t')");
    expect(() =>
      projects.createProject(ctx, {
        jobYearId: 'fy', workCategory: 'PRE_SALES', receivedDate: null, dueDate: null, projectName: 'X', clientId: null, salespersonId: null,
        note: '', filePath: null, fileName: null, fileExtension: null, priorityPoint: 3,
      }),
    ).toThrow(/Job Freelance/);
    expect(() =>
      records.createWarranty(ctx, {
        jobYearId: 'fy', model: 'M', brandId: null, ipAddress: '', username: '', macAddress: '', serialNumber: '', receivedDate: null, testedDate: null,
        customerReport: '', inspection: '', result: '', resolution: '', caseNumber: '', images: [],
      }),
    ).toThrow(/Job Freelance/);
  });
});

describe('Password', () => {
  it('bắt buộc Tên website / Username / Password; mật khẩu chỉ lưu dạng mã hóa, xem lại được', () => {
    const e = passwords.createPassword(ctx, { siteName: 'Gmail', username: 'me@example.com', password: 'S3cret!', url: 'mail.google.com' });
    expect(e).toMatchObject({ siteName: 'Gmail', username: 'me@example.com', url: 'mail.google.com' });
    expect(e).not.toHaveProperty('password');
    const stored = ctx.db.scalar<string>('SELECT password_encrypted FROM password_entries WHERE id = ?', [e.id]);
    expect(stored).not.toContain('S3cret!');
    expect(passwords.revealPassword(ctx, e.id)).toBe('S3cret!');
    passwords.updatePassword(ctx, e.id, { siteName: 'Gmail cá nhân', username: 'me@example.com', url: '' });
    expect(passwords.revealPassword(ctx, e.id)).toBe('S3cret!');
    passwords.updatePassword(ctx, e.id, { siteName: 'Gmail cá nhân', username: 'me@example.com', password: 'Moi', url: '' });
    expect(passwords.revealPassword(ctx, e.id)).toBe('Moi');
    expect(() => passwords.updatePassword(ctx, e.id, { siteName: 'G', username: 'u', password: '', url: '' })).toThrow(/không được để trống/);
    expect(() => passwords.createPassword(ctx, { siteName: '', username: 'u', password: 'p', url: '' })).toThrow(/Tên website/);
    expect(() => passwords.createPassword(ctx, { siteName: 'S', username: '', password: 'p', url: '' })).toThrow(/Username/);
    expect(() => passwords.createPassword(ctx, { siteName: 'S', username: 'u', password: '', url: '' })).toThrow(/Password/);
    passwords.createPassword(ctx, { siteName: 'Github', username: 'dev', password: 'x', url: '' });
    expect(passwords.listPasswords(ctx).map((p) => p.siteName)).toEqual(['Gmail cá nhân', 'Github']);
    passwords.deletePassword(ctx, e.id);
    expect(passwords.listPasswords(ctx)).toHaveLength(1);
  });
});

describe('Tool online', () => {
  it('bắt buộc Tên tool và Link hợp lệ; CRUD', () => {
    expect(isWebLink('https://tinypng.com')).toBe(true);
    expect(isWebLink('remove.bg/upload')).toBe(true);
    expect(isWebLink('nén ảnh')).toBe(false);
    expect(isWebLink('javascript:alert(1)')).toBe(false);
    const t = passwords.createOnlineTool(ctx, { name: 'TinyPNG', purpose: 'Nén ảnh', url: 'tinypng.com' });
    expect(t).toMatchObject({ name: 'TinyPNG', purpose: 'Nén ảnh', url: 'tinypng.com' });
    expect(() => passwords.createOnlineTool(ctx, { name: '', purpose: '', url: 'a.com' })).toThrow(/Tên tool/);
    expect(() => passwords.createOnlineTool(ctx, { name: 'X', purpose: '', url: '' })).toThrow(/Link/);
    expect(() => passwords.createOnlineTool(ctx, { name: 'X', purpose: '', url: 'nén ảnh online' })).toThrow(/Link không hợp lệ/);
    passwords.updateOnlineTool(ctx, t.id, { name: 'TinyPNG', purpose: 'Nén PNG/JPG', url: 'https://tinypng.com' });
    expect(passwords.listOnlineTools(ctx)[0].purpose).toBe('Nén PNG/JPG');
    passwords.deleteOnlineTool(ctx, t.id);
    expect(passwords.listOnlineTools(ctx)).toEqual([]);
  });
});

describe('Import hàng loạt từ .xlsx', () => {
  const projectSheet = sheet('Danh sách', [
    ['DANH SÁCH DỰ ÁN 2026'],
    [],
    ['STT', 'Tên dự án', 'Tên SI', 'Hãng', 'Sale', 'Chủ đầu tư', 'Ngày bắt đầu', 'Hạn', 'Ưu tiên', 'Ghi chú'],
    [null, 'Trường học A', 'SI Alpha', 'Axis, Hikvision', 'Lan', 'Sở GD', 46327, '30/11/2026', 2, 'Đã khảo sát'],
    [20, 'Bệnh viện B', 'si alpha', 'AXIS', null, null, '2026-11-02', null, null, null],
    [null, null, null, null, null, null, null, null, null, null],
    [null, '', 'SI Beta', null, null, null, null, null, null, null],
    [21, 'Ngày sai', null, null, null, null, '35/13/2026', null, null, null],
    [20, 'Trùng STT', null, null, null, null, null, null, 7, null],
  ]);

  it('tự nhận diện dòng header và cột theo tên tiêu đề', () => {
    const cfg = autoBulkConfig([projectSheet], BULK_FIELDS.PRE_SALES);
    expect(cfg).toMatchObject({ sheet: 'Danh sách', headerRow: 2, endRow: 8 });
    expect(cfg.columns).toMatchObject({ stt: 0, projectName: 1, si: 2, brand: 3, sale: 4, eu: 5, receivedDate: 6, dueDate: 7, priority: 8, note: 9 });
    const rows = buildBulkRows('PRE_SALES', projectSheet, cfg, new Set([5]));
    expect(rows.map((r) => r.rowNumber)).toEqual([4, 5, 7, 8, 9]);
    expect(rows[0].values).toMatchObject({ projectName: 'Trường học A', receivedDate: '2026-11-01', dueDate: '2026-11-30', priority: 2 });
    expect(rows[0].errors).toEqual([]);
    expect(rows[2].errors.join()).toMatch(/Thiếu Tên dự án/);
    expect(rows[3].errors.join()).toMatch(/không phải ngày hợp lệ/);
    expect(rows[4].errors.join()).toMatch(/STT 20 trùng với dòng 5.*|Priority "7"/);
    const back = bulkConfigFromMappings('PRE_SALES', [projectSheet], bulkConfigToMappings('PRE_SALES', cfg));
    expect(back).toEqual(cfg);
  });

  it('Pre-sales: ghi dòng hợp lệ, khớp/thêm danh mục theo tên, bỏ qua dòng lỗi, STT tự đánh không trùng', () => {
    projects.createProject(ctx, {
      stt: 21, jobYearId: mainYear, workCategory: 'PRE_SALES', receivedDate: null, dueDate: null, projectName: 'Có sẵn', clientId: null,
      salespersonId: null, note: '', filePath: null, fileName: null, fileExtension: null, priorityPoint: 3,
    });
    master.createMaster(ctx, 'brands', 'Axis');
    const cfg = autoBulkConfig([projectSheet], BULK_FIELDS.PRE_SALES);
    const rows = buildBulkRows('PRE_SALES', projectSheet, cfg).map(({ rowNumber, values }) => ({ rowNumber, values }));
    const res = bulkImport(ctx, { target: 'PRE_SALES', jobYearId: mainYear, rows, workbookSignature: 'sig-1', mappings: bulkConfigToMappings('PRE_SALES', cfg) });
    expect(res.created).toBe(2);
    expect(res.skipped.map((s) => s.rowNumber)).toEqual([7, 8, 9]);
    expect(res.newMasters).toEqual(
      expect.arrayContaining([
        { kind: 'siPartners', name: 'SI Alpha' },
        { kind: 'brands', name: 'Hikvision' },
        { kind: 'salespersons', name: 'Lan' },
        { kind: 'clients', name: 'Sở GD' },
      ]),
    );
    expect(res.newMasters.some((m) => m.name === 'Axis' || m.name === 'si alpha')).toBe(false);
    const list = projects.listProjects(ctx).filter((p) => p.projectName !== 'Có sẵn');
    expect(list.map((p) => [p.stt, p.projectName, p.siName, p.brands.map((b) => b.name).join('+'), p.workCategory])).toEqual([
      [20, 'Bệnh viện B', 'SI Alpha', 'Axis', 'PRE_SALES'],
      [22, 'Trường học A', 'SI Alpha', 'Axis+Hikvision', 'PRE_SALES'],
    ]);
    const a = list.find((p) => p.projectName === 'Trường học A')!;
    expect(a).toMatchObject({ receivedDate: '2026-11-01', dueDate: '2026-11-30', priorityPoint: 2, clientName: 'Sở GD', salespersonName: 'Lan' });
    expect(notes.listProjectNotes(ctx, a.id)[0]).toMatchObject({ noteDate: TEST_TODAY, text: 'Đã khảo sát' });
    expect(projects.savedMappings(ctx, 'sig-1').some((m) => m.targetField === 'bulk.PRE_SALES.col.projectName')).toBe(true);
  });

  it('Pre-sales có nơi lưu: tạo thư mục cho từng dự án', () => {
    const root = tmpDir('ppm-bulk-root-');
    const res = bulkImport(ctx, {
      target: 'POST_SALES',
      jobYearId: mainYear,
      folderParent: root,
      rows: [{ rowNumber: 2, values: { projectName: 'Kho lạnh', si: 'SI Gamma', brand: 'Bosch' } }],
    });
    expect(res.created).toBe(1);
    expect(fs.existsSync(path.join(root, '1.Kho lạnh_SI Gamma_Bosch'))).toBe(true);
  });

  it('Warranty: cần Model hoặc Case no, mật khẩu được mã hóa', () => {
    const ws = sheet('RMA', [
      ['Case no', 'Model', 'Hãng', 'Serial number', 'Pass', 'Ngày nhận', 'Khách hàng báo'],
      ['RMA-01', 'M3007', 'Axis', 'ACCC1', 'admin123', '05/11/2026', 'Mất hình'],
      [null, null, 'Axis', 'ACCC2', null, null, 'Không lên nguồn'],
    ]);
    const cfg = autoBulkConfig([ws], BULK_FIELDS.WARRANTY);
    const rows = buildBulkRows('WARRANTY', ws, cfg);
    expect(rows[1].errors.join()).toMatch(/Model hoặc Case no/);
    const res = bulkImport(ctx, { target: 'WARRANTY', jobYearId: mainYear, rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })) });
    expect(res).toMatchObject({ created: 1, skipped: [{ rowNumber: 3 }] });
    const [w] = records.listWarranty(ctx, mainYear);
    expect(w).toMatchObject({ caseNumber: 'RMA-01', model: 'M3007', brandName: 'Axis', serialNumber: 'ACCC1', receivedDate: '2026-11-05', hasPassword: true });
    expect(records.revealWarrantyPassword(ctx, w.id)).toBe('admin123');
  });

  it('Job Freelance: Tình trạng khớp theo tên, chưa có thì thêm', () => {
    const ws = sheet('Jobs', [
      ['STT', 'Tên dự án', 'Bên thuê', 'Ngày bắt đầu', 'Tình trạng', 'Ghi chú'],
      [3, 'Logo', 'Chị Hoa', '01/10/2026', 'hoàn thành', 'Đã bàn giao'],
      [null, 'Landing page', 'Anh Tú', null, 'Chờ nghiệm thu', null],
    ]);
    const cfg = autoBulkConfig([ws], BULK_FIELDS.FREELANCE);
    const rows = buildBulkRows('FREELANCE', ws, cfg).map(({ rowNumber, values }) => ({ rowNumber, values }));
    const res = bulkImport(ctx, { target: 'FREELANCE', rows });
    expect(res.created).toBe(2);
    expect(res.newMasters).toEqual(
      expect.arrayContaining([
        { kind: 'freelanceStatuses', name: 'Chờ nghiệm thu' },
        { kind: 'freelanceHirers', name: 'Chị Hoa' },
        { kind: 'freelanceHirers', name: 'Anh Tú' },
      ]),
    );
    expect(res.newMasters).toHaveLength(3);
    expect(freelance.listFreelance(ctx).map((j) => [j.stt, j.projectName, j.hirer, j.startDate, j.statusName])).toEqual([
      [3, 'Logo', 'Chị Hoa', '2026-10-01', 'Hoàn thành'],
      [4, 'Landing page', 'Anh Tú', null, 'Chờ nghiệm thu'],
    ]);
  });

  it('chặn import Pre/Post-sales/Warranty khi thiếu năm; lỗi giữa chừng không ghi dòng nào', () => {
    expect(() => bulkImport(ctx, { target: 'PRE_SALES', rows: [] })).toThrow(/năm/);
    const before = projects.listProjects(ctx).length;
    expect(() =>
      bulkImport(ctx, {
        target: 'PRE_SALES',
        jobYearId: mainYear,
        folderParent: path.join(tmpDir(), 'khong-ton-tai'),
        rows: [
          { rowNumber: 2, values: { projectName: 'A' } },
          { rowNumber: 3, values: { projectName: 'B' } },
        ],
      }),
    ).toThrow(/Thư mục lưu dự án/);
    expect(projects.listProjects(ctx)).toHaveLength(before);
  });

  it('IPC bulkImport/listFreelance/revealPassword đi qua handlers', async () => {
    const h = createHandlers(ctx, {} as never);
    await h.bulkImport({ target: 'FREELANCE', rows: [{ rowNumber: 2, values: { projectName: 'Qua IPC' } }] });
    expect((await h.listFreelance()).map((j) => j.projectName)).toEqual(['Qua IPC']);
    const p = await h.createPassword({ siteName: 'A', username: 'u', password: 'pw', url: '' });
    expect(await h.revealPassword(p.id)).toBe('pw');
  });
});
