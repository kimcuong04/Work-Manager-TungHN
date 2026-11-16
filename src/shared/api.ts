import type {
  AppInfo,
  AppSettings,
  BackupInfo,
  ExperienceInput,
  ExperienceRecord,
  FileCheck,
  ImageRef,
  ImportPayload,
  JobType,
  JobYear,
  LinkedFile,
  MasterDeleteStrategy,
  MasterItem,
  MasterKind,
  Project,
  ProjectCategory,
  ProjectImport,
  ProjectInput,
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
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, input: ProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  setProjectCompleted(id: string, completed: boolean): Promise<Project>;
  applyBoardChanges(changes: { id: string; completed: boolean }[]): Promise<void>;
  moveProject(id: string, jobYearId: string, category: ProjectCategory): Promise<Project>;

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

  listExperience(brandId: string | null): Promise<ExperienceRecord[]>;
  createExperience(input: ExperienceInput): Promise<ExperienceRecord>;
  updateExperience(id: string, input: ExperienceInput): Promise<ExperienceRecord>;
  deleteExperience(id: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;

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
