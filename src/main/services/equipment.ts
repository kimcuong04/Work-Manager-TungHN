import { randomUUID } from 'node:crypto';
import type { EquipmentInput, EquipmentItem, EquipmentLoan, EquipmentLoanInput, EquipmentLoanOptions, ImageRef } from '../../shared/types';
import { isValidISODate } from '../../shared/dates';
import { cleanName } from '../../shared/text';
import { hasErrors, validateEquipmentInput, validateEquipmentLoanInput } from '../../shared/validation';
import { AppError, now, str, strOrNull, type Ctx } from '../context';
import { deleteImageFiles } from '../integration/images';
import { loadImages, syncImages, type ImageTable } from './records';

const IMG: ImageTable = { table: 'equipment_images', owner: 'equipment_id' };

const SELECT_ITEM = 'SELECT e.*, b.name AS brand_name FROM equipment_items e LEFT JOIN brands b ON b.id = e.brand_id';
const SELECT_LOAN = `
SELECT l.*, si.name AS si_name, s.name AS salesperson_name
FROM equipment_loans l
LEFT JOIN si_partners si ON si.id = l.si_id
LEFT JOIN salespersons s ON s.id = l.salesperson_id`;
const LOAN_ORDER = 'ORDER BY l.borrow_date DESC, l.created_at DESC';

const t = (s: string | null | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim();

function mapLoan(r: Record<string, any>): EquipmentLoan {
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    siId: strOrNull(r.si_id),
    siName: strOrNull(r.si_name),
    salespersonId: strOrNull(r.salesperson_id),
    salespersonName: strOrNull(r.salesperson_name),
    borrowDate: r.borrow_date,
    returnDate: strOrNull(r.return_date),
    reason: str(r.reason),
    returnCondition: str(r.return_condition),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function loadLoans(ctx: Ctx, ids: string[]): Map<string, EquipmentLoan[]> {
  const map = new Map<string, EquipmentLoan[]>();
  if (!ids.length) return map;
  const rows =
    ids.length === 1
      ? ctx.db.all<Record<string, any>>(`${SELECT_LOAN} WHERE l.equipment_id = ? ${LOAN_ORDER}`, ids)
      : ctx.db.all<Record<string, any>>(`${SELECT_LOAN} ${LOAN_ORDER}`);
  const wanted = new Set(ids);
  for (const r of rows) {
    if (!wanted.has(r.equipment_id)) continue;
    const list = map.get(r.equipment_id) ?? [];
    list.push(mapLoan(r));
    map.set(r.equipment_id, list);
  }
  return map;
}

function mapItem(r: Record<string, any>, images: ImageRef[], loans: EquipmentLoan[]): EquipmentItem {
  return {
    id: r.id,
    stt: r.stt,
    productName: str(r.product_name),
    brandId: strOrNull(r.brand_id),
    brandName: strOrNull(r.brand_name),
    serialNumber: str(r.serial_number),
    description: str(r.description),
    handoverDate: strOrNull(r.handover_date),
    condition: str(r.condition),
    currentBorrowDate: strOrNull(r.current_borrow_date),
    currentDueDate: strOrNull(r.current_due_date),
    images,
    loans,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listEquipment(ctx: Ctx): EquipmentItem[] {
  const rows = ctx.db.all<Record<string, any>>(`${SELECT_ITEM} ORDER BY e.stt DESC`);
  const ids = rows.map((r) => r.id as string);
  const imgs = loadImages(ctx, IMG, ids);
  const loans = loadLoans(ctx, ids);
  return rows.map((r) => mapItem(r, imgs.get(r.id) ?? [], loans.get(r.id) ?? []));
}

export function getEquipment(ctx: Ctx, id: string): EquipmentItem {
  const r = ctx.db.get<Record<string, any>>(`${SELECT_ITEM} WHERE e.id = ?`, [id]);
  if (!r) throw new AppError('Không tìm thấy thiết bị trong Kho thiết bị.');
  return mapItem(r, loadImages(ctx, IMG, [id]).get(id) ?? [], loadLoans(ctx, [id]).get(id) ?? []);
}

export function nextEquipmentStt(ctx: Ctx): number {
  return (ctx.db.scalar<number>('SELECT COALESCE(MAX(stt), 0) FROM equipment_items') ?? 0) + 1;
}

/** STT duy nhất trong cả kho: bỏ trống (undefined) thì giữ STT cũ khi sửa, hoặc lấy STT lớn nhất + 1. */
function resolveStt(ctx: Ctx, input: EquipmentInput, currentId?: string): number {
  let stt = input.stt ?? undefined;
  if (stt === undefined && currentId) stt = ctx.db.scalar<number>('SELECT stt FROM equipment_items WHERE id = ?', [currentId]) ?? undefined;
  if (stt === undefined) return nextEquipmentStt(ctx);
  const dup = ctx.db.get<{ product_name: string }>('SELECT product_name FROM equipment_items WHERE stt = ? AND id <> ?', [stt, currentId ?? '']);
  if (dup) throw new AppError(`STT ${stt} đã dùng cho thiết bị "${dup.product_name}". Hãy chọn STT khác (gợi ý: ${nextEquipmentStt(ctx)}).`);
  return stt;
}

function check(ctx: Ctx, input: EquipmentInput) {
  const e = validateEquipmentInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  if (input.brandId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM brands WHERE id = ?', [input.brandId])) throw new AppError('Hãng không tồn tại.');
}

const itemValues = (input: EquipmentInput) => [
  cleanName(input.productName),
  input.brandId || null,
  t(input.serialNumber),
  t(input.description),
  input.handoverDate || null,
  t(input.condition),
  input.currentBorrowDate || null,
  input.currentDueDate || null,
];

export function createEquipment(ctx: Ctx, input: EquipmentInput): EquipmentItem {
  check(ctx, input);
  const stt = resolveStt(ctx, input);
  const id = randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO equipment_items (id, stt, product_name, brand_id, serial_number, description, handover_date, condition, current_borrow_date, current_due_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, stt, ...itemValues(input), stamp, stamp],
    );
    syncImages(ctx, IMG, id, input.images ?? []);
  });
  return getEquipment(ctx, id);
}

export function updateEquipment(ctx: Ctx, id: string, input: EquipmentInput): EquipmentItem {
  getEquipment(ctx, id);
  check(ctx, input);
  const stt = resolveStt(ctx, input, id);
  let removed: string[] = [];
  ctx.db.tx(() => {
    ctx.db.run(
      `UPDATE equipment_items SET stt=?, product_name=?, brand_id=?, serial_number=?, description=?, handover_date=?, condition=?, current_borrow_date=?, current_due_date=?, updated_at=? WHERE id=?`,
      [stt, ...itemValues(input), now(), id],
    );
    removed = syncImages(ctx, IMG, id, input.images ?? []);
  });
  deleteImageFiles(ctx, removed);
  return getEquipment(ctx, id);
}

export function deleteEquipment(ctx: Ctx, id: string): void {
  const item = getEquipment(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM equipment_items WHERE id = ?', [id]));
  deleteImageFiles(ctx, item.images.map((i) => i.storageKey));
}

/** Xóa nhiều thiết bị (kèm ảnh và lịch sử mượn/trả) trong một transaction; id không còn tồn tại thì bỏ qua. */
export function deleteEquipments(ctx: Ctx, ids: string[]): number {
  const found = [...new Set(ids)].filter((id) => ctx.db.scalar<number>('SELECT COUNT(*) FROM equipment_items WHERE id = ?', [id]) > 0);
  const images = loadImages(ctx, IMG, found);
  ctx.db.tx(() => found.forEach((id) => ctx.db.run('DELETE FROM equipment_items WHERE id = ?', [id])));
  deleteImageFiles(ctx, [...images.values()].flat().map((i) => i.storageKey));
  return found.length;
}

/**
 * Thêm (loanId = null) hoặc sửa một lần mượn/trả. Sau khi lưu:
 * - `setCurrent` (lần mượn chưa trả): Ngày mượn hiện tại = Ngày mượn của lần này, Ngày hẹn trả hiện tại = `dueDate`.
 * - `clearCurrent` (lần mượn đã trả): xóa Ngày mượn / Ngày hẹn trả hiện tại.
 * - Nếu đây là lần trả mới nhất có ghi "Tình trạng khi trả" thì Tình trạng của thiết bị lấy theo giá trị đó.
 */
export function saveEquipmentLoan(ctx: Ctx, equipmentId: string, loanId: string | null, input: EquipmentLoanInput, opts: EquipmentLoanOptions = {}): EquipmentItem {
  getEquipment(ctx, equipmentId);
  const e = validateEquipmentLoanInput(input);
  if (hasErrors(e)) throw new AppError(Object.values(e).filter(Boolean).join(' '));
  if (input.siId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM si_partners WHERE id = ?', [input.siId])) throw new AppError('Tên SI không tồn tại.');
  if (input.salespersonId && !ctx.db.scalar<number>('SELECT COUNT(*) FROM salespersons WHERE id = ?', [input.salespersonId])) throw new AppError('Sale không tồn tại.');
  if (loanId) {
    const owner = ctx.db.scalar<string>('SELECT equipment_id FROM equipment_loans WHERE id = ?', [loanId]);
    if (owner !== equipmentId) throw new AppError('Không tìm thấy lần mượn này.');
  }
  const due = !input.returnDate ? opts.setCurrent?.dueDate ?? null : null;
  if (due && (!isValidISODate(due) || due < input.borrowDate)) throw new AppError('Ngày hẹn trả phải là ngày hợp lệ, không trước Ngày mượn.');
  const id = loanId ?? randomUUID();
  const stamp = now();
  ctx.db.tx(() => {
    const values = [input.siId || null, input.salespersonId || null, input.borrowDate, input.returnDate || null, t(input.reason), t(input.returnCondition)];
    if (loanId)
      ctx.db.run('UPDATE equipment_loans SET si_id=?, salesperson_id=?, borrow_date=?, return_date=?, reason=?, return_condition=?, updated_at=? WHERE id=?', [...values, stamp, id]);
    else
      ctx.db.run(
        'INSERT INTO equipment_loans (id, equipment_id, si_id, salesperson_id, borrow_date, return_date, reason, return_condition, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, equipmentId, ...values, stamp, stamp],
      );
    if (!input.returnDate && opts.setCurrent)
      ctx.db.run('UPDATE equipment_items SET current_borrow_date = ?, current_due_date = ? WHERE id = ?', [input.borrowDate, due, equipmentId]);
    if (input.returnDate && opts.clearCurrent) ctx.db.run('UPDATE equipment_items SET current_borrow_date = NULL, current_due_date = NULL WHERE id = ?', [equipmentId]);
    const latest = ctx.db.get<{ id: string; return_condition: string }>(
      "SELECT id, return_condition FROM equipment_loans WHERE equipment_id = ? AND return_date IS NOT NULL AND TRIM(return_condition) <> '' ORDER BY return_date DESC, updated_at DESC LIMIT 1",
      [equipmentId],
    );
    if (latest?.id === id) ctx.db.run('UPDATE equipment_items SET condition = ? WHERE id = ?', [latest.return_condition, equipmentId]);
    ctx.db.run('UPDATE equipment_items SET updated_at = ? WHERE id = ?', [stamp, equipmentId]);
  });
  return getEquipment(ctx, equipmentId);
}

/** Xóa một lần mượn/trả; thông tin hiện tại của thiết bị (Tình trạng, ngày mượn) giữ nguyên. */
export function deleteEquipmentLoan(ctx: Ctx, loanId: string): EquipmentItem {
  const owner = ctx.db.scalar<string>('SELECT equipment_id FROM equipment_loans WHERE id = ?', [loanId]);
  if (!owner) throw new AppError('Không tìm thấy lần mượn này.');
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM equipment_loans WHERE id = ?', [loanId]);
    ctx.db.run('UPDATE equipment_items SET updated_at = ? WHERE id = ?', [now(), owner]);
  });
  return getEquipment(ctx, owner);
}
