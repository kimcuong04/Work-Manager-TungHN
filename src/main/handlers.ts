import fs from 'node:fs';
import path from 'node:path';
import type { Api } from '../shared/api';
import { IMAGE_EXTENSIONS, LINK_FILE_EXTENSIONS } from '../shared/types';
import { fileExtension } from '../shared/validation';
import { resolveWebLink } from '../shared/webLink';
import { AppError, type Ctx } from './context';
import { checkFile, readWorkbook, writeXlsx } from './integration/files';
import { imagePath, importImageBuffer, importImages, storageUsage } from './integration/images';
import { inspectBackup, restoreBackup, writeBackup } from './services/backup';
import * as calendar from './services/calendar';
import * as master from './services/master';
import * as notes from './services/notes';
import * as projects from './services/projects';
import * as records from './services/records';
import { globalSearch } from './services/search';
import { getSettings, updateSettings } from './services/settings';
import type { Updater } from './updater';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Các thao tác phụ thuộc hệ điều hành (dialog, shell) — tách riêng để service test được không cần Electron. */
export interface Desktop {
  pickFiles(opts: { title: string; filters: FileFilter[]; multi?: boolean }): Promise<string[]>;
  saveFile(opts: { title: string; defaultName: string; filters: FileFilter[] }): Promise<string | null>;
  openPath(p: string): Promise<string>;
  showItemInFolder(p: string): void;
  openExternal(url: string): Promise<void>;
  /** Ảnh trong clipboard: dữ liệu PNG (ảnh chụp/ảnh copy) hoặc đường dẫn file ảnh copy từ Explorer. */
  readClipboardImage(): Promise<{ png?: Uint8Array; files?: string[] } | null>;
  writeClipboardImage(file: string): Promise<boolean>;
  pickDirectory(title: string): Promise<string | null>;
  /** Chuyển file/thư mục vào Thùng rác (khôi phục được). */
  trashItem(p: string): Promise<void>;
  updater: Pick<Updater, 'getStatus' | 'check' | 'install'>;
}

export type Handlers = { [K in keyof Api]: (...args: Parameters<Api[K]>) => Awaited<ReturnType<Api[K]>> | ReturnType<Api[K]> };

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function createHandlers(ctx: Ctx, desktop: Desktop): Handlers {
  // Renderer chỉ được đọc workbook/backup mà người dùng vừa chọn qua hộp thoại.
  const pickedWorkbooks = new Set<string>();
  const pickedBackups = new Set<string>();
  const pickedDirs = new Set<string>();
  const dirKey = (p: string) => path.resolve(p).toLowerCase();

  /** Chỉ tạo/chuyển thư mục dự án vào nơi người dùng đã chọn qua hộp thoại (hoặc nơi lưu đã nhớ / nơi đang dùng). */
  const assertFolderParent = (parent: string | null | undefined, currentFolder?: string | null) => {
    if (!parent) return;
    const k = dirKey(parent);
    const saved = getSettings(ctx).projectRootDir;
    const allowed = pickedDirs.has(k) || (saved && dirKey(saved) === k) || (currentFolder && dirKey(path.dirname(currentFolder)) === k);
    if (!allowed) throw new AppError('Hãy chọn lại nơi lưu thư mục dự án.');
  };

  const DANGEROUS = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'scr', 'lnk', 'reg', 'hta', 'cpl', 'pif']);

  const assertLinkedFile = (p: string) => {
    const linked = ctx.db.scalar<number>('SELECT COUNT(*) FROM projects WHERE file_path = ?', [p]);
    if (!linked) throw new AppError('File này không được liên kết với dự án nào.');
  };

  return {
    getAppInfo: () => ({ version: ctx.appVersion, dataDir: ctx.paths.dataDir, encryption: ctx.platform.encryptionKind }),
    getSettings: () => getSettings(ctx),
    updateSettings: (patch) => {
      const { projectRootDir: _ignored, ...rest } = patch ?? {};
      return updateSettings(ctx, rest);
    },

    listMaster: (kind) => master.listMaster(ctx, kind),
    createMaster: (kind, name) => master.createMaster(ctx, kind, name),
    renameMaster: (kind, id, name) => master.renameMaster(ctx, kind, id, name),
    deleteMaster: (kind, id, strategy) => master.deleteMaster(ctx, kind, id, strategy),
    setMasterActive: (kind, id, active) => master.setMasterActive(ctx, kind, id, active),
    setSalespersonDepartment: (id, dept) => master.setSalespersonDepartment(ctx, id, dept),
    moveMaster: (kind, id, dir) => master.moveMaster(ctx, kind, id, dir),

    listYears: () => master.listYears(ctx),
    createYear: (jobType, label) => master.createYear(ctx, jobType, label),
    renameYear: (id, label) => master.renameYear(ctx, id, label),
    deleteYear: (id) => master.deleteYear(ctx, id),

    listProjects: () => projects.listProjects(ctx),
    createProject: (input, opts) => {
      assertFolderParent(input?.folderParent);
      return projects.createProject(ctx, input, opts ?? {});
    },
    updateProject: (id, input, opts) => {
      assertFolderParent(input?.folderParent, projects.getProject(ctx, id).folderPath);
      return projects.updateProject(ctx, id, input, opts ?? {});
    },
    deleteProject: async (id, opts) => {
      const p = projects.getProject(ctx, id);
      if (opts?.deleteFolder && p.folderPath && fs.existsSync(p.folderPath)) {
        try {
          await desktop.trashItem(p.folderPath);
        } catch (e) {
          throw new AppError(`Không chuyển được thư mục vào Thùng rác (${(e as Error).message}). Dự án chưa bị xóa — đóng các file đang mở rồi thử lại.`);
        }
      }
      projects.deleteProject(ctx, id);
    },
    nextProjectStt: () => projects.nextProjectStt(ctx),
    pickFolder: async (title) => {
      const dir = await desktop.pickDirectory(title || 'Chọn thư mục');
      if (dir) pickedDirs.add(dirKey(dir));
      return dir;
    },
    openProjectFolder: async (id) => {
      const p = projects.getProject(ctx, id);
      if (!p.folderPath) throw new AppError('Dự án chưa có thư mục trên máy.');
      if (!fs.existsSync(p.folderPath)) throw new AppError('Không thấy thư mục dự án (có thể đã bị xóa/chuyển). Dùng "Đồng bộ thư mục" để tạo lại.');
      const err = await desktop.openPath(p.folderPath);
      if (err) throw new AppError(`Không mở được thư mục: ${err}`);
    },
    syncProjectFolder: (id, parent) => {
      assertFolderParent(parent, projects.getProject(ctx, id).folderPath);
      return projects.syncProjectFolder(ctx, id, parent ?? null);
    },
    setProjectCompleted: (id, completed) => projects.setProjectCompleted(ctx, id, completed),
    applyBoardChanges: (changes) => projects.applyBoardChanges(ctx, changes),
    moveProject: (id, jobYearId, category) => projects.moveProject(ctx, id, jobYearId, category),

    listProjectNotes: (id) => notes.listProjectNotes(ctx, id),
    saveProjectNote: (id, input, opts) => notes.saveProjectNote(ctx, id, input, opts ?? {}),
    deleteProjectNote: (id) => notes.deleteProjectNote(ctx, id),

    pickLinkFile: async () => {
      const [file] = await desktop.pickFiles({
        title: 'Chọn file DWG/TXT',
        filters: [{ name: 'Bản vẽ AutoCAD / Văn bản (*.dwg, *.txt)', extensions: LINK_FILE_EXTENSIONS }],
      });
      if (!file) return null;
      const ext = fileExtension(file);
      if (!LINK_FILE_EXTENSIONS.includes(ext)) throw new AppError('Chỉ hỗ trợ file .dwg hoặc .txt.');
      return { path: file, name: path.basename(file), extension: ext };
    },
    checkFile: (p) => checkFile(p),
    openFile: async (p) => {
      assertLinkedFile(p);
      const c = checkFile(p);
      if (!c.accessible) throw new AppError(`${c.message} Hãy chọn lại file.`);
      const err = await desktop.openPath(p);
      if (err)
        throw new AppError(
          `Không mở được file: ${err}. Kiểm tra đã cài và đặt ứng dụng mặc định cho đuôi .${fileExtension(p)} (ví dụ AutoCAD cho .dwg).`,
        );
    },
    showFileInFolder: (p) => {
      assertLinkedFile(p);
      if (!checkFile(p).exists) throw new AppError('File không còn tồn tại.');
      desktop.showItemInFolder(p);
    },

    pickWorkbook: async () => {
      const [file] = await desktop.pickFiles({ title: 'Chọn workbook Excel', filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }] });
      if (!file) return null;
      if (fileExtension(file) !== 'xlsx') throw new AppError('Chỉ hỗ trợ file Excel .xlsx (không hỗ trợ .xls, .csv).');
      pickedWorkbooks.add(file);
      return file;
    },
    readWorkbook: (p) => {
      if (!pickedWorkbooks.has(p)) throw new AppError('Hãy chọn lại workbook.');
      const s = getSettings(ctx);
      const data = readWorkbook(p, s.xlsxMaxMb, s.xlsxMaxRows);
      return { ...data, savedMappings: projects.savedMappings(ctx, data.signature) };
    },
    getProjectImport: (id) => projects.getProjectImport(ctx, id),
    commitImport: (id, payload) => projects.commitImport(ctx, id, payload),
    removeImport: (id) => projects.removeImport(ctx, id),

    listWarranty: (yearId) => records.listWarranty(ctx, yearId),
    createWarranty: (input) => records.createWarranty(ctx, input),
    updateWarranty: (id, input) => records.updateWarranty(ctx, id, input),
    deleteWarranty: (id) => records.deleteWarranty(ctx, id),
    revealWarrantyPassword: (id) => records.revealWarrantyPassword(ctx, id),

    pickImages: async () => {
      const files = await desktop.pickFiles({
        title: 'Chọn ảnh',
        multi: true,
        filters: [{ name: 'Ảnh (*.jpg, *.jpeg, *.png, *.webp)', extensions: IMAGE_EXTENSIONS }],
      });
      return files.length ? importImages(ctx, files) : [];
    },
    pasteImages: async () => {
      const clip = await desktop.readClipboardImage();
      const files = (clip?.files ?? []).filter((f) => IMAGE_EXTENSIONS.includes(fileExtension(f)));
      if (files.length) return importImages(ctx, files);
      if (clip?.png?.length) return [importImageBuffer(ctx, clip.png, `Ảnh dán ${stamp()}.png`)];
      throw new AppError('Clipboard không có ảnh. Hãy chụp màn hình (Win+Shift+S) hoặc copy một ảnh rồi dán lại.');
    },
    importDroppedImages: (paths) => {
      if (!Array.isArray(paths)) throw new AppError('Dữ liệu không hợp lệ.');
      const files = paths
        .filter((f): f is string => typeof f === 'string' && path.isAbsolute(f))
        .filter((f) => IMAGE_EXTENSIONS.includes(fileExtension(f)) && fs.existsSync(f) && fs.statSync(f).isFile())
        .slice(0, 50);
      if (!files.length) throw new AppError('Chỉ kéo thả được file ảnh JPG/JPEG/PNG/WEBP.');
      return importImages(ctx, files);
    },
    copyImageToClipboard: async (key) => {
      if (!(await desktop.writeClipboardImage(imagePath(ctx, key)))) throw new AppError('Không sao chép được ảnh này vào clipboard.');
    },

    listExperience: (brandId) => records.listExperience(ctx, brandId),
    createExperience: (input) => records.createExperience(ctx, input),
    updateExperience: (id, input) => records.updateExperience(ctx, id, input),
    deleteExperience: (id) => records.deleteExperience(ctx, id),
    openExternalUrl: async (text) => {
      const url = resolveWebLink(String(text ?? ''));
      if (!url) throw new AppError('Link trống.');
      await desktop.openExternal(url);
    },
    pickLocalLink: async (kind) => {
      if (kind === 'folder') return desktop.pickDirectory('Chọn thư mục liên kết');
      const [file] = await desktop.pickFiles({ title: 'Chọn file liên kết', filters: [{ name: 'Tất cả file', extensions: ['*'] }] });
      return file ?? null;
    },
    openLocalLink: async (p) => {
      const linked = ctx.db.scalar<number>(
        'SELECT (SELECT COUNT(*) FROM experience_records WHERE local_path = ?) + (SELECT COUNT(*) FROM knowledge_records WHERE local_path = ?)',
        [p, p],
      );
      if (!linked) throw new AppError('Đường dẫn này không được liên kết với mục nào.');
      if (!fs.existsSync(p)) throw new AppError('File/thư mục không còn tồn tại hoặc đã bị di chuyển — hãy chọn lại.');
      // File chạy được (.exe, .bat…) chỉ mở thư mục chứa nó, không tự chạy.
      if (fs.statSync(p).isFile() && DANGEROUS.has(fileExtension(p))) return desktop.showItemInFolder(p);
      const err = await desktop.openPath(p);
      if (err) throw new AppError(`Không mở được: ${err}`);
    },

    globalSearch: (q) => globalSearch(ctx, q),
    exportXlsx: async (spec) => {
      const name = String(spec?.defaultName || 'Xuat').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'Xuat';
      const target = await desktop.saveFile({
        title: 'Xuất file Excel',
        defaultName: name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`,
        filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }],
      });
      return target ? writeXlsx(target, spec.sheetName, spec.rows) : null;
    },

    listKnowledge: (scope) => records.listKnowledge(ctx, scope && 'brandId' in scope ? scope.brandId ?? null : undefined),
    createKnowledge: (input) => records.createKnowledge(ctx, input),
    updateKnowledge: (id, input) => records.updateKnowledge(ctx, id, input),
    deleteKnowledge: (id) => records.deleteKnowledge(ctx, id),

    listCalendarEvents: (q) => calendar.listCalendarEvents(ctx, q ?? {}),
    createCalendarEvent: (input) => calendar.createCalendarEvent(ctx, input),
    updateCalendarEvent: (id, input) => calendar.updateCalendarEvent(ctx, id, input),
    moveCalendarEvent: (id, date) => calendar.moveCalendarEvent(ctx, id, date),
    deleteCalendarEvent: (id) => calendar.deleteCalendarEvent(ctx, id),

    getStorageUsage: () => storageUsage(ctx, getSettings(ctx).imageQuotaMb),
    exportBackup: async () => {
      const target = await desktop.saveFile({
        title: 'Lưu file backup',
        defaultName: `PPM-backup-${stamp()}.zip`,
        filters: [{ name: 'PPM Backup (*.zip)', extensions: ['zip'] }],
      });
      return target ? writeBackup(ctx, target) : null;
    },
    pickBackup: async () => {
      const [file] = await desktop.pickFiles({ title: 'Chọn file backup', filters: [{ name: 'PPM Backup (*.zip)', extensions: ['zip'] }] });
      if (!file) return null;
      const info = inspectBackup(file);
      pickedBackups.add(file);
      return info;
    },
    restoreBackup: async (p) => {
      if (!pickedBackups.has(p)) throw new AppError('Hãy chọn lại file backup.');
      await restoreBackup(ctx, p);
    },
    openDataFolder: async () => {
      await desktop.openPath(ctx.paths.dataDir);
    },

    getUpdateStatus: () => desktop.updater.getStatus(),
    checkForUpdates: () => desktop.updater.check(),
    installUpdate: () => desktop.updater.install(),
  };
}
