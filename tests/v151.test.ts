import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { createHandlers, type Desktop } from '../src/main/handlers';
import { importImageBuffer } from '../src/main/integration/images';
import { bulkImport } from '../src/main/services/bulkImport';
import * as freelance from '../src/main/services/freelance';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import { autoBulkConfig, buildBulkRows, BULK_FIELDS, nameSttRatio, splitNameStt } from '../src/shared/bulkImport';
import type { ProjectInput, WorkbookSheet } from '../src/shared/types';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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

const sheet = (rows: (string | number | null)[][]): WorkbookSheet => ({ name: 'S', rows, rowCount: rows.length, colCount: Math.max(...rows.map((r) => r.length)), truncated: false });

function desktopStub() {
  const trashed: string[] = [];
  const desktop = {
    trashItem: async (p: string) => {
      if (p.includes('dang-mo')) throw new Error('EBUSY');
      trashed.push(p);
      fs.rmSync(p, { recursive: true, force: true });
    },
  } as unknown as Desktop;
  return { desktop, trashed };
}

describe('Xóa nhiều mục đã chọn', () => {
  it('xóa nhiều dự án một lần: ghi chú/ảnh/lịch đi theo, id lạ bị bỏ qua', () => {
    const a = projects.createProject(ctx, input({ projectName: 'A', receivedDate: TEST_TODAY }));
    const b = projects.createProject(ctx, input({ projectName: 'B' }));
    const c = projects.createProject(ctx, input({ projectName: 'C' }));
    const img = importImageBuffer(ctx, PNG, 'a.png');
    notes.saveProjectNote(ctx, a.id, { noteDate: TEST_TODAY, html: `<div>x</div><img data-key="${img.storageKey}">` });
    expect(projects.deleteProjects(ctx, [a.id, b.id, 'khong-co'])).toBe(2);
    expect(projects.listProjects(ctx).map((p) => p.projectName)).toEqual(['C']);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM project_notes')).toBe(0);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM calendar_events WHERE project_id IS NOT NULL')).toBe(0);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(false);
    expect(c.id).toBeTruthy();
  });

  it('IPC deleteProjects + "Xóa cả folder local": thư mục vào Thùng rác; thư mục đang mở thì giữ dự án đó lại', async () => {
    const root = tmpDir('ppm-del-');
    const keep = path.join(root, 'dang-mo');
    fs.mkdirSync(keep);
    const a = projects.createProject(ctx, input({ projectName: 'Có thư mục', folderParent: root }));
    const b = projects.createProject(ctx, input({ projectName: 'Không thư mục' }));
    const c = projects.createProject(ctx, input({ projectName: 'Đang mở' }));
    ctx.db.run('UPDATE projects SET folder_path = ? WHERE id = ?', [keep, c.id]);
    const { desktop, trashed } = desktopStub();
    const h = createHandlers(ctx, desktop);
    const res = await h.deleteProjects([a.id, b.id, c.id], { deleteFolder: true });
    expect(res.deleted).toBe(2);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatch(/Đang mở/);
    expect(trashed).toEqual([a.folderPath]);
    expect(projects.listProjects(ctx).map((p) => p.id)).toEqual([c.id]);
    expect(fs.existsSync(keep)).toBe(true);
  });

  it('xóa nhiều Warranty (kèm ảnh) và nhiều job Freelance', async () => {
    const img = importImageBuffer(ctx, PNG, 'w.png');
    const base = { jobYearId: year, brandId: null, ipAddress: '', username: '', macAddress: '', serialNumber: '', receivedDate: null, testedDate: null, customerReport: '', inspection: '', result: '', resolution: '', caseNumber: '' };
    const w1 = records.createWarranty(ctx, { ...base, model: 'M1', images: [img] });
    const w2 = records.createWarranty(ctx, { ...base, model: 'M2', images: [] });
    records.createWarranty(ctx, { ...base, model: 'M3', images: [] });
    const h = createHandlers(ctx, desktopStub().desktop);
    expect(await h.deleteWarranties([w1.id, w2.id])).toBe(2);
    expect(records.listWarranty(ctx, year).map((w) => w.model)).toEqual(['M3']);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(false);

    const j = ['J1', 'J2', 'J3'].map((n) => freelance.createFreelance(ctx, { projectName: n, hirerId: null, startDate: null, statusId: null }, { noteHtml: '<div>n</div>' }));
    expect(await h.deleteFreelances([j[0].id, j[2].id])).toBe(2);
    expect(freelance.listFreelance(ctx).map((x) => x.projectName)).toEqual(['J2']);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_notes')).toBe(1);
  });
});

describe('Import: STT lấy từ số ở đầu Tên dự án', () => {
  it('tách số đầu tên', () => {
    expect(splitNameStt('01. Bristish Center-1154 láng-ventech')).toEqual({ stt: 1, name: 'Bristish Center-1154 láng-ventech' });
    expect(splitNameStt('59. Gtel- V06-Hanwha')).toEqual({ stt: 59, name: 'Gtel- V06-Hanwha' });
    expect(splitNameStt('7) Kho lạnh')).toEqual({ stt: 7, name: 'Kho lạnh' });
    expect(splitNameStt('12 - Nhà máy')).toEqual({ stt: 12, name: 'Nhà máy' });
    expect(splitNameStt('3.5 inch camera')).toBeNull();
    expect(splitNameStt('2026 Dự án mới')).toBeNull();
    expect(splitNameStt('Trường học A')).toBeNull();
    expect(splitNameStt('0. Không hợp lệ')).toBeNull();
  });

  it('file xếp ngược (60 → 1) không có cột STT: STT khớp số trong tên, không bị đảo; số trùng thì tự cấp STT mới', () => {
    const ws = sheet([
      ['Tên dự án', 'Tên SI'],
      ['3. Gtel- V06-Hanwha', 'Gtel'],
      ['2. Infonest- phường xã', 'Infonest'],
      ['2. BIDV- Active lic', 'BIDV'],
      ['1. Bristish Center-1154 láng-ventech', 'Ventech'],
      ['Không có số', 'X'],
    ]);
    const cfg = autoBulkConfig([ws], BULK_FIELDS.PRE_SALES);
    expect(cfg.columns.stt).toBeUndefined();
    expect(nameSttRatio(ws, cfg)).toBe(0.8);
    const rows = buildBulkRows('PRE_SALES', ws, cfg, new Set(), { sttFromName: true });
    expect(rows.map((r) => [r.values.stt, r.values.projectName])).toEqual([
      [3, 'Gtel- V06-Hanwha'],
      [2, 'Infonest- phường xã'],
      [null, 'BIDV- Active lic'],
      [1, 'Bristish Center-1154 láng-ventech'],
      [undefined, 'Không có số'],
    ]);
    expect(rows.every((r) => !r.errors.length)).toBe(true);
    expect(rows[2].warnings.join()).toMatch(/trùng với dòng 3/);

    const res = bulkImport(ctx, { target: 'PRE_SALES', jobYearId: year, rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })) });
    expect(res.created).toBe(5);
    expect(projects.listProjects(ctx).map((p) => `${p.stt}. ${p.projectName}`)).toEqual([
      '1. Bristish Center-1154 láng-ventech',
      '2. Infonest- phường xã',
      '3. Gtel- V06-Hanwha',
      '4. BIDV- Active lic',
      '5. Không có số',
    ]);
  });

  it('tắt tùy chọn thì giữ nguyên tên; số đầu tên đã có trong hệ thống thì cấp STT mới kèm lưu ý', () => {
    projects.createProject(ctx, input({ stt: 1, projectName: 'Có sẵn' }));
    const ws = sheet([['Tên dự án'], ['1. Trùng số'], ['2. Mới']]);
    const cfg = autoBulkConfig([ws], BULK_FIELDS.PRE_SALES);
    expect(buildBulkRows('PRE_SALES', ws, cfg).map((r) => r.values.projectName)).toEqual(['1. Trùng số', '2. Mới']);
    const rows = buildBulkRows('PRE_SALES', ws, cfg, new Set([1]), { sttFromName: true });
    expect(rows.map((r) => [r.values.stt, r.values.projectName, r.warnings.length])).toEqual([
      [null, 'Trùng số', 1],
      [2, 'Mới', 0],
    ]);
  });

  it('Job Freelance cũng lấy STT từ tên; Warranty không áp dụng', () => {
    const ws = sheet([['Tên dự án', 'Bên thuê'], ['12. Logo', 'Chị Hoa'], ['11. Web', 'Anh Tú']]);
    const rows = buildBulkRows('FREELANCE', ws, autoBulkConfig([ws], BULK_FIELDS.FREELANCE), new Set(), { sttFromName: true });
    bulkImport(ctx, { target: 'FREELANCE', rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })) });
    expect(freelance.listFreelance(ctx).map((j) => `${j.stt}. ${j.projectName}`)).toEqual(['11. Web', '12. Logo']);
    const wsW = sheet([['Model', 'Case no'], ['1. M3007', 'RMA']]);
    const w = buildBulkRows('WARRANTY', wsW, autoBulkConfig([wsW], BULK_FIELDS.WARRANTY), new Set(), { sttFromName: true });
    expect(w[0].values.model).toBe('1. M3007');
  });
});
