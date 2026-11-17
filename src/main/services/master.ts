import { randomUUID } from 'node:crypto';
import { cleanName, nameKey } from '../../shared/text';
import type { JobType, JobYear, MasterDeleteStrategy, MasterItem, MasterKind } from '../../shared/types';
import { MASTER_LABEL, ORDERED_MASTER_KINDS } from '../../shared/types';
import { validateMasterName, validateYearLabel } from '../../shared/validation';
import { AppError, now, type Ctx } from '../context';

interface MasterSpec {
  table: string;
  usage: { table: string; column: string; nullable: boolean }[];
}

const SPECS: Record<MasterKind, MasterSpec> = {
  clients: { table: 'clients', usage: [{ table: 'projects', column: 'client_id', nullable: true }] },
  siPartners: {
    table: 'si_partners',
    usage: [
      { table: 'projects', column: 'si_id', nullable: true },
      { table: 'warranty_records', column: 'si_id', nullable: true },
    ],
  },
  departments: { table: 'departments', usage: [{ table: 'salespersons', column: 'department_id', nullable: true }] },
  salespersons: { table: 'salespersons', usage: [{ table: 'projects', column: 'salesperson_id', nullable: true }] },
  freelanceStatuses: { table: 'freelance_statuses', usage: [{ table: 'freelance_jobs', column: 'status_id', nullable: true }] },
  brands: {
    table: 'brands',
    usage: [
      { table: 'warranty_records', column: 'brand_id', nullable: true },
      { table: 'experience_records', column: 'brand_id', nullable: false },
      { table: 'knowledge_records', column: 'brand_id', nullable: true },
      { table: 'project_brands', column: 'brand_id', nullable: false },
    ],
  },
};

function spec(kind: MasterKind): MasterSpec {
  const s = SPECS[kind];
  if (!s) throw new AppError('Loại danh mục không hợp lệ.');
  return s;
}

function usageCount(ctx: Ctx, kind: MasterKind, id: string): number {
  return spec(kind).usage.reduce(
    (sum, u) => sum + ctx.db.scalar<number>(`SELECT COUNT(*) FROM ${u.table} WHERE ${u.column} = ?`, [id]),
    0,
  );
}

export function listMaster(ctx: Ctx, kind: MasterKind): MasterItem[] {
  const s = spec(kind);
  const usageSql = s.usage
    .map((u) => `(SELECT COUNT(*) FROM ${u.table} WHERE ${u.table}.${u.column} = m.id)`)
    .join(' + ');
  const dept = kind === 'salespersons';
  return ctx.db
    .all<Record<string, any>>(
      `SELECT m.*, ${usageSql} AS usage_count${dept ? ', d.name AS department_name' : ''} FROM ${s.table} m
       ${dept ? 'LEFT JOIN departments d ON d.id = m.department_id' : ''} ORDER BY ${ORDERED_MASTER_KINDS.includes(kind) ? 'm.sort_order, m.name' : 'm.name COLLATE NOCASE'}`,
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      isActive: !!r.is_active,
      usageCount: r.usage_count,
      ...(dept ? { departmentId: r.department_id ?? null, departmentName: r.department_name ?? null } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

function getMaster(ctx: Ctx, kind: MasterKind, id: string): MasterItem {
  const item = listMaster(ctx, kind).find((m) => m.id === id);
  if (!item) throw new AppError(`Không tìm thấy ${MASTER_LABEL[kind]}.`);
  return item;
}

function assertUniqueName(ctx: Ctx, kind: MasterKind, name: string, exceptId?: string) {
  const key = nameKey(name);
  const dup = ctx.db
    .all<{ id: string; name: string }>(`SELECT id, name FROM ${spec(kind).table}`)
    .find((r) => r.id !== exceptId && nameKey(r.name) === key);
  if (dup) throw new AppError(`${MASTER_LABEL[kind]} "${dup.name}" đã tồn tại.`);
}

export function createMaster(ctx: Ctx, kind: MasterKind, rawName: string): MasterItem {
  const err = validateMasterName(rawName);
  if (err) throw new AppError(err);
  const name = cleanName(rawName);
  assertUniqueName(ctx, kind, name);
  const id = randomUUID();
  const stamp = now();
  const table = spec(kind).table;
  ctx.db.tx(() => {
    const order = ctx.db.scalar<number>(`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM ${table}`);
    ctx.db.run(`INSERT INTO ${table} (id,name,sort_order,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, [id, name, order, stamp, stamp]);
  });
  return getMaster(ctx, kind, id);
}

export function renameMaster(ctx: Ctx, kind: MasterKind, id: string, rawName: string): MasterItem {
  const err = validateMasterName(rawName);
  if (err) throw new AppError(err);
  const name = cleanName(rawName);
  getMaster(ctx, kind, id);
  assertUniqueName(ctx, kind, name, id);
  ctx.db.tx(() => ctx.db.run(`UPDATE ${spec(kind).table} SET name = ?, updated_at = ? WHERE id = ?`, [name, now(), id]));
  return getMaster(ctx, kind, id);
}

export function setSalespersonDepartment(ctx: Ctx, id: string, departmentId: string | null): MasterItem {
  getMaster(ctx, 'salespersons', id);
  if (departmentId) getMaster(ctx, 'departments', departmentId);
  ctx.db.tx(() => ctx.db.run('UPDATE salespersons SET department_id = ?, updated_at = ? WHERE id = ?', [departmentId, now(), id]));
  return getMaster(ctx, 'salespersons', id);
}

export function setMasterActive(ctx: Ctx, kind: MasterKind, id: string, active: boolean): void {
  getMaster(ctx, kind, id);
  ctx.db.tx(() => ctx.db.run(`UPDATE ${spec(kind).table} SET is_active = ?, updated_at = ? WHERE id = ?`, [active, now(), id]));
}

/** Đổi thứ tự (lên/xuống) cho danh mục sắp theo thứ tự người dùng chọn, vd Tình trạng của Job Freelance. */
export function moveMaster(ctx: Ctx, kind: MasterKind, id: string, direction: -1 | 1): void {
  if (!ORDERED_MASTER_KINDS.includes(kind)) throw new AppError(`${MASTER_LABEL[kind]} được sắp xếp theo tên.`);
  const items = listMaster(ctx, kind);
  const i = items.findIndex((m) => m.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  const table = spec(kind).table;
  ctx.db.tx(() => items.forEach((m, idx) => ctx.db.run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [idx, m.id])));
}

export function deleteMaster(ctx: Ctx, kind: MasterKind, id: string, strategy: MasterDeleteStrategy): void {
  const item = getMaster(ctx, kind, id);
  const s = spec(kind);
  const used = usageCount(ctx, kind, id);
  if (used > 0) {
    if (kind === 'brands')
      throw new AppError(`Hãng "${item.name}" đang được ${used} bản ghi sử dụng. Hãy Deactivate thay vì xóa.`);
    if (!strategy)
      throw new AppError(`${MASTER_LABEL[kind]} "${item.name}" đang được ${used} mục sử dụng. Chọn mục thay thế hoặc gỡ liên kết trước khi xóa.`);
    if ('replaceWithId' in strategy) {
      if (strategy.replaceWithId === id) throw new AppError('Mục thay thế phải khác mục cần xóa.');
      getMaster(ctx, kind, strategy.replaceWithId);
    } else if (s.usage.some((u) => !u.nullable)) {
      throw new AppError(`${MASTER_LABEL[kind]} là trường bắt buộc, chỉ có thể thay thế bằng mục khác.`);
    }
  }
  ctx.db.tx(() => {
    if (used > 0 && strategy) {
      const stamp = now();
      for (const u of s.usage) {
        const target = 'replaceWithId' in strategy ? strategy.replaceWithId : null;
        if (u.table === 'project_brands') continue;
        ctx.db.run(`UPDATE ${u.table} SET ${u.column} = ?, updated_at = ? WHERE ${u.column} = ?`, [target, stamp, id]);
      }
    }
    ctx.db.run(`DELETE FROM ${s.table} WHERE id = ?`, [id]);
  });
}

/* ---------------- Job years ---------------- */

function mapYear(r: Record<string, any>): JobYear {
  return {
    id: r.id,
    jobType: r.job_type,
    yearLabel: r.year_label,
    sortOrder: r.sort_order,
    projectCount: r.project_count ?? 0,
    warrantyCount: r.warranty_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listYears(ctx: Ctx): JobYear[] {
  return ctx.db
    .all(
      `SELECT y.*,
        (SELECT COUNT(*) FROM projects p WHERE p.job_year_id = y.id) AS project_count,
        (SELECT COUNT(*) FROM warranty_records w WHERE w.job_year_id = y.id) AS warranty_count
       FROM job_years y ORDER BY y.job_type, y.sort_order DESC, y.year_label DESC`,
    )
    .map(mapYear);
}

export function getYear(ctx: Ctx, id: string): JobYear {
  const y = listYears(ctx).find((x) => x.id === id);
  if (!y) throw new AppError('Không tìm thấy năm.');
  return y;
}

function assertYearUnique(ctx: Ctx, jobType: JobType, label: string, exceptId?: string) {
  const key = nameKey(label);
  const dup = listYears(ctx).find((y) => y.jobType === jobType && y.id !== exceptId && nameKey(y.yearLabel) === key);
  if (dup) throw new AppError(`Năm "${dup.yearLabel}" đã tồn tại trong Job này.`);
}

export function createYear(ctx: Ctx, jobType: JobType, rawLabel: string): JobYear {
  if (jobType === 'FREELANCE') throw new AppError('Job Freelance là một bảng chung, không chia theo năm.');
  if (jobType !== 'MAIN') throw new AppError('Job không hợp lệ.');
  const err = validateYearLabel(rawLabel);
  if (err) throw new AppError(err);
  const label = cleanName(rawLabel);
  assertYearUnique(ctx, jobType, label);
  const id = randomUUID();
  const stamp = now();
  const numeric = /^\d{4}$/.test(label) ? Number(label) : null;
  ctx.db.tx(() => {
    const order = numeric ?? ctx.db.scalar<number>('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM job_years WHERE job_type = ?', [jobType]);
    ctx.db.run('INSERT INTO job_years VALUES (?,?,?,?,?,?)', [id, jobType, label, order, stamp, stamp]);
  });
  return getYear(ctx, id);
}

export function renameYear(ctx: Ctx, id: string, rawLabel: string): JobYear {
  const err = validateYearLabel(rawLabel);
  if (err) throw new AppError(err);
  const label = cleanName(rawLabel);
  const y = getYear(ctx, id);
  assertYearUnique(ctx, y.jobType, label, id);
  ctx.db.tx(() => ctx.db.run('UPDATE job_years SET year_label = ?, updated_at = ? WHERE id = ?', [label, now(), id]));
  return getYear(ctx, id);
}

export function deleteYear(ctx: Ctx, id: string): void {
  const y = getYear(ctx, id);
  if (y.projectCount + y.warrantyCount > 0)
    throw new AppError(
      `Năm "${y.yearLabel}" còn ${y.projectCount} Project và ${y.warrantyCount} Warranty Record. Hãy di chuyển hoặc xóa dữ liệu trước.`,
    );
  ctx.db.tx(() => ctx.db.run('DELETE FROM job_years WHERE id = ?', [id]));
}
