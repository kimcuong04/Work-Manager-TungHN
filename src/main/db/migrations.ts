import { randomUUID } from 'node:crypto';
import { formatDate } from '../../shared/dates';
import { noteHtmlToText, textToNoteHtml } from '../../shared/noteHtml';
import type { Db } from './database';

const MASTER_TABLE = (name: string) => `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

const IMAGE_TABLE = (name: string, owner: string, ownerTable: string) => `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  ${owner} TEXT NOT NULL REFERENCES ${ownerTable}(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_${name}_owner ON ${name}(${owner});`;

const V1 = `
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
${MASTER_TABLE('clients')}
${MASTER_TABLE('design_units')}
${MASTER_TABLE('project_stages')}
${MASTER_TABLE('brands')}

CREATE TABLE job_years (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('MAIN','FREELANCE')),
  year_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_job_years_label ON job_years(job_type, year_label COLLATE NOCASE);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  job_year_id TEXT NOT NULL REFERENCES job_years(id),
  work_category TEXT NOT NULL CHECK (work_category IN ('PRE_SALES','POST_SALES')),
  received_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  project_name TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  design_unit_id TEXT REFERENCES design_units(id),
  note TEXT,
  stage_id TEXT REFERENCES project_stages(id),
  file_path TEXT,
  file_name TEXT,
  file_extension TEXT,
  priority_point INTEGER NOT NULL CHECK (priority_point BETWEEN 1 AND 5),
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_node ON projects(job_year_id, work_category);

CREATE TABLE project_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  source_file_name TEXT NOT NULL,
  source_path TEXT,
  sheet_names TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE imported_project_info (
  id TEXT PRIMARY KEY,
  project_import_id TEXT NOT NULL REFERENCES project_imports(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_value TEXT,
  display_order INTEGER NOT NULL
);
CREATE TABLE imported_requirements (
  id TEXT PRIMARY KEY,
  project_import_id TEXT NOT NULL REFERENCES project_imports(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_date TEXT,
  sort_order INTEGER NOT NULL
);
CREATE TABLE imported_items (
  id TEXT PRIMARY KEY,
  project_import_id TEXT NOT NULL REFERENCES project_imports(id) ON DELETE CASCADE,
  model TEXT,
  brand TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL
);
CREATE TABLE import_column_mappings (
  workbook_signature TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  source_column TEXT NOT NULL,
  target_field TEXT NOT NULL,
  PRIMARY KEY (workbook_signature, target_field)
);

CREATE TABLE warranty_records (
  id TEXT PRIMARY KEY,
  job_year_id TEXT NOT NULL REFERENCES job_years(id),
  model TEXT,
  brand_id TEXT REFERENCES brands(id),
  ip_address TEXT,
  username TEXT,
  password_encrypted TEXT,
  mac_address TEXT,
  serial_number TEXT,
  received_date TEXT,
  tested_date TEXT,
  customer_report TEXT,
  inspection TEXT,
  result TEXT,
  resolution TEXT,
  case_number TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_warranty_year ON warranty_records(job_year_id);
${IMAGE_TABLE('warranty_images', 'warranty_record_id', 'warranty_records')}

CREATE TABLE experience_records (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  experience_date TEXT NOT NULL,
  project_id TEXT,
  project_text TEXT,
  device_model TEXT,
  event TEXT NOT NULL,
  web_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_experience_brand ON experience_records(brand_id);
${IMAGE_TABLE('experience_images', 'experience_id', 'experience_records')}
`;

function seedV1(db: Db) {
  const now = new Date().toISOString();
  const year = String(new Date().getFullYear());
  const settings: Record<string, string> = {
    theme: 'light',
    urgent_threshold_days: '2',
    attention_threshold_days: '5',
    image_quota_mb: '2048',
    xlsx_max_mb: '20',
    xlsx_max_rows: '20000',
  };
  for (const [k, v] of Object.entries(settings)) db.run('INSERT INTO app_settings VALUES (?,?,?)', [k, v, now]);
  ['Concept', 'Thiết kế cơ sở', 'Thiết kế kỹ thuật', 'Thi công'].forEach((name, i) =>
    db.run('INSERT INTO project_stages VALUES (?,?,?,1,?,?)', [randomUUID(), name, i, now, now]),
  );
  for (const job of ['MAIN', 'FREELANCE'])
    db.run('INSERT INTO job_years VALUES (?,?,?,?,?,?)', [randomUUID(), job, year, Number(year), now, now]);
}

/** v1.3: Salesperson cho Project, module Kiến thức, Calendar. */
const V2 = `
${MASTER_TABLE('salespersons')}
ALTER TABLE projects ADD COLUMN salesperson_id TEXT REFERENCES salespersons(id);

CREATE TABLE knowledge_records (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id),
  knowledge_date TEXT NOT NULL,
  title TEXT NOT NULL,
  device_model TEXT,
  content TEXT,
  web_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_knowledge_brand ON knowledge_records(brand_id);
${IMAGE_TABLE('knowledge_images', 'knowledge_id', 'knowledge_records')}

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  title TEXT NOT NULL,
  note TEXT,
  color TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('PROJECT_START','PROJECT_UPDATE','CUSTOM')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_calendar_date ON calendar_events(event_date);
CREATE INDEX idx_calendar_project ON calendar_events(project_id);
`;

/** Dự án có từ trước khi có Calendar: đưa ngày tiếp nhận lên Calendar để lịch không trống. */
function backfillCalendarV2(db: Db) {
  const now = new Date().toISOString();
  const rows = db.all<{ id: string; project_name: string; received_date: string }>('SELECT id, project_name, received_date FROM projects');
  for (const r of rows)
    db.run(
      `INSERT INTO calendar_events (id, event_date, start_time, end_time, title, note, color, kind, project_id, project_name, created_at, updated_at)
       VALUES (?,?,NULL,NULL,?,'',NULL,'PROJECT_START',?,?,?,?)`,
      [randomUUID(), r.received_date, r.project_name, r.id, r.project_name, now, now],
    );
}

/** v1.3: ghi chú dự án lưu theo ngày (HTML có định dạng + ảnh dán vào). */
const V3 = `
CREATE TABLE project_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note_date TEXT NOT NULL,
  content_html TEXT NOT NULL,
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_project_notes_day ON project_notes(project_id, note_date);
${IMAGE_TABLE('project_note_images', 'note_id', 'project_notes')}
`;

/** Ghi chú dạng text của bản cũ thành mục ghi chú của ngày dự án được cập nhật lần cuối. */
function backfillNotesV3(db: Db) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = db.all<{ id: string; note: string | null; updated_at: string }>("SELECT id, note, updated_at FROM projects WHERE TRIM(COALESCE(note, '')) <> ''");
  for (const r of rows) {
    const d = new Date(r.updated_at);
    const day = Number.isNaN(d.getTime()) ? r.updated_at.slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const text = r.note!.replace(/\r\n/g, '\n');
    const html = text
      .split('\n')
      .map((line) => (line.trim() ? `<div>${esc(line)}</div>` : '<div><br></div>'))
      .join('');
    db.run('INSERT INTO project_notes VALUES (?,?,?,?,?,?,?)', [randomUUID(), r.id, day, html, text.trim(), r.updated_at, r.updated_at]);
  }
}

/**
 * v1.4: STT, Tên SI, nhiều Hãng/dự án, thư mục dự án trên máy; EU (CĐT) và các ngày thành không bắt buộc.
 * SQLite không bỏ được NOT NULL bằng ALTER nên tạo bảng projects mới, chép dữ liệu, rồi đổi tên
 * (chạy với foreign_keys = OFF để DROP bảng cũ không xóa dây chuyền ghi chú, lịch, dữ liệu import).
 */
const V4 = `
${MASTER_TABLE('si_partners')}
${MASTER_TABLE('departments')}
ALTER TABLE salespersons ADD COLUMN department_id TEXT REFERENCES departments(id);

CREATE TABLE projects_v4 (
  id TEXT PRIMARY KEY,
  stt INTEGER NOT NULL,
  job_year_id TEXT NOT NULL REFERENCES job_years(id),
  work_category TEXT NOT NULL CHECK (work_category IN ('PRE_SALES','POST_SALES')),
  received_date TEXT,
  due_date TEXT,
  project_name TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id),
  si_id TEXT REFERENCES si_partners(id),
  design_unit_id TEXT REFERENCES design_units(id),
  stage_id TEXT REFERENCES project_stages(id),
  salesperson_id TEXT REFERENCES salespersons(id),
  note TEXT,
  file_path TEXT,
  file_name TEXT,
  file_extension TEXT,
  folder_path TEXT,
  priority_point INTEGER NOT NULL CHECK (priority_point BETWEEN 1 AND 5),
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO projects_v4 (id, stt, job_year_id, work_category, received_date, due_date, project_name, client_id, si_id,
  design_unit_id, stage_id, salesperson_id, note, file_path, file_name, file_extension, folder_path, priority_point,
  is_completed, completed_at, created_at, updated_at)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id), job_year_id, work_category, received_date, due_date, project_name,
  client_id, NULL, design_unit_id, stage_id, salesperson_id, note, file_path, file_name, file_extension, NULL, priority_point,
  is_completed, completed_at, created_at, updated_at
FROM projects;
DROP TABLE projects;
ALTER TABLE projects_v4 RENAME TO projects;
CREATE INDEX idx_projects_node ON projects(job_year_id, work_category);
CREATE UNIQUE INDEX ux_projects_stt ON projects(stt);

CREATE TABLE project_brands (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, brand_id)
);
CREATE INDEX idx_project_brands_brand ON project_brands(brand_id);

ALTER TABLE warranty_records ADD COLUMN si_id TEXT REFERENCES si_partners(id);
ALTER TABLE experience_records ADD COLUMN local_path TEXT;
ALTER TABLE knowledge_records ADD COLUMN local_path TEXT;
`;

/** v1.5: Job Freelance thành bảng riêng (có Tình trạng + ghi chú theo ngày), mục Password, Tool online. */
const V5 = `
${MASTER_TABLE('freelance_statuses')}

CREATE TABLE freelance_jobs (
  id TEXT PRIMARY KEY,
  stt INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  hirer TEXT,
  start_date TEXT,
  status_id TEXT REFERENCES freelance_statuses(id),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_freelance_jobs_stt ON freelance_jobs(stt);

CREATE TABLE freelance_notes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES freelance_jobs(id) ON DELETE CASCADE,
  note_date TEXT NOT NULL,
  content_html TEXT NOT NULL,
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_freelance_notes_day ON freelance_notes(job_id, note_date);
${IMAGE_TABLE('freelance_note_images', 'note_id', 'freelance_notes')}

CREATE TABLE password_entries (
  id TEXT PRIMARY KEY,
  site_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  site_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE online_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const FREELANCE_STATUSES = ['Mới nhận', 'Đang làm', 'Tạm dừng', 'Hoàn thành', 'Đã hủy'];

function localDay(stamp: string): string {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return stamp.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Chuyển dự án Pre/Post-sales cũ của Job Freelance sang bảng freelance_jobs (giữ id, STT, tên, ngày bắt đầu và ghi chú
 * theo ngày; Bên thuê lấy từ EU, không có thì Tên SI). Các trường bảng mới không có (SI, Hãng, Sale, hạn, thư mục,
 * file, bảng thiết bị import) được ghi lại thành một mục ghi chú để không mất thông tin.
 * Warranty của Job Freelance chuyển sang Warranty Job Chính cùng năm. Sau đó xóa dự án và năm Freelance cũ.
 */
function migrateFreelanceV5(db: Db) {
  const stamp = new Date().toISOString();
  const statusIds = FREELANCE_STATUSES.map((name, i) => {
    const id = randomUUID();
    db.run('INSERT INTO freelance_statuses VALUES (?,?,?,1,?,?)', [id, name, i, stamp, stamp]);
    return id;
  });
  const doing = statusIds[1];
  const done = statusIds[3];

  const years = db.all<{ id: string; year_label: string }>("SELECT id, year_label FROM job_years WHERE job_type = 'FREELANCE'");
  if (!years.length) return;
  const yearIds = years.map((y) => y.id);
  const inYears = `(${yearIds.map(() => '?').join(',')})`;

  const rows = db.all<Record<string, any>>(
    `SELECT p.*, y.year_label, c.name AS client_name, si.name AS si_name, sp.name AS sale_name
     FROM projects p JOIN job_years y ON y.id = p.job_year_id
     LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN si_partners si ON si.id = p.si_id
     LEFT JOIN salespersons sp ON sp.id = p.salesperson_id
     WHERE p.job_year_id IN ${inYears} ORDER BY p.stt`,
    yearIds,
  );
  for (const p of rows) {
    db.run('INSERT INTO freelance_jobs VALUES (?,?,?,?,?,?,?,?,?)', [
      p.id,
      p.stt,
      p.project_name,
      p.client_name ?? p.si_name ?? null,
      p.received_date ?? null,
      p.is_completed ? done : doing,
      '',
      p.created_at,
      p.updated_at,
    ]);
    db.run(
      'INSERT INTO freelance_notes SELECT id, project_id, note_date, content_html, content_text, created_at, updated_at FROM project_notes WHERE project_id = ?',
      [p.id],
    );
    db.run(
      `INSERT INTO freelance_note_images SELECT i.id, i.note_id, i.storage_key, i.file_name, i.mime_type, i.size_bytes, i.sort_order, i.created_at
       FROM project_note_images i JOIN project_notes n ON n.id = i.note_id WHERE n.project_id = ?`,
      [p.id],
    );

    const cat = p.work_category === 'POST_SALES' ? 'Post-sales' : 'Pre-sales';
    const lines = [`Chuyển từ Job Freelance › ${p.year_label} › ${cat} (bản cũ). Thông tin không còn trong bảng mới:`];
    const add = (label: string, v: unknown) => {
      if (v !== null && v !== undefined && String(v).trim() !== '') lines.push(`${label}: ${v}`);
    };
    const brands = db.all<{ name: string }>(
      'SELECT b.name FROM project_brands pb JOIN brands b ON b.id = pb.brand_id WHERE pb.project_id = ? ORDER BY pb.sort_order',
      [p.id],
    );
    add('EU', p.client_name);
    add('Tên SI', p.si_name);
    add('Hãng', brands.map((b) => b.name).join(', '));
    add('Sale', p.sale_name);
    add('Ngày tới hạn', formatDate(p.due_date));
    add('Priority', p.priority_point);
    add('Thư mục dự án', p.folder_path);
    add('File liên kết', p.file_path);
    const imp = db.get<{ id: string; source_file_name: string }>('SELECT id, source_file_name FROM project_imports WHERE project_id = ?', [p.id]);
    if (imp) {
      const items = db.all<{ model: string | null; brand: string | null; description: string | null }>(
        'SELECT model, brand, description FROM imported_items WHERE project_import_id = ? ORDER BY sort_order',
        [imp.id],
      );
      lines.push(`Bảng thiết bị import từ ${imp.source_file_name} (${items.length} dòng):`);
      for (const it of items.slice(0, 500)) lines.push(`• ${[it.model, it.brand, it.description].filter((x) => x && x.trim()).join(' – ')}`);
      if (items.length > 500) lines.push(`… và ${items.length - 500} dòng khác (xem bản backup trước nâng cấp).`);
    }
    const day = localDay(p.created_at);
    const html = textToNoteHtml(lines.join('\n'));
    const existing = db.get<{ id: string; content_html: string }>('SELECT id, content_html FROM freelance_notes WHERE job_id = ? AND note_date = ?', [p.id, day]);
    if (existing) {
      const merged = `${existing.content_html}<div><br></div>${html}`;
      db.run('UPDATE freelance_notes SET content_html = ?, content_text = ? WHERE id = ?', [merged, noteHtmlToText(merged), existing.id]);
    } else db.run('INSERT INTO freelance_notes VALUES (?,?,?,?,?,?,?)', [randomUUID(), p.id, day, html, noteHtmlToText(html), stamp, stamp]);

    const derived = db
      .all<{ note_date: string; content_text: string }>('SELECT note_date, content_text FROM freelance_notes WHERE job_id = ? ORDER BY note_date DESC', [p.id])
      .map((n) => `${formatDate(n.note_date)}: ${n.content_text}`)
      .join('\n\n')
      .slice(0, 20_000);
    db.run('UPDATE freelance_jobs SET note = ? WHERE id = ?', [derived, p.id]);
    db.run("UPDATE experience_records SET project_text = ? WHERE project_id = ? AND TRIM(COALESCE(project_text, '')) = ''", [
      `${p.stt}. ${p.project_name} (Job Freelance)`,
      p.id,
    ]);
  }
  if (rows.length) db.run(`DELETE FROM projects WHERE job_year_id IN ${inYears}`, yearIds);

  for (const y of years) {
    if (!db.scalar<number>('SELECT COUNT(*) FROM warranty_records WHERE job_year_id = ?', [y.id])) continue;
    let main = db.scalar<string>("SELECT id FROM job_years WHERE job_type = 'MAIN' AND year_label = ? COLLATE NOCASE", [y.year_label]);
    if (!main) {
      main = randomUUID();
      const order = /^\d{4}$/.test(y.year_label)
        ? Number(y.year_label)
        : (db.scalar<number>("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM job_years WHERE job_type = 'MAIN'") ?? 1);
      db.run("INSERT INTO job_years VALUES (?, 'MAIN', ?, ?, ?, ?)", [main, y.year_label, order, stamp, stamp]);
    }
    db.run('UPDATE warranty_records SET job_year_id = ? WHERE job_year_id = ?', [main, y.id]);
  }
  db.run(`DELETE FROM job_years WHERE id IN ${inYears}`, yearIds);
}

export interface Migration {
  version: number;
  up: (db: Db) => void;
  /** Tắt kiểm tra khóa ngoại trong lúc chạy (bắt buộc khi tạo lại bảng có bảng con tham chiếu). */
  foreignKeysOff?: boolean;
}

/**
 * Thêm migration mới vào CUỐI mảng (version tăng dần); KHÔNG sửa/xóa migration đã phát hành vì máy
 * user đã chạy chúng rồi. Không DROP/tạo lại bảng mà không copy dữ liệu.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(V1);
      seedV1(db);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(V2);
      backfillCalendarV2(db);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(V3);
      backfillNotesV3(db);
    },
  },
  {
    version: 4,
    foreignKeysOff: true,
    up: (db) => db.exec(V4),
  },
  {
    version: 5,
    up: (db) => {
      db.exec(V5);
      migrateFreelanceV5(db);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): void {
  const current = db.scalar<number>('PRAGMA user_version') ?? 0;
  const target = migrations[migrations.length - 1].version;
  if (current > target)
    throw new Error(`Dữ liệu được tạo bởi phiên bản mới hơn (schema ${current}). Hãy cập nhật ứng dụng.`);
  for (const m of migrations) {
    if (m.version <= current) continue;
    // PRAGMA foreign_keys không có tác dụng bên trong transaction nên phải tắt trước BEGIN.
    if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.tx(() => {
        m.up(db);
        if (m.foreignKeysOff) {
          const broken = db.all('PRAGMA foreign_key_check');
          if (broken.length) throw new Error(`Nâng cấp dữ liệu lên schema ${m.version} làm hỏng ${broken.length} liên kết — đã hủy, dữ liệu giữ nguyên.`);
        }
        db.exec(`PRAGMA user_version = ${m.version}`);
      });
    } finally {
      if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
