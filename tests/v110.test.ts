import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import { globalSearch } from '../src/main/services/search';
import type { ImportPayload, ProjectInput } from '../src/shared/types';
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
  filePath: null,
  fileName: null,
  fileExtension: null,
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

describe('Nâng cấp v1.9 → v1.10', () => {
  it('bảng import cũ giữ nguyên, sau đó thêm được bảng thứ hai', async () => {
    const file = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 9));
    const c1 = { ...ctx, db: old };
    const y = master.listYears(c1).find((x) => x.jobType === 'MAIN')!.id;
    const p = projects.createProject(c1, input({ jobYearId: y }));
    projects.commitImport(c1, p.id, payload('BOQ-v1.xlsx', ['P1375', 'M3086']));
    old.close();
    const db = await Db.open(file);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    const c2 = { ...ctx, db };
    expect(projects.listProjectImports(c2, p.id).map((i) => [i.sourceFileName, i.items.length])).toEqual([['BOQ-v1.xlsx', 2]]);
    projects.commitImport(c2, p.id, payload('BOQ-v2.xlsx', ['Q6135']));
    expect(projects.listProjectImports(c2, p.id).map((i) => i.sourceFileName)).toEqual(['BOQ-v2.xlsx', 'BOQ-v1.xlsx']);
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
  });
});

describe('Nhiều bảng import thiết bị trong một dự án', () => {
  it('Import thêm giữ bảng cũ; Import lại chỉ thay đúng bảng đó; Gỡ một bảng', () => {
    const p = projects.createProject(ctx, input());
    const a = projects.commitImport(ctx, p.id, payload('BOQ-01.xlsx', ['P1375']));
    const b = projects.commitImport(ctx, p.id, payload('BOQ-02.xlsx', ['M3086', 'Q6135']));
    expect(projects.listProjectImports(ctx, p.id).map((i) => [i.id, i.items.length])).toEqual([
      [b.id, 2],
      [a.id, 1],
    ]);
    expect(projects.getProject(ctx, p.id).hasImport).toBe(true);

    const a2 = projects.commitImport(ctx, p.id, payload('BOQ-01-sua.xlsx', ['P1375', 'P1377']), a.id);
    const list = projects.listProjectImports(ctx, p.id);
    expect(list.map((i) => i.sourceFileName).sort()).toEqual(['BOQ-01-sua.xlsx', 'BOQ-02.xlsx']);
    expect(list.find((i) => i.id === a2.id)!.items.map((i) => i.model)).toEqual(['P1375', 'P1377']);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM imported_items')).toBe(4);

    // Tìm theo Model ra dự án dù thiết bị nằm ở bảng nào.
    expect(globalSearch(ctx, { mode: 'model', text: 'q6135' }).some((h) => h.id === p.id)).toBe(true);

    projects.removeImport(ctx, p.id, b.id);
    expect(projects.listProjectImports(ctx, p.id).map((i) => i.sourceFileName)).toEqual(['BOQ-01-sua.xlsx']);
    expect(() => projects.removeImport(ctx, p.id, b.id)).toThrow(/Không tìm thấy bảng import/);
    const other = projects.createProject(ctx, input({ projectName: 'Khác' }));
    expect(() => projects.commitImport(ctx, other.id, payload('x.xlsx', ['X']), a2.id)).toThrow(/Không tìm thấy bảng import/);
    projects.removeImport(ctx, p.id, a2.id);
    expect(projects.getProject(ctx, p.id).hasImport).toBe(false);
  });

  it('xóa dự án xóa luôn mọi bảng import', () => {
    const p = projects.createProject(ctx, input());
    projects.commitImport(ctx, p.id, payload('a.xlsx', ['A']));
    projects.commitImport(ctx, p.id, payload('b.xlsx', ['B']));
    projects.deleteProject(ctx, p.id);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM project_imports')).toBe(0);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM imported_items')).toBe(0);
  });
});
