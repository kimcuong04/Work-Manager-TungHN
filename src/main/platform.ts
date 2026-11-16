import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { nativeImage, safeStorage } from 'electron';
import type { Platform } from './context';

function fallbackKey(dataDir: string): Buffer {
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
  const key = randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

/**
 * Mã hóa mật khẩu Warranty: ưu tiên safeStorage (Windows DPAPI, gắn với tài khoản Windows);
 * nếu hệ điều hành không hỗ trợ thì dùng AES-256-GCM với khóa lưu trong thư mục dữ liệu.
 */
export function createPlatform(dataDir: string): Platform {
  const osAvailable = safeStorage.isEncryptionAvailable();
  let key: Buffer | null = null;
  const getKey = () => (key ??= fallbackKey(dataDir));

  return {
    encryptionKind: osAvailable ? 'os' : 'fallback',
    encrypt(plain) {
      if (osAvailable) return `os:${safeStorage.encryptString(plain).toString('base64')}`;
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', getKey(), iv);
      const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return `aes:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
    },
    decrypt(cipher) {
      if (cipher.startsWith('os:')) return safeStorage.decryptString(Buffer.from(cipher.slice(3), 'base64'));
      if (cipher.startsWith('aes:')) {
        const buf = Buffer.from(cipher.slice(4), 'base64');
        const d = createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
        d.setAuthTag(buf.subarray(12, 28));
        return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
      }
      throw new Error('Định dạng mật khẩu không xác định');
    },
    makeThumbnail(src, dest, size) {
      const img = nativeImage.createFromPath(src);
      if (img.isEmpty()) return false;
      const { width } = img.getSize();
      const out = width > size ? img.resize({ width: size, quality: 'good' }) : img;
      fs.writeFileSync(dest, out.toJPEG(82));
      return true;
    },
  };
}
