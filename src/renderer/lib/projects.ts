import { STATUS_ORDER, computeStatus, remainingDays, type Thresholds } from '../../shared/status';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, JOB_LABEL, type DeadlineStatus, type JobType, type Project, type ProjectCategory } from '../../shared/types';

export interface ProjectView extends Project {
  status: DeadlineStatus;
  /** null = chưa có ngày tới hạn. */
  remaining: number | null;
  haystack: string;
  location: string;
  /** "STT. Tên dự án" */
  label: string;
  brandNames: string;
}

export function buildViews(projects: Project[], today: string, th: Thresholds): ProjectView[] {
  return projects.map((p) => {
    const brandNames = p.brands.map((b) => b.name).join(', ');
    return {
      ...p,
      status: computeStatus(p, today, th),
      remaining: remainingDays(p.dueDate, today),
      haystack: buildHaystack([String(p.stt), p.projectName, p.clientName, p.siName, brandNames, p.salespersonName, p.note]),
      location: `${JOB_LABEL[p.jobType]} › ${p.yearLabel} › ${CATEGORY_LABEL[p.workCategory]}`,
      label: `${p.stt}. ${p.projectName}`,
      brandNames,
    };
  });
}

/** "Tên/Phòng ban" cho màn chi tiết; bảng danh sách chỉ hiện tên. */
export function salesLabel(p: Pick<Project, 'salespersonName' | 'salespersonDepartment'>): string | null {
  if (!p.salespersonName) return null;
  return p.salespersonDepartment ? `${p.salespersonName}/${p.salespersonDepartment}` : p.salespersonName;
}

/** Ghi chú mới nhất (cột note tổng hợp các ngày, mới nhất trước). */
export function latestNote(p: Pick<Project, 'note'>): string {
  return (p.note ?? '').split('\n\n')[0] ?? '';
}

export interface ProjectFilter {
  q: string;
  clients: string[];
  salespersons: string[];
  sis?: string[];
  brands?: string[];
  jobs: JobType[];
  years: string[];
  categories: ProjectCategory[];
  statuses: DeadlineStatus[];
}

export const EMPTY_FILTER: ProjectFilter = { q: '', clients: [], salespersons: [], sis: [], brands: [], jobs: [], years: [], categories: [], statuses: [] };

export function isFilterActive(f: ProjectFilter): boolean {
  return (
    !!f.q.trim() ||
    f.clients.length + (f.salespersons?.length ?? 0) + (f.sis?.length ?? 0) + (f.brands?.length ?? 0) + f.jobs.length + f.years.length + f.categories.length + f.statuses.length > 0
  );
}

/** Search + các bộ lọc kết hợp đồng thời (AND giữa các nhóm, OR trong cùng nhóm). */
export function applyFilter(list: ProjectView[], f: ProjectFilter): ProjectView[] {
  const q = normalizeText(f.q);
  const yearKeys = new Set(f.years.map((y) => y.toLowerCase()));
  return list.filter(
    (p) =>
      (!f.clients.length || (p.clientId !== null && f.clients.includes(p.clientId))) &&
      (!f.sis?.length || (p.siId !== null && f.sis.includes(p.siId))) &&
      (!f.brands?.length || p.brands.some((b) => f.brands!.includes(b.id))) &&
      (!f.salespersons?.length || (p.salespersonId !== null && f.salespersons.includes(p.salespersonId))) &&
      (!f.jobs.length || f.jobs.includes(p.jobType)) &&
      (!yearKeys.size || yearKeys.has(p.yearLabel.toLowerCase())) &&
      (!f.categories.length || f.categories.includes(p.workCategory)) &&
      (!f.statuses.length || f.statuses.includes(p.status)) &&
      matchesQuery(q, p.haystack),
  );
}

export type SortKey = 'stt' | 'priority' | 'due' | 'received' | 'name' | 'client' | 'si' | 'status';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const SORT_LABEL: Record<SortKey, string> = {
  stt: 'STT',
  priority: 'Priority Point',
  due: 'Ngày tới hạn',
  received: 'Ngày bắt đầu',
  name: 'Tên dự án',
  client: 'EU',
  si: 'Tên SI',
  status: 'Trạng thái',
};

export const DEFAULT_SORT: SortState = { key: 'priority', dir: 'asc' };

/** Mặc định: Priority tăng dần (1 trước 5), rồi ngày tới hạn tăng dần (SRS 5.2). */
export function sortProjects(list: ProjectView[], s: SortState): ProjectView[] {
  const sign = s.dir === 'asc' ? 1 : -1;
  // Thiếu ngày/giá trị luôn xếp cuối, bất kể chiều sắp xếp.
  const nullsLast = (x: string | null, y: string | null, c: (x: string, y: string) => number) => (x && y ? sign * c(x, y) : x ? -1 : y ? 1 : 0);
  const byDue = (a: ProjectView, b: ProjectView) => (a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : 0);
  const cmp: Record<SortKey, (a: ProjectView, b: ProjectView) => number> = {
    stt: (a, b) => sign * (a.stt - b.stt),
    priority: (a, b) => sign * (a.priorityPoint - b.priorityPoint) || byDue(a, b),
    due: (a, b) => nullsLast(a.dueDate, b.dueDate, (x, y) => x.localeCompare(y)) || a.priorityPoint - b.priorityPoint,
    received: (a, b) => nullsLast(a.receivedDate, b.receivedDate, (x, y) => x.localeCompare(y)) || a.priorityPoint - b.priorityPoint,
    name: (a, b) => sign * compareVi(a.projectName, b.projectName),
    client: (a, b) => nullsLast(a.clientName, b.clientName, compareVi) || a.priorityPoint - b.priorityPoint,
    si: (a, b) => nullsLast(a.siName, b.siName, compareVi) || a.priorityPoint - b.priorityPoint,
    status: (a, b) => sign * (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) || a.priorityPoint - b.priorityPoint || byDue(a, b),
  };
  return [...list].sort(cmp[s.key]);
}

export function groupByStatus(list: ProjectView[]): Record<DeadlineStatus, ProjectView[]> {
  const g: Record<DeadlineStatus, ProjectView[]> = { URGENT: [], ATTENTION: [], NEW: [], COMPLETED: [] };
  for (const p of list) g[p.status].push(p);
  return g;
}

export const CATEGORY_SLUG: Record<string, 'PRE_SALES' | 'POST_SALES' | 'WARRANTY'> = {
  'pre-sales': 'PRE_SALES',
  'post-sales': 'POST_SALES',
  warranty: 'WARRANTY',
};
export const SLUG_OF: Record<'PRE_SALES' | 'POST_SALES' | 'WARRANTY', string> = {
  PRE_SALES: 'pre-sales',
  POST_SALES: 'post-sales',
  WARRANTY: 'warranty',
};

export function nodePath(jobType: JobType, yearId: string, cat: 'PRE_SALES' | 'POST_SALES' | 'WARRANTY'): string {
  return `/job/${jobType}/${yearId}/${SLUG_OF[cat]}`;
}
