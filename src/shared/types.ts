export type JobType = 'MAIN' | 'FREELANCE';
export type ProjectCategory = 'PRE_SALES' | 'POST_SALES';
export type WorkCategory = ProjectCategory | 'WARRANTY';
export type DeadlineStatus = 'URGENT' | 'ATTENTION' | 'NEW' | 'COMPLETED';
export type ActiveStatus = Exclude<DeadlineStatus, 'COMPLETED'>;
export type Theme = 'light' | 'dark';
export type MasterKind = 'clients' | 'brands' | 'salespersons' | 'siPartners' | 'departments' | 'freelanceStatuses' | 'freelanceHirers';
export const MASTER_KINDS: MasterKind[] = ['clients', 'siPartners', 'brands', 'salespersons', 'departments', 'freelanceStatuses', 'freelanceHirers'];
/** Danh mục theo phân loại trong Settings › Master Data: Job Freelance quản lý riêng, không dùng chung với Job Chính. */
export type MasterGroup = 'MAIN' | 'FREELANCE';
export const MASTER_GROUP: Record<MasterKind, MasterGroup> = {
  clients: 'MAIN',
  siPartners: 'MAIN',
  brands: 'MAIN',
  salespersons: 'MAIN',
  departments: 'MAIN',
  freelanceStatuses: 'FREELANCE',
  freelanceHirers: 'FREELANCE',
};
/** Danh mục sắp xếp theo thứ tự người dùng chọn (lên/xuống) thay vì theo tên. */
export const ORDERED_MASTER_KINDS: MasterKind[] = ['freelanceStatuses'];

/**
 * Job có năm và Pre-sales / Post-sales / Warranty. Từ v1.5 Job Freelance là một bảng riêng (`freelance_jobs`),
 * `FREELANCE` chỉ còn trong kiểu dữ liệu để đọc bản ghi cũ.
 */
export const JOB_TYPES: JobType[] = ['MAIN'];
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
  brands: 'Hãng',
  salespersons: 'Sale',
  siPartners: 'Tên SI',
  departments: 'Phòng ban',
  freelanceStatuses: 'Tình trạng',
  freelanceHirers: 'Bên thuê',
};

/** File liên kết của dự án: bản vẽ AutoCAD, văn bản, Word, PDF (chỉ lưu đường dẫn, mở bằng ứng dụng mặc định). */
export const LINK_FILE_EXTENSIONS = ['dwg', 'txt', 'docx', 'pdf'];
export const LINK_FILE_LABEL = '.dwg, .txt, .docx, .pdf';
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
  /** false = thư mục có sẵn do người dùng liên kết khi tạo dự án: không tự đổi tên/chuyển theo thông tin dự án. */
  folderAuto: boolean;
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
  /** Chỉ khi tạo mới: liên kết thư mục có sẵn (không tạo thư mục mới, không tự đổi tên). */
  folderLink?: string | null;
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

/** Ghi chú theo ngày: mỗi ngày một mục, sửa được mục của ngày cũ. */
export interface DayNote {
  id: string;
  noteDate: string;
  html: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectNote extends DayNote {
  projectId: string;
}

export interface FreelanceNote extends DayNote {
  jobId: string;
}

/** Một dòng của bảng Job Freelance. */
export interface FreelanceJob {
  id: string;
  stt: number;
  projectName: string;
  /** Bên thuê (danh mục riêng của Job Freelance). */
  hirerId: string | null;
  /** Tên Bên thuê để hiển thị ('' nếu chưa có). */
  hirer: string;
  startDate: string | null;
  statusId: string | null;
  statusName: string | null;
  /** Bản chữ thuần của mọi ngày ghi chú (mới nhất trước). */
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface FreelanceInput {
  /** undefined = tự lấy STT lớn nhất + 1; null = người dùng bỏ trống (báo lỗi). */
  stt?: number | null;
  projectName: string;
  hirerId: string | null;
  startDate: string | null;
  statusId: string | null;
}

export interface FreelanceSaveOptions {
  /** Ghi chú (HTML) của ngày hôm nay; undefined = không đổi, rỗng = xóa ghi chú hôm nay. */
  noteHtml?: string;
}

/** Mục Password: chỉ trả về cờ có mật khẩu, mật khẩu thật lấy qua revealPassword. */
export interface PasswordEntry {
  id: string;
  siteName: string;
  username: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordInput {
  siteName: string;
  username: string;
  /** Bắt buộc khi tạo; khi sửa undefined = giữ nguyên. */
  password?: string;
  url: string;
}

export interface OnlineTool {
  id: string;
  name: string;
  purpose: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineToolInput {
  name: string;
  purpose: string;
  url: string;
}

/** Import hàng loạt từ .xlsx vào Pre-sales / Post-sales / Warranty của một năm, hoặc bảng Job Freelance. */
export type BulkTarget = 'PRE_SALES' | 'POST_SALES' | 'WARRANTY' | 'FREELANCE';

export type BulkValue = string | number | null;

export interface BulkRowInput {
  /** Số dòng trong sheet (bắt đầu từ 1) để báo lỗi. */
  rowNumber: number;
  values: Record<string, BulkValue>;
}

export interface BulkImportSpec {
  target: BulkTarget;
  /** Bắt buộc với Pre-sales / Post-sales / Warranty. */
  jobYearId?: string;
  rows: BulkRowInput[];
  /** Pre/Post-sales: tạo thư mục "STT.Tên dự án_Tên SI_Hãng" cho từng dự án trong thư mục này. */
  folderParent?: string | null;
  workbookSignature?: string;
  mappings?: ColumnMappingRecord[];
}

export interface BulkImportResult {
  created: number;
  skipped: { rowNumber: number; error: string }[];
  /** Mục mới được thêm vào danh mục (EU, Hãng, Tình trạng…) vì chưa có. */
  newMasters: { kind: MasterKind; name: string }[];
  /** Cảnh báo không chặn (vd thư mục đã có sẵn được liên kết). */
  notices: string[];
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
  /** Số thứ tự trong năm (duy nhất trong năm đó). */
  stt: number;
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
  /** undefined = tự lấy STT lớn nhất trong năm + 1; null = người dùng bỏ trống (báo lỗi). */
  stt?: number | null;
  jobYearId: string;
  model: string;
  brandId: string | null;
  siId?: string | null;
  ipAddress: string;
  username: string;
  /** undefined = giữ nguyên mật khẩu cũ, '' = xóa mật khẩu. */
  password?: string;
  /** Duplicate: dùng lại mật khẩu (đã mã hóa) của bản ghi này khi `password` để undefined. */
  copyPasswordFrom?: string;
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

/** Một lần cho mượn / trả thiết bị trong Kho thiết bị (log theo ngày). */
export interface EquipmentLoan {
  id: string;
  equipmentId: string;
  siId: string | null;
  siName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salespersonDepartment: string | null;
  borrowDate: string;
  /** null = chưa trả (đang mượn). */
  returnDate: string | null;
  reason: string;
  returnCondition: string;
  createdAt: string;
  updatedAt: string;
}

/** Thiết bị trong Kho thiết bị — quản lý riêng, không thuộc Job Chính. STT duy nhất trong cả kho. */
export interface EquipmentItem {
  id: string;
  stt: number;
  productName: string;
  brandId: string | null;
  brandName: string | null;
  serialNumber: string;
  /** Nhập tay; tự lấy theo "Tình trạng khi trả" khi ghi lần trả mới nhất. */
  condition: string;
  currentBorrowDate: string | null;
  currentDueDate: string | null;
  images: ImageRef[];
  /** Lịch sử mượn/trả, mới nhất trước (theo Ngày mượn). */
  loans: EquipmentLoan[];
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentInput {
  /** undefined = tự lấy STT lớn nhất + 1; null = người dùng bỏ trống (báo lỗi). */
  stt?: number | null;
  productName: string;
  brandId: string | null;
  serialNumber: string;
  condition: string;
  currentBorrowDate: string | null;
  currentDueDate: string | null;
  images: ImageRef[];
}

export interface EquipmentLoanInput {
  siId: string | null;
  salespersonId: string | null;
  borrowDate: string;
  returnDate: string | null;
  reason: string;
  returnCondition: string;
}

/** Cập nhật thông tin "hiện tại" của thiết bị khi lưu một lần mượn/trả. */
export interface EquipmentLoanOptions {
  /** Lần mượn chưa trả: đặt Ngày mượn hiện tại = Ngày mượn của lần này và Ngày hẹn trả hiện tại = giá trị này. */
  setCurrent?: { dueDate: string | null };
  /** Lần mượn đã trả: xóa Ngày mượn / Ngày hẹn trả hiện tại (thiết bị đã về kho). */
  clearCurrent?: boolean;
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

/** Nguồn hiển thị trên Calendar. Sự kiện tự tạo không liên kết dự án không thuộc nguồn nào (luôn hiện). */
export type CalendarSource = 'MAIN' | 'FREELANCE' | 'EXPERIENCE';

/**
 * Mục Calendar sinh trực tiếp từ dữ liệu Job Freelance / Kinh nghiệm (không lưu riêng nên luôn khớp khi sửa/xóa):
 * PROJECT_START = ngày bắt đầu job / ngày của kinh nghiệm; PROJECT_UPDATE = ngày có ghi chú / ngày sửa.
 */
export interface CalendarFeedItem {
  key: string;
  source: 'FREELANCE' | 'EXPERIENCE';
  kind: 'PROJECT_START' | 'PROJECT_UPDATE';
  date: string;
  title: string;
  subtitle: string;
  note: string;
  /** Id job Freelance / bản ghi Kinh nghiệm. */
  targetId: string;
  brandId?: string;
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
  kind: 'project' | 'warranty' | 'freelance' | 'equipment';
  id: string;
  title: string;
  subtitle: string;
  /** Giá trị khớp với từ khóa (tên SI, serial, model…). */
  matched: string;
  date: string | null;
  jobType: JobType;
  /** Rỗng với Job Freelance (không chia năm). */
  jobYearId: string;
  yearLabel: string;
  workCategory: WorkCategory | null;
}

export interface XlsxExport {
  defaultName: string;
  sheetName: string;
  rows: (string | number | null)[][];
  /** Chỉ số các cột chứa ngày ISO (YYYY-MM-DD): ghi thành ô ngày của Excel, hiển thị mm/dd/yyyy. */
  dateColumns?: number[];
  /** Chỉ số các cột nội dung nhiều dòng: bật "Wrap text" + căn trên để Excel hiện đủ các dòng. */
  wrapColumns?: number[];
}

/** Ghi chú theo ngày dạng chữ thuần (đã bỏ ảnh/định dạng), dùng khi xuất file. */
export interface NoteTextRow {
  projectId: string;
  noteDate: string;
  text: string;
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

export interface DataLocationInfo {
  dataDir: string;
  defaultDir: string;
  isDefault: boolean;
  /** Vị trí cũ còn bản dữ liệu (sau khi chuyển), null nếu đã dọn hoặc không có. */
  previousDir: string | null;
  sizeBytes: number;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  encryption: 'os' | 'fallback';
}
