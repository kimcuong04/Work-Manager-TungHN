import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, FolderKanban, GripVertical, Infinity as InfinityIcon, Laptop, ListChecks, ListTodo, Pencil, Plus, X } from 'lucide-react';
import { addDays, formatDate, formatDateTime, isValidISODate } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import { CATEGORY_LABEL, TODO_NO_DATE, TODO_NO_DATE_LABEL, type TodoItem, type TodoKind, type TodoTarget } from '../../shared/types';
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
      toast('success', `Đã thêm ${picked.length} việc vào ${dayLabel(date)}.`);
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
      title={`Thêm dự án / job vào To-do ${dayLabel(date)}`}
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
const dayLabel = (d: string) => (d === TODO_NO_DATE ? TODO_NO_DATE_LABEL : formatDate(d));

type Variant = 'single' | 'column' | 'row';
type DropAt = { date: string; id: string | null; after: boolean };

/** Kéo thả dùng chung cho mọi ngày trên trang: kéo trong một ngày để xếp ưu tiên, kéo sang ngày khác / Vô thời hạn để chuyển. */
interface DragCtl {
  dragId: string | null;
  over: DropAt | null;
  start: (id: string, from: string) => void;
  hover: (at: DropAt) => void;
  drop: () => void;
  end: () => void;
}

/**
 * Việc của một ngày (hoặc mục Vô thời hạn): ô thêm nhanh việc tự nhập, danh sách cần làm (kéo ☰ để xếp ưu tiên hoặc
 * kéo sang ngày khác, phím mũi tên để xếp) và danh sách đã hoàn thành. Dùng chung cho xem 1 ngày (single), 3/5 ngày
 * (cột dọc), 7 ngày (từng ngày xếp dọc) và cột Vô thời hạn.
 */
function DayTodos({
  date,
  items,
  variant,
  drag,
  onItems,
  onPick,
}: {
  date: string;
  items: TodoItem[];
  variant: Variant;
  drag: DragCtl;
  onItems: (date: string, items: TodoItem[]) => void;
  onPick: (date: string) => void;
}) {
  const { today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const open = items.filter((t) => !t.doneAt);
  const done = items.filter((t) => t.doneAt);
  const noDate = date === TODO_NO_DATE;
  const day = dayLabel(date);
  const where = noDate ? day : `ngày ${day}`;
  const zoneOn = !!drag.dragId && drag.over?.date === date && drag.over.id === null;

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
  const move = (id: string, delta: -1 | 1) => {
    const ids = open.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const byId = new Map(open.map((t) => [t.id, t]));
    onItems(date, [...ids.map((x) => byId.get(x)!), ...done]);
    void run(api.reorderTodos(date, ids));
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-grip="${id}"]`)?.focus());
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
      <input className="input" placeholder="Thêm việc mới… (Enter)" aria-label={`Thêm việc mới ${where}`} value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} />
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
        {items.length === 0
          ? noDate
            ? 'Việc chưa định ngày — gõ việc mới ở ô trên hoặc kéo việc từ các ngày vào đây.'
            : `Chưa có việc nào cho ${day}${variant === 'single' ? ' — gõ tên việc ở ô trên, hoặc Chọn dự án / job.' : '.'}`
          : noDate
            ? 'Đã xong hết việc Vô thời hạn.'
            : 'Đã xong hết việc của ngày này.'}
      </div>
    ) : (
      <ol className="todo-list" ref={listRef} aria-label={`Việc cần làm ${day}`}>
        {open.map((t, i) => {
          const over = drag.over?.date === date && drag.over.id === t.id && drag.dragId !== t.id ? drag.over : null;
          return (
            <li
              key={t.id}
              className={`todo-item ${drag.dragId === t.id ? 'dragging' : ''} ${over ? (over.after ? 'drop-after' : 'drop-before') : ''}`}
              data-todo={t.id}
              onDragOver={(e) => {
                if (!drag.dragId) return;
                e.preventDefault();
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                drag.hover({ date, id: t.id, after: e.clientY > r.top + r.height / 2 });
              }}
            >
              <button
                className="todo-grip"
                draggable
                data-grip={t.id}
                aria-label={`Kéo để sắp xếp ${t.title} (hoặc phím mũi tên lên/xuống)`}
                title="Kéo lên / xuống để sắp xếp ưu tiên, kéo sang ngày khác / Vô thời hạn để chuyển"
                onDragStart={(e) => {
                  drag.start(t.id, date);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                  const li = e.currentTarget.closest('li');
                  if (li) e.dataTransfer.setDragImage(li, 16, 16);
                }}
                onDragEnd={drag.end}
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
          );
        })}
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

  // Cả khung ngày nhận thả (kể cả khi danh sách trống): thả vào chỗ trống = thêm vào cuối danh sách cần làm.
  const zone = {
    onDragOver: (e: React.DragEvent) => {
      if (!drag.dragId) return;
      e.preventDefault();
      if (drag.over?.date !== date || drag.over.id !== null) drag.hover({ date, id: null, after: true });
    },
    onDrop: (e: React.DragEvent) => {
      if (!drag.dragId) return;
      e.preventDefault();
      drag.drop();
    },
  };

  if (variant === 'single')
    return (
      <div className="stack">
        <section className={`card card-pad todo-zone ${zoneOn ? 'drop-on' : ''}`} {...zone} data-day={date} aria-label={`To-do ${day}`}>
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
    <section
      className={`card todo-day todo-zone v-${variant} ${date === today ? 'today' : ''} ${noDate ? 'nodate' : ''} ${zoneOn ? 'drop-on' : ''}`}
      aria-label={noDate ? `To-do ${day}` : `To-do ${weekday(date)} ${day}`}
      data-day={noDate ? 'nodate' : date}
      {...zone}
    >
      <header className="todo-day-head">
        {noDate ? (
          <b className="row" style={{ gap: 6 }}>
            <InfinityIcon size={16} /> {day}
          </b>
        ) : (
          <>
            <b>{weekday(date)}</b>
            <span>{day}</span>
            {date === today && <span className="badge accent">Hôm nay</span>}
          </>
        )}
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

/** To-do list: việc theo ngày (dự án, job Freelance hoặc việc tự nhập), xem 1 / 3 / 5 / 7 ngày, kèm mục Vô thời hạn. */
export function TodoPage() {
  usePageTitle('To-do list');
  const { today } = useAppData();
  const { toast, toastError } = useUi();
  const [date, setDate] = useSessionState<string>('todo-date', today);
  const [span, setSpan] = useLocalState<Span>('todo-span', 1);
  const [byDate, setByDate] = useState<Record<string, TodoItem[]> | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropAt | null>(null);
  const dragRef = useRef<{ id: string; from: string } | null>(null);
  const overRef = useRef<DropAt | null>(null);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(date, i)), [date, span]);
  const to = days[days.length - 1];

  const load = useCallback(() => {
    setByDate(null);
    Promise.all([api.listTodosRange(date, to), api.listTodos(TODO_NO_DATE)])
      .then(([list, undated]) => {
        const map: Record<string, TodoItem[]> = { [TODO_NO_DATE]: undated };
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
  const pickExisting = useMemo(() => new Set((picking !== null ? byDate?.[picking] ?? [] : []).filter((t) => t.targetId).map(keyOf)), [picking, byDate]);

  const endDrag = () => {
    dragRef.current = null;
    overRef.current = null;
    setDragId(null);
    setOver(null);
  };
  const dropDrag = () => {
    const d = dragRef.current;
    const o = overRef.current;
    endDrag();
    if (!d || !o || !byDate || o.id === d.id) return;
    const item = (byDate[d.from] ?? []).find((t) => t.id === d.id);
    if (!item) return;
    const target = (byDate[o.date] ?? []).filter((t) => !t.doneAt && t.id !== d.id);
    const hit = o.id ? target.findIndex((t) => t.id === o.id) : -1;
    const index = hit >= 0 ? hit + (o.after ? 1 : 0) : target.length;
    if (o.date === d.from) {
      const ids = target.map((t) => t.id);
      ids.splice(index, 0, d.id);
      const before = (byDate[d.from] ?? []).filter((t) => !t.doneAt).map((t) => t.id);
      if (ids.join() === before.join()) return;
      const byId = new Map((byDate[d.from] ?? []).map((t) => [t.id, t]));
      setDay(d.from, [...ids.map((x) => byId.get(x)!), ...(byDate[d.from] ?? []).filter((t) => t.doneAt)]);
      api
        .reorderTodos(d.from, ids)
        .then((list) => setDay(d.from, list))
        .catch((e: unknown) => {
          toastError(e);
          load();
        });
      return;
    }
    if (item.targetId && (byDate[o.date] ?? []).some((t) => t.kind === item.kind && t.targetId === item.targetId)) {
      toast('error', `"${label(item)}" đã có trong To-do ${dayLabel(o.date)}.`);
      return;
    }
    setByDate((m) => {
      if (!m) return m;
      const next = { ...m, [d.from]: (m[d.from] ?? []).filter((t) => t.id !== d.id) };
      if (m[o.date]) {
        const moved = { ...item, todoDate: o.date };
        const open = m[o.date].filter((t) => !t.doneAt);
        open.splice(index, 0, moved);
        next[o.date] = [...open, ...m[o.date].filter((t) => t.doneAt)];
      }
      return next;
    });
    const visible = o.date === TODO_NO_DATE || days.includes(o.date);
    api
      .moveTodo(d.id, o.date, index)
      .then((res) => {
        setByDate((m) => ({ ...(m ?? {}), ...res }));
        if (!visible) toast('success', `Đã chuyển "${item.title}" sang ${dayLabel(o.date)}.`);
      })
      .catch((e: unknown) => {
        toastError(e);
        load();
      });
  };
  const drag: DragCtl = {
    dragId,
    over,
    start: (id, from) => {
      dragRef.current = { id, from };
      setDragId(id);
    },
    hover: (at) => {
      overRef.current = at;
      setOver((cur) => (cur && cur.date === at.date && cur.id === at.id && cur.after === at.after ? cur : at));
    },
    drop: dropDrag,
    end: endDrag,
  };

  // Xem 1 ngày: khi đang kéo, hiện các ngày lân cận để thả việc sang (thanh nổi ở đáy màn hình, xem CSS .todo-drop-days).
  const nearby = span === 1 ? [-1, 1, 2, 3, 4, 5, 6].map((n) => addDays(date, n)) : [];
  const undated = byDate ? (
    <DayTodos date={TODO_NO_DATE} items={byDate[TODO_NO_DATE] ?? []} variant="column" drag={drag} onItems={setDay} onPick={setPicking} />
  ) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row">
            <ListTodo size={22} style={{ color: 'var(--accent)' }} /> To-do list
          </h1>
          <div className="muted small">
            Việc cần làm theo ngày: gõ việc mới, hoặc chọn dự án Pre-sales / Post-sales / job Freelance — kéo biểu tượng ☰ để sắp xếp ưu tiên, kéo sang ngày khác
            hoặc vào Vô thời hạn để chuyển.
          </div>
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

      {byDate && dragId && span === 1 && (
        <div className="todo-drop-days" aria-label="Thả vào ngày khác">
          <span className="small muted">Thả sang ngày:</span>
          {nearby.map((d) => (
            <div
              key={d}
              className={`todo-drop-day ${over?.date === d ? 'on' : ''}`}
              data-drop-day={d}
              onDragOver={(e) => {
                e.preventDefault();
                drag.hover({ date: d, id: null, after: true });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drag.drop();
              }}
            >
              <b>{d === today ? 'Hôm nay' : weekday(d)}</b>
              <span>{formatDate(d).slice(0, 5)}</span>
            </div>
          ))}
        </div>
      )}

      {byDate &&
        (span === 1 ? (
          <div className="todo-board">
            <DayTodos date={date} items={byDate[date] ?? []} variant="single" drag={drag} onItems={setDay} onPick={setPicking} />
            <aside className="todo-side">{undated}</aside>
          </div>
        ) : span === 7 ? (
          <div className="todo-board">
            <div className="todo-rows">
              {days.map((d) => (
                <DayTodos key={d} date={d} items={byDate[d] ?? []} variant="row" drag={drag} onItems={setDay} onPick={setPicking} />
              ))}
            </div>
            <aside className="todo-side">{undated}</aside>
          </div>
        ) : (
          <div className="todo-cols" style={{ ['--todo-cols' as string]: span + 1 }}>
            {days.map((d) => (
              <DayTodos key={d} date={d} items={byDate[d] ?? []} variant="column" drag={drag} onItems={setDay} onPick={setPicking} />
            ))}
            {undated}
          </div>
        ))}
      {picking !== null && <TodoPicker date={picking} existing={pickExisting} onClose={() => setPicking(null)} onAdded={(items) => setDay(picking, items)} />}
    </>
  );
}
