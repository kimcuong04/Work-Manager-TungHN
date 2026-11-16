import path from 'node:path';
import type { Db } from './db/database';

export class AppError extends Error {
  readonly userFacing = true;
}

export interface Platform {
  encryptionKind: 'os' | 'fallback';
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  /** Tạo thumbnail JPEG; trả false nếu định dạng không hỗ trợ (ví dụ WEBP). */
  makeThumbnail(src: string, dest: string, size: number): boolean;
}

export interface Paths {
  dataDir: string;
  dbFile: string;
  imagesDir: string;
  thumbsDir: string;
  backupsDir: string;
  logsDir: string;
}

export interface Ctx {
  db: Db;
  paths: Paths;
  platform: Platform;
  appVersion: string;
}

export function makePaths(dataDir: string): Paths {
  return {
    dataDir,
    dbFile: path.join(dataDir, 'ppm.sqlite'),
    imagesDir: path.join(dataDir, 'images'),
    thumbsDir: path.join(dataDir, 'thumbs'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
  };
}

export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
export const now = (): string => new Date().toISOString();
