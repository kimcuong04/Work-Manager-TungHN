import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { BackupInfo } from '../../shared/types';
import { AppError, type Ctx, type Paths } from '../context';
import { Db } from '../db/database';
import { SCHEMA_VERSION } from '../db/migrations';

const MANIFEST = 'manifest.json';
const DB_ENTRY = 'ppm.sqlite';
const SAFE_ENTRY = /^(images|thumbs)\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)(\.jpg)?$/;

interface Manifest {
  app: 'personal-project-manager';
  formatVersion: 1;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  counts: Record<string, number>;
}

const STARTUP_RE = /^start-\d{8}-\d{6}-\d{3}\.sqlite$/;

function fileStamp(d = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

/** Mỗi lần mở app sao lưu database; giữ `keep` bản mới nhất để một bản lỗi không ghi đè hết bản tốt. */
export function rotateStartupBackups(paths: Paths, keep = 10): void {
  if (!fs.existsSync(paths.dbFile)) return;
  fs.mkdirSync(paths.backupsDir, { recursive: true });
  fs.copyFileSync(paths.dbFile, path.join(paths.backupsDir, `start-${fileStamp()}.sqlite`));
  const old = fs
    .readdirSync(paths.backupsDir)
    .filter((f) => STARTUP_RE.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.rmSync(path.join(paths.backupsDir, f), { force: true });
}

function counts(ctx: Ctx): Record<string, number> {
  const c = (sql: string) => ctx.db.scalar<number>(sql);
  return {
    projects: c('SELECT COUNT(*) FROM projects'),
    warranty: c('SELECT COUNT(*) FROM warranty_records'),
    experience: c('SELECT COUNT(*) FROM experience_records'),
    knowledge: c('SELECT COUNT(*) FROM knowledge_records'),
    calendar: c('SELECT COUNT(*) FROM calendar_events'),
    notes: c('SELECT COUNT(*) FROM project_notes'),
    freelance: c('SELECT COUNT(*) FROM freelance_jobs'),
    passwords: c('SELECT COUNT(*) FROM password_entries'),
    onlineTools: c('SELECT COUNT(*) FROM online_tools'),
    images: c('SELECT (SELECT COUNT(*) FROM warranty_images) + (SELECT COUNT(*) FROM experience_images) + (SELECT COUNT(*) FROM knowledge_images) + (SELECT COUNT(*) FROM project_note_images) + (SELECT COUNT(*) FROM freelance_note_images)'),
  };
}

function addDir(zip: AdmZip, dir: string, prefix: string) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) zip.addLocalFile(path.join(dir, f), prefix);
}

export function writeBackup(ctx: Ctx, target: string): string {
  const zip = new AdmZip();
  const manifest: Manifest = {
    app: 'personal-project-manager',
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    appVersion: ctx.appVersion,
    createdAt: new Date().toISOString(),
    counts: counts(ctx),
  };
  zip.addFile(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.addFile(DB_ENTRY, Buffer.from(ctx.db.exportBytes()));
  addDir(zip, ctx.paths.imagesDir, 'images');
  addDir(zip, ctx.paths.thumbsDir, 'thumbs');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  zip.writeZip(tmp);
  fs.renameSync(tmp, target);
  return target;
}

function openBackup(file: string): { zip: AdmZip; manifest: Manifest } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(file);
  } catch {
    throw new AppError('File backup bị hỏng hoặc không phải file .zip.');
  }
  const m = zip.getEntry(MANIFEST);
  if (!m || !zip.getEntry(DB_ENTRY)) throw new AppError('File không phải backup của Personal Project Manager.');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(m.getData().toString('utf8'));
  } catch {
    throw new AppError('Manifest của backup bị hỏng.');
  }
  if (manifest.app !== 'personal-project-manager') throw new AppError('File không phải backup của Personal Project Manager.');
  if (manifest.schemaVersion > SCHEMA_VERSION) throw new AppError('Backup được tạo bởi phiên bản mới hơn, hãy cập nhật ứng dụng.');
  return { zip, manifest };
}

export function inspectBackup(file: string): BackupInfo {
  const { manifest } = openBackup(file);
  return {
    path: file,
    fileName: path.basename(file),
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    counts: manifest.counts ?? {},
  };
}

/** Tạo bản sao lưu an toàn trước, kiểm tra backup hợp lệ, rồi mới thay dữ liệu hiện tại. */
export async function restoreBackup(ctx: Ctx, file: string): Promise<void> {
  const { zip } = openBackup(file);
  const dbBytes = new Uint8Array(zip.getEntry(DB_ENTRY)!.getData());
  await Db.validateBytes(dbBytes);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeBackup(ctx, path.join(ctx.paths.backupsDir, `auto-before-restore-${stamp}.zip`));

  const staging = path.join(ctx.paths.dataDir, `restore-${stamp}`);
  fs.mkdirSync(path.join(staging, 'images'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'thumbs'), { recursive: true });
  try {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || e.entryName === MANIFEST || e.entryName === DB_ENTRY) continue;
      if (!SAFE_ENTRY.test(e.entryName)) continue;
      fs.writeFileSync(path.join(staging, e.entryName), e.getData());
    }
    for (const dir of ['images', 'thumbs'] as const) {
      const live = dir === 'images' ? ctx.paths.imagesDir : ctx.paths.thumbsDir;
      fs.rmSync(live, { recursive: true, force: true });
      fs.renameSync(path.join(staging, dir), live);
    }
    await ctx.db.replaceWith(dbBytes);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
