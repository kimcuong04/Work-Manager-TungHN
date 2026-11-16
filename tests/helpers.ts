import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { makePaths, type Ctx, type Platform } from '../src/main/context';
import { Db } from '../src/main/db/database';

export const fakePlatform: Platform = {
  encryptionKind: 'fallback',
  encrypt: (p) => `aes:${Buffer.from(p, 'utf8').reverse().toString('base64')}`,
  decrypt: (c) => Buffer.from(c.slice(4), 'base64').reverse().toString('utf8'),
  makeThumbnail: () => false,
};

export function tmpDir(prefix = 'ppm-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function makeCtx(dir = tmpDir()): Promise<Ctx> {
  const paths = makePaths(dir);
  const db = await Db.open(paths.dbFile);
  return { db, paths, platform: fakePlatform, appVersion: 'test' };
}

export function writeWorkbook(file: string, sheets: Record<string, unknown[][]>): string {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return file;
}
