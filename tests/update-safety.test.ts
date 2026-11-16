import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makePaths } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from '../src/main/db/migrations';
import { rotateStartupBackups } from '../src/main/services/backup';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import { referencedImageKeys } from '../src/main/services/records';
import { getSettings, updateSettings } from '../src/main/services/settings';
import { releaseNotesToText } from '../src/shared/releaseNotes';
import { makeCtx, tmpDir } from './helpers';

async function seededDbFile() {
  const ctx = await makeCtx();
  const year = master.listYears(ctx)[0].id;
  const client = master.createMaster(ctx, 'clients', 'CĐT A');
  projects.createProject(ctx, {
    jobYearId: year, workCategory: 'PRE_SALES', receivedDate: '2026-11-16', dueDate: '2026-11-20', projectName: 'Dự án thật',
    clientId: client.id, salespersonId: null, note: '', filePath: null, fileName: null, fileExtension: null, priorityPoint: 3,
  });
  ctx.db.close();
  return ctx.paths;
}

const NEXT = SCHEMA_VERSION + 1;

describe('Nâng cấp schema khi app tự cập nhật', () => {
  it('sao lưu database trước khi chạy migration mới và giữ nguyên dữ liệu', async () => {
    const paths = await seededDbFile();
    const next: Migration[] = [...MIGRATIONS, { version: NEXT, up: (db) => db.exec('ALTER TABLE projects ADD COLUMN budget INTEGER') }];
    const db = await Db.open(paths.dbFile, next);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(NEXT);
    expect(db.scalar<string>('SELECT project_name FROM projects')).toBe('Dự án thật');
    const backups = fs.readdirSync(paths.backupsDir).filter((f) => f.startsWith(`pre-migrate-v${SCHEMA_VERSION}-to-v${NEXT}-`));
    expect(backups).toHaveLength(1);
    db.close();
  });

  it('migration lỗi: rollback, file gốc không đổi, vẫn có bản sao', async () => {
    const paths = await seededDbFile();
    const before = fs.readFileSync(paths.dbFile);
    const broken: Migration[] = [
      ...MIGRATIONS,
      {
        version: NEXT,
        up: (db) => {
          db.exec('DELETE FROM projects');
          throw new Error('migration hỏng');
        },
      },
    ];
    await expect(Db.open(paths.dbFile, broken)).rejects.toThrow('migration hỏng');
    expect(Buffer.compare(fs.readFileSync(paths.dbFile), before)).toBe(0);
    expect(fs.readdirSync(paths.backupsDir).some((f) => f.startsWith('pre-migrate-'))).toBe(true);
    const reopened = await Db.open(paths.dbFile);
    expect(reopened.scalar<number>('SELECT COUNT(*) FROM projects')).toBe(1);
  });

  it('bản cũ mở dữ liệu của bản mới thì từ chối, không ghi hỏng', async () => {
    const paths = await seededDbFile();
    const next: Migration[] = [...MIGRATIONS, { version: NEXT, up: () => {} }];
    (await Db.open(paths.dbFile, next)).close();
    await expect(Db.open(paths.dbFile)).rejects.toThrow(/phiên bản mới hơn/);
  });
});

describe('Bản sao lưu khi khởi động', () => {
  it('giữ 10 bản mới nhất', async () => {
    const paths = makePaths(tmpDir());
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.dbFile, 'db');
    for (let i = 0; i < 13; i++) {
      rotateStartupBackups(paths);
      await new Promise((r) => setTimeout(r, 2));
    }
    const files = fs.readdirSync(paths.backupsDir).filter((f) => f.startsWith('start-'));
    expect(files).toHaveLength(10);
  });
  it('không làm gì khi chưa có database', () => {
    const paths = makePaths(tmpDir());
    rotateStartupBackups(paths);
    expect(fs.existsSync(paths.backupsDir)).toBe(false);
  });
});

describe('Dọn ảnh mồ côi không xóa nhầm bảng ảnh mới', () => {
  it('tự nhận mọi bảng có cột storage_key', async () => {
    const ctx = await makeCtx();
    ctx.db.exec('CREATE TABLE project_images (id TEXT PRIMARY KEY, storage_key TEXT NOT NULL)');
    ctx.db.run("INSERT INTO project_images VALUES ('1', '11111111-1111-1111-1111-111111111111.png')");
    expect(referencedImageKeys(ctx).has('11111111-1111-1111-1111-111111111111.png')).toBe(true);
  });
});

describe('Cài đặt tự cập nhật', () => {
  it('mặc định bật, tắt được và lưu lại', async () => {
    const ctx = await makeCtx();
    expect(getSettings(ctx).autoUpdate).toBe(true);
    updateSettings(ctx, { autoUpdate: false });
    expect(getSettings(ctx).autoUpdate).toBe(false);
  });
});

describe('Release notes', () => {
  it('chuyển HTML của GitHub sang text an toàn', () => {
    const html = '<ul>\n<li>Sửa lỗi lọc &amp; sắp xếp</li>\n<li>Thêm <strong>Báo cáo</strong></li>\n</ul><script>alert(1)</script>';
    expect(releaseNotesToText(html)).toBe('• Sửa lỗi lọc & sắp xếp\n• Thêm Báo cáo');
    expect(releaseNotesToText('<p>Bản 1.3</p>\n<ul>\n<li>A</li>\n</ul>')).toBe('Bản 1.3\n• A');
    expect(releaseNotesToText([{ version: '1.2.1', note: '<p>A</p>' }])).toBe('A');
    expect(releaseNotesToText(null)).toBe('');
  });
});
