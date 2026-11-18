import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import * as calendar from '../src/main/services/calendar';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import { noteImageSrc, parseImageScale, sanitizeNoteHtml } from '../src/shared/noteHtml';
import type { ProjectInput } from '../src/shared/types';
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
const file = (p: string) => ({ path: p, name: p.split('\\').pop()!, extension: p.split('.').pop()!.toLowerCase() });

describe('Nâng cấp v1.11 → v1.12', () => {
  it('file liên kết cũ (một file) chuyển sang danh sách file của dự án', async () => {
    const f = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(f, MIGRATIONS.slice(0, 11));
    const c1 = { ...ctx, db: old };
    const y = master.listYears(c1).find((x) => x.jobType === 'MAIN')!.id;
    // Dữ liệu cũ ghi bằng SQL: code mới đọc bảng project_files chưa có ở schema 11.
    old.tx(() => {
      old.run(
        'INSERT INTO projects (id, stt, job_year_id, work_category, project_name, note, file_path, file_name, file_extension, priority_point, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        ['p-file', 1, y, 'PRE_SALES', 'Có file', '', 'C:\\BV\\mat-bang.dwg', 'mat-bang.dwg', 'dwg', 3, 't', 't'],
      );
      old.run('INSERT INTO projects (id, stt, job_year_id, work_category, project_name, note, priority_point, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [
        'p-no-file', 99, y, 'PRE_SALES', 'Không file', '', 3, 't', 't',
      ]);
    });
    const a = { id: 'p-file' };
    old.close();
    const db = await Db.open(f);
    expect(SCHEMA_VERSION).toBe(12);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(12);
    const c2 = { ...ctx, db };
    const got = projects.getProject(c2, a.id);
    expect(got.files).toEqual([{ path: 'C:\\BV\\mat-bang.dwg', name: 'mat-bang.dwg', extension: 'dwg' }]);
    expect([got.filePath, got.fileExtension]).toEqual(['C:\\BV\\mat-bang.dwg', 'dwg']);
    expect(projects.getProject(c2, 'p-no-file').files).toEqual([]);
  });
});

describe('Nhiều file liên kết cho một dự án', () => {
  it('tạo / sửa với nhiều file; bỏ trùng; sai đuôi bị từ chối; file đầu tiên là file chính', () => {
    const p = projects.createProject(ctx, input({ files: [file('C:\\A\\ban-ve.dwg'), file('C:\\A\\bao-gia.xlsx'), file('c:\\a\\BAN-VE.dwg')] }));
    expect(p.files.map((f) => f.name)).toEqual(['ban-ve.dwg', 'bao-gia.xlsx']);
    expect([p.fileName, p.fileExtension]).toEqual(['ban-ve.dwg', 'dwg']);
    expect(() => projects.createProject(ctx, input({ files: [file('C:\\A\\virus.exe')] }))).toThrow(/Chỉ hỗ trợ file/);

    const u = projects.updateProject(ctx, p.id, input({ files: [file('C:\\A\\bao-gia.xlsx'), file('C:\\A\\thuyet-minh.docx'), file('C:\\A\\hop-dong.pdf')] }), { addToCalendar: true });
    expect(u.files.map((f) => f.extension)).toEqual(['xlsx', 'docx', 'pdf']);
    const upd = calendar.listCalendarEvents(ctx, { projectId: p.id }).find((e) => e.kind === 'PROJECT_UPDATE')!;
    expect(upd.note).toMatch(/File liên kết: ban-ve\.dwg, bao-gia\.xlsx → bao-gia\.xlsx, thuyet-minh\.docx, hop-dong\.pdf/);
  });

  it('thêm / thay / gỡ từng file ở trang chi tiết (setProjectFiles); client cũ gửi một file vẫn chạy', () => {
    const p = projects.createProject(ctx, input({ filePath: 'C:\\A\\cu.txt', fileName: 'cu.txt', fileExtension: 'txt' }));
    expect(p.files.map((f) => f.name)).toEqual(['cu.txt']);
    let r = projects.setProjectFiles(ctx, p.id, [...p.files, file('C:\\A\\moi.pdf')]);
    expect(r.files.map((f) => f.name)).toEqual(['cu.txt', 'moi.pdf']);
    r = projects.setProjectFiles(ctx, p.id, [r.files[1]]);
    expect([r.files.length, r.fileName]).toEqual([1, 'moi.pdf']);
    expect(ctx.db.scalar<string>('SELECT file_name FROM projects WHERE id = ?', [p.id])).toBe('moi.pdf');
    r = projects.setProjectFiles(ctx, p.id, []);
    expect([r.files, r.filePath]).toEqual([[], null]);
    expect(() => projects.setProjectFiles(ctx, p.id, Array.from({ length: 51 }, (_, i) => file(`C:\\A\\f${i}.pdf`)))).toThrow(/50/);
    projects.setProjectFiles(ctx, p.id, [file('C:\\A\\x.pdf')]);
    projects.deleteProject(ctx, p.id);
    expect(ctx.db.scalar<number>('SELECT COUNT(*) FROM project_files')).toBe(0);
  });
});

describe('Ảnh trong ghi chú: kích thước và căn lề', () => {
  const key = '0f8fad5b-d9cb-469f-a165-70867728950e.png';
  it('giữ width / data-scale / data-align hợp lệ, bỏ giá trị lạ', () => {
    const html = `<img src="${noteImageSrc(key)}" data-key="${key}" width="480" data-scale="0.25" data-align="center" onerror="x()">`;
    expect(sanitizeNoteHtml(html)).toBe(`<img src="${noteImageSrc(key)}" data-key="${key}" alt="" width="480" data-scale="0.25" data-align="center">`);
    const bad = `<img src="${noteImageSrc(key)}" data-key="${key}" width="100%" data-scale="9.5" data-align="float">`;
    expect(sanitizeNoteHtml(bad)).toBe(`<img src="${noteImageSrc(key)}" data-key="${key}" alt="">`);
  });
  it('tỉ lệ: số thập phân tối đa 2 chữ số, dấu chấm hoặc phẩy, trong [0.05, 5]', () => {
    expect([parseImageScale('1'), parseImageScale('0.5'), parseImageScale('1,25'), parseImageScale(' 2.75 ')]).toEqual([1, 0.5, 1.25, 2.75]);
    expect([parseImageScale('0.125'), parseImageScale('0.01'), parseImageScale('6'), parseImageScale('abc'), parseImageScale('-1')]).toEqual([null, null, null, null, null]);
  });
});
