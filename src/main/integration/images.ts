import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_EXTENSIONS, type ImageRef, type StorageUsage } from '../../shared/types';
import { fileExtension } from '../../shared/validation';
import { AppError, type Ctx } from '../context';
import { log } from '../logger';

const KEY_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function assertStorageKey(key: string): void {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new AppError('Mã ảnh không hợp lệ.');
}

export function imagePath(ctx: Ctx, key: string): string {
  assertStorageKey(key);
  return path.join(ctx.paths.imagesDir, key);
}

export function thumbPath(ctx: Ctx, key: string): string {
  assertStorageKey(key);
  return path.join(ctx.paths.thumbsDir, `${key}.jpg`);
}

export function imageExists(ctx: Ctx, key: string): boolean {
  return fs.existsSync(imagePath(ctx, key));
}

/** Copy ảnh người dùng chọn vào kho ảnh của ứng dụng; ảnh chưa gắn record sẽ được dọn khi khởi động. */
export function importImages(ctx: Ctx, sources: string[]): ImageRef[] {
  fs.mkdirSync(ctx.paths.imagesDir, { recursive: true });
  fs.mkdirSync(ctx.paths.thumbsDir, { recursive: true });
  const out: ImageRef[] = [];
  for (const src of sources) {
    const ext = fileExtension(src);
    if (!IMAGE_EXTENSIONS.includes(ext)) throw new AppError(`"${path.basename(src)}" không phải ảnh JPG/JPEG/PNG/WEBP.`);
    const stat = fs.statSync(src);
    if (stat.size > MAX_IMAGE_BYTES) throw new AppError(`Ảnh "${path.basename(src)}" vượt quá 30 MB.`);
    const key = `${randomUUID()}.${ext}`;
    fs.copyFileSync(src, imagePath(ctx, key));
    try {
      ctx.platform.makeThumbnail(imagePath(ctx, key), thumbPath(ctx, key), 320);
    } catch (e) {
      log('warn', 'Không tạo được thumbnail', e);
    }
    out.push({ storageKey: key, fileName: path.basename(src), mimeType: MIME[ext], sizeBytes: stat.size });
  }
  return out;
}

/** Ảnh dán từ clipboard (ảnh chụp màn hình, ảnh copy từ trình duyệt…) đã được chuyển sang PNG. */
export function importImageBuffer(ctx: Ctx, data: Uint8Array, fileName: string): ImageRef {
  if (!data.length) throw new AppError('Clipboard không có dữ liệu ảnh.');
  if (data.length > MAX_IMAGE_BYTES) throw new AppError('Ảnh dán vượt quá 30 MB.');
  const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (!isPng) throw new AppError('Dữ liệu dán không phải ảnh PNG.');
  fs.mkdirSync(ctx.paths.imagesDir, { recursive: true });
  fs.mkdirSync(ctx.paths.thumbsDir, { recursive: true });
  const key = `${randomUUID()}.png`;
  fs.writeFileSync(imagePath(ctx, key), data);
  try {
    ctx.platform.makeThumbnail(imagePath(ctx, key), thumbPath(ctx, key), 320);
  } catch (e) {
    log('warn', 'Không tạo được thumbnail', e);
  }
  return { storageKey: key, fileName, mimeType: MIME.png, sizeBytes: data.length };
}

export function deleteImageFiles(ctx: Ctx, keys: string[]): void {
  for (const key of keys) {
    for (const p of [imagePath(ctx, key), thumbPath(ctx, key)]) {
      try {
        fs.rmSync(p, { force: true });
      } catch (e) {
        log('warn', 'Không xóa được file ảnh', e);
      }
    }
  }
}

export function cleanupOrphanImages(ctx: Ctx, referenced: Set<string>): number {
  if (!fs.existsSync(ctx.paths.imagesDir)) return 0;
  const orphans = fs.readdirSync(ctx.paths.imagesDir).filter((f) => KEY_RE.test(f) && !referenced.has(f));
  deleteImageFiles(ctx, orphans);
  return orphans.length;
}

export function storageUsage(ctx: Ctx, quotaMb: number): StorageUsage {
  let bytes = 0;
  let count = 0;
  for (const dir of [ctx.paths.imagesDir, ctx.paths.thumbsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      bytes += fs.statSync(path.join(dir, f)).size;
      if (dir === ctx.paths.imagesDir) count++;
    }
  }
  return { bytes, count, quotaMb };
}
