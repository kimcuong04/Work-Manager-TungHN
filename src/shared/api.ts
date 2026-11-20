import type {
  AppInfo,
  AppSettings,
  BackupInfo,
  DataLocationInfo,
  CalendarEvent,
  CalendarEventInput,
  CalendarFeedItem,
  CalendarQuery,
  BulkImportResult,
  BulkImportSpec,
  EquipmentInput,
  EquipmentItem,
  EquipmentLoanInput,
  ExperienceInput,
  FreelanceInput,
  FreelanceJob,
  FreelanceNote,
  CompanionPayment,
  CompanionPaymentInput,
  TempEvent,
  TempEventInput,
  DayNote,
  FreelanceSaveOptions,
  OnlineTool,
  OnlineToolInput,
  PasswordEntry,
  PasswordInput,
  ExperienceRecord,
  FileCheck,
  ImageRef,
  ImportOwner,
  ImportPayload,
  NoteTextRow,
  JobType,
  JobYear,
  KnowledgeInput,
  KnowledgePlace,
  KnowledgePlaceInput,
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
  ProjectSaved,
  ProjectSaveOptions,
  SearchHit,
  SearchQuery,
  XlsxExport,
  SettingsPatch,
  TodoItem,
  TodoTarget,
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
  /** Chỉ cho danh mục có màu (Tình trạng / Trạng thái thanh toán của Job Freelance). */
  setMasterColor(kind: MasterKind, id: string, color: string | null): Promise<MasterItem>;
  setSalespersonDepartment(id: string, departmentId: string | null): Promise<MasterItem>;
  /** Chỉ cho danh mục sắp theo thứ tự (Tình trạng Freelance). */
  moveMaster(kind: MasterKind, id: string, direction: -1 | 1): Promise<void>;

  listYears(): Promise<JobYear[]>;
  createYear(jobType: JobType, label: string): Promise<JobYear>;
  renameYear(id: string, label: string): Promise<JobYear>;
  deleteYear(id: string): Promise<void>;

  listProjects(): Promise<Project[]>;
  createProject(input: ProjectInput, opts?: ProjectSaveOptions): Promise<ProjectSaved>;
  updateProject(id: string, input: ProjectInput, opts?: ProjectSaveOptions): Promise<ProjectSaved>;
  /** `deleteFolder`: chuyển thư mục dự án vào Thùng rác trước khi xóa dự án. */
  deleteProject(id: string, opts?: { deleteFolder?: boolean }): Promise<void>;
  /**
   * Xóa nhiều dự án. `deleteFolder`: chuyển thư mục của từng dự án vào Thùng rác trước; dự án nào không chuyển được
   * thư mục thì giữ lại và trả về trong `failed`.
   */
  deleteProjects(ids: string[], opts?: { deleteFolder?: boolean }): Promise<{ deleted: number; failed: string[] }>;
  /** STT tiếp theo của danh sách (năm × Pre-sales/Post-sales). */
  nextProjectStt(jobYearId: string, category: ProjectCategory): Promise<number>;
  /** Chọn thư mục qua hộp thoại; thư mục được chọn mới dùng làm nơi lưu thư mục dự án. */
  pickFolder(title?: string): Promise<string | null>;
  openProjectFolder(id: string): Promise<void>;
  /** Tạo thư mục cho dự án chưa có, hoặc đổi tên thư mục cho khớp STT/Tên/SI/Hãng hiện tại. */
  syncProjectFolder(id: string, parent?: string | null): Promise<ProjectSaved>;
  /** Liên kết thư mục có sẵn (đã chọn qua pickFolder) — không tự đổi tên; null = bỏ liên kết (không xóa thư mục). */
  setProjectFolderLink(id: string, dir: string | null): Promise<ProjectSaved>;
  setProjectCompleted(id: string, completed: boolean): Promise<Project>;
  applyBoardChanges(changes: { id: string; completed: boolean }[]): Promise<void>;
  moveProject(id: string, jobYearId: string, category: ProjectCategory): Promise<Project>;

  listProjectNotes(projectId: string): Promise<ProjectNote[]>;
  /** Lưu (tạo/sửa) ghi chú của một ngày; nội dung rỗng thì xóa mục của ngày đó và trả về null. */
  saveProjectNote(projectId: string, input: ProjectNoteInput, opts?: { addToCalendar?: boolean }): Promise<ProjectNote | null>;
  deleteProjectNote(id: string): Promise<void>;
  /** Ghi chú chữ thuần của mọi dự án trong khoảng ngày (vd một tháng). */
  listProjectNotesInRange(from: string, to: string): Promise<NoteTextRow[]>;

  listFreelance(): Promise<FreelanceJob[]>;
  nextFreelanceStt(): Promise<number>;
  createFreelance(input: FreelanceInput, opts?: FreelanceSaveOptions): Promise<FreelanceJob>;
  updateFreelance(id: string, input: FreelanceInput, opts?: FreelanceSaveOptions): Promise<FreelanceJob>;
  setFreelanceStatus(id: string, statusId: string | null): Promise<FreelanceJob>;
  setFreelancePaymentStatus(id: string, paymentStatusId: string | null): Promise<FreelanceJob>;
  deleteFreelance(id: string): Promise<void>;
  deleteFreelances(ids: string[]): Promise<number>;
  listFreelanceNotes(jobId: string): Promise<FreelanceNote[]>;
  /** Nội dung rỗng thì xóa mục của ngày đó và trả về null. */
  saveFreelanceNote(jobId: string, input: ProjectNoteInput): Promise<FreelanceNote | null>;
  deleteFreelanceNote(id: string): Promise<void>;
  /** Các lần thanh toán cho người đồng hành của job (mới nhất trước). */
  listCompanionPayments(jobId: string): Promise<CompanionPayment[]>;
  /** Ghi một lần thanh toán (ngày tự ghi là hôm nay). */
  addCompanionPayment(jobId: string, companionId: string, input: CompanionPaymentInput): Promise<CompanionPayment>;
  updateCompanionPayment(id: string, input: CompanionPaymentInput): Promise<CompanionPayment>;
  deleteCompanionPayment(id: string): Promise<void>;

  /* Sự kiện tạm thời (dưới Kho thiết bị) */
  listEvents(): Promise<TempEvent[]>;
  nextEventStt(): Promise<number>;
  createEvent(input: TempEventInput, opts?: { noteHtml?: string }): Promise<TempEvent>;
  updateEvent(id: string, input: TempEventInput): Promise<TempEvent>;
  deleteEvent(id: string): Promise<void>;
  setEventFiles(id: string, files: LinkedFile[]): Promise<TempEvent>;
  /** Liên kết thư mục có sẵn trên máy (null = bỏ liên kết). */
  setEventFolder(id: string, folder: string | null): Promise<TempEvent>;
  listEventNotes(eventId: string): Promise<DayNote[]>;
  saveEventNote(eventId: string, input: ProjectNoteInput): Promise<DayNote | null>;
  deleteEventNote(id: string): Promise<void>;
  listEventImports(eventId: string): Promise<ProjectImport[]>;
  commitEventImport(eventId: string, payload: ImportPayload, replaceImportId?: string | null): Promise<ProjectImport>;
  removeEventImport(eventId: string, importId: string): Promise<void>;
  renameEventImport(eventId: string, importId: string, name: string): Promise<ProjectImport>;
  reorderEventImports(eventId: string, ids: string[]): Promise<ProjectImport[]>;

  /** Import nhiều dòng từ .xlsx (đã map cột) vào Pre-sales / Post-sales / Warranty / Job Freelance. */
  bulkImport(spec: BulkImportSpec): Promise<BulkImportResult>;

  listPasswords(): Promise<PasswordEntry[]>;
  createPassword(input: PasswordInput): Promise<PasswordEntry>;
  updatePassword(id: string, input: PasswordInput): Promise<PasswordEntry>;
  deletePassword(id: string): Promise<void>;
  revealPassword(id: string): Promise<string>;

  listOnlineTools(): Promise<OnlineTool[]>;
  createOnlineTool(input: OnlineToolInput): Promise<OnlineTool>;
  updateOnlineTool(id: string, input: OnlineToolInput): Promise<OnlineTool>;
  deleteOnlineTool(id: string): Promise<void>;

  pickLinkFile(): Promise<LinkedFile | null>;
  /** Chọn một hoặc nhiều file liên kết cùng lúc. */
  pickLinkFiles(): Promise<LinkedFile[]>;
  /** Thay toàn bộ danh sách file liên kết của dự án. */
  setProjectFiles(projectId: string, files: LinkedFile[]): Promise<Project>;
  checkFile(path: string): Promise<FileCheck>;
  openFile(path: string): Promise<void>;
  showFileInFolder(path: string): Promise<void>;

  /** Chọn file .xlsx; hộp thoại mở sẵn thư mục của dự án / sự kiện `owner` (nếu có), thư mục import gần nhất, hoặc Downloads. */
  pickWorkbook(owner?: ImportOwner | null): Promise<string | null>;
  readWorkbook(path: string): Promise<WorkbookData>;
  /** Các bảng thiết bị import của dự án theo thứ tự tab (trái → phải). */
  listProjectImports(projectId: string): Promise<ProjectImport[]>;
  /** Thêm bảng import mới; có `replaceImportId` thì thay đúng bảng đó. */
  commitImport(projectId: string, payload: ImportPayload, replaceImportId?: string | null): Promise<ProjectImport>;
  removeImport(projectId: string, importId: string): Promise<void>;
  /** Đổi tên tab của bảng import. */
  renameImport(projectId: string, importId: string, name: string): Promise<ProjectImport>;
  /** Xếp lại thứ tự tab; `ids` gồm đủ các bảng import của dự án. */
  reorderImports(projectId: string, ids: string[]): Promise<ProjectImport[]>;

  listWarranty(jobYearId: string): Promise<WarrantyRecord[]>;
  createWarranty(input: WarrantyInput): Promise<WarrantyRecord>;
  updateWarranty(id: string, input: WarrantyInput): Promise<WarrantyRecord>;
  deleteWarranty(id: string): Promise<void>;
  deleteWarranties(ids: string[]): Promise<number>;
  nextWarrantyStt(jobYearId: string): Promise<number>;
  revealWarrantyPassword(id: string): Promise<string>;

  /** Kho thiết bị: bảng riêng (không thuộc Job Chính), kèm lịch sử mượn/trả của từng thiết bị. */
  listEquipment(): Promise<EquipmentItem[]>;
  nextEquipmentStt(): Promise<number>;
  createEquipment(input: EquipmentInput): Promise<EquipmentItem>;
  updateEquipment(id: string, input: EquipmentInput): Promise<EquipmentItem>;
  deleteEquipment(id: string): Promise<void>;
  deleteEquipments(ids: string[]): Promise<number>;
  /** Thêm (loanId = null) hoặc sửa một lần mượn/trả; trả về thiết bị sau khi cập nhật. */
  saveEquipmentLoan(equipmentId: string, loanId: string | null, input: EquipmentLoanInput): Promise<EquipmentItem>;
  deleteEquipmentLoan(loanId: string): Promise<EquipmentItem>;

  /** To-do list theo ngày (yyyy-mm-dd). Các hàm sửa trả về danh sách mới của ngày đó. */
  listTodos(date: string): Promise<TodoItem[]>;
  listTodosRange(from: string, to: string): Promise<TodoItem[]>;
  addTodoTask(date: string, title: string): Promise<TodoItem[]>;
  renameTodoTask(id: string, title: string): Promise<TodoItem[]>;
  addTodos(date: string, targets: TodoTarget[]): Promise<TodoItem[]>;
  setTodoDone(id: string, done: boolean): Promise<TodoItem[]>;
  reorderTodos(date: string, ids: string[]): Promise<TodoItem[]>;
  /** Kéo việc sang ngày khác / mục Vô thời hạn (`date` = ''), vào vị trí `index`; trả về danh sách mới của ngày cũ và ngày đích. */
  moveTodo(id: string, date: string, index: number): Promise<Record<string, TodoItem[]>>;
  deleteTodo(id: string): Promise<TodoItem[]>;

  pickImages(): Promise<ImageRef[]>;
  /** Lấy ảnh đang có trong clipboard hệ điều hành (ảnh chụp màn hình, ảnh copy, hoặc file ảnh copy từ Explorer). */
  pasteImages(): Promise<ImageRef[]>;
  /** Ảnh kéo thả từ thư mục trên máy (đường dẫn lấy qua webUtils ở preload). */
  importDroppedImages(paths: string[]): Promise<ImageRef[]>;
  copyImageToClipboard(storageKey: string): Promise<void>;

  listExperience(brandId: string | null): Promise<ExperienceRecord[]>;
  createExperience(input: ExperienceInput): Promise<ExperienceRecord>;
  updateExperience(id: string, input: ExperienceInput): Promise<ExperienceRecord>;
  deleteExperience(id: string): Promise<void>;
  /** Link website nhập tự do: link thì mở, không phải link thì tìm kiếm trên trình duyệt mặc định. */
  openExternalUrl(text: string): Promise<void>;
  /** "Hyperlink" tới file/thư mục trên máy cho Experience / Kiến thức. */
  pickLocalLink(kind: 'file' | 'folder'): Promise<string | null>;
  openLocalLink(path: string): Promise<void>;

  globalSearch(query: SearchQuery): Promise<SearchHit[]>;
  /** Hỏi nơi lưu rồi ghi file .xlsx; trả về đường dẫn hoặc null nếu hủy. */
  exportXlsx(spec: XlsxExport): Promise<string | null>;

  /** `{}` = tất cả, `{ brandId: null }` = Kiến thức chung. */
  listKnowledge(scope: { brandId?: string | null }): Promise<KnowledgeRecord[]>;
  createKnowledge(input: KnowledgeInput): Promise<KnowledgeRecord>;
  updateKnowledge(id: string, input: KnowledgeInput): Promise<KnowledgeRecord>;
  deleteKnowledge(id: string): Promise<void>;
  /** "Thêm Hãng" ở trang Kiến thức (Hãng trùng tên đang bị ẩn khỏi Kiến thức thì hiện lại). */
  addKnowledgeBrand(name: string): Promise<MasterItem>;
  /** Xóa Hãng khỏi Kiến thức: bài kiến thức chuyển sang Kiến thức chung (hoặc xóa luôn); Hãng còn dùng nơi khác thì chỉ ẩn. */
  removeKnowledgeBrand(brandId: string, deleteRecords: boolean): Promise<{ deletedBrand: boolean; moved: number; deleted: number }>;
  listPlaces(): Promise<KnowledgePlace[]>;
  createPlace(input: KnowledgePlaceInput): Promise<KnowledgePlace>;
  updatePlace(id: string, input: KnowledgePlaceInput): Promise<KnowledgePlace>;
  deletePlace(id: string): Promise<void>;

  listCalendarEvents(query: CalendarQuery): Promise<CalendarEvent[]>;
  /** Mục Calendar của Job Freelance và Kinh nghiệm (tính từ dữ liệu, chỉ đọc). */
  listCalendarFeed(query: CalendarQuery): Promise<CalendarFeedItem[]>;
  createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateCalendarEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent>;
  moveCalendarEvent(id: string, eventDate: string): Promise<CalendarEvent>;
  deleteCalendarEvent(id: string): Promise<void>;

  getStorageUsage(): Promise<StorageUsage>;
  exportBackup(): Promise<string | null>;
  pickBackup(): Promise<BackupInfo | null>;
  restoreBackup(path: string): Promise<void>;
  openDataFolder(): Promise<void>;

  getDataLocation(): Promise<DataLocationInfo>;
  /**
   * Chép dữ liệu sang thư mục khác (chọn qua hộp thoại) hoặc về thư mục mặc định, kiểm tra, ghi lại vị trí rồi
   * khởi động lại app. Trả về null nếu người dùng hủy.
   */
  changeDataDir(to: 'pick' | 'default'): Promise<{ dataDir: string } | null>;
  openPreviousDataFolder(): Promise<void>;
  /** Chuyển bản dữ liệu ở vị trí cũ vào Thùng rác. */
  trashPreviousData(): Promise<void>;

  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
}

export type ApiMethod = keyof Api;

export type ApiResult = { ok: true; data: unknown } | { ok: false; error: string };
