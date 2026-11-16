export type JobType = 'MAIN' | 'FREELANCE';
export type ProjectCategory = 'PRE_SALES' | 'POST_SALES';
export type WorkCategory = ProjectCategory | 'WARRANTY';
export type DeadlineStatus = 'URGENT' | 'ATTENTION' | 'NEW' | 'COMPLETED';
export type ActiveStatus = Exclude<DeadlineStatus, 'COMPLETED'>;
export type Theme = 'light' | 'dark';
export type MasterKind = 'clients' | 'designUnits' | 'stages' | 'brands' | 'salespersons' | 'siPartners' | 'departments';
export const MASTER_KINDS: MasterKind[] = ['clients', 'siPartners', 'brands', 'salespersons', 'departments', 'designUnits', 'stages'];

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
  clients: 'EU',
  designUnits: 'Đơn vị thiết kế',
  stages: 'Giai đoạn',
  brands: 'Hãng',
  salespersons: 'Sale',
  siPartners: 'Tên SI',
  departments: 'Phòng ban',
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
  /** Thư mục cha dùng gần nhất khi tạo thư mục dự án (mặc định cho lần sau). */
  projectRootDir: string | null;
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
  /** Chỉ có ở Sale: phòng ban của người đó. */
  departmentId?: string | null;
  departmentName?: string | null;
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

export interface NamedRef {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  /** Số thứ tự dự án (duy nhất), dùng trong tên thư mục "STT.Tên dự án_Tên SI_Hãng". */
  stt: number;
  jobYearId: string;
  jobType: JobType;
  yearLabel: string;
  workCategory: ProjectCategory;
  /** Ngày bắt đầu (tên cũ: Ngày tiếp nhận). */
  receivedDate: string | null;
  dueDate: string | null;
  projectName: string;
  /** EU (tên cũ: CĐT). */
  clientId: string | null;
  clientName: string | null;
  siId: string | null;
  siName: string | null;
  brands: NamedRef[];
  salespersonDepartment: string | null;
  /** Thư mục của dự án trên máy (tự tạo/đổi tên theo STT, tên, SI, Hãng). */
  folderPath: string | null;
  designUnitId: string | null;
  designUnitName: string | null;
  stageId: string | null;
  stageName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
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
  /** undefined = tự lấy STT lớn nhất + 1; null = người dùng bỏ trống (báo lỗi). */
  stt?: number | null;
  jobYearId: string;
  workCategory: ProjectCategory;
  receivedDate: string | null;
  dueDate: string | null;
  projectName: string;
  clientId: string | null;
  siId?: string | null;
  brandIds?: string[];
  /** Thư mục cha chứa thư mục dự án; undefined = giữ nguyên (khi sửa) / không tạo thư mục. */
  folderParent?: string | null;
  designUnitId: string | null;
  stageId: string | null;
  salespersonId: string | null;
  note: string;
  filePath: string | null;
  fileName: string | null;
  fileExtension: string | null;
  priorityPoint: number;
}

/** Kết quả lưu dự án; `notice` = cảnh báo không chặn (ví dụ chưa đổi được tên thư mục vì đang mở). */
export type ProjectSaved = Project & { notice?: string };

export interface ProjectSaveOptions {
  /** Ghi một sự kiện "Cập nhật dự án" (kèm tóm tắt thay đổi) vào Calendar ngày hôm nay. */
  addToCalendar?: boolean;
  /** Ghi chú (HTML) của ngày hôm nay; undefined = không đổi, rỗng = xóa ghi chú hôm nay. */
  noteHtml?: string;
}

/** Ghi chú dự án theo ngày: mỗi ngày một mục, sửa được mục của ngày cũ. */
export interface ProjectNote {
  id: string;
  projectId: string;
  noteDate: string;
  html: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectNoteInput {
  noteDate: string;
  html: string;
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
  siId: string | null;
  siName: string | null;
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
  siId?: string | null;
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
  localPath: string;
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
  localPath?: string;
  images: ImageRef[];
}

export interface KnowledgeRecord {
  id: string;
  brandId: string | null;
  brandName: string | null;
  knowledgeDate: string;
  title: string;
  deviceModel: string;
  content: string;
  webUrl: string;
  localPath: string;
  images: ImageRef[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeInput {
  brandId: string | null;
  knowledgeDate: string;
  title: string;
  deviceModel: string;
  content: string;
  webUrl: string;
  localPath?: string;
  images: ImageRef[];
}

export type CalendarEventKind = 'PROJECT_START' | 'PROJECT_UPDATE' | 'CUSTOM';

export const CALENDAR_KIND_LABEL: Record<CalendarEventKind, string> = {
  PROJECT_START: 'Bắt đầu dự án',
  PROJECT_UPDATE: 'Cập nhật dự án',
  CUSTOM: 'Sự kiện khác',
};

export const CALENDAR_COLORS = ['sage', 'blue', 'teal', 'amber', 'red', 'purple', 'gray'] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export interface CalendarEvent {
  id: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  note: string;
  color: CalendarColor | null;
  kind: CalendarEventKind;
  projectId: string | null;
  projectName: string | null;
  projectExists: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventInput {
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  note: string;
  color: CalendarColor | null;
  projectId: string | null;
}

export interface CalendarQuery {
  from?: string;
  to?: string;
  projectId?: string;
}

export type SearchMode = 'name' | 'si' | 'serial' | 'brand' | 'model';

export const SEARCH_MODE_LABEL: Record<SearchMode, string> = {
  name: 'Tên dự án',
  si: 'Tên SI',
  serial: 'Serial number',
  brand: 'Hãng',
  model: 'Model / Mã TB',
};

export interface SearchQuery {
  mode: SearchMode;
  text: string;
  /** Lọc theo Ngày bắt đầu (dự án) / Ngày nhận (Warranty). */
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export interface SearchHit {
  kind: 'project' | 'warranty';
  id: string;
  title: string;
  subtitle: string;
  /** Giá trị khớp với từ khóa (tên SI, serial, model…). */
  matched: string;
  date: string | null;
  jobType: JobType;
  jobYearId: string;
  yearLabel: string;
  workCategory: WorkCategory;
}

export interface XlsxExport {
  defaultName: string;
  sheetName: string;
  rows: (string | number | null)[][];
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
