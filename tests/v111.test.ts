import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import * as freelance from '../src/main/services/freelance';
import * as todos from '../src/main/services/todos';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

let ctx: Ctx;
beforeEach(async () => {
  ctx = await makeCtx();
});

describe('Nâng cấp v1.10 → v1.11', () => {
  it('việc cũ (job Freelance) giữ nguyên, sau đó thêm được việc tự nhập', async () => {
    const file = path.join(tmpDir(), 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 10));
    const c1 = { ...ctx, db: old };
    const j = freelance.createFreelance(c1, { projectName: 'Logo', hirerId: null, startDate: null, statusId: null });
    todos.addTodos(c1, TEST_TODAY, [{ kind: 'FREELANCE', targetId: j.id }]);
    old.close();
    const db = await Db.open(file);
    expect(SCHEMA_VERSION).toBe(11);
    expect(db.scalar<number>('PRAGMA user_version')).toBe(11);
    const c2 = { ...ctx, db };
    expect(todos.listTodos(c2, TEST_TODAY).map((t) => [t.kind, t.title])).toEqual([['FREELANCE', 'Logo']]);
    expect(todos.addTodoTask(c2, TEST_TODAY, 'Gọi lại khách').map((t) => [t.kind, t.title])).toEqual([
      ['FREELANCE', 'Logo'],
      ['TASK', 'Gọi lại khách'],
    ]);
    // Vẫn không cho thêm trùng job trong cùng ngày.
    expect(todos.addTodos(c2, TEST_TODAY, [{ kind: 'FREELANCE', targetId: j.id }])).toHaveLength(2);
  });
});

describe('To-do list: việc tự nhập và xem nhiều ngày', () => {
  it('thêm việc chỉ có tên; đổi tên; xếp cùng job; đánh dấu xong', () => {
    const j = freelance.createFreelance(ctx, { projectName: 'Landing page', hirerId: null, startDate: null, statusId: null });
    todos.addTodos(ctx, TEST_TODAY, [{ kind: 'FREELANCE', targetId: j.id }]);
    let list = todos.addTodoTask(ctx, TEST_TODAY, '  Gửi   báo giá  cho anh Nam ');
    expect(list.map((t) => [t.kind, t.title, t.targetId, t.stt, t.scope])).toEqual([
      ['FREELANCE', 'Landing page', j.id, 1, 'Job Freelance'],
      ['TASK', 'Gửi báo giá cho anh Nam', null, null, 'Việc tự nhập'],
    ]);
    expect(() => todos.addTodoTask(ctx, TEST_TODAY, '   ')).toThrow(/Nhập tên việc/);
    expect(() => todos.addTodoTask(ctx, TEST_TODAY, 'x'.repeat(301))).toThrow(/300/);
    const task = list[1];
    list = todos.renameTodoTask(ctx, task.id, 'Gửi báo giá bản 2');
    expect(list[1].title).toBe('Gửi báo giá bản 2');
    expect(() => todos.renameTodoTask(ctx, list[0].id, 'Đổi tên job')).toThrow(/việc tự nhập/);
    list = todos.reorderTodos(ctx, TEST_TODAY, [task.id, list[0].id]);
    expect(list.map((t) => t.kind)).toEqual(['TASK', 'FREELANCE']);
    list = todos.setTodoDone(ctx, task.id, true);
    expect(list.map((t) => [t.kind, !!t.doneAt])).toEqual([
      ['FREELANCE', false],
      ['TASK', true],
    ]);
    // Việc mới thêm luôn ở cuối danh sách chưa xong.
    list = todos.addTodoTask(ctx, TEST_TODAY, 'Việc thứ ba');
    expect(list.map((t) => t.title)).toEqual(['Landing page', 'Việc thứ ba', 'Gửi báo giá bản 2']);
    list = todos.deleteTodo(ctx, task.id);
    expect(list).toHaveLength(2);
  });

  it('lấy việc của nhiều ngày (3 / 5 / 7 ngày), sắp theo ngày; khoảng ngày quá 31 ngày bị từ chối', () => {
    todos.addTodoTask(ctx, '2026-11-18', 'Ngày 18');
    todos.addTodoTask(ctx, '2026-11-16', 'Ngày 16 - a');
    todos.addTodoTask(ctx, '2026-11-16', 'Ngày 16 - b');
    todos.addTodoTask(ctx, '2026-11-23', 'Ngoài khoảng');
    expect(todos.listTodosRange(ctx, '2026-11-16', '2026-11-22').map((t) => [t.todoDate, t.title])).toEqual([
      ['2026-11-16', 'Ngày 16 - a'],
      ['2026-11-16', 'Ngày 16 - b'],
      ['2026-11-18', 'Ngày 18'],
    ]);
    expect(() => todos.listTodosRange(ctx, '2026-11-20', '2026-11-16')).toThrow(/không hợp lệ/);
    expect(() => todos.listTodosRange(ctx, '2026-01-01', '2026-03-01')).toThrow(/không hợp lệ/);
  });
});
