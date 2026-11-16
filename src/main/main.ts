import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from 'electron';
import type { ApiResult } from '../shared/api';
import type { AppEvent, UpdateStatus } from '../shared/types';
import { AppError, makePaths, type Ctx } from './context';
import { Db } from './db/database';
import { createHandlers, type Desktop, type Handlers } from './handlers';
import { cleanupOrphanImages, imagePath, thumbPath } from './integration/images';
import { initLogger, log } from './logger';
import { createPlatform } from './platform';
import { rotateStartupBackups } from './services/backup';
import { referencedImageKeys } from './services/records';
import { getSettings } from './services/settings';
import { createUpdater, type Updater } from './updater';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

protocol.registerSchemesAsPrivileged([
  { scheme: 'ppm-img', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.commandLine.appendSwitch('lang', 'vi');
// Thư mục dữ liệu tùy chỉnh (test/portable) thì profile Chromium (localStorage) cũng nằm cùng chỗ.
if (process.env.PPM_DATA_DIR) app.setPath('userData', path.join(process.env.PPM_DATA_DIR, 'electron-profile'));

let mainWindow: BrowserWindow | null = null;
let ctx: Ctx | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

app.on('window-all-closed', () => app.quit());

function isTrustedSender(url: string | undefined): boolean {
  if (!url) return false;
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

function emit(event: AppEvent) {
  mainWindow?.webContents.send('ppm:event', event);
}

/**
 * Bản cập nhật lỗi (ví dụ migration hỏng) không được làm user kẹt lại: dữ liệu gốc đã được rollback
 * và sao lưu, cho phép tải bản sửa lỗi từ GitHub ngay trên hộp thoại lỗi.
 */
async function startupFailed(err: unknown, updater: Updater) {
  const message = err instanceof Error ? err.message : String(err);
  log('error', 'Khởi động thất bại', err);
  if (updater.getStatus().state === 'disabled') {
    dialog.showErrorBox('Personal Project Manager', `Không khởi động được ứng dụng:\n${message}`);
    return app.quit();
  }
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Personal Project Manager',
    message: 'Không khởi động được ứng dụng',
    detail: `${message}\n\nDữ liệu gốc không bị thay đổi (đã có bản sao trong thư mục backups). Bạn có thể tải bản sửa lỗi mới nhất từ GitHub.`,
    buttons: ['Tải bản sửa lỗi & cài đặt', 'Thoát'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return app.quit();
  const s = await updater.checkAndWait();
  if (s.state === 'downloaded') return updater.install();
  dialog.showErrorBox('Personal Project Manager', s.state === 'error' ? s.error ?? 'Lỗi tải bản cập nhật.' : 'Chưa có bản sửa lỗi mới hơn trên GitHub.');
  app.quit();
}

async function start() {
  const dataDir = process.env.PPM_DATA_DIR || path.join(app.getPath('userData'), 'data');
  const paths = makePaths(dataDir);
  let updateEnabled = true;
  const updater = createUpdater((status: UpdateStatus) => emit({ type: 'update', status }));

  try {
    fs.mkdirSync(paths.backupsDir, { recursive: true });
    initLogger(paths.logsDir);
    rotateStartupBackups(paths);

    const db = await Db.open(paths.dbFile);
    ctx = { db, paths, platform: createPlatform(dataDir), appVersion: app.getVersion() };
    const removed = cleanupOrphanImages(ctx, referencedImageKeys(ctx));
    if (removed) log('info', `Đã dọn ${removed} ảnh không còn được dùng`);
    updateEnabled = getSettings(ctx).autoUpdate;
  } catch (err) {
    return startupFailed(err, updater);
  }

  protocol.handle('ppm-img', (req) => {
    try {
      const u = new URL(req.url);
      const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
      let file = u.hostname === 'thumb' ? thumbPath(ctx!, key) : imagePath(ctx!, key);
      if (u.hostname === 'thumb' && !fs.existsSync(file)) file = imagePath(ctx!, key);
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  const desktop: Desktop = {
    async pickFiles({ title, filters, multi }) {
      const r = await dialog.showOpenDialog(mainWindow!, {
        title,
        filters,
        properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      });
      return r.canceled ? [] : r.filePaths;
    },
    async saveFile({ title, defaultName, filters }) {
      const r = await dialog.showSaveDialog(mainWindow!, { title, defaultPath: defaultName, filters });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    openPath: (p) => shell.openPath(p),
    showItemInFolder: (p) => shell.showItemInFolder(p),
    openExternal: (url) => shell.openExternal(url),
    async readClipboardImage() {
      const items = await clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const bytes = Buffer.from(await ((await item.getType(type)) as Blob).arrayBuffer());
        const png = type === 'image/png' ? bytes : nativeImage.createFromBuffer(bytes).toPNG();
        if (png.length) return { png: new Uint8Array(png) };
      }
      // Copy file trong Explorer: clipboard chỉ có danh sách file (text/uri-list), không có dữ liệu ảnh.
      const files: string[] = [];
      for (const item of items) {
        if (!item.types.includes('text/uri-list')) continue;
        const list = await ((await item.getType('text/uri-list')) as Blob).text();
        for (const line of list.split(/\r?\n/)) {
          if (!line.trim().startsWith('file:')) continue;
          try {
            files.push(fileURLToPath(line.trim()));
          } catch {
            /* bỏ qua đường dẫn không hợp lệ */
          }
        }
      }
      return files.length ? { files } : null;
    },
    async pickDirectory(title) {
      const r = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    trashItem: (p) => shell.trashItem(p),
    async writeClipboardImage(file) {
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return false;
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]);
      return true;
    },
    updater,
  };
  const handlers: Handlers = createHandlers(ctx!, desktop);

  ipcMain.handle('api', async (event, method: string, args: unknown[]): Promise<ApiResult> => {
    if (!isTrustedSender(event.senderFrame?.url)) return { ok: false, error: 'Nguồn gọi không hợp lệ.' };
    if (!Object.prototype.hasOwnProperty.call(handlers, method)) return { ok: false, error: `Không hỗ trợ thao tác ${method}.` };
    try {
      const fn = handlers[method as keyof Handlers] as (...a: unknown[]) => unknown;
      const data = await fn(...(Array.isArray(args) ? args : []));
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: err.message };
      log('error', `Lỗi khi xử lý ${method}`, err);
      return { ok: false, error: `Lỗi hệ thống: ${err instanceof Error ? err.message : String(err)}. Chi tiết đã ghi vào log.` };
    }
  });

  createWindow(getSettings(ctx!).theme === 'dark' ? '#111113' : '#f6f7f1');
  updater.startSchedule(() => (ctx ? getSettings(ctx).autoUpdate : updateEnabled));
}

function createWindow(background: string) {
  if (!DEV_URL) Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Personal Project Manager',
    backgroundColor: background,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedSender(url)) e.preventDefault();
  });
  mainWindow.on('closed', () => (mainWindow = null));

  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
}
