import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../context';

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function assertDirectory(dir: string | null | undefined): asserts dir is string {
  if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
    throw new AppError('Thư mục lưu dự án không tồn tại hoặc không truy cập được — hãy chọn lại.');
}

/** Tạo thư mục dự án; đã có sẵn thư mục trùng tên thì dùng luôn (ví dụ người dùng tạo tay trước đó). */
export function ensureProjectFolder(parent: string, name: string): { path: string; created: boolean } {
  assertDirectory(parent);
  const target = path.join(parent, name);
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new AppError(`Trong thư mục đã chọn có một file tên "${name}", không tạo được thư mục dự án.`);
    return { path: target, created: false };
  }
  try {
    fs.mkdirSync(target);
  } catch (e) {
    throw new AppError(`Không tạo được thư mục dự án: ${(e as Error).message}`);
  }
  return { path: target, created: true };
}

export interface FolderMove {
  path: string;
  /** true nếu đã đổi tên/chuyển trên ổ đĩa (cần hoàn tác nếu lưu database thất bại). */
  moved: boolean;
  notice?: string;
}

/**
 * Đổi tên/chuyển thư mục dự án theo thông tin mới. Thư mục đang mở (Explorer, file đang dùng) thì giữ tên cũ
 * và trả về cảnh báo để người dùng đóng lại rồi đồng bộ sau, thay vì chặn việc lưu dự án.
 */
export function moveProjectFolder(oldPath: string, newPath: string): FolderMove {
  if (oldPath === newPath) return { path: oldPath, moved: false };
  if (!fs.existsSync(oldPath)) {
    assertDirectory(path.dirname(newPath));
    if (!fs.existsSync(newPath)) fs.mkdirSync(newPath);
    return { path: newPath, moved: false, notice: 'Không thấy thư mục cũ của dự án (có thể đã bị xóa/chuyển) — đã tạo thư mục mới.' };
  }
  assertDirectory(path.dirname(newPath));
  const caseOnly = oldPath.toLowerCase() === newPath.toLowerCase();
  if (!caseOnly && fs.existsSync(newPath)) throw new AppError(`Đã có thư mục "${path.basename(newPath)}" ở nơi lưu — đổi tên dự án/STT khác hoặc xử lý thư mục đó trước.`);
  try {
    fs.renameSync(oldPath, newPath);
    return { path: newPath, moved: true };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    if (code === 'EXDEV') throw new AppError('Không chuyển được thư mục dự án sang ổ đĩa khác. Hãy tự chuyển thư mục rồi chọn lại nơi lưu trên cùng ổ đĩa.');
    if (BUSY.has(code))
      return {
        path: oldPath,
        moved: false,
        notice: 'Đã lưu dự án nhưng chưa đổi được tên thư mục vì thư mục hoặc file bên trong đang mở. Đóng lại rồi bấm “Đồng bộ tên thư mục” ở trang chi tiết.',
      };
    throw new AppError(`Không đổi được tên thư mục dự án: ${(e as Error).message}`);
  }
}

export function undoFolderMove(from: string, to: string): void {
  try {
    if (fs.existsSync(to) && !fs.existsSync(from)) fs.renameSync(to, from);
  } catch {
    /* không hoàn tác được: thư mục vẫn còn ở tên mới */
  }
}

/** Xóa thư mục vừa tạo khi lưu dự án thất bại (chỉ khi còn trống). */
export function removeIfEmpty(dir: string): void {
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* bỏ qua */
  }
}
