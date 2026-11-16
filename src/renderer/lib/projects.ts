import { STATUS_ORDER, computeStatus, remainingDays, type Thresholds } from '../../shared/status';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, JOB_LABEL, type DeadlineStatus, type JobType, type Project, type ProjectCategory } from '../../shared/types';

export interface ProjectView extends Project {
  status: DeadlineStatus;
  remaining: number;
  haystack: string;
  location: string;
}

export function buildViews(projects: Project[], today: string, th: Thresholds): ProjectView[] {
  return projects.map((p) => ({
    ...p,
    status: computeStatus(p, today, th),
    remaining: remainingDays(p.dueDate, today),
    haystack: buildHaystack([p.projectName, p.clientName, p.designUnitName, p.stageName, p.salespersonName, p.note]),
    location: `${JOB_LABEL[p.jobType]} › ${p.yearLabel} › ${CATEGORY_LABEL[p.workCategory]}`,
  }));
}

export interface ProjectFilter {
  q: string;
  clients: string[];
  designUnits: string[];
  salespersons: string[];
  jobs: JobType[];
  years: string[];
  categories: ProjectCategory[];
  statuses: DeadlineStatus[];
}

export const EMPTY_FILTER: ProjectFilter = { q: '', clients: [], designUnits: [], salespersons: [], jobs: [], years: [], categories: [], statuses: [] };

export function isFilterActive(f: ProjectFilter): boolean {
  return (
    !!f.q.trim() ||
    f.clients.length + f.designUnits.length + (f.salespersons?.length ?? 0) + f.jobs.length + f.years.length + f.categories.length + f.statuses.length > 0
  );
}

/** Search + các bộ lọc kết hợp đồng thời (AND giữa các nhóm, OR trong cùng nhóm). */
export function applyFilter(list: ProjectView[], f: ProjectFilter): ProjectView[] {
  const q = normalizeText(f.q);
  const yearKeys = new Set(f.years.map((y) => y.toLowerCase()));
  return list.filter(
    (p) =>
      (!f.clients.length || f.clients.includes(p.clientId)) &&
      (!f.designUnits.length || (p.designUnitId !== null && f.designUnits.includes(p.designUnitId))) &&
      (!f.salespersons?.length || (p.salespersonId !== null && f.salespersons.includes(p.salespersonId))) &&
      (!f.jobs.length || f.jobs.includes(p.jobType)) &&
      (!yearKeys.size || yearKeys.has(p.yearLabel.toLowerCase())) &&
      (!f.categories.length || f.categories.includes(p.workCategory)) &&
      (!f.statuses.length || f.statuses.includes(p.status)) &&
      matchesQuery(q, p.haystack),
  );
}

export type SortKey = 'priority' | 'due' | 'received' | 'name' | 'client' | 'status';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const SORT_LABEL: Record<SortKey, string> = {
  priority: 'Priority Point',
  due: 'Ngày tới hạn',
  received: 'Ngày tiếp nhận',
  name: 'Tên dự án',
  client: 'CĐT',
  status: 'Trạng thái',
};

export const DEFAULT_SORT: SortState = { key: 'priority', dir: 'asc' };

/** Mặc định: Priority tăng dần (1 trước 5), rồi ngày tới hạn tăng dần (SRS 5.2). */
export function sortProjects(list: ProjectView[], s: SortState): ProjectView[] {
  const sign = s.dir === 'asc' ? 1 : -1;
  const byDue = (a: ProjectView, b: ProjectView) => a.dueDate.localeCompare(b.dueDate);
  const cmp: Record<SortKey, (a: ProjectView, b: ProjectView) => number> = {
    priority: (a, b) => sign * (a.priorityPoint - b.priorityPoint) || byDue(a, b),
    due: (a, b) => sign * byDue(a, b) || a.priorityPoint - b.priorityPoint,
    received: (a, b) => sign * a.receivedDate.localeCompare(b.receivedDate) || a.priorityPoint - b.priorityPoint,
    name: (a, b) => sign * compareVi(a.projectName, b.projectName),
    client: (a, b) => sign * compareVi(a.clientName, b.clientName) || a.priorityPoint - b.priorityPoint,
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
