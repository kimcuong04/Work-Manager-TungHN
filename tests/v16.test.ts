import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { createHandlers, type Desktop } from '../src/main/handlers';
import { writeXlsx } from '../src/main/integration/files';
import { bulkImport } from '../src/main/services/bulkImport';
import * as calendar from '../src/main/services/calendar';
import * as freelance from '../src/main/services/freelance';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import type { ProjectInput, WarrantyInput } from '../src/shared/types';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

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
  filePath: null,
  fileName: null,
  fileExtension: null,
  priorityPoint: 3,
  ...over,
});

const wInput = (over: Partial<WarrantyInput> = {}): WarrantyInput => ({
  jobYearId: year,
  model: 'M3007',
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

describe('Nâng cấp v1.5 → v1.6', () => {
  it('Warranty có STT theo năm (thứ tự Ngày nhận), Bên thuê thành danh mục, dọn lịch của dự án đã xóa, STT dự án theo từng danh sách', async () => {
    const file = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 5));
    const y = old.scalar<string>("SELECT id FROM job_years WHERE job_type = 'MAIN'");
    old.tx(() => {
      old.run('INSERT INTO warranty_records (id, job_year_id, model, received_date, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['w2', y, 'Sau', '2026-10-05', 't1', 't1']);
      old.run('INSERT INTO warranty_records (id, job_year_id, model, received_date, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['w1', y, 'Trước', '2026-10-01', 't2', 't2']);
      old.run('INSERT INTO warranty_records (id, job_year_id, model, received_date, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['w3', y, 'Không ngày', null, 't0', 't0']);
      old.run("INSERT INTO freelance_jobs VALUES ('f1', 1, 'Logo', 'Chị  Hoa', NULL, NULL, '', 't', 't')");
      old.run("INSERT INTO freelance_jobs VALUES ('f2', 2, 'Web', 'chị hoa', NULL, NULL, '', 't', 't')");
      old.run("INSERT INTO freelance_jobs VALUES ('f3', 3, 'App', 'Anh Tú', NULL, NULL, '', 't', 't')");
      old.run(
        "INSERT INTO projects (id, stt, job_year_id, work_category, project_name, priority_point, created_at, updated_at) VALUES ('p1', 7, ?, 'PRE_SALES', 'Còn', 3, 't', 't')",
        [y],
      );
      old.run("INSERT INTO calendar_events VALUES ('e-orphan','2026-10-01',NULL,NULL,'Đã xóa','',NULL,'PROJECT_UPDATE',NULL,'Đã xóa','t','t')");
      old.run("INSERT INTO calendar_events VALUES ('e-custom','2026-10-02',NULL,NULL,'Họp','',NULL,'CUSTOM',NULL,'Đã xóa','t','t')");
      old.run("INSERT INTO calendar_events VALUES ('e-live','2026-10-03',NULL,NULL,'Còn','',NULL,'PROJECT_START','p1','Còn','t','t')");
    });
    old.close();

    const db = await Db.open(file);
    const c = { ...ctx, db };
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(records.listWarranty(c, y).map((w) => [w.stt, w.model])).toEqual([
      [3, 'Không ngày'],
      [2, 'Sau'],
      [1, 'Trước'],
    ]);
    expect(master.listMaster(c, 'freelanceHirers').map((h) => h.name)).toEqual(['Anh Tú', 'Chị Hoa']);
    expect(freelance.listFreelance(c).map((j) => j.hirer)).toEqual(['Chị Hoa', 'Chị Hoa', 'Anh Tú']);
    expect(calendar.listCalendarEvents(c).map((e) => e.id)).toEqual(['e-custom', 'e-live']);
    expect(projects.getProject(c, 'p1')).toMatchObject({ stt: 7, folderAuto: true });
    // STT 7 đã có ở Pre-sales nhưng Post-sales cùng năm vẫn dùng được.
    const post = projects.createProject(c, input({ jobYearId: y, workCategory: 'POST_SALES', stt: 7, projectName: 'Post 7' }));
    expect(post.stt).toBe(7);
  });
});

describe('STT riêng cho từng danh sách (năm × Pre-sales / Post-sales)', () => {
  it('Pre-sales tới 74, Post-sales tới 50 → dự án Post-sales mới là 51; trùng chỉ chặn trong cùng danh sách', () => {
    projects.createProject(ctx, input({ stt: 74, projectName: 'Pre 74' }));
    projects.createProject(ctx, input({ stt: 50, workCategory: 'POST_SALES', projectName: 'Post 50' }));
    expect(projects.nextProjectStt(ctx, year, 'POST_SALES')).toBe(51);
    expect(projects.nextProjectStt(ctx, year, 'PRE_SALES')).toBe(75);
    expect(projects.createProject(ctx, input({ workCategory: 'POST_SALES', projectName: 'Post mới' })).stt).toBe(51);
    expect(projects.createProject(ctx, input({ stt: 74, workCategory: 'POST_SALES', projectName: 'Post 74' })).stt).toBe(74);
    expect(() => projects.createProject(ctx, input({ stt: 74, projectName: 'Pre trùng' }))).toThrow(/STT 74 đã được dùng.*gợi ý: 75/);
    const y2025 = master.createYear(ctx, 'MAIN', '2025');
    expect(projects.createProject(ctx, input({ jobYearId: y2025.id, projectName: 'Năm khác' })).stt).toBe(1);
  });

  it('di chuyển sang danh sách đã có STT đó thì lấy số tiếp theo của danh sách mới', () => {
    const a = projects.createProject(ctx, input({ stt: 3, projectName: 'A' }));
    projects.createProject(ctx, input({ stt: 3, workCategory: 'POST_SALES', projectName: 'B' }));
    projects.createProject(ctx, input({ stt: 8, workCategory: 'POST_SALES', projectName: 'C' }));
    expect(projects.moveProject(ctx, a.id, year, 'POST_SALES')).toMatchObject({ workCategory: 'POST_SALES', stt: 9 });
    const d = projects.createProject(ctx, input({ stt: 20, projectName: 'D' }));
    expect(projects.moveProject(ctx, d.id, year, 'POST_SALES').stt).toBe(20);
  });

  it('import Post-sales chỉ xét STT đã có trong Post-sales', () => {
    projects.createProject(ctx, input({ stt: 74, projectName: 'Pre 74' }));
    projects.createProject(ctx, input({ stt: 50, workCategory: 'POST_SALES', projectName: 'Post 50' }));
    const res = bulkImport(ctx, { target: 'POST_SALES', jobYearId: year, rows: [{ rowNumber: 2, values: { projectName: 'Mới' } }, { rowNumber: 3, values: { stt: 74, projectName: 'Có số' } }] });
    expect(res).toMatchObject({ created: 2, skipped: [] });
    expect(projects.listProjects(ctx).filter((p) => p.workCategory === 'POST_SALES').map((p) => p.stt).sort((a, b) => a - b)).toEqual([50, 74, 75]);
  });
});

describe('Calendar: Job Freelance và Kinh nghiệm luôn khớp dữ liệu', () => {
  it('Freelance: ngày bắt đầu + ngày có ghi chú; Kinh nghiệm: ngày ghi nhận; sửa/xóa là đổi theo', () => {
    const hirer = master.createMaster(ctx, 'freelanceHirers', 'Chị Hoa');
    const j = freelance.createFreelance(ctx, { projectName: 'Logo', hirerId: hirer.id, startDate: '2026-11-02', statusId: null }, { noteHtml: '<div>Gửi phương án</div>' });
    const brand = master.createMaster(ctx, 'brands', 'Axis');
    const e = records.createExperience(ctx, { brandId: brand.id, experienceDate: '2026-11-05', projectId: null, projectText: 'Kho A', deviceModel: 'P1375', event: 'Camera mất hình do PoE', webUrl: '', images: [] });
    const feed = calendar.listCalendarFeed(ctx, { from: '2026-11-01', to: '2026-11-30' });
    expect(feed.map((f) => [f.source, f.kind, f.date, f.title])).toEqual([
      ['FREELANCE', 'PROJECT_START', '2026-11-02', '1. Logo'],
      ['EXPERIENCE', 'PROJECT_START', '2026-11-05', 'Axis: Camera mất hình do PoE'],
      ['FREELANCE', 'PROJECT_UPDATE', TEST_TODAY, '1. Logo'],
    ]);
    expect(feed[0].subtitle).toContain('Bên thuê Chị Hoa');
    expect(feed[2].note).toBe('Ghi chú: Gửi phương án');

    freelance.updateFreelance(ctx, j.id, { stt: 1, projectName: 'Logo mới', hirerId: hirer.id, startDate: '2026-11-03', statusId: null });
    records.updateExperience(ctx, e.id, { brandId: brand.id, experienceDate: '2026-11-07', projectId: null, projectText: '', deviceModel: '', event: 'Đã sửa', webUrl: '', images: [] });
    const after = calendar.listCalendarFeed(ctx, { from: '2026-11-01', to: '2026-11-30' }).filter((f) => f.kind === 'PROJECT_START');
    expect(after.map((f) => [f.date, f.title])).toEqual([
      ['2026-11-03', '1. Logo mới'],
      ['2026-11-07', 'Axis: Đã sửa'],
    ]);
    freelance.deleteFreelance(ctx, j.id);
    records.deleteExperience(ctx, e.id);
    expect(calendar.listCalendarFeed(ctx, {})).toEqual([]);
  });
});

describe('Warranty: STT', () => {
  it('tự +1 trong năm, sửa được, trùng trong năm bị chặn, năm khác dùng lại được', () => {
    const a = records.createWarranty(ctx, wInput());
    const b = records.createWarranty(ctx, wInput({ caseNumber: 'RMA-01' }));
    expect([a.stt, b.stt]).toEqual([1, 2]);
    expect(records.nextWarrantyStt(ctx, year)).toBe(3);
    expect(records.createWarranty(ctx, wInput({ stt: 10 })).stt).toBe(10);
    expect(() => records.createWarranty(ctx, wInput({ stt: 2 }))).toThrow(/STT 2 đã dùng.*gợi ý: 11/);
    expect(() => records.createWarranty(ctx, wInput({ stt: null }))).toThrow(/Bắt buộc nhập STT/);
    expect(records.updateWarranty(ctx, a.id, { ...wInput(), stt: 5 }).stt).toBe(5);
    expect(records.updateWarranty(ctx, a.id, wInput({ model: 'Đổi model' })).stt).toBe(5);
    const y2025 = master.createYear(ctx, 'MAIN', '2025');
    expect(records.createWarranty(ctx, wInput({ jobYearId: y2025.id, stt: 2 })).stt).toBe(2);
  });

  it('Duplicate: STT mới, dùng lại mật khẩu đã mã hóa của bản gốc', () => {
    const src = records.createWarranty(ctx, wInput({ password: 'admin123', caseNumber: 'RMA-01' }));
    const copy = records.createWarranty(ctx, wInput({ caseNumber: 'RMA-02', password: undefined, copyPasswordFrom: src.id }));
    expect(copy).toMatchObject({ stt: 2, hasPassword: true });
    expect(records.revealWarrantyPassword(ctx, copy.id)).toBe('admin123');
    const own = records.createWarranty(ctx, wInput({ password: 'khac', copyPasswordFrom: src.id }));
    expect(records.revealWarrantyPassword(ctx, own.id)).toBe('khac');
  });

  it('import Warranty: STT theo cột hoặc tự đánh tiếp trong năm', () => {
    records.createWarranty(ctx, wInput());
    const res = bulkImport(ctx, {
      target: 'WARRANTY',
      jobYearId: year,
      rows: [
        { rowNumber: 2, values: { model: 'A' } },
        { rowNumber: 3, values: { stt: 1, model: 'Trùng' } },
        { rowNumber: 4, values: { stt: 7, model: 'B' } },
      ],
    });
    expect(res.created).toBe(2);
    expect(res.skipped[0]).toMatchObject({ rowNumber: 3 });
    expect(records.listWarranty(ctx, year).map((w) => [w.stt, w.model])).toEqual([
      [8, 'A'],
      [7, 'B'],
      [1, 'M3007'],
    ]);
  });
});

describe('Thư mục dự án không bắt buộc: tạo mới / liên kết thư mục có sẵn / đặt sau', () => {
  const picker = () => {
    let next: string | null = null;
    const desktop = { pickDirectory: async () => next } as unknown as Desktop;
    return { desktop, set: (d: string) => (next = d) };
  };

  it('tạo dự án liên kết thư mục có sẵn: không tạo/đổi tên thư mục khi sửa; phải chọn qua hộp thoại', async () => {
    const own = path.join(tmpDir(), 'Thu muc rieng cua toi');
    fs.mkdirSync(own);
    const pk = picker();
    const h = createHandlers(ctx, pk.desktop);
    expect(() => h.createProject(input({ projectName: 'X', folderLink: own }))).toThrow(/chọn lại thư mục có sẵn/);
    pk.set(own);
    await h.pickFolder('x');
    const p = await h.createProject(input({ projectName: 'Có thư mục riêng', folderLink: own }));
    expect(p).toMatchObject({ folderPath: own, folderAuto: false });
    const upd = projects.updateProject(ctx, p.id, input({ projectName: 'Đổi tên dự án', stt: p.stt }));
    expect(upd.folderPath).toBe(own);
    expect(fs.existsSync(own)).toBe(true);
    expect(() => projects.syncProjectFolder(ctx, p.id)).toThrow(/thư mục có sẵn/);
  });

  it('không chọn thư mục thì vẫn tạo được; đặt sau bằng liên kết, bỏ liên kết không xóa thư mục', async () => {
    const p = projects.createProject(ctx, input({ projectName: 'Chưa có thư mục' }));
    expect(p.folderPath).toBeNull();
    const dir = tmpDir('ppm-link-');
    const pk = picker();
    pk.set(dir);
    const h = createHandlers(ctx, pk.desktop);
    expect(() => h.setProjectFolderLink(p.id, dir)).toThrow(/chọn lại/);
    await h.pickFolder('x');
    expect(await h.setProjectFolderLink(p.id, dir)).toMatchObject({ folderPath: dir, folderAuto: false });
    expect(await h.setProjectFolderLink(p.id, null)).toMatchObject({ folderPath: null, folderAuto: true });
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('Xuất xlsx: ghi chú theo ngày trong tháng', () => {
  it('chỉ lấy ghi chú trong khoảng ngày, chữ thuần', () => {
    const a = projects.createProject(ctx, input({ projectName: 'A' }));
    notes.saveProjectNote(ctx, a.id, { noteDate: '2026-10-31', html: '<div>tháng trước</div>' });
    notes.saveProjectNote(ctx, a.id, { noteDate: '2026-11-03', html: '<div><b>Khảo sát</b></div><div>Gửi BOQ</div>' });
    notes.saveProjectNote(ctx, a.id, { noteDate: '2026-11-12', html: '<div>Chốt giá</div>' });
    expect(notes.listProjectNotesInRange(ctx, '2026-11-01', '2026-11-30')).toEqual([
      { projectId: a.id, noteDate: '2026-11-03', text: 'Khảo sát\nGửi BOQ' },
      { projectId: a.id, noteDate: '2026-11-12', text: 'Chốt giá' },
    ]);
    expect(() => notes.listProjectNotesInRange(ctx, 'x', '2026-11-30')).toThrow(/không hợp lệ/);
  });

  it('ô nhiều dòng được bật Wrap text, ô ngày vẫn dạng mm/dd/yyyy', () => {
    const out = path.join(tmpDir(), 'thang.xlsx');
    writeXlsx(out, 'T11', [['Tên', 'Ngày', 'Ghi chú'], ['A', '2026-11-05', '• Ngày 05/11/2026\n    - dòng 1'], ['B', null, 'một dòng']], [1], [2]);
    const buf = fs.readFileSync(out);
    const ws = XLSX.read(buf).Sheets.T11;
    expect(ws.C2.v).toBe('• Ngày 05/11/2026\n    - dòng 1');
    expect(ws.B2.w).toBe('11/05/2026');
    const zip = XLSX.CFB.read(buf, { type: 'buffer' });
    const text = (n: string) => Buffer.from(zip.FileIndex[zip.FullPaths.findIndex((p: string) => p.endsWith(n))].content as Uint8Array).toString();
    const xfs = /<cellXfs count="(\d+)">/.exec(text('xl/styles.xml'))!;
    expect(text('xl/styles.xml')).toContain('wrapText="1"');
    expect(text('xl/worksheets/sheet1.xml')).toMatch(new RegExp(`<c r="C2"[^>]* s="${Number(xfs[1]) - 1}"`));
    expect(text('xl/worksheets/sheet1.xml')).not.toMatch(/<c r="C3"[^>]* s=/);
  });
});
