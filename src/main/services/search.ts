import { inRange } from '../../shared/dates';
import { buildHaystack, matchExcerpt, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, JOB_LABEL, type JobType, type SearchHit, type SearchQuery } from '../../shared/types';
import { AppError, type Ctx } from '../context';

const MODES = new Set(['name', 'si', 'serial', 'brand', 'model', 'note']);

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

const noHit = { jobType: 'MAIN' as JobType, jobYearId: '', yearLabel: '', workCategory: null };

/**
 * Tìm theo Ghi chú: ghi chú theo ngày của dự án Pre/Post-sales, Job Freelance, Sự kiện tạm thời (mỗi chủ sở hữu một
 * kết quả, lấy ngày ghi chú khớp gần nhất) và Ghi chú / Note của Password, Website - App - Địa điểm (không có ngày).
 */
function searchNotes(
  ctx: Ctx,
  text: string,
  h: { hit: (hay: (string | null | undefined)[]) => boolean; inDate: (d: string | null) => boolean; projectHit: (r: ProjectRow, matched: string) => SearchHit },
  out: SearchHit[],
) {
  const excerpt = (date: string | null, body: string) => `${date ? `${date.split('-').reverse().join('/')}: ` : ''}${matchExcerpt(body, text)}`;
  const firstByOwner = (rows: { owner: string; note_date: string; content_text: string }[]) => {
    const m = new Map<string, { date: string; body: string }>();
    for (const r of rows) if (!m.has(r.owner) && h.inDate(r.note_date) && h.hit([r.content_text])) m.set(r.owner, { date: r.note_date, body: r.content_text });
    return m;
  };

  const projectNotes = firstByOwner(ctx.db.all('SELECT project_id AS owner, note_date, content_text FROM project_notes ORDER BY note_date DESC'));
  if (projectNotes.size) {
    const rows = ctx.db.all<ProjectRow>(
      `SELECT p.id, p.stt, p.project_name, p.received_date, p.job_year_id, p.work_category, y.job_type, y.year_label, si.name AS si_name, c.name AS client_name
       FROM projects p JOIN job_years y ON y.id = p.job_year_id LEFT JOIN si_partners si ON si.id = p.si_id LEFT JOIN clients c ON c.id = p.client_id`,
    );
    for (const r of rows) {
      const n = projectNotes.get(r.id);
      if (n) out.push({ ...h.projectHit(r, excerpt(n.date, n.body)), date: n.date });
    }
  }

  const jobNotes = firstByOwner(ctx.db.all('SELECT job_id AS owner, note_date, content_text FROM freelance_notes ORDER BY note_date DESC'));
  for (const r of ctx.db.all<{ id: string; stt: number; project_name: string; hirer: string | null }>(
    'SELECT f.id, f.stt, f.project_name, hi.name AS hirer FROM freelance_jobs f LEFT JOIN freelance_hirers hi ON hi.id = f.hirer_id',
  )) {
    const n = jobNotes.get(r.id);
    if (n)
      out.push({
        kind: 'freelance',
        id: r.id,
        title: `${r.stt}. ${r.project_name}`,
        subtitle: `Job Freelance${r.hirer ? ` · Bên thuê ${r.hirer}` : ''}`,
        matched: excerpt(n.date, n.body),
        date: n.date,
        ...noHit,
        jobType: 'FREELANCE',
      });
  }

  const eventNotes = firstByOwner(ctx.db.all('SELECT event_id AS owner, note_date, content_text FROM temp_event_notes ORDER BY note_date DESC'));
  for (const r of ctx.db.all<{ id: string; stt: number; name: string; event_date: string | null; brand_name: string | null }>(
    `SELECT e.id, e.stt, e.name, e.event_date,
       (SELECT group_concat(name, ', ') FROM (SELECT b.name FROM temp_event_brands eb JOIN brands b ON b.id = eb.brand_id WHERE eb.event_id = e.id ORDER BY eb.sort_order)) AS brand_name
     FROM temp_events e`,
  )) {
    const n = eventNotes.get(r.id);
    if (n)
      out.push({
        kind: 'event',
        id: r.id,
        title: `${r.stt}. ${r.name}`,
        subtitle: `Sự kiện tạm thời${r.brand_name ? ` · ${r.brand_name}` : ''}`,
        matched: excerpt(n.date, n.body),
        date: n.date,
        ...noHit,
      });
  }

  // Password / Website - App - Địa điểm không có ngày: chỉ hiện khi không lọc theo khoảng ngày.
  if (!h.inDate(null)) return;
  for (const r of ctx.db.all<{ id: string; site_name: string; username: string; note: string }>("SELECT id, site_name, username, note FROM password_entries WHERE note <> ''"))
    if (h.hit([r.note]))
      out.push({ kind: 'password', id: r.id, title: r.site_name, subtitle: `Password · ${r.username}`, matched: excerpt(null, r.note), date: null, ...noHit });
  for (const r of ctx.db.all<{ id: string; name: string; note: string }>("SELECT id, name, note FROM knowledge_places WHERE note <> ''"))
    if (h.hit([r.note]))
      out.push({ kind: 'place', id: r.id, title: r.name, subtitle: 'Kiến thức › Website - App - Địa điểm', matched: excerpt(null, r.note), date: null, ...noHit });
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

  if (q.mode === 'note') searchNotes(ctx, q.text ?? '', { hit, inDate, projectHit }, out);

  out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title, 'vi'));
  return out.slice(0, Math.min(Math.max(q.limit ?? 300, 1), 1000));
}
