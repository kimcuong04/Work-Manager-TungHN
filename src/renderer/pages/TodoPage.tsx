import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, FolderKanban, GripVertical, Laptop, ListChecks, ListTodo, Pencil, Plus, X } from 'lucide-react';
import { addDays, formatDate, formatDateTime, isValidISODate } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, type TodoItem, type TodoKind, type TodoTarget } from '../../shared/types';
import { api } from '../api';
import { DateInput, SearchInput } from '../components/common';
import { Modal } from '../components/Modal';
import { useLocalState, useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';

type Span = 1 | 3 | 5 | 7;
const SPANS: { n: Span; label: string }[] = [
  { n: 1, label: '1 ngày' },
  { n: 3, label: '3 ngày' },
  { n: 5, label: '5 ngày' },
  { n: 7, label: '7 ngày' },
];
const WEEKDAY = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00`).getDay()];

const keyOf = (t: { kind: TodoKind; targetId: string | null }) => `${t.kind}:${t.targetId}`;

interface Candidate extends TodoTarget {
  title: string;
  scope: string;
  status: string | null;
  done: boolean;
  hay: string;
  order: string;
}

/** Chọn dự án Pre-sales / Post-sales (Job Chính, không gồm Warranty) và job Freelance để thêm vào một ngày. */
function TodoPicker({ date, existing, onClose, onAdded }: { date: string; existing: Set<string>; onClose: () => void; onAdded: (items: TodoItem[]) => void }) {
  const { projects, freelance, yearById } = useAppData();
  const { toast, toastError } = useUi();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | TodoTarget['kind']>('all');
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
      title={`Thêm dự án / job vào To-do ${formatDate(date)}`}
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
        <div className="field-hint">Job Chính chỉ gồm Pre-sales / Post-sales (không có Warranty). Việc không thuộc dự án nào thì gõ thẳng vào ô “Thêm việc mới”.</div>
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

const kindIcon = (k: TodoKind, size = 12) => (k === 'MAIN' ? <FolderKanban size={size} /> : k === 'FREELANCE' ? <Laptop size={size} /> : <ListChecks size={size} />);
const label = (t: TodoItem) => (t.stt !== null ? `${t.stt}. ${t.title}` : t.title);

type Variant = 'single' | 'column' | 'row';

/**
 * Việc của một ngày: ô thêm nhanh việc tự nhập, danh sách cần làm (kéo ☰ hoặc phím mũi tên để xếp ưu tiên) và
 * danh sách đã hoàn thành. Dùng chung cho xem 1 ngày (single), 3/5 ngày (cột dọc) và 7 ngày (từng ngày xếp dọc).
 */
function DayTodos({ date, items, variant, onItems, onPick }: { date: string; items: TodoItem[]; variant: Variant; onItems: (date: string, items: TodoItem[]) => void; onPick: (date: string) => void }) {
  const { today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const open = items.filter((t) => !t.doneAt);
  const done = items.filter((t) => t.doneAt);
  const day = formatDate(date);

  const run = async (p: Promise<TodoItem[]>, msg?: string) => {
    try {
      onItems(date, await p);
      if (msg) toast('success', msg);
      return true;
    } catch (e) {
      toastError(e);
      api.listTodos(date).then((list) => onItems(date, list)).catch(() => undefined);
      return false;
    }
  };
  const addTask = async () => {
    if (!draft.trim() || adding) return;
    setAdding(true);
    if (await run(api.addTodoTask(date, draft))) setDraft('');
    setAdding(false);
  };
  const reorder = (ids: string[]) => {
    const byId = new Map(open.map((t) => [t.id, t]));
    onItems(date, [...ids.map((id) => byId.get(id)!).filter(Boolean), ...done]);
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
    ids.splice(ids.indexOf(drop.id) + (drop.after ? 1 : 0), 0, dragId);
    reorder(ids);
  };
  const remove = async (t: TodoItem) => {
    const msg = t.kind === 'TASK' ? `Xóa việc "${t.title}" khỏi ${day}?` : `Bỏ "${t.title}" khỏi To-do ${day}? Dự án / job không bị ảnh hưởng.`;
    if (!(await confirm({ title: 'Bỏ khỏi To-do list', message: msg, confirmText: 'Bỏ khỏi danh sách' }))) return;
    void run(api.deleteTodo(t.id), 'Đã bỏ khỏi To-do list.');
  };
  const saveEdit = async () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    const current = items.find((t) => t.id === e.id)?.title;
    if (e.title.trim() && e.title.trim() !== current) await run(api.renameTodoTask(e.id, e.title));
  };

  const title = (t: TodoItem) =>
    editing?.id === t.id ? (
      <input
        className="input todo-edit"
        autoFocus
        aria-label="Tên việc"
        value={editing.title}
        onChange={(ev) => setEditing({ ...editing, title: ev.target.value })}
        onBlur={() => void saveEdit()}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') void saveEdit();
          if (ev.key === 'Escape') setEditing(null);
        }}
      />
    ) : t.kind === 'TASK' ? (
      <span className="todo-title" onDoubleClick={() => setEditing({ id: t.id, title: t.title })} title="Bấm đúp để đổi tên">
        {t.title}
      </span>
    ) : (
      <button className="todo-title linklike" onClick={() => navigate(t.kind === 'MAIN' ? `/project/${t.targetId}` : `/freelance/${t.targetId}`)} title="Mở dự án / job">
        {label(t)}
      </button>
    );
  const meta = (t: TodoItem) => (
    <span className="small muted todo-meta">
      {kindIcon(t.kind)} {t.scope}
      {t.status ? ` · ${t.status}` : ''}
    </span>
  );
  const tools = (t: TodoItem) => (
    <span className="todo-tools">
      {t.kind === 'TASK' && (
        <button className="btn sm icon ghost" aria-label={`Đổi tên ${t.title}`} title="Đổi tên" onClick={() => setEditing({ id: t.id, title: t.title })}>
          <Pencil size={13} />
        </button>
      )}
      <button className="btn sm icon ghost" aria-label={`Bỏ ${t.title} khỏi danh sách`} title="Bỏ khỏi danh sách" onClick={() => void remove(t)}>
        <X size={14} />
      </button>
    </span>
  );

  const quickAdd = (
    <form
      className="todo-quick"
      onSubmit={(e) => {
        e.preventDefault();
        void addTask();
      }}
    >
      <input className="input" placeholder="Thêm việc mới… (Enter)" aria-label={`Thêm việc mới ngày ${day}`} value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} />
      <button className="btn sm" type="submit" disabled={!draft.trim() || adding} aria-label={`Thêm việc vào ${day}`}>
        <Plus size={14} />
        {variant !== 'column' && ' Thêm'}
      </button>
      {variant !== 'single' && (
        <button className="btn sm icon ghost" type="button" title="Chọn dự án / job" aria-label={`Chọn dự án / job cho ${day}`} onClick={() => onPick(date)}>
          <FolderKanban size={15} />
        </button>
      )}
    </form>
  );

  const openList =
    open.length === 0 ? (
      <div className="faint small todo-empty">
        {items.length === 0 ? `Chưa có việc nào cho ${day}${variant === 'single' ? ' — gõ tên việc ở ô trên, hoặc Chọn dự án / job.' : '.'}` : 'Đã xong hết việc của ngày này.'}
      </div>
    ) : (
      <ol className="todo-list" ref={listRef} aria-label={`Việc cần làm ${day}`} onDragOver={(e) => dragId && e.preventDefault()} onDrop={onDrop}>
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
            {variant !== 'column' && <span className="todo-rank">{i + 1}</span>}
            <button className="todo-check" aria-label={`Đánh dấu đã hoàn thành: ${t.title}`} title="Đánh dấu Đã hoàn thành" onClick={() => void run(api.setTodoDone(t.id, true), `Đã hoàn thành "${t.title}".`)}>
              <Circle size={18} />
            </button>
            <div className="todo-main">
              {title(t)}
              {meta(t)}
            </div>
            {tools(t)}
          </li>
        ))}
      </ol>
    );
  const doneList = (
    <ul className="todo-list" aria-label={`Việc đã hoàn thành ${day}`}>
      {done.map((t) => (
        <li key={t.id} className="todo-item done" data-todo={t.id}>
          <button className="todo-check on" aria-label={`Bỏ đánh dấu hoàn thành: ${t.title}`} title="Bỏ đánh dấu (quay lại Cần làm)" onClick={() => void run(api.setTodoDone(t.id, false))}>
            <CheckCircle2 size={18} />
          </button>
          <div className="todo-main">
            {title(t)}
            {meta(t)}
          </div>
          {variant === 'single' && (
            <>
              <span className="badge accent">Đã hoàn thành</span>
              <span className="small faint nowrap">{formatDateTime(t.doneAt)}</span>
            </>
          )}
          {tools(t)}
        </li>
      ))}
    </ul>
  );

  if (variant === 'single')
    return (
      <div className="stack">
        <section className="card card-pad">
          <h2 className="card-title">Cần làm ({open.length})</h2>
          {quickAdd}
          {openList}
        </section>
        {done.length > 0 && (
          <section className="card card-pad">
            <h2 className="card-title">Đã hoàn thành ({done.length})</h2>
            {doneList}
          </section>
        )}
      </div>
    );

  return (
    <section className={`card todo-day v-${variant} ${date === today ? 'today' : ''}`} aria-label={`To-do ${weekday(date)} ${day}`} data-day={date}>
      <header className="todo-day-head">
        <b>{weekday(date)}</b>
        <span>{day}</span>
        {date === today && <span className="badge accent">Hôm nay</span>}
        <span className="grow" />
        <span className="small muted">
          {open.length} cần làm{done.length ? ` · ${done.length} xong` : ''}
        </span>
      </header>
      {quickAdd}
      {openList}
      {done.length > 0 && (
        <>
          <div className="todo-done-label small muted">Đã hoàn thành ({done.length})</div>
          {doneList}
        </>
      )}
    </section>
  );
}

/** To-do list: việc theo ngày (dự án, job Freelance hoặc việc tự nhập), xem 1 / 3 / 5 / 7 ngày. */
export function TodoPage() {
  usePageTitle('To-do list');
  const { today } = useAppData();
  const { toastError } = useUi();
  const [date, setDate] = useSessionState<string>('todo-date', today);
  const [span, setSpan] = useLocalState<Span>('todo-span', 1);
  const [byDate, setByDate] = useState<Record<string, TodoItem[]> | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(date, i)), [date, span]);
  const to = days[days.length - 1];

  const load = useCallback(() => {
    setByDate(null);
    api
      .listTodosRange(date, to)
      .then((list) => {
        const map: Record<string, TodoItem[]> = {};
        for (const t of list) (map[t.todoDate] ??= []).push(t);
        setByDate(map);
      })
      .catch(toastError);
  }, [date, to, toastError]);
  useEffect(load, [load]);

  const setDay = (d: string, items: TodoItem[]) => setByDate((m) => ({ ...(m ?? {}), [d]: items }));
  const all = days.flatMap((d) => byDate?.[d] ?? []);
  const openN = all.filter((t) => !t.doneAt).length;
  const step = span === 1 ? 1 : span;
  const pickExisting = useMemo(() => new Set((picking ? byDate?.[picking] ?? [] : []).filter((t) => t.targetId).map(keyOf)), [picking, byDate]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row">
            <ListTodo size={22} style={{ color: 'var(--accent)' }} /> To-do list
          </h1>
          <div className="muted small">Việc cần làm theo ngày: gõ việc mới, hoặc chọn dự án Pre-sales / Post-sales / job Freelance — kéo biểu tượng ☰ để sắp xếp ưu tiên.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setPicking(date)}>
            <Plus size={16} /> Chọn dự án / job
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Chế độ xem">
          {SPANS.map((s) => (
            <button key={s.n} className={span === s.n ? 'on' : ''} aria-pressed={span === s.n} onClick={() => setSpan(s.n)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className="btn sm icon" aria-label={span === 1 ? 'Ngày trước' : `${span} ngày trước`} title={span === 1 ? 'Ngày trước' : `${span} ngày trước`} onClick={() => setDate(addDays(date, -step))}>
          <ChevronLeft size={15} />
        </button>
        <div style={{ width: 170 }}>
          <DateInput id="todo-date" value={date} onChange={(d) => d && isValidISODate(d) && setDate(d)} />
        </div>
        <button className="btn sm icon" aria-label={span === 1 ? 'Ngày sau' : `${span} ngày sau`} title={span === 1 ? 'Ngày sau' : `${span} ngày sau`} onClick={() => setDate(addDays(date, step))}>
          <ChevronRight size={15} />
        </button>
        <button className="btn sm" disabled={date === today} onClick={() => setDate(today)}>
          Hôm nay
        </button>
        <span className="small muted">
          {span > 1 ? `${formatDate(date)} → ${formatDate(to)} · ` : date === today ? 'Hôm nay · ' : ''}
          {byDate ? `${openN} việc cần làm · ${all.length - openN} đã hoàn thành` : 'Đang tải…'}
        </span>
      </div>

      {byDate &&
        (span === 1 ? (
          <DayTodos date={date} items={byDate[date] ?? []} variant="single" onItems={setDay} onPick={setPicking} />
        ) : (
          <div className={span === 7 ? 'todo-rows' : 'todo-cols'} style={{ ['--todo-cols' as string]: span }}>
            {days.map((d) => (
              <DayTodos key={d} date={d} items={byDate[d] ?? []} variant={span === 7 ? 'row' : 'column'} onItems={setDay} onPick={setPicking} />
            ))}
          </div>
        ))}
      {picking && <TodoPicker date={picking} existing={pickExisting} onClose={() => setPicking(null)} onAdded={(items) => setDay(picking, items)} />}
    </>
  );
}
