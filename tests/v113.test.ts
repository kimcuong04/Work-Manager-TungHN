import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import type { ImportPayload, ProjectInput } from '../src/shared/types';
import { defaultImportTabName, uniqueImportTabName, validateImportTabName } from '../src/shared/validation';
import { makeCtx, tmpDir } from './helpers';

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
const payload = (file: string, models: string[] = ['P1375']): ImportPayload => ({
  sourceFileName: file,
  sourcePath: `C:\\BOQ\\${file}`,
  sheetNames: ['Equipment'],
  workbookSignature: '',
  info: [],
  requirements: [],
  items: models.map((m) => ({ model: m, brand: 'Axis', description: '' })),
  mappings: [],
});
const tabs = (projectId: string) => projects.listProjectImports(ctx, projectId).map((i) => i.name);

describe('Nâng cấp v1.12 → v1.13', () => {
  it('bảng import cũ có tên tab theo tên file (trùng thì thêm số), xếp theo ngày import, cũ nhất bên trái', async () => {
    const f = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(f, MIGRATIONS.slice(0, 12));
    const y = master.listYears({ ...ctx, db: old }).find((x) => x.jobType === 'MAIN')!.id;
    old.tx(() => {
      for (const [id, name] of [
        ['p1', 'Có 3 bảng'],
        ['p2', 'Có 1 bảng'],
      ])
        old.run('INSERT INTO projects (id, stt, job_year_id, work_category, project_name, note, priority_point, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [
          id, id === 'p1' ? 1 : 2, y, 'PRE_SALES', name, '', 3, 't', 't',
        ]);
      const imp = (id: string, pid: string, file: string, at: string) =>
        old.run('INSERT INTO project_imports VALUES (?,?,?,?,?,?,?)', [id, pid, file, null, '["Equipment"]', at, 'IMPORTED']);
      imp('i-new', 'p1', 'BOQ.xlsx', '2026-11-10T00:00:00.000Z');
      imp('i-old', 'p1', 'BOQ.xlsx', '2026-11-01T00:00:00.000Z');
      imp('i-mid', 'p1', 'Camera tầng 1.XLSX', '2026-11-05T00:00:00.000Z');
      imp('i-p2', 'p2', 'BOQ.xlsx', '2026-11-02T00:00:00.000Z');
      old.run("INSERT INTO imported_items VALUES ('it1', 'i-mid', 'M3086', 'Axis', '', 0)");
    });
    old.close();
    const db = await Db.open(f);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    const c2 = { ...ctx, db };
    expect(projects.listProjectImports(c2, 'p1').map((i) => [i.id, i.name, i.sortOrder])).toEqual([
      ['i-old', 'BOQ', 0],
      ['i-mid', 'Camera tầng 1', 1],
      ['i-new', 'BOQ (2)', 2],
    ]);
    expect(projects.listProjectImports(c2, 'p1')[1].items.map((i) => i.model)).toEqual(['M3086']);
    expect(projects.listProjectImports(c2, 'p2').map((i) => i.name)).toEqual(['BOQ']);
  });
});

describe('Tên tab bảng import', () => {
  it('mặc định là tên file bỏ đuôi; trùng thì thêm (2), (3)… như Excel', () => {
    expect([defaultImportTabName('BOQ thiết bị.xlsx'), defaultImportTabName('a.b.xlsx'), defaultImportTabName('.xlsx'), defaultImportTabName('  ')]).toEqual([
      'BOQ thiết bị',
      'a.b',
      'Bảng',
      'Bảng',
    ]);
    expect(uniqueImportTabName('BOQ', ['boq', 'BOQ (2)'])).toBe('BOQ (3)');
    const long = 'x'.repeat(60);
    expect(uniqueImportTabName(long, [long])).toBe(`${'x'.repeat(56)} (2)`);
    expect(validateImportTabName('  ', [])).toMatch(/không được để trống/);
    expect(validateImportTabName('y'.repeat(61), [])).toMatch(/60 ký tự/);
    expect(validateImportTabName('Tầng 1', ['tầng 1'])).toMatch(/Đã có bảng tên/);
    expect(validateImportTabName('Tầng 1', ['Tầng 2'])).toBeNull();
  });
});

describe('Tab sheet: thêm / đổi tên / đổi thứ tự / import lại', () => {
  it('import thêm nối tab vào cuối, tên không trùng', () => {
    const p = projects.createProject(ctx, input());
    projects.commitImport(ctx, p.id, payload('BOQ.xlsx'));
    projects.commitImport(ctx, p.id, payload('Tủ rack.xlsx'));
    projects.commitImport(ctx, p.id, payload('boq.xlsx'));
    expect(tabs(p.id)).toEqual(['BOQ', 'Tủ rack', 'boq (2)']);
    expect(projects.listProjectImports(ctx, p.id).map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it('đổi tên: chuẩn hóa khoảng trắng, chặn trống / trùng / dự án khác', () => {
    const p = projects.createProject(ctx, input());
    const a = projects.commitImport(ctx, p.id, payload('A.xlsx'));
    const b = projects.commitImport(ctx, p.id, payload('B.xlsx'));
    expect(projects.renameImport(ctx, p.id, a.id, '  Camera   tầng 1 ').name).toBe('Camera tầng 1');
    expect(projects.renameImport(ctx, p.id, a.id, 'CAMERA TẦNG 1').name).toBe('CAMERA TẦNG 1');
    expect(() => projects.renameImport(ctx, p.id, b.id, 'camera tầng 1')).toThrow(/Đã có bảng tên/);
    expect(() => projects.renameImport(ctx, p.id, b.id, '')).toThrow(/không được để trống/);
    const other = projects.createProject(ctx, input({ projectName: 'Khác' }));
    expect(() => projects.renameImport(ctx, other.id, b.id, 'X')).toThrow(/Không tìm thấy bảng import/);
    projects.commitImport(ctx, other.id, payload('A.xlsx'));
    expect(tabs(other.id)).toEqual(['A']);
    expect(tabs(p.id)).toEqual(['CAMERA TẦNG 1', 'B']);
  });

  it('đổi thứ tự: phải gửi đủ các bảng, mỗi bảng một lần', () => {
    const p = projects.createProject(ctx, input());
    const [a, b, c] = ['A', 'B', 'C'].map((n) => projects.commitImport(ctx, p.id, payload(`${n}.xlsx`)));
    expect(projects.reorderImports(ctx, p.id, [c.id, a.id, b.id]).map((i) => i.name)).toEqual(['C', 'A', 'B']);
    expect(tabs(p.id)).toEqual(['C', 'A', 'B']);
    expect(() => projects.reorderImports(ctx, p.id, [a.id, b.id])).toThrow(/đã thay đổi/);
    expect(() => projects.reorderImports(ctx, p.id, [a.id, a.id, b.id])).toThrow(/đã thay đổi/);
    const other = projects.createProject(ctx, input({ projectName: 'Khác' }));
    const x = projects.commitImport(ctx, other.id, payload('X.xlsx'));
    expect(() => projects.reorderImports(ctx, p.id, [a.id, b.id, x.id])).toThrow(/đã thay đổi/);
    projects.commitImport(ctx, p.id, payload('D.xlsx'));
    expect(tabs(p.id)).toEqual(['C', 'A', 'B', 'D']);
    projects.removeImport(ctx, p.id, a.id);
    expect(tabs(p.id)).toEqual(['C', 'B', 'D']);
  });

  it('import lại giữ vị trí tab; tên tự đặt theo file mới, tên đã đổi tay thì giữ', () => {
    const p = projects.createProject(ctx, input());
    const a = projects.commitImport(ctx, p.id, payload('BOQ.xlsx'));
    const b = projects.commitImport(ctx, p.id, payload('BOQ.xlsx'));
    const c = projects.commitImport(ctx, p.id, payload('Rack.xlsx'));
    projects.reorderImports(ctx, p.id, [c.id, a.id, b.id]);
    expect(tabs(p.id)).toEqual(['Rack', 'BOQ', 'BOQ (2)']);

    const b2 = projects.commitImport(ctx, p.id, payload('BOQ-sua.xlsx', ['Q6135']), b.id);
    expect(b2.name).toBe('BOQ-sua');
    projects.renameImport(ctx, p.id, c.id, 'Tủ rack phòng server');
    const c2 = projects.commitImport(ctx, p.id, payload('Rack-v2.xlsx'), c.id);
    expect(c2.name).toBe('Tủ rack phòng server');
    const a2 = projects.commitImport(ctx, p.id, payload('BOQ.xlsx', ['P1377']), a.id);
    expect(a2.name).toBe('BOQ');
    expect(projects.listProjectImports(ctx, p.id).map((i) => [i.id, i.name])).toEqual([
      [c2.id, 'Tủ rack phòng server'],
      [a2.id, 'BOQ'],
      [b2.id, 'BOQ-sua'],
    ]);
  });
});
