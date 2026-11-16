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
