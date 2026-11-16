import { randomUUID } from 'node:crypto';
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

export interface Migration {
  version: number;
  up: (db: Db) => void;
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
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): void {
  const current = db.scalar<number>('PRAGMA user_version') ?? 0;
  const target = migrations[migrations.length - 1].version;
  if (current > target)
    throw new Error(`Dữ liệu được tạo bởi phiên bản mới hơn (schema ${current}). Hãy cập nhật ứng dụng.`);
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.tx(() => {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
}
