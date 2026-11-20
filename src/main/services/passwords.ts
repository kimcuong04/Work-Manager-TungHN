import { randomUUID } from 'node:crypto';
import type { OnlineTool, OnlineToolInput, PasswordEntry, PasswordInput } from '../../shared/types';
import { hasErrors, validateOnlineToolInput, validatePasswordInput } from '../../shared/validation';
import { AppError, now, str, type Ctx } from '../context';

/* ---------------- Password ---------------- */

function mapPassword(r: Record<string, any>): PasswordEntry {
  return {
    id: r.id,
    siteName: r.site_name,
    username: r.username,
    url: str(r.site_url),
    note: str(r.note),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** STT là thứ tự thêm vào (cũ nhất = 1). Không bao giờ trả về mật khẩu ở đây. */
export function listPasswords(ctx: Ctx): PasswordEntry[] {
  return ctx.db.all('SELECT id, site_name, username, site_url, note, created_at, updated_at FROM password_entries ORDER BY created_at, id').map(mapPassword);
}

function getPassword(ctx: Ctx, id: string): PasswordEntry {
  const r = ctx.db.get('SELECT id, site_name, username, site_url, note, created_at, updated_at FROM password_entries WHERE id = ?', [id]);
  if (!r) throw new AppError('Không tìm thấy mục Password (có thể đã bị xóa).');
  return mapPassword(r);
}

function checkPassword(input: PasswordInput, creating: boolean) {
  const e = validatePasswordInput(input, creating);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
}

export function createPassword(ctx: Ctx, input: PasswordInput): PasswordEntry {
  checkPassword(input, true);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() =>
    ctx.db.run(
      'INSERT INTO password_entries (id, site_name, username, password_encrypted, site_url, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, input.siteName.trim(), input.username.trim(), ctx.platform.encrypt(input.password!), (input.url ?? '').trim() || null, (input.note ?? '').trim(), stamp, stamp],
    ),
  );
  return getPassword(ctx, id);
}

export function updatePassword(ctx: Ctx, id: string, input: PasswordInput): PasswordEntry {
  getPassword(ctx, id);
  checkPassword(input, false);
  ctx.db.tx(() => {
    ctx.db.run('UPDATE password_entries SET site_name = ?, username = ?, site_url = ?, updated_at = ? WHERE id = ?', [
      input.siteName.trim(),
      input.username.trim(),
      (input.url ?? '').trim() || null,
      now(),
      id,
    ]);
    if (input.note !== undefined) ctx.db.run('UPDATE password_entries SET note = ? WHERE id = ?', [String(input.note ?? '').trim(), id]);
    if (input.password !== undefined) ctx.db.run('UPDATE password_entries SET password_encrypted = ? WHERE id = ?', [ctx.platform.encrypt(input.password), id]);
  });
  return getPassword(ctx, id);
}

export function deletePassword(ctx: Ctx, id: string): void {
  getPassword(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM password_entries WHERE id = ?', [id]));
}

export function revealPassword(ctx: Ctx, id: string): string {
  const row = ctx.db.get<{ password_encrypted: string }>('SELECT password_encrypted FROM password_entries WHERE id = ?', [id]);
  if (!row) throw new AppError('Không tìm thấy mục Password (có thể đã bị xóa).');
  try {
    return ctx.platform.decrypt(row.password_encrypted);
  } catch {
    throw new AppError('Không giải mã được mật khẩu (dữ liệu có thể được khôi phục từ máy hoặc tài khoản Windows khác).');
  }
}

/* ---------------- Tool online ---------------- */

function mapTool(r: Record<string, any>): OnlineTool {
  return { id: r.id, name: r.name, purpose: str(r.purpose), url: r.url, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function listOnlineTools(ctx: Ctx): OnlineTool[] {
  return ctx.db.all('SELECT * FROM online_tools ORDER BY created_at, id').map(mapTool);
}

function getTool(ctx: Ctx, id: string): OnlineTool {
  const r = ctx.db.get('SELECT * FROM online_tools WHERE id = ?', [id]);
  if (!r) throw new AppError('Không tìm thấy tool (có thể đã bị xóa).');
  return mapTool(r);
}

function checkTool(input: OnlineToolInput) {
  const e = validateOnlineToolInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
}

export function createOnlineTool(ctx: Ctx, input: OnlineToolInput): OnlineTool {
  checkTool(input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() =>
    ctx.db.run('INSERT INTO online_tools VALUES (?,?,?,?,?,?)', [id, input.name.trim(), (input.purpose ?? '').trim(), input.url.trim(), stamp, stamp]),
  );
  return getTool(ctx, id);
}

export function updateOnlineTool(ctx: Ctx, id: string, input: OnlineToolInput): OnlineTool {
  getTool(ctx, id);
  checkTool(input);
  ctx.db.tx(() =>
    ctx.db.run('UPDATE online_tools SET name = ?, purpose = ?, url = ?, updated_at = ? WHERE id = ?', [
      input.name.trim(),
      (input.purpose ?? '').trim(),
      input.url.trim(),
      now(),
      id,
    ]),
  );
  return getTool(ctx, id);
}

export function deleteOnlineTool(ctx: Ctx, id: string): void {
  getTool(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM online_tools WHERE id = ?', [id]));
}
