import { inRange } from '../../shared/dates';
import { buildHaystack, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, JOB_LABEL, type JobType, type SearchHit, type SearchQuery } from '../../shared/types';
import { AppError, type Ctx } from '../context';

const MODES = new Set(['name', 'si', 'serial', 'brand', 'model']);

interface ProjectRow {
  id: string;
  stt: number;
  project_name: string;
  received_date: string | null;
  job_year_id: string;
  work_category: 'PRE_SALES' | 'POST_SALES';
  job_type: JobType;
  year_label: string;
  si_name: string | null;
  client_name: string | null;
}

interface WarrantyRow {
  id: string;
  model: string | null;
  serial_number: string | null;
  case_number: string | null;
  received_date: string | null;
  job_year_id: string;
  job_type: JobType;
  year_label: string;
  brand_name: string | null;
  si_name: string | null;
}

/**
 * Tìm toàn bộ dữ liệu theo một loại: Tên dự án, Tên SI, Serial (Warranty), Hãng, Model/Mã thiết bị (bảng thiết bị
 * import của dự án). Tên dự án tìm cả bảng Job Freelance. Lọc theo Ngày bắt đầu (dự án, Freelance) / Ngày nhận (Warranty).
 */
export function globalSearch(ctx: Ctx, q: SearchQuery): SearchHit[] {
  if (!MODES.has(q.mode)) throw new AppError('Kiểu tìm kiếm không hợp lệ.');
  const nq = normalizeText(q.text ?? '');
  if (!nq) return [];
  const from = q.from || null;
  const to = q.to || null;
  const inDate = (d: string | null) => inRange(d, from, to);
  const hit = (hay: (string | null | undefined)[]) => matchesQuery(nq, buildHaystack(hay));
  const out: SearchHit[] = [];

  const projectHit = (r: ProjectRow, matched: string): SearchHit => ({
    kind: 'project',
    id: r.id,
    title: `${r.stt}. ${r.project_name}`,
    subtitle: `${JOB_LABEL[r.job_type]} › ${r.year_label} › ${CATEGORY_LABEL[r.work_category]}${r.client_name ? ` · EU ${r.client_name}` : ''}`,
    matched,
    date: r.received_date,
    jobType: r.job_type,
    jobYearId: r.job_year_id,
    yearLabel: r.year_label,
    workCategory: r.work_category,
  });
  const warrantyHit = (r: WarrantyRow, matched: string): SearchHit => ({
    kind: 'warranty',
    id: r.id,
    title: `${r.model || 'Warranty'}${r.case_number ? ` · ${r.case_number}` : ''}`,
    subtitle: `Warranty · ${JOB_LABEL[r.job_type]} › ${r.year_label}${r.serial_number ? ` · SN ${r.serial_number}` : ''}`,
    matched,
    date: r.received_date,
    jobType: r.job_type,
    jobYearId: r.job_year_id,
    yearLabel: r.year_label,
    workCategory: 'WARRANTY',
  });

  if (q.mode !== 'serial') {
    const projects = ctx.db.all<ProjectRow>(
      `SELECT p.id, p.stt, p.project_name, p.received_date, p.job_year_id, p.work_category, y.job_type, y.year_label,
         si.name AS si_name, c.name AS client_name
       FROM projects p JOIN job_years y ON y.id = p.job_year_id
       LEFT JOIN si_partners si ON si.id = p.si_id LEFT JOIN clients c ON c.id = p.client_id`,
    );
    const brands = new Map<string, string[]>();
    if (q.mode === 'brand')
      for (const r of ctx.db.all<{ project_id: string; name: string }>('SELECT pb.project_id, b.name FROM project_brands pb JOIN brands b ON b.id = pb.brand_id'))
        brands.set(r.project_id, [...(brands.get(r.project_id) ?? []), r.name]);
    const models = new Map<string, string[]>();
    if (q.mode === 'model')
      for (const r of ctx.db.all<{ project_id: string; model: string | null }>(
        'SELECT i.project_id, it.model FROM imported_items it JOIN project_imports i ON i.id = it.project_import_id',
      ))
        if (r.model) models.set(r.project_id, [...(models.get(r.project_id) ?? []), r.model]);

    for (const r of projects) {
      if (!inDate(r.received_date)) continue;
      if (q.mode === 'name' && hit([String(r.stt), r.project_name])) out.push(projectHit(r, r.project_name));
      else if (q.mode === 'si' && r.si_name && hit([r.si_name])) out.push(projectHit(r, r.si_name));
      else if (q.mode === 'brand') {
        const m = (brands.get(r.id) ?? []).filter((b) => hit([b]));
        if (m.length) out.push(projectHit(r, m.join(', ')));
      } else if (q.mode === 'model') {
        const m = [...new Set((models.get(r.id) ?? []).filter((x) => hit([x])))];
        if (m.length) out.push(projectHit(r, m.slice(0, 4).join(', ') + (m.length > 4 ? ` (+${m.length - 4})` : '')));
      }
    }
  }

  if (q.mode === 'si' || q.mode === 'serial' || q.mode === 'brand') {
    const warranty = ctx.db.all<WarrantyRow>(
      `SELECT w.id, w.model, w.serial_number, w.case_number, w.received_date, w.job_year_id, y.job_type, y.year_label,
         b.name AS brand_name, si.name AS si_name
       FROM warranty_records w JOIN job_years y ON y.id = w.job_year_id
       LEFT JOIN brands b ON b.id = w.brand_id LEFT JOIN si_partners si ON si.id = w.si_id`,
    );
    for (const r of warranty) {
      if (!inDate(r.received_date)) continue;
      const value = q.mode === 'si' ? r.si_name : q.mode === 'serial' ? r.serial_number : r.brand_name;
      if (value && hit([value])) out.push(warrantyHit(r, value));
    }
  }

  if (q.mode === 'si' || q.mode === 'serial' || q.mode === 'brand' || q.mode === 'model') {
    const items = ctx.db.all<{ id: string; stt: number; product_name: string; serial_number: string; current_borrow_date: string | null; brand_name: string | null }>(
      'SELECT e.id, e.stt, e.product_name, e.serial_number, e.current_borrow_date, b.name AS brand_name FROM equipment_items e LEFT JOIN brands b ON b.id = e.brand_id',
    );
    const sis = new Map<string, string[]>();
    if (q.mode === 'si')
      for (const r of ctx.db.all<{ equipment_id: string; name: string }>('SELECT DISTINCT l.equipment_id, si.name FROM equipment_loans l JOIN si_partners si ON si.id = l.si_id'))
        sis.set(r.equipment_id, [...(sis.get(r.equipment_id) ?? []), r.name]);
    for (const r of items) {
      if (!inDate(r.current_borrow_date)) continue;
      const values = q.mode === 'si' ? sis.get(r.id) ?? [] : [q.mode === 'serial' ? r.serial_number : q.mode === 'brand' ? r.brand_name : r.product_name];
      const m = values.filter((v): v is string => !!v && hit([v]));
      if (!m.length) continue;
      out.push({
        kind: 'equipment',
        id: r.id,
        title: `${r.stt}. ${r.product_name}`,
        subtitle: `Kho thiết bị${r.brand_name ? ` · ${r.brand_name}` : ''}${r.serial_number ? ` · SN ${r.serial_number}` : ''}`,
        matched: m.join(', '),
        date: r.current_borrow_date,
        jobType: 'MAIN',
        jobYearId: '',
        yearLabel: '',
        workCategory: null,
      });
    }
  }

  if (q.mode === 'name') {
    const jobs =ctx.db.all<{ id: string; stt: number; project_name: string; hirer: string | null; start_date: string | null; status_name: string | null }>(
      'SELECT f.id, f.stt, f.project_name, h.name AS hirer, f.start_date, s.name AS status_name FROM freelance_jobs f LEFT JOIN freelance_statuses s ON s.id = f.status_id LEFT JOIN freelance_hirers h ON h.id = f.hirer_id',
    );
    for (const r of jobs) {
      if (!inDate(r.start_date) || !hit([String(r.stt), r.project_name])) continue;
      out.push({
        kind: 'freelance',
        id: r.id,
        title: `${r.stt}. ${r.project_name}`,
        subtitle: `Job Freelance${r.hirer ? ` · Bên thuê ${r.hirer}` : ''}${r.status_name ? ` · ${r.status_name}` : ''}`,
        matched: r.project_name,
        date: r.start_date,
        jobType: 'FREELANCE',
        jobYearId: '',
        yearLabel: r.start_date?.slice(0, 4) ?? '',
        workCategory: null,
      });
    }
  }

  out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title, 'vi'));
  return out.slice(0, Math.min(Math.max(q.limit ?? 300, 1), 1000));
}
