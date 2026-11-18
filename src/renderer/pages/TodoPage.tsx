import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, FolderKanban, GripVertical, Laptop, ListTodo, Plus, X } from 'lucide-react';
import { addDays, formatDate, formatDateTime, isValidISODate } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, type TodoItem, type TodoKind, type TodoTarget } from '../../shared/types';
import { api } from '../api';
import { DateInput, EmptyState, SearchInput } from '../components/common';
import { Modal } from '../components/Modal';
import { useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';

const keyOf = (t: TodoTarget) => `${t.kind}:${t.targetId}`;

interface Candidate extends TodoTarget {
  title: string;
  scope: string;
  status: string | null;
  done: boolean;
  hay: string;
  order: string;
}

/** Chọn dự án Pre-sales / Post-sales (Job Chính, không gồm Warranty) và job Freelance để thêm vào ngày đang xem. */
function TodoPicker({ date, existing, onClose, onAdded }: { date: string; existing: Set<string>; onClose: () => void; onAdded: (items: TodoItem[]) => void }) {
  const { projects, freelance, yearById } = useAppData();
  const { toast, toastError } = useUi();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | TodoKind>('all');
  const [hideDone, setHideDone] = useState(true);
  const [picked, setPicked] = useState<TodoTarget[]>([]);
  const [saving, setSaving] = useState(false);

  const all = useMemo<Candidate[]>(() => {
    const main: Candidate[] = projects.map((p) => {
      const scope = `${CATEGORY_LABEL[p.workCategory]} ${yearById.get(p.jobYearId)?.yearLabel ?? ''}`.trim();
      return {
        kind: 'MAIN',
        targetId: p.id,
        title: `${p.stt}. ${p.projectName}`,
        scope,
        status: p.isCompleted ? 'Đã hoàn thành' : p.dueDate ? `Hạn ${formatDate(p.dueDate)}` : null,
        done: p.isCompleted,
        hay: buildHaystack([String(p.stt), p.projectName, scope]),
        order: `0${yearById.get(p.jobYearId)?.yearLabel ?? ''}${p.workCategory}${String(1e6 - p.stt).padStart(7, '0')}`,
      };
    });
    const free: Candidate[] = freelance.map((j) => ({
      kind: 'FREELANCE',
      targetId: j.id,
      title: `${j.stt}. ${j.projectName}`,
      scope: 'Job Freelance',
      status: j.statusName,
      done: false,
      hay: buildHaystack([String(j.stt), j.projectName, j.hirer, j.statusName, 'freelance']),
      order: `1${String(1e6 - j.stt).padStart(7, '0')}`,
    }));
    return [...main.sort((a, b) => compareVi(b.order, a.order)), ...free.sort((a, b) => compareVi(a.order, b.order))];
  }, [projects, freelance, yearById]);

  const nq = normalizeText(q);
  const matches = all.filter((c) => (kind === 'all' || c.kind === kind) && (!hideDone || !c.done) && matchesQuery(nq, c.hay));
  const shown = matches.slice(0, 300);
  const pickedKeys = new Set(picked.map(keyOf));
  const toggle = (c: Candidate) => setPicked((list) => (pickedKeys.has(keyOf(c)) ? list.filter((t) => keyOf(t) !== keyOf(c)) : [...list, { kind: c.kind, targetId: c.targetId }]));

  const save = async () => {
    setSaving(true);
    try {
      onAdded(await api.addTodos(date, picked));
      toast('success', `Đã thêm ${picked.length} việc vào ${formatDate(date)}.`);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="lg"
      title={`Thêm việc vào To-do ${formatDate(date)}`}
      onClose={onClose}
      footer={() => (
        <>
          <span className="left small muted">{picked.length ? `Đã chọn ${picked.length} việc` : 'Chọn một hoặc nhiều job'}</span>
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={!picked.length || saving} onClick={() => void save()}>
            {saving ? 'Đang thêm…' : `Thêm ${picked.length || ''} việc`}
          </button>
        </>
      )}
    >
      <div className="stack">
        <div className="row wrap" style={{ gap: 8 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Tìm STT, tên dự án / job, năm…" width={300} />
          <div className="seg" role="group" aria-label="Loại job">
            {(['all', 'MAIN', 'FREELANCE'] as const).map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'all' ? 'Tất cả' : k === 'MAIN' ? 'Job Chính' : 'Job Freelance'}
              </button>
            ))}
          </div>
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            Ẩn dự án đã hoàn thành
          </label>
        </div>
        <div className="field-hint">Job Chính chỉ gồm Pre-sales / Post-sales (không có Warranty).</div>
        <div className="todo-pick-list" role="listbox" aria-label="Chọn job" aria-multiselectable>
          {shown.length === 0 && <div className="faint small" style={{ padding: 12 }}>Không có job phù hợp.</div>}
          {shown.map((c) => {
            const key = keyOf(c);
            const already = existing.has(key);
            const on = already || pickedKeys.has(key);
            return (
              <label key={key} className={`todo-pick ${already ? 'disabled' : ''}`} role="option" aria-selected={on}>
                <input type="checkbox" checked={on} disabled={already} onChange={() => toggle(c)} aria-label={`Chọn ${c.title}`} />
                {c.kind === 'MAIN' ? <FolderKanban size={15} /> : <Laptop size={15} />}
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ fontWeight: 600, display: 'block' }}>
                    {c.title}
                  </span>
                  <span className="small muted">
                    {c.scope}
                    {c.status ? ` · ${c.status}` : ''}
                  </span>
                </span>
                {already && <span className="badge">Đã có</span>}
              </label>
            );
          })}
          {matches.length > shown.length && <div className="faint small" style={{ padding: 10 }}>Còn {matches.length - shown.length} job — gõ để tìm cụ thể hơn.</div>}
        </div>
      </div>
    </Modal>
  );
}

/** To-do list theo ngày: chọn job cần làm, kéo ☰ để xếp ưu tiên, đánh dấu Đã hoàn thành. */
export function TodoPage() {
  usePageTitle('To-do list');
  const { today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [date, setDate] = useSessionState<string>('todo-date', today);
  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setItems(null);
    api.listTodos(date).then(setItems).catch(toastError);
  }, [date, toastError]);

  const open = (items ?? []).filter((t) => !t.doneAt);
  const done = (items ?? []).filter((t) => t.doneAt);
  const existing = useMemo(() => new Set((items ?? []).map(keyOf)), [items]);

  const run = async (p: Promise<TodoItem[]>, msg?: string) => {
    try {
      setItems(await p);
      if (msg) toast('success', msg);
    } catch (e) {
      toastError(e);
      api.listTodos(date).then(setItems).catch(() => undefined);
    }
  };
  const reorder = (ids: string[]) => {
    const byId = new Map(open.map((t) => [t.id, t]));
    setItems([...ids.map((id) => byId.get(id)!).filter(Boolean), ...done]);
    void run(api.reorderTodos(date, ids));
  };
  const move = (id: string, delta: -1 | 1) => {
    const ids = open.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-grip="${id}"]`)?.focus());
  };
  const onDrop = () => {
    if (!dragId || !drop || dragId === drop.id) return;
    const ids = open.map((t) => t.id).filter((id) => id !== dragId);
    const at = ids.indexOf(drop.id) + (drop.after ? 1 : 0);
    ids.splice(at, 0, dragId);
    reorder(ids);
  };
  const remove = async (t: TodoItem) => {
    if (!(await confirm({ title: 'Bỏ khỏi To-do list', message: `Bỏ "${t.title}" khỏi To-do ${formatDate(date)}? Dự án / job không bị ảnh hưởng.`, confirmText: 'Bỏ khỏi danh sách' }))) return;
    void run(api.deleteTodo(t.id), 'Đã bỏ khỏi To-do list.');
  };
  const openTarget = (t: TodoItem) => navigate(t.kind === 'MAIN' ? `/project/${t.targetId}` : `/freelance/${t.targetId}`);
  const setDay = (d: string | null) => d && isValidISODate(d) && setDate(d);

  const title = (t: TodoItem) => (
    <button className="todo-title linklike" onClick={() => openTarget(t)} title="Mở dự án / job">
      {t.stt}. {t.title}
    </button>
  );
  const meta = (t: TodoItem) => (
    <span className="small muted">
      {t.kind === 'MAIN' ? <FolderKanban size={12} /> : <Laptop size={12} />} {t.scope}
      {t.status ? ` · ${t.status}` : ''}
    </span>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row">
            <ListTodo size={22} style={{ color: 'var(--accent)' }} /> To-do list
          </h1>
          <div className="muted small">Việc cần làm theo ngày từ Job Chính (Pre-sales / Post-sales) và Job Freelance — kéo biểu tượng ☰ để sắp xếp ưu tiên.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setPicking(true)}>
            <Plus size={16} /> Thêm việc
          </button>
        </div>
      </div>
      <div className="toolbar">
        <button className="btn sm icon" aria-label="Ngày trước" title="Ngày trước" onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft size={15} />
        </button>
        <div style={{ width: 170 }}>
          <DateInput id="todo-date" value={date} onChange={setDay} />
        </div>
        <button className="btn sm icon" aria-label="Ngày sau" title="Ngày sau" onClick={() => setDate(addDays(date, 1))}>
          <ChevronRight size={15} />
        </button>
        <button className="btn sm" disabled={date === today} onClick={() => setDate(today)}>
          Hôm nay
        </button>
        <span className="small muted">
          {date === today ? 'Hôm nay · ' : ''}
          {items ? `${open.length} việc cần làm · ${done.length} đã hoàn thành` : 'Đang tải…'}
        </span>
      </div>

      {items && items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ListTodo size={36} />}
            title={`Chưa có việc nào cho ${formatDate(date)}`}
            text="Bấm “Thêm việc” để chọn dự án Pre-sales / Post-sales hoặc job Freelance cần làm trong ngày."
            action={
              <button className="btn primary" onClick={() => setPicking(true)}>
                <Plus size={16} /> Thêm việc
              </button>
            }
          />
        </div>
      ) : (
        items && (
          <div className="stack">
            <section className="card card-pad">
              <h2 className="card-title">Cần làm ({open.length})</h2>
              {open.length === 0 ? (
                <div className="faint small">Đã xong hết việc của ngày này.</div>
              ) : (
                <ol className="todo-list" ref={listRef} aria-label="Việc cần làm" onDragOver={(e) => dragId && e.preventDefault()} onDrop={onDrop}>
                  {open.map((t, i) => (
                    <li
                      key={t.id}
                      className={`todo-item ${dragId === t.id ? 'dragging' : ''} ${drop?.id === t.id ? (drop.after ? 'drop-after' : 'drop-before') : ''}`}
                      data-todo={t.id}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > r.top + r.height / 2;
                        if (drop?.id !== t.id || drop.after !== after) setDrop({ id: t.id, after });
                      }}
                    >
                      <button
                        className="todo-grip"
                        draggable
                        data-grip={t.id}
                        aria-label={`Kéo để sắp xếp ${t.title} (hoặc phím mũi tên lên/xuống)`}
                        title="Kéo lên / xuống để sắp xếp ưu tiên"
                        onDragStart={(e) => {
                          setDragId(t.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', t.id);
                          const li = e.currentTarget.closest('li');
                          if (li) e.dataTransfer.setDragImage(li, 16, 16);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDrop(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            move(t.id, e.key === 'ArrowUp' ? -1 : 1);
                          }
                        }}
                      >
                        <GripVertical size={16} />
                      </button>
                      <span className="todo-rank">{i + 1}</span>
                      <button className="todo-check" aria-label={`Đánh dấu đã hoàn thành: ${t.title}`} title="Đánh dấu Đã hoàn thành" onClick={() => void run(api.setTodoDone(t.id, true), `Đã hoàn thành "${t.title}".`)}>
                        <Circle size={18} />
                      </button>
                      <div className="todo-main">
                        {title(t)}
                        {meta(t)}
                      </div>
                      <button className="btn sm icon ghost" aria-label={`Bỏ ${t.title} khỏi danh sách`} title="Bỏ khỏi danh sách" onClick={() => void remove(t)}>
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {done.length > 0 && (
              <section className="card card-pad">
                <h2 className="card-title">Đã hoàn thành ({done.length})</h2>
                <ul className="todo-list" aria-label="Việc đã hoàn thành">
                  {done.map((t) => (
                    <li key={t.id} className="todo-item done" data-todo={t.id}>
                      <button className="todo-check on" aria-label={`Bỏ đánh dấu hoàn thành: ${t.title}`} title="Bỏ đánh dấu (quay lại Cần làm)" onClick={() => void run(api.setTodoDone(t.id, false))}>
                        <CheckCircle2 size={18} />
                      </button>
                      <div className="todo-main">
                        {title(t)}
                        {meta(t)}
                      </div>
                      <span className="badge accent">Đã hoàn thành</span>
                      <span className="small faint nowrap">{formatDateTime(t.doneAt)}</span>
                      <button className="btn sm icon ghost" aria-label={`Bỏ ${t.title} khỏi danh sách`} title="Bỏ khỏi danh sách" onClick={() => void remove(t)}>
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )
      )}
      {picking && <TodoPicker date={date} existing={existing} onClose={() => setPicking(false)} onAdded={setItems} />}
    </>
  );
}
