import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { createHandlers, type Desktop } from '../src/main/handlers';
import * as calendar from '../src/main/services/calendar';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import { globalSearch } from '../src/main/services/search';
import { getSettings } from '../src/main/services/settings';
import { projectFolderName } from '../src/shared/folderName';
import type { ProjectInput } from '../src/shared/types';
import { resolveWebLink } from '../src/shared/webLink';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let ctx: Ctx;
let year: string;

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    jobYearId: year,
    workCategory: 'PRE_SALES',
    receivedDate: '2026-11-10',
    dueDate: '2026-11-30',
    projectName: 'Nhà máy A',
    clientId: null,
    siId: null,
    brandIds: [],
    salespersonId: null,
    note: '',
    filePath: null,
    fileName: null,
    fileExtension: null,
    priorityPoint: 3,
    ...over,
  };
}

function fakeDesktop(over: Partial<Desktop> = {}) {
  const calls: { trashed: string[]; shown: string[]; opened: string[] } = { trashed: [], shown: [], opened: [] };
  const desktop = {
    pickFiles: async () => [],
    saveFile: async () => null,
    openPath: async (p: string) => {
      calls.opened.push(p);
      return '';
    },
    showItemInFolder: (p: string) => calls.shown.push(p),
    openExternal: async () => {},
    readClipboardImage: async () => null,
    writeClipboardImage: async () => true,
    pickDirectory: async () => null,
    trashItem: async (p: string) => {
      calls.trashed.push(p);
      fs.rmSync(p, { recursive: true, force: true });
    },
    updater: { getStatus: () => ({ state: 'disabled', currentVersion: 'test' }), check: async () => ({ state: 'disabled', currentVersion: 'test' }), install: () => {} },
    ...over,
  } as unknown as Desktop;
  return { desktop, calls };
}

beforeEach(async () => {
  ctx = await makeCtx();
  year = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
});

describe('Nâng cấp dữ liệu v1.3 → v1.4 (tạo lại bảng projects)', () => {
  it('giữ nguyên dự án và toàn bộ dữ liệu con; STT đánh theo thứ tự tạo; EU/ngày thành không bắt buộc', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 3));
    const y = old.scalar<string>("SELECT id FROM job_years WHERE job_type = 'MAIN'");
    old.tx(() => {
      old.run("INSERT INTO clients VALUES ('c1','CĐT cũ',0,1,'t','t')");
      for (const [id, name, created] of [
        ['p2', 'Dự án sau', '2026-10-02T00:00:00Z'],
        ['p1', 'Dự án trước', '2026-10-01T00:00:00Z'],
      ])
        old.run(
          `INSERT INTO projects (id, job_year_id, work_category, received_date, due_date, project_name, client_id, priority_point, note, created_at, updated_at)
           VALUES (?, ?, 'PRE_SALES', '2026-10-01', '2026-12-01', ?, 'c1', 2, '', ?, ?)`,
          [id, y, name, created, created],
        );
      old.run("INSERT INTO project_notes VALUES ('n1','p1','2026-10-05','<div>Ghi chú</div>','Ghi chú','t','t')");
      old.run("INSERT INTO calendar_events VALUES ('e1','2026-10-01',NULL,NULL,'Dự án trước','','',  'PROJECT_START','p1','Dự án trước','t','t')");
      old.run("INSERT INTO project_imports VALUES ('i1','p2','a.xlsx',NULL,'[]','t','IMPORTED')");
      old.run("INSERT INTO imported_items VALUES ('it1','i1','DS-2CD','Hik','Camera',0)");
    });
    old.close();

    const db = await Db.open(file);
    const c = { ...ctx, db };
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(db.scalar<number>('PRAGMA foreign_keys')).toBe(1);
    const list = projects.listProjects(c);
    expect(list.map((p) => [p.stt, p.projectName, p.clientName])).toEqual([
      [1, 'Dự án trước', 'CĐT cũ'],
      [2, 'Dự án sau', 'CĐT cũ'],
    ]);
    expect(notes.listProjectNotes(c, 'p1')).toHaveLength(1);
    expect(calendar.listCalendarEvents(c, { projectId: 'p1' })).toHaveLength(1);
    expect(projects.getProjectImport(c, 'p2')!.items[0].model).toBe('DS-2CD');
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
    // Xóa dự án sau khi nâng cấp vẫn xóa dây chuyền đúng (khóa ngoại của bảng con còn trỏ đúng bảng mới).
    projects.deleteProject(c, 'p1');
    expect(db.scalar<number>('SELECT COUNT(*) FROM project_notes')).toBe(0);
    expect(projects.createProject(c, input({ jobYearId: y, projectName: 'Mới', clientId: null, receivedDate: null, dueDate: null })).stt).toBe(3);
  });
});

describe('STT và các trường không bắt buộc', () => {
  it('STT tự +1 từ STT lớn nhất; trùng STT bị chặn; chỉ cần STT + tên', () => {
    expect(projects.nextProjectStt(ctx, year, 'PRE_SALES')).toBe(1);
    const a = projects.createProject(ctx, input());
    const b = projects.createProject(ctx, input({ stt: 10, projectName: 'B' }));
    expect([a.stt, b.stt]).toEqual([1, 10]);
    expect(projects.nextProjectStt(ctx, year, 'PRE_SALES')).toBe(11);
    expect(() => projects.createProject(ctx, input({ stt: 10 }))).toThrow(/STT 10 đã được dùng/);
    expect(() => projects.createProject(ctx, input({ stt: null }))).toThrow(/Bắt buộc nhập STT/);
    const bare = projects.createProject(ctx, input({ projectName: 'Chỉ có tên', receivedDate: null, dueDate: null }));
    expect(bare).toMatchObject({ stt: 11, clientId: null, receivedDate: null, dueDate: null, isCompleted: false });
    expect(calendar.listCalendarEvents(ctx, { projectId: bare.id })).toHaveLength(0);
    projects.updateProject(ctx, bare.id, input({ projectName: 'Chỉ có tên', receivedDate: '2026-11-12', dueDate: null }));
    expect(calendar.listCalendarEvents(ctx, { projectId: bare.id })[0]).toMatchObject({ kind: 'PROJECT_START', eventDate: '2026-11-12' });
  });

  it('nhiều Hãng, Tên SI, Sale "Tên/Phòng ban"', () => {
    const axis = master.createMaster(ctx, 'brands', 'Axis');
    const hik = master.createMaster(ctx, 'brands', 'Hikvision');
    const si = master.createMaster(ctx, 'siPartners', 'SI Alpha');
    const dept = master.createMaster(ctx, 'departments', 'Kinh doanh 1');
    const sale = master.createMaster(ctx, 'salespersons', 'Chị Lan');
    master.setSalespersonDepartment(ctx, sale.id, dept.id);
    const p = projects.createProject(ctx, input({ brandIds: [hik.id, axis.id], siId: si.id, salespersonId: sale.id }));
    expect(p.brands.map((b) => b.name)).toEqual(['Hikvision', 'Axis']);
    expect(p).toMatchObject({ siName: 'SI Alpha', salespersonName: 'Chị Lan', salespersonDepartment: 'Kinh doanh 1' });
    expect(master.listMaster(ctx, 'salespersons')[0]).toMatchObject({ departmentName: 'Kinh doanh 1' });
    expect(master.listMaster(ctx, 'brands').find((b) => b.id === axis.id)!.usageCount).toBe(1);
    expect(() => master.deleteMaster(ctx, 'brands', axis.id, null)).toThrow(/Deactivate/);
    master.deleteMaster(ctx, 'departments', dept.id, { unlink: true });
    expect(projects.getProject(ctx, p.id).salespersonDepartment).toBeNull();
    master.deleteMaster(ctx, 'siPartners', si.id, { unlink: true });
    expect(projects.getProject(ctx, p.id).siId).toBeNull();
  });

  it('Warranty có Tên SI dùng chung danh mục', () => {
    const si = master.createMaster(ctx, 'siPartners', 'SI Beta');
    const base = { jobYearId: year, model: 'M1', brandId: null, ipAddress: '', username: '', password: '', macAddress: '', serialNumber: 'SN-1', receivedDate: null, testedDate: null, customerReport: '', inspection: '', result: '', resolution: '', caseNumber: '', images: [] };
    const w = records.createWarranty(ctx, { ...base, siId: si.id });
    expect(w.siName).toBe('SI Beta');
    expect(records.updateWarranty(ctx, w.id, { ...base, siId: null }).siName).toBeNull();
    expect(master.listMaster(ctx, 'siPartners')[0].usageCount).toBe(0);
  });

  it('dự án mới không có ngày tới hạn thì không bị tự hoàn thành', () => {
    expect(projects.createProject(ctx, input({ dueDate: null, receivedDate: '2026-10-01' })).isCompleted).toBe(false);
  });
});

describe('Thư mục dự án trên máy', () => {
  it('tạo thư mục "STT.Tên_SI_Hãng", nhớ nơi lưu, đổi tên theo thông tin mới, giữ nội dung bên trong', () => {
    const root = tmpDir('ppm-root-');
    const si = master.createMaster(ctx, 'siPartners', 'SI Alpha');
    const a = master.createMaster(ctx, 'brands', 'Axis');
    const b = master.createMaster(ctx, 'brands', 'Bosch');
    const p = projects.createProject(ctx, input({ projectName: 'Kho lạnh: B/2', siId: si.id, brandIds: [a.id, b.id], folderParent: root }));
    expect(path.basename(p.folderPath!)).toBe('1.Kho lạnh B 2_SI Alpha_Axis-Bosch');
    expect(fs.statSync(p.folderPath!).isDirectory()).toBe(true);
    expect(getSettings(ctx).projectRootDir).toBe(root);
    fs.writeFileSync(path.join(p.folderPath!, 'bao-gia.txt'), 'x');
    const u = projects.updateProject(ctx, p.id, input({ stt: 7, projectName: 'Kho lạnh B2', siId: si.id, brandIds: [a.id] }));
    expect(path.basename(u.folderPath!)).toBe('7.Kho lạnh B2_SI Alpha_Axis');
    expect(fs.existsSync(path.join(u.folderPath!, 'bao-gia.txt'))).toBe(true);
    expect(fs.existsSync(p.folderPath!)).toBe(false);
  });

  it('thư mục đã có sẵn thì liên kết; dự án cũ chưa có thư mục thì tạo được sau', () => {
    const root = tmpDir('ppm-root-');
    fs.mkdirSync(path.join(root, '1.Nhà máy A'));
    const p = projects.createProject(ctx, input({ folderParent: root }));
    expect(p.notice).toMatch(/Đã có sẵn thư mục/);
    const legacy = projects.createProject(ctx, input({ projectName: 'Cũ' }));
    expect(legacy.folderPath).toBeNull();
    const synced = projects.syncProjectFolder(ctx, legacy.id, root);
    expect(path.basename(synced.folderPath!)).toBe('2.Cũ');
  });

  it.skipIf(process.platform !== 'win32')('thư mục đang mở (file bên trong đang dùng) thì vẫn lưu dự án, giữ tên cũ và cảnh báo', () => {
    const root = tmpDir('ppm-root-');
    const p = projects.createProject(ctx, input({ folderParent: root }));
    const fd = fs.openSync(path.join(p.folderPath!, 'dang-mo.txt'), 'w');
    try {
      const u = projects.updateProject(ctx, p.id, input({ projectName: 'Tên mới' }));
      expect(u.projectName).toBe('Tên mới');
      expect(u.folderPath).toBe(p.folderPath);
      expect(u.notice).toMatch(/chưa đổi được tên thư mục/);
    } finally {
      fs.closeSync(fd);
    }
    const synced = projects.syncProjectFolder(ctx, p.id);
    expect(path.basename(synced.folderPath!)).toBe('1.Tên mới');
  });

  it('lưu thất bại thì hoàn tác đổi tên thư mục', () => {
    const root = tmpDir('ppm-root-');
    const p = projects.createProject(ctx, input({ folderParent: root }));
    projects.createProject(ctx, input({ stt: 5, projectName: 'Khác' }));
    expect(() => projects.updateProject(ctx, p.id, input({ stt: 5 }))).toThrow(/STT 5/);
    expect(fs.existsSync(p.folderPath!)).toBe(true);
  });

  it('handlers: chỉ tạo thư mục ở nơi đã chọn qua hộp thoại; xóa kèm folder → Thùng rác', async () => {
    const root = tmpDir('ppm-root-');
    const { desktop, calls } = fakeDesktop({ pickDirectory: async () => root });
    const h = createHandlers(ctx, desktop);
    await expect(Promise.resolve().then(() => h.createProject(input({ folderParent: tmpDir('ppm-other-') })))).rejects.toThrow(/chọn lại nơi lưu/);
    expect(await h.pickFolder('x')).toBe(root);
    const p = await h.createProject(input({ folderParent: root }));
    expect(fs.existsSync(p.folderPath!)).toBe(true);
    await h.openProjectFolder(p.id);
    expect(calls.opened).toEqual([p.folderPath]);
    await h.deleteProject(p.id, { deleteFolder: true });
    expect(calls.trashed).toEqual([p.folderPath]);
    expect(projects.listProjects(ctx)).toHaveLength(0);
    const q = await h.createProject(input({ projectName: 'Giữ thư mục', folderParent: root }));
    await h.deleteProject(q.id, { deleteFolder: false });
    expect(fs.existsSync(q.folderPath!)).toBe(true);
  });

  it('quy cách tên thư mục bỏ phần trống và ký tự Windows không cho phép', () => {
    expect(projectFolderName({ stt: 3, projectName: 'A*B?', siName: '', brandNames: [] })).toBe('3.A B');
    expect(projectFolderName({ stt: 4, projectName: 'Dự án', siName: 'SI', brandNames: ['X', 'Y'] })).toBe('4.Dự án_SI_X-Y');
  });
});

describe('Tìm kiếm toàn cục', () => {
  it('theo tên dự án / Tên SI / Serial / Hãng / Model, kèm lọc ngày', () => {
    const si = master.createMaster(ctx, 'siPartners', 'Viettel IDC');
    const axis = master.createMaster(ctx, 'brands', 'Axis');
    const p1 = projects.createProject(ctx, input({ projectName: 'Trường học Ngô Quyền', siId: si.id, brandIds: [axis.id], receivedDate: '2026-11-02' }));
    projects.createProject(ctx, input({ projectName: 'Bệnh viện', receivedDate: '2026-09-01', dueDate: '2026-12-01' }));
    projects.commitImport(ctx, p1.id, { sourceFileName: 'a.xlsx', sourcePath: null, sheetNames: [], workbookSignature: '', info: [], requirements: [], items: [{ model: 'P3265-LVE', brand: 'Axis', description: '' }], mappings: [] });
    records.createWarranty(ctx, {
      jobYearId: year, model: 'Q6135', brandId: axis.id, siId: si.id, ipAddress: '', username: '', password: '', macAddress: '', serialNumber: 'ACCC8E99', receivedDate: '2026-11-05',
      testedDate: null, customerReport: '', inspection: '', result: '', resolution: '', caseNumber: 'RMA-9', images: [],
    });
    const kinds = (r: { kind: string; title: string }[]) => r.map((x) => `${x.kind}:${x.title}`);
    expect(kinds(globalSearch(ctx, { mode: 'name', text: 'truong hoc' }))).toEqual(['project:1. Trường học Ngô Quyền']);
    expect(kinds(globalSearch(ctx, { mode: 'si', text: 'viettel' }))).toEqual(['warranty:Q6135 · RMA-9', 'project:1. Trường học Ngô Quyền']);
    expect(globalSearch(ctx, { mode: 'serial', text: 'accc8e99' })[0]).toMatchObject({ kind: 'warranty', matched: 'ACCC8E99' });
    expect(globalSearch(ctx, { mode: 'brand', text: 'axis' })).toHaveLength(2);
    expect(globalSearch(ctx, { mode: 'model', text: 'p3265' })[0]).toMatchObject({ kind: 'project', matched: 'P3265-LVE' });
    expect(globalSearch(ctx, { mode: 'name', text: 'benh vien', from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
    expect(globalSearch(ctx, { mode: 'name', text: 'benh vien', from: '2026-09-01', to: '2026-09-30' })).toHaveLength(1);
  });
});

describe('Link website nhập tự do', () => {
  it('link mở thẳng, tên miền thêm https://, còn lại thì tìm kiếm; không bao giờ mở scheme lạ', () => {
    expect(resolveWebLink('https://axis.com/a?b=1')).toBe('https://axis.com/a?b=1');
    expect(resolveWebLink('axis.com/support')).toBe('https://axis.com/support');
    expect(resolveWebLink('www.hikvision.com')).toBe('https://www.hikvision.com/');
    expect(resolveWebLink('reset camera axis')).toBe('https://www.google.com/search?q=reset%20camera%20axis');
    expect(resolveWebLink('javascript:alert(1)')).toMatch(/^https:\/\/www\.google\.com\/search\?q=javascript/);
    expect(resolveWebLink('file:///C:/x')).toMatch(/^https:\/\/www\.google\.com\/search/);
    expect(resolveWebLink('  ')).toBeNull();
  });

  it('Hyperlink chỉ mở đường dẫn đã lưu; file chạy được chỉ mở thư mục chứa nó', async () => {
    const dir = tmpDir();
    const exe = path.join(dir, 'setup.exe');
    fs.writeFileSync(exe, 'x');
    const brand = master.createMaster(ctx, 'brands', 'Axis');
    records.createExperience(ctx, { brandId: brand.id, experienceDate: '2026-11-01', projectId: null, projectText: null, deviceModel: '', event: 'E', webUrl: 'axis.com', localPath: exe, images: [] });
    const { desktop, calls } = fakeDesktop();
    const h = createHandlers(ctx, desktop);
    await expect(h.openLocalLink(path.join(dir, 'khac.txt'))).rejects.toThrow(/không được liên kết/);
    await h.openLocalLink(exe);
    expect(calls.shown).toEqual([exe]);
    expect(calls.opened).toEqual([]);
  });
});

describe('Xuất xlsx và ảnh kéo thả', () => {
  it('xuất bảng ra file .xlsx đọc lại được', async () => {
    const target = path.join(tmpDir(), 'du-an.xlsx');
    const { desktop } = fakeDesktop({ saveFile: async () => target });
    const h = createHandlers(ctx, desktop);
    const saved = await h.exportXlsx({ defaultName: 'Du an', sheetName: 'Tháng 11', rows: [['STT', 'Tên'], [1, 'Dự án A'], [2, null]] });
    expect(saved).toBe(target);
    const wb = XLSX.read(fs.readFileSync(target));
    expect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })).toEqual([['STT', 'Tên'], [1, 'Dự án A'], [2, '']]);
  });

  it('cột ngày xuất thành ô ngày Excel hiển thị mm/dd/yyyy; ô trống / không phải ngày giữ nguyên', async () => {
    const target = path.join(tmpDir(), 'ngay.xlsx');
    const h = createHandlers(ctx, fakeDesktop({ saveFile: async () => target }).desktop);
    await h.exportXlsx({
      defaultName: 'Ngay',
      sheetName: 'T11',
      rows: [['Tên', 'Ngày bắt đầu', 'Ngày tới hạn'], ['A', '2026-11-16', '2026-02-03'], ['B', null, '2026-12-31'], ['C', 'không rõ', '1999-01-09']],
      dateColumns: [1, 2],
    });
    const ws = XLSX.read(fs.readFileSync(target), { cellNF: true }).Sheets.T11;
    expect(ws.B2).toMatchObject({ t: 'n', w: '11/16/2026' });
    expect(ws.C2.w).toBe('02/03/2026');
    expect(ws.C3.w).toBe('12/31/2026');
    expect(ws.C4.w).toBe('01/09/1999');
    expect(String(ws.B2.z)).toMatch(/^mm.+dd.+yyyy$/);
    expect(ws.B3).toMatchObject({ t: 's', v: '' });
    expect(ws.B4).toMatchObject({ t: 's', v: 'không rõ' });
    expect(XLSX.SSF.parse_date_code(ws.B2.v)).toMatchObject({ y: 2026, m: 11, d: 16 });
  });

  it('ảnh kéo thả từ thư mục được copy vào kho ảnh; file không phải ảnh bị từ chối', async () => {
    const dir = tmpDir();
    const pic = path.join(dir, 'so-do.png');
    fs.writeFileSync(pic, PNG);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const h = createHandlers(ctx, fakeDesktop().desktop);
    const [img] = await h.importDroppedImages([pic, path.join(dir, 'a.txt')]);
    expect(img.fileName).toBe('so-do.png');
    await expect(Promise.resolve().then(() => h.importDroppedImages([path.join(dir, 'a.txt')]))).rejects.toThrow(/Chỉ kéo thả được file ảnh/);
  });
});

describe('Hôm nay cố định trong test', () => {
  it('helper dùng ngày cố định', () => expect(TEST_TODAY).toBe('2026-11-16'));
});
