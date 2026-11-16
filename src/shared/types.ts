export type JobType = 'MAIN' | 'FREELANCE';
export type ProjectCategory = 'PRE_SALES' | 'POST_SALES';
export type WorkCategory = ProjectCategory | 'WARRANTY';
export type DeadlineStatus = 'URGENT' | 'ATTENTION' | 'NEW' | 'COMPLETED';
export type ActiveStatus = Exclude<DeadlineStatus, 'COMPLETED'>;
export type Theme = 'light' | 'dark';
export type MasterKind = 'clients' | 'designUnits' | 'stages' | 'brands';

export const JOB_TYPES: JobType[] = ['MAIN', 'FREELANCE'];
export const JOB_LABEL: Record<JobType, string> = { MAIN: 'Job Chính', FREELANCE: 'Job Freelance' };
export const WORK_CATEGORIES: WorkCategory[] = ['PRE_SALES', 'POST_SALES', 'WARRANTY'];
export const PROJECT_CATEGORIES: ProjectCategory[] = ['PRE_SALES', 'POST_SALES'];
export const CATEGORY_LABEL: Record<WorkCategory, string> = {
  PRE_SALES: 'Pre-sales',
  POST_SALES: 'Post-sales',
  WARRANTY: 'Warranty',
};
export const MASTER_LABEL: Record<MasterKind, string> = {
  clients: 'CĐT',
  designUnits: 'Đơn vị thiết kế',
  stages: 'Giai đoạn',
  brands: 'Hãng',
};

export const LINK_FILE_EXTENSIONS = ['dwg', 'txt'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export interface AppSettings {
  theme: Theme;
  urgentThresholdDays: number;
  attentionThresholdDays: number;
  imageQuotaMb: number;
  xlsxMaxMb: number;
  xlsxMaxRows: number;
  autoUpdate: boolean;
  updatedAt: string;
}

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  version?: string;
  releaseNotes?: string;
  releaseDate?: string;
  percent?: number;
  error?: string;
  message?: string;
  checkedAt?: string;
}

export type AppEvent = { type: 'update'; status: UpdateStatus };
export type SettingsPatch = Partial<Omit<AppSettings, 'updatedAt'>>;

export interface MasterItem {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type MasterDeleteStrategy = { replaceWithId: string } | { unlink: true } | null;

export interface JobYear {
  id: string;
  jobType: JobType;
  yearLabel: string;
  sortOrder: number;
  projectCount: number;
  warrantyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  jobYearId: string;
  jobType: JobType;
  yearLabel: string;
  workCategory: ProjectCategory;
  receivedDate: string;
  dueDate: string;
  projectName: string;
  clientId: string;
  clientName: string;
  designUnitId: string | null;
  designUnitName: string | null;
  stageId: string | null;
  stageName: string | null;
  note: string;
  filePath: string | null;
  fileName: string | null;
  fileExtension: string | null;
  priorityPoint: number;
  isCompleted: boolean;
  completedAt: string | null;
  hasImport: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  jobYearId: string;
  workCategory: ProjectCategory;
  receivedDate: string;
  dueDate: string;
  projectName: string;
  clientId: string;
  designUnitId: string | null;
  stageId: string | null;
  note: string;
  filePath: string | null;
  fileName: string | null;
  fileExtension: string | null;
  priorityPoint: number;
}

export interface LinkedFile {
  path: string;
  name: string;
  extension: string;
}

export interface FileCheck {
  exists: boolean;
  accessible: boolean;
  message?: string;
}

export type CellValue = string | number | boolean | null;

export interface WorkbookSheet {
  name: string;
  rows: CellValue[][];
  rowCount: number;
  colCount: number;
  truncated: boolean;
}

export interface ColumnMappingRecord {
  sheetName: string;
  sourceColumn: string;
  targetField: string;
}

export interface WorkbookData {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  signature: string;
  sheets: WorkbookSheet[];
  savedMappings: ColumnMappingRecord[];
  warnings: string[];
}

export interface ImportedInfoRow {
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
}

export interface ImportedRequirement {
  roundNumber: number;
  content: string;
  createdDate: string | null;
}

export interface ImportedItem {
  model: string;
  brand: string;
  description: string;
}

export interface ImportPayload {
  sourceFileName: string;
  sourcePath: string | null;
  sheetNames: string[];
  workbookSignature: string;
  info: ImportedInfoRow[];
  requirements: ImportedRequirement[];
  items: ImportedItem[];
  mappings: ColumnMappingRecord[];
}

export interface ProjectImport {
  id: string;
  projectId: string;
  sourceFileName: string;
  sourcePath: string | null;
  sheetNames: string[];
  importedAt: string;
  status: string;
  info: ImportedInfoRow[];
  requirements: ImportedRequirement[];
  items: ImportedItem[];
}

export interface ImageRef {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface WarrantyRecord {
  id: string;
  jobYearId: string;
  jobType: JobType;
  yearLabel: string;
  model: string;
  brandId: string | null;
  brandName: string | null;
  ipAddress: string;
  username: string;
  hasPassword: boolean;
  macAddress: string;
  serialNumber: string;
  receivedDate: string | null;
  testedDate: string | null;
  customerReport: string;
  inspection: string;
  result: string;
  resolution: string;
  caseNumber: string;
  images: ImageRef[];
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyInput {
  jobYearId: string;
  model: string;
  brandId: string | null;
  ipAddress: string;
  username: string;
  /** undefined = giữ nguyên mật khẩu cũ, '' = xóa mật khẩu. */
  password?: string;
  macAddress: string;
  serialNumber: string;
  receivedDate: string | null;
  testedDate: string | null;
  customerReport: string;
  inspection: string;
  result: string;
  resolution: string;
  caseNumber: string;
  images: ImageRef[];
}

export interface ExperienceRecord {
  id: string;
  brandId: string;
  brandName: string;
  experienceDate: string;
  projectId: string | null;
  projectText: string | null;
  projectExists: boolean;
  deviceModel: string;
  event: string;
  webUrl: string;
  images: ImageRef[];
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceInput {
  brandId: string;
  experienceDate: string;
  projectId: string | null;
  projectText: string | null;
  deviceModel: string;
  event: string;
  webUrl: string;
  images: ImageRef[];
}

export interface BackupInfo {
  path: string;
  fileName: string;
  createdAt: string;
  appVersion: string;
  counts: Record<string, number>;
}

export interface StorageUsage {
  bytes: number;
  count: number;
  quotaMb: number;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  encryption: 'os' | 'fallback';
}
