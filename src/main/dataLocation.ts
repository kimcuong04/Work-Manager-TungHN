import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './context';
import { Db } from './db/database';

/**
 * Thư mục dữ liệu có thể chuyển sang ổ khác. Vị trí được ghi trong `data-location.json` nằm ở thư mục cấu hình
 * của app (userData), KHÔNG nằm trong thư mục dữ liệu — để mở app vẫn biết dữ liệu ở đâu.
 */
export interface DataLocationFile {
  dataDir: string;
  /** Nơi dữ liệu được chép đi: vẫn còn bản cũ ở đó cho tới khi người dùng dọn. */
  previousDataDir?: string | null;
  changedAt?: string;
}

export const LOCATION_FILE = 'data-location.json';
/** Những gì thuộc về dữ liệu của app trong thư mục dữ liệu (không đụng tới file khác của người dùng). */
export const DATA_ENTRIES = ['ppm.sqlite', 'secret.key', 'images', 'thumbs', 'backups', 'logs'];
export const SUBFOLDER = 'PPM Data';

export const samePath = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** true nếu `child` nằm trong `parent` (hoặc trùng). */
export const isInside = (child: string, parent: string) => {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

export function readLocation(configDir: string): DataLocationFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, LOCATION_FILE), 'utf8'));
    return raw && typeof raw.dataDir === 'string' && raw.dataDir ? raw : null;
  } catch {
    return null;
  }
}

export function writeLocation(configDir: string, loc: DataLocationFile): void {
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, LOCATION_FILE);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...loc, changedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export function hasPpmData(dir: string | null | undefined): boolean {
  return !!dir && fs.existsSync(path.join(dir, 'ppm.sqlite'));
}

/** Thư mục chọn còn trống hoặc đã là thư mục dữ liệu PPM thì dùng luôn; có file khác thì tạo thư mục con "PPM Data". */
export function resolveTarget(picked: string): string {
  if (hasPpmData(picked)) return picked;
  const items = fs.existsSync(picked) ? fs.readdirSync(picked) : [];
  return items.length ? path.join(picked, SUBFOLDER) : picked;
}

export function assertMovable(current: string, target: string): void {
  if (!path.isAbsolute(target)) throw new AppError('Đường dẫn thư mục không hợp lệ.');
  if (samePath(current, target)) throw new AppError('Dữ liệu đang ở đúng thư mục này rồi.');
  if (isInside(target, current)) throw new AppError('Không chọn được thư mục nằm bên trong thư mục dữ liệu hiện tại.');
  fs.mkdirSync(target, { recursive: true });
  const probe = path.join(target, `.ppm-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch {
    throw new AppError('Không ghi được vào thư mục đã chọn (ổ chỉ đọc hoặc không có quyền).');
  }
}

function fileCount(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).length;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Dữ liệu PPM đang có ở thư mục đích được chuyển vào thư mục con "PPM cũ <thời điểm>" — không ghi đè, không xóa. */
export function setAsideExisting(target: string): string | null {
  const present = DATA_ENTRIES.filter((e) => fs.existsSync(path.join(target, e)));
  if (!present.length) return null;
  const aside = path.join(target, `PPM cu ${stamp()}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const e of present) fs.renameSync(path.join(target, e), path.join(aside, e));
  return aside;
}

/**
 * Chép toàn bộ dữ liệu sang thư mục mới rồi kiểm tra lại (database mở được, đủ dung lượng, đủ số ảnh).
 * Thư mục cũ giữ nguyên; lỗi giữa chừng thì xóa phần đã chép ở thư mục mới.
 */
export async function copyDataTo(db: Db, current: string, target: string): Promise<void> {
  db.persist();
  fs.mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  try {
    for (const e of DATA_ENTRIES) {
      const src = path.join(current, e);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(target, e);
      fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });
      copied.push(dst);
    }
    const a = fs.statSync(path.join(current, 'ppm.sqlite')).size;
    const b = fs.statSync(path.join(target, 'ppm.sqlite')).size;
    if (a !== b) throw new Error('database chép sang không khớp kích thước');
    await Db.validateBytes(new Uint8Array(fs.readFileSync(path.join(target, 'ppm.sqlite'))));
    for (const dir of ['images', 'thumbs'])
      if (fileCount(path.join(current, dir)) !== fileCount(path.join(target, dir))) throw new Error(`thiếu file trong thư mục ${dir}`);
  } catch (e) {
    for (const c of copied) fs.rmSync(c, { recursive: true, force: true });
    const code = (e as NodeJS.ErrnoException).code;
    throw new AppError(
      code === 'ENOSPC'
        ? 'Ổ đĩa đích không đủ dung lượng. Dữ liệu hiện tại không bị thay đổi.'
        : `Không chép được dữ liệu sang thư mục mới (${(e as Error).message}). Dữ liệu hiện tại không bị thay đổi.`,
    );
  }
}

/** Dọn bản dữ liệu cũ: chỉ những mục thuộc dữ liệu PPM, chuyển vào Thùng rác; xóa thư mục nếu trống hẳn. */
export async function trashOldData(dir: string, trash: (p: string) => Promise<void>): Promise<void> {
  for (const e of DATA_ENTRIES) {
    const p = path.join(dir, e);
    if (fs.existsSync(p)) await trash(p);
  }
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* thư mục còn file khác của người dùng: giữ nguyên */
  }
}

export function dirSize(dir: string): number {
  let total = 0;
  const walk = (p: string) => {
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    else total += st.size;
  };
  for (const e of DATA_ENTRIES) walk(path.join(dir, e));
  return total;
}

export type MissingChoice = 'retry' | 'pick' | 'default' | 'quit';

/**
 * Chọn thư mục dữ liệu khi khởi động. Vị trí đã đổi mà không thấy dữ liệu (ổ chưa cắm, thư mục bị đổi tên) thì
 * hỏi người dùng — không tự tạo database trống ở đó. Hộp thoại được truyền vào để test được không cần Electron.
 */
export async function resolveStartupDataDir(o: {
  configDir: string;
  defaultDir: string;
  askMissing: (dir: string) => Promise<MissingChoice>;
  pickDir: () => Promise<string | null>;
  notifyNotData: (dir: string) => Promise<void>;
}): Promise<string | null> {
  const loc = readLocation(o.configDir);
  if (!loc || samePath(loc.dataDir, o.defaultDir)) return o.defaultDir;
  let dir = loc.dataDir;
  for (;;) {
    if (hasPpmData(dir)) return dir;
    const choice = await o.askMissing(dir);
    if (choice === 'retry') continue;
    if (choice === 'pick') {
      const picked = await o.pickDir();
      if (!picked) continue;
      if (!hasPpmData(picked)) {
        await o.notifyNotData(picked);
        continue;
      }
      writeLocation(o.configDir, { ...loc, dataDir: picked });
      dir = picked;
      continue;
    }
    if (choice === 'default') {
      writeLocation(o.configDir, { dataDir: o.defaultDir, previousDataDir: null });
      return o.defaultDir;
    }
    return null;
  }
}
