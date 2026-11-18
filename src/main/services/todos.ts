import { randomUUID } from 'node:crypto';
import { diffDays, formatDate, isValidISODate } from '../../shared/dates';
import { cleanName } from '../../shared/text';
import { CATEGORY_LABEL, type ProjectCategory, type TodoItem, type TodoTarget } from '../../shared/types';
import { AppError, now, type Ctx } from '../context';

const SELECT_TODO = `
SELECT t.*,
  p.stt AS p_stt, p.project_name AS p_name, p.work_category, p.is_completed, p.due_date AS p_due, y.year_label,
  f.stt AS f_stt, f.project_name AS f_name, fs.name AS f_status
FROM todo_items t
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN job_years y ON y.id = p.job_year_id
LEFT JOIN freelance_jobs f ON f.id = t.freelance_job_id
LEFT JOIN freelance_statuses fs ON fs.id = f.status_id`;

function mapTodo(r: Record<string, any>): TodoItem {
  if (r.title !== null && r.title !== undefined)
    return { id: r.id, todoDate: r.todo_date, kind: 'TASK', targetId: null, stt: null, title: r.title, scope: 'Việc tự nhập', status: null, sortOrder: r.sort_order, doneAt: r.done_at ?? null };
  const main = !!r.project_id;
  return {
    id: r.id,
    todoDate: r.todo_date,
    kind: main ? 'MAIN' : 'FREELANCE',
    targetId: main ? r.project_id : r.freelance_job_id,
    stt: main ? r.p_stt : r.f_stt,
    title: main ? r.p_name : r.f_name,
    scope: main ? `${CATEGORY_LABEL[r.work_category as ProjectCategory] ?? 'Job Chính'} ${r.year_label ?? ''}`.trim() : 'Job Freelance',
    status: main ? (r.is_completed ? 'Đã hoàn thành' : r.p_due ? `Hạn ${formatDate(r.p_due)}` : null) : r.f_status ?? null,
    sortOrder: r.sort_order,
    doneAt: r.done_at ?? null,
  };
}

function checkDate(date: string) {
  if (!isValidISODate(date)) throw new AppError('Ngày của To-do list không hợp lệ.');
}

/** Việc của một ngày: việc chưa xong theo thứ tự ưu tiên (kéo thả), sau đó các việc đã hoàn thành. */
export function listTodos(ctx: Ctx, date: string): TodoItem[] {
  checkDate(date);
  return ctx.db
    .all<Record<string, any>>(`${SELECT_TODO} WHERE t.todo_date = ? ${ORDER}`, [date])
    .map(mapTodo);
}

const ORDER = 'ORDER BY t.todo_date, (t.done_at IS NOT NULL), t.sort_order, t.done_at, t.created_at';

/** Việc của các ngày từ `from` đến `to` (tối đa 31 ngày), theo ngày rồi theo thứ tự ưu tiên. */
export function listTodosRange(ctx: Ctx, from: string, to: string): TodoItem[] {
  checkDate(from);
  checkDate(to);
  if (to < from || diffDays(to, from) > 31) throw new AppError('Khoảng ngày của To-do list không hợp lệ.');
  return ctx.db.all<Record<string, any>>(`${SELECT_TODO} WHERE t.todo_date BETWEEN ? AND ? ${ORDER}`, [from, to]).map(mapTodo);
}

const nextOrder = (ctx: Ctx, date: string) => ctx.db.scalar<number>('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todo_items WHERE todo_date = ? AND done_at IS NULL', [date]) ?? 0;

function taskTitle(raw: string): string {
  const title = cleanName(String(raw ?? ''));
  if (!title) throw new AppError('Nhập tên việc.');
  if (title.length > 300) throw new AppError('Tên việc tối đa 300 ký tự.');
  return title;
}

/** Thêm một việc tự nhập (chỉ có tên) vào cuối danh sách chưa xong của ngày `date`. */
export function addTodoTask(ctx: Ctx, date: string, title: string): TodoItem[] {
  checkDate(date);
  const name = taskTitle(title);
  const stamp = now();
  ctx.db.tx(() =>
    ctx.db.run('INSERT INTO todo_items (id, todo_date, title, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)', [randomUUID(), date, name, nextOrder(ctx, date), stamp, stamp]),
  );
  return listTodos(ctx, date);
}

/** Đổi tên việc tự nhập (việc trỏ tới dự án / job thì lấy tên theo dự án / job, không đổi ở đây). */
export function renameTodoTask(ctx: Ctx, id: string, title: string): TodoItem[] {
  const date = dateOf(ctx, id);
  if (ctx.db.scalar<string | null>('SELECT title FROM todo_items WHERE id = ?', [id]) === null) throw new AppError('Chỉ đổi tên được việc tự nhập.');
  const name = taskTitle(title);
  ctx.db.tx(() => ctx.db.run('UPDATE todo_items SET title = ?, updated_at = ? WHERE id = ?', [name, now(), id]));
  return listTodos(ctx, date);
}

/** Thêm các dự án Pre-sales / Post-sales và job Freelance vào ngày `date`; việc đã có trong ngày thì bỏ qua. */
export function addTodos(ctx: Ctx, date: string, targets: TodoTarget[]): TodoItem[] {
  checkDate(date);
  if (!Array.isArray(targets) || targets.length > 500) throw new AppError('Danh sách việc không hợp lệ.');
  const stamp = now();
  ctx.db.tx(() => {
    let order = nextOrder(ctx, date);
    for (const t of targets) {
      const id = String(t?.targetId ?? '');
      if (t?.kind === 'MAIN') {
        const ok = ctx.db.scalar<number>("SELECT COUNT(*) FROM projects WHERE id = ? AND work_category IN ('PRE_SALES','POST_SALES')", [id]);
        if (!ok) throw new AppError('Dự án không còn tồn tại (chỉ chọn được Pre-sales / Post-sales).');
        if (ctx.db.scalar<number>('SELECT COUNT(*) FROM todo_items WHERE todo_date = ? AND project_id = ?', [date, id])) continue;
        ctx.db.run('INSERT INTO todo_items (id, todo_date, project_id, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)', [randomUUID(), date, id, order++, stamp, stamp]);
      } else if (t?.kind === 'FREELANCE') {
        if (!ctx.db.scalar<number>('SELECT COUNT(*) FROM freelance_jobs WHERE id = ?', [id])) throw new AppError('Job Freelance không còn tồn tại.');
        if (ctx.db.scalar<number>('SELECT COUNT(*) FROM todo_items WHERE todo_date = ? AND freelance_job_id = ?', [date, id])) continue;
        ctx.db.run('INSERT INTO todo_items (id, todo_date, freelance_job_id, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)', [randomUUID(), date, id, order++, stamp, stamp]);
      } else throw new AppError('Loại việc không hợp lệ.');
    }
  });
  return listTodos(ctx, date);
}

function dateOf(ctx: Ctx, id: string): string {
  const date = ctx.db.scalar<string>('SELECT todo_date FROM todo_items WHERE id = ?', [id]);
  if (!date) throw new AppError('Không tìm thấy việc này trong To-do list.');
  return date;
}

/** Đánh dấu "Đã hoàn thành" (hoặc bỏ đánh dấu: việc quay lại cuối danh sách chưa xong). */
export function setTodoDone(ctx: Ctx, id: string, done: boolean): TodoItem[] {
  const date = dateOf(ctx, id);
  const stamp = now();
  ctx.db.tx(() => {
    if (done) ctx.db.run('UPDATE todo_items SET done_at = COALESCE(done_at, ?), updated_at = ? WHERE id = ?', [stamp, stamp, id]);
    else {
      const order = nextOrder(ctx, date);
      ctx.db.run('UPDATE todo_items SET done_at = NULL, sort_order = ?, updated_at = ? WHERE id = ?', [order, stamp, id]);
    }
  });
  return listTodos(ctx, date);
}

/** Thứ tự ưu tiên mới của các việc trong ngày (id theo thứ tự từ trên xuống); id không thuộc ngày đó thì bỏ qua. */
export function reorderTodos(ctx: Ctx, date: string, ids: string[]): TodoItem[] {
  checkDate(date);
  if (!Array.isArray(ids)) throw new AppError('Thứ tự không hợp lệ.');
  const stamp = now();
  ctx.db.tx(() => ids.forEach((id, i) => ctx.db.run('UPDATE todo_items SET sort_order = ?, updated_at = ? WHERE id = ? AND todo_date = ?', [i, stamp, String(id), date])));
  return listTodos(ctx, date);
}

export function deleteTodo(ctx: Ctx, id: string): TodoItem[] {
  const date = dateOf(ctx, id);
  ctx.db.tx(() => ctx.db.run('DELETE FROM todo_items WHERE id = ?', [id]));
  return listTodos(ctx, date);
}
