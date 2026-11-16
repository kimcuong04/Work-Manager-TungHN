import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { releaseNotesToText } from '../shared/releaseNotes';
import type { UpdateStatus } from '../shared/types';
import { AppError } from './context';
import { log } from './logger';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 8000;

export interface Updater {
  getStatus(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  /** Kiểm tra và chờ tới khi tải xong / không có bản mới / lỗi. */
  checkAndWait(): Promise<UpdateStatus>;
  install(): void;
  startSchedule(isEnabled: () => boolean): void;
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(msg)) return 'Không kết nối được GitHub — kiểm tra Internet rồi thử lại.';
  if (/\b404\b|Cannot find latest|No published versions|Unable to find latest version/i.test(msg))
    return 'Chưa có bản phát hành nào trên GitHub (hoặc repo phát hành đang để private).';
  if (/sha512 checksum mismatch/i.test(msg)) return 'File tải về bị lỗi, sẽ thử lại ở lần kiểm tra sau.';
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}

/**
 * Tự cập nhật qua GitHub Releases (electron-updater). Chỉ hoạt động với bản cài bằng Setup (NSIS)
 * có nhúng app-update.yml; bản dev/portable trả về trạng thái "disabled" kèm lý do.
 * Chỉ tải thông tin phiên bản + bộ cài từ GitHub, không gửi dữ liệu người dùng đi đâu.
 */
export function createUpdater(notify: (s: UpdateStatus) => void): Updater {
  const currentVersion = app.getVersion();
  let reason: string | null = null;
  if (!app.isPackaged) reason = 'Đang chạy từ source (dev) — chức năng tự cập nhật chỉ có ở bản cài đặt.';
  else if (process.env.PORTABLE_EXECUTABLE_FILE) reason = 'Bản portable không tự cập nhật được — hãy cài bằng file PersonalProjectManager-Setup.';
  else if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) reason = 'Bản build này chưa gắn kênh cập nhật GitHub.';

  let status: UpdateStatus = reason ? { state: 'disabled', currentVersion, message: reason } : { state: 'idle', currentVersion };
  const waiters: ((s: UpdateStatus) => void)[] = [];
  const set = (patch: Partial<UpdateStatus>) => {
    status = { ...status, ...patch, currentVersion };
    notify(status);
    if (['downloaded', 'up-to-date', 'error'].includes(status.state)) waiters.splice(0).forEach((w) => w(status));
  };
  const infoPatch = (i: UpdateInfo) => ({
    version: i.version,
    releaseNotes: releaseNotesToText(i.releaseNotes),
    releaseDate: i.releaseDate,
  });

  if (!reason) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: (m: unknown) => log('info', `[updater] ${String(m)}`),
      warn: (m: unknown) => log('warn', `[updater] ${String(m)}`),
      error: (m: unknown) => log('error', `[updater] ${String(m)}`),
      debug: () => {},
    };
    autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }));
    autoUpdater.on('update-available', (i) => set({ state: 'downloading', percent: 0, ...infoPatch(i) }));
    autoUpdater.on('update-not-available', () => set({ state: 'up-to-date', checkedAt: new Date().toISOString() }));
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => set({ state: 'downloaded', percent: 100, ...infoPatch(i) }));
    autoUpdater.on('error', (e) => set({ state: 'error', error: friendlyError(e), checkedAt: new Date().toISOString() }));
  }

  const busy = () => status.state === 'checking' || status.state === 'downloading' || status.state === 'downloaded';

  const check = async (): Promise<UpdateStatus> => {
    if (reason || busy()) return status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      set({ state: 'error', error: friendlyError(e), checkedAt: new Date().toISOString() });
    }
    return status;
  };

  return {
    getStatus: () => status,
    check,
    checkAndWait: () => {
      if (reason || status.state === 'downloaded') return Promise.resolve(status);
      const done = new Promise<UpdateStatus>((resolve) => waiters.push(resolve));
      void check().then((s) => {
        if (s.state === 'error' || s.state === 'up-to-date') waiters.splice(0).forEach((w) => w(s));
      });
      return done;
    },
    install: () => {
      if (status.state !== 'downloaded') throw new AppError('Chưa có bản cập nhật nào được tải xong.');
      log('info', `[updater] Cài bản ${status.version} và khởi động lại`);
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
    },
    startSchedule: (isEnabled) => {
      if (reason) return;
      const run = () => {
        if (isEnabled()) void check();
      };
      setTimeout(run, FIRST_CHECK_DELAY_MS);
      setInterval(run, CHECK_INTERVAL_MS);
    },
  };
}
