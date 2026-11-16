import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { makePaths, type Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import {
  LOCATION_FILE,
  assertMovable,
  copyDataTo,
  readLocation,
  resolveStartupDataDir,
  resolveTarget,
  setAsideExisting,
  writeLocation,
  type MissingChoice,
} from '../src/main/dataLocation';
import { createHandlers, type Desktop } from '../src/main/handlers';
import { importImageBuffer } from '../src/main/integration/images';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import { fakePlatform, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function seeded(dir = tmpDir('ppm-data-')): Promise<Ctx> {
  const ctx = await makeCtx(dir);
  const year = master.listYears(ctx)[0].id;
  projects.createProject(ctx, {
    jobYearId: year, workCategory: 'PRE_SALES', receivedDate: '2026-11-10', dueDate: '2026-11-30', projectName: 'Dự án thật', clientId: null,
    salespersonId: null, note: '', filePath: null, fileName: null, fileExtension: null, priorityPoint: 3,
  });
  importImageBuffer(ctx, PNG, 'a.png');
  fs.mkdirSync(ctx.paths.backupsDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.paths.backupsDir, 'start-1.sqlite'), 'x');
  return ctx;
}

function desktopFor(ctx: Ctx, configDir: string, over: Partial<Desktop> = {}) {
  const calls = { relaunch: 0, trashed: [] as string[], asked: 0 };
  const desktop = {
    pickFiles: async () => [],
    saveFile: async () => null,
    openPath: async () => '',
    showItemInFolder: () => {},
    openExternal: async () => {},
    readClipboardImage: async () => null,
    writeClipboardImage: async () => true,
    pickDirectory: async () => null,
    trashItem: async (p: string) => {
      calls.trashed.push(path.basename(p));
      fs.rmSync(p, { recursive: true, force: true });
    },
    ask: async () => {
      calls.asked++;
      return 2;
    },
    relaunch: () => {
      calls.relaunch++;
    },
    dataLocation: { configDir, defaultDir: ctx.paths.dataDir },
    updater: { getStatus: () => ({ state: 'disabled', currentVersion: 't' }), check: async () => ({ state: 'disabled', currentVersion: 't' }), install: () => {} },
    ...over,
  } as unknown as Desktop;
  return { desktop, calls };
}

describe('Chọn thư mục đích', () => {
  it('thư mục trống dùng luôn; có file khác thì tạo thư mục con "PPM Data"; đã có dữ liệu PPM thì dùng luôn', () => {
    const empty = tmpDir();
    expect(resolveTarget(empty)).toBe(empty);
    const busy = tmpDir();
    fs.writeFileSync(path.join(busy, 'tai-lieu.docx'), 'x');
    expect(resolveTarget(busy)).toBe(path.join(busy, 'PPM Data'));
    const ppm = tmpDir();
    fs.writeFileSync(path.join(ppm, 'ppm.sqlite'), 'x');
    expect(resolveTarget(ppm)).toBe(ppm);
  });

  it('không cho chọn chính nó hoặc thư mục bên trong thư mục dữ liệu', () => {
    const cur = tmpDir();
    expect(() => assertMovable(cur, cur)).toThrow(/đúng thư mục này/);
    expect(() => assertMovable(cur, path.join(cur, 'images'))).toThrow(/bên trong/);
    expect(() => assertMovable(cur, path.join(tmpDir(), 'moi'))).not.toThrow();
  });
});

describe('Chép dữ liệu sang thư mục mới', () => {
  it('chép đủ database, ảnh, backup; mở ở chỗ mới thấy đúng dữ liệu; thư mục cũ giữ nguyên', async () => {
    const ctx = await seeded();
    const target = path.join(tmpDir(), 'D-drive', 'PPM');
    await copyDataTo(ctx.db, ctx.paths.dataDir, target);
    for (const e of ['ppm.sqlite', 'images', 'thumbs', 'backups']) expect(fs.existsSync(path.join(target, e))).toBe(true);
    expect(fs.existsSync(path.join(ctx.paths.dataDir, 'ppm.sqlite'))).toBe(true);
    const moved: Ctx = { db: await Db.open(path.join(target, 'ppm.sqlite')), paths: makePaths(target), platform: fakePlatform, appVersion: 't' };
    expect(projects.listProjects(moved).map((p) => p.projectName)).toEqual(['Dự án thật']);
    expect(fs.readdirSync(path.join(target, 'images'))).toHaveLength(1);
  });

  it('thư mục đích đã có dữ liệu PPM thì chuyển dữ liệu đó vào thư mục con "PPM cu …", không xóa', () => {
    const t = tmpDir();
    fs.writeFileSync(path.join(t, 'ppm.sqlite'), 'cu');
    fs.mkdirSync(path.join(t, 'images'));
    const aside = setAsideExisting(t)!;
    expect(path.basename(aside)).toMatch(/^PPM cu \d{8}-\d{6}$/);
    expect(fs.readFileSync(path.join(aside, 'ppm.sqlite'), 'utf8')).toBe('cu');
    expect(fs.existsSync(path.join(t, 'ppm.sqlite'))).toBe(false);
  });
});

describe('Đổi thư mục dữ liệu qua Settings', () => {
  it('chép → ghi vị trí mới (nhớ vị trí cũ) → khởi động lại; lần mở sau thấy bản cũ và dọn được vào Thùng rác', async () => {
    const ctx = await seeded();
    const configDir = tmpDir('ppm-config-');
    const target = path.join(tmpDir(), 'PPM');
    const { desktop, calls } = desktopFor(ctx, configDir, { pickDirectory: async () => target });
    vi.useFakeTimers();
    try {
      const res = await createHandlers(ctx, desktop).changeDataDir('pick');
      expect(res).toEqual({ dataDir: target });
      vi.advanceTimersByTime(1000);
      expect(calls.relaunch).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(readLocation(configDir)).toMatchObject({ dataDir: target, previousDataDir: ctx.paths.dataDir });

    // Lần mở sau: app chạy trên thư mục mới.
    const after: Ctx = { db: await Db.open(path.join(target, 'ppm.sqlite')), paths: makePaths(target), platform: fakePlatform, appVersion: 't' };
    const h2 = createHandlers(after, desktopFor(after, configDir, { dataLocation: { configDir, defaultDir: ctx.paths.dataDir } }).desktop);
    const info = await h2.getDataLocation();
    expect(info).toMatchObject({ dataDir: target, isDefault: false, previousDir: ctx.paths.dataDir });
    expect(info.sizeBytes).toBeGreaterThan(0);
    const d2 = desktopFor(after, configDir, { dataLocation: { configDir, defaultDir: ctx.paths.dataDir } });
    await createHandlers(after, d2.desktop).trashPreviousData();
    expect(d2.calls.trashed.sort()).toEqual(['backups', 'images', 'ppm.sqlite', 'thumbs'].sort());
    expect(readLocation(configDir)).toMatchObject({ dataDir: target, previousDataDir: null });
    expect((await createHandlers(after, d2.desktop).getDataLocation()).previousDir).toBeNull();
  });

  it('thư mục đích đã có dữ liệu: hỏi Dùng có sẵn / Thay thế / Hủy', async () => {
    const ctx = await seeded();
    const configDir = tmpDir('ppm-config-');
    const other = await seeded();
    other.db.close();
    const use = desktopFor(ctx, configDir, { pickDirectory: async () => other.paths.dataDir, ask: async () => 0 });
    expect(await createHandlers(ctx, use.desktop).changeDataDir('pick')).toEqual({ dataDir: other.paths.dataDir });
    expect(fs.readdirSync(other.paths.dataDir).some((f) => f.startsWith('PPM cu'))).toBe(false);

    const cancel = desktopFor(ctx, configDir, { pickDirectory: async () => other.paths.dataDir, ask: async () => 2 });
    expect(await createHandlers(ctx, cancel.desktop).changeDataDir('pick')).toBeNull();

    const replace = desktopFor(ctx, configDir, { pickDirectory: async () => other.paths.dataDir, ask: async () => 1 });
    await createHandlers(ctx, replace.desktop).changeDataDir('pick');
    expect(fs.readdirSync(other.paths.dataDir).some((f) => f.startsWith('PPM cu'))).toBe(true);
  });

  it('hủy chọn thư mục thì không làm gì', async () => {
    const ctx = await seeded();
    const configDir = tmpDir('ppm-config-');
    expect(await createHandlers(ctx, desktopFor(ctx, configDir).desktop).changeDataDir('pick')).toBeNull();
    expect(fs.existsSync(path.join(configDir, LOCATION_FILE))).toBe(false);
  });
});

describe('Khởi động khi không thấy thư mục dữ liệu (ổ chưa cắm…)', () => {
  const run = (configDir: string, defaultDir: string, answers: MissingChoice[], picks: (string | null)[] = []) => {
    const asked: string[] = [];
    const notified: string[] = [];
    return {
      asked,
      notified,
      result: resolveStartupDataDir({
        configDir,
        defaultDir,
        askMissing: async (d) => {
          asked.push(d);
          return answers.shift() ?? 'quit';
        },
        pickDir: async () => picks.shift() ?? null,
        notifyNotData: async (d) => {
          notified.push(d);
        },
      }),
    };
  };

  it('chưa đổi vị trí → thư mục mặc định, không hỏi gì', async () => {
    const r = run(tmpDir(), 'C:\\mac-dinh', []);
    expect(await r.result).toBe('C:\\mac-dinh');
    expect(r.asked).toEqual([]);
  });

  it('thấy dữ liệu ở vị trí đã đổi → dùng luôn', async () => {
    const configDir = tmpDir();
    const d = tmpDir();
    fs.writeFileSync(path.join(d, 'ppm.sqlite'), 'x');
    writeLocation(configDir, { dataDir: d });
    expect(await run(configDir, 'C:\\mac-dinh', []).result).toBe(d);
  });

  it('không thấy → Thử lại (sau khi cắm ổ) thì mở được; không tự tạo dữ liệu trống', async () => {
    const configDir = tmpDir();
    const d = path.join(tmpDir(), 'o-ngoai');
    writeLocation(configDir, { dataDir: d });
    let asks = 0;
    const result = await resolveStartupDataDir({
      configDir,
      defaultDir: 'C:\mac-dinh',
      askMissing: async () => {
        asks++;
        expect(fs.existsSync(d)).toBe(false);
        // Người dùng cắm ổ rồi bấm Thử lại.
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'ppm.sqlite'), 'x');
        return 'retry';
      },
      pickDir: async () => null,
      notifyNotData: async () => {},
    });
    expect(result).toBe(d);
    expect(asks).toBe(1);
  });

  it('chọn thư mục khác: thư mục không có dữ liệu thì báo và hỏi lại; chọn đúng thì ghi nhớ', async () => {
    const configDir = tmpDir();
    writeLocation(configDir, { dataDir: path.join(tmpDir(), 'mat') });
    const wrong = tmpDir();
    const right = tmpDir();
    fs.writeFileSync(path.join(right, 'ppm.sqlite'), 'x');
    const r = run(configDir, 'C:\\mac-dinh', ['pick', 'pick'], [wrong, right]);
    expect(await r.result).toBe(right);
    expect(r.notified).toEqual([wrong]);
    expect(readLocation(configDir)!.dataDir).toBe(right);
  });

  it('Dùng thư mục mặc định → ghi lại vị trí mặc định; Thoát → null', async () => {
    const configDir = tmpDir();
    writeLocation(configDir, { dataDir: path.join(tmpDir(), 'mat') });
    expect(await run(configDir, 'C:\\mac-dinh', ['default']).result).toBe('C:\\mac-dinh');
    expect(readLocation(configDir)!.dataDir).toBe('C:\\mac-dinh');
    writeLocation(configDir, { dataDir: path.join(tmpDir(), 'mat') });
    expect(await run(configDir, 'C:\\mac-dinh', ['quit']).result).toBeNull();
  });

  it('file vị trí hỏng thì bỏ qua, dùng mặc định', async () => {
    const configDir = tmpDir();
    fs.writeFileSync(path.join(configDir, LOCATION_FILE), '{hỏng');
    expect(readLocation(configDir)).toBeNull();
    expect(await run(configDir, 'C:\\mac-dinh', []).result).toBe('C:\\mac-dinh');
  });
});
