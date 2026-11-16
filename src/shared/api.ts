import type {
  AppInfo,
  AppSettings,
  BackupInfo,
  CalendarEvent,
  CalendarEventInput,
  CalendarQuery,
  ExperienceInput,
  ExperienceRecord,
  FileCheck,
  ImageRef,
  ImportPayload,
  JobType,
  JobYear,
  KnowledgeInput,
  KnowledgeRecord,
  LinkedFile,
  MasterDeleteStrategy,
  MasterItem,
  MasterKind,
  Project,
  ProjectCategory,
  ProjectImport,
  ProjectInput,
  ProjectNote,
  ProjectNoteInput,
  ProjectSaveOptions,
  SettingsPatch,
  StorageUsage,
  UpdateStatus,
  WarrantyInput,
  WarrantyRecord,
  WorkbookData,
} from './types';

/** Hợp đồng IPC giữa renderer và main process. Mọi method đều async. */
export interface Api {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: SettingsPatch): Promise<AppSettings>;

  listMaster(kind: MasterKind): Promise<MasterItem[]>;
  createMaster(kind: MasterKind, name: string): Promise<MasterItem>;
  renameMaster(kind: MasterKind, id: string, name: string): Promise<MasterItem>;
  deleteMaster(kind: MasterKind, id: string, strategy: MasterDeleteStrategy): Promise<void>;
  setMasterActive(kind: MasterKind, id: string, active: boolean): Promise<void>;
  moveMaster(kind: MasterKind, id: string, direction: -1 | 1): Promise<void>;

  listYears(): Promise<JobYear[]>;
  createYear(jobType: JobType, label: string): Promise<JobYear>;
  renameYear(id: string, label: string): Promise<JobYear>;
  deleteYear(id: string): Promise<void>;

  listProjects(): Promise<Project[]>;
  createProject(input: ProjectInput, opts?: ProjectSaveOptions): Promise<Project>;
  updateProject(id: string, input: ProjectInput, opts?: ProjectSaveOptions): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  setProjectCompleted(id: string, completed: boolean): Promise<Project>;
  applyBoardChanges(changes: { id: string; completed: boolean }[]): Promise<void>;
  moveProject(id: string, jobYearId: string, category: ProjectCategory): Promise<Project>;

  listProjectNotes(projectId: string): Promise<ProjectNote[]>;
  /** Lưu (tạo/sửa) ghi chú của một ngày; nội dung rỗng thì xóa mục của ngày đó và trả về null. */
  saveProjectNote(projectId: string, input: ProjectNoteInput, opts?: { addToCalendar?: boolean }): Promise<ProjectNote | null>;
  deleteProjectNote(id: string): Promise<void>;

  pickLinkFile(): Promise<LinkedFile | null>;
  checkFile(path: string): Promise<FileCheck>;
  openFile(path: string): Promise<void>;
  showFileInFolder(path: string): Promise<void>;

  pickWorkbook(): Promise<string | null>;
  readWorkbook(path: string): Promise<WorkbookData>;
  getProjectImport(projectId: string): Promise<ProjectImport | null>;
  commitImport(projectId: string, payload: ImportPayload): Promise<ProjectImport>;
  removeImport(projectId: string): Promise<void>;

  listWarranty(jobYearId: string): Promise<WarrantyRecord[]>;
  createWarranty(input: WarrantyInput): Promise<WarrantyRecord>;
  updateWarranty(id: string, input: WarrantyInput): Promise<WarrantyRecord>;
  deleteWarranty(id: string): Promise<void>;
  revealWarrantyPassword(id: string): Promise<string>;

  pickImages(): Promise<ImageRef[]>;
  /** Lấy ảnh đang có trong clipboard hệ điều hành (ảnh chụp màn hình, ảnh copy, hoặc file ảnh copy từ Explorer). */
  pasteImages(): Promise<ImageRef[]>;
  copyImageToClipboard(storageKey: string): Promise<void>;

  listExperience(brandId: string | null): Promise<ExperienceRecord[]>;
  createExperience(input: ExperienceInput): Promise<ExperienceRecord>;
  updateExperience(id: string, input: ExperienceInput): Promise<ExperienceRecord>;
  deleteExperience(id: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;

  /** `{}` = tất cả, `{ brandId: null }` = Kiến thức chung. */
  listKnowledge(scope: { brandId?: string | null }): Promise<KnowledgeRecord[]>;
  createKnowledge(input: KnowledgeInput): Promise<KnowledgeRecord>;
  updateKnowledge(id: string, input: KnowledgeInput): Promise<KnowledgeRecord>;
  deleteKnowledge(id: string): Promise<void>;

  listCalendarEvents(query: CalendarQuery): Promise<CalendarEvent[]>;
  createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateCalendarEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent>;
  moveCalendarEvent(id: string, eventDate: string): Promise<CalendarEvent>;
  deleteCalendarEvent(id: string): Promise<void>;

  getStorageUsage(): Promise<StorageUsage>;
  exportBackup(): Promise<string | null>;
  pickBackup(): Promise<BackupInfo | null>;
  restoreBackup(path: string): Promise<void>;
  openDataFolder(): Promise<void>;

  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
}

export type ApiMethod = keyof Api;

export type ApiResult = { ok: true; data: unknown } | { ok: false; error: string };
