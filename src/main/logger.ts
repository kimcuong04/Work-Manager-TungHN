import fs from 'node:fs';
import path from 'node:path';

let logFile: string | null = null;

export function initLogger(logsDir: string): void {
  fs.mkdirSync(logsDir, { recursive: true });
  logFile = path.join(logsDir, 'app.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    /* bỏ qua lỗi xoay vòng log */
  }
}

/** Không bao giờ truyền dữ liệu người dùng nhập (đặc biệt mật khẩu) vào log. */
export function log(level: 'info' | 'warn' | 'error', message: string, err?: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err !== undefined ? String(err) : '';
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${detail ? ` | ${detail}` : ''}\n`;
  if (level === 'error') console.error(line.trim());
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* không để lỗi ghi log làm hỏng thao tác chính */
  }
}
