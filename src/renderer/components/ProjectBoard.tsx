import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderInput,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { STATUS_LABEL, STATUS_ORDER, computeStatus, describeRemaining } from '../../shared/status';
import { CATEGORY_LABEL, JOB_LABEL, JOB_TYPES, PROJECT_CATEGORIES, type DeadlineStatus } from '../../shared/types';
import { api } from '../api';
import { useLocalState, useSessionState } from '../lib/persist';
import {
  EMPTY_FILTER,
  SORT_LABEL,
  applyFilter,
  groupByStatus,
  isFilterActive,
  sortProjects,
  DEFAULT_SORT,
  type ProjectFilter,
  type ProjectView,
  type SortKey,
  type SortState,
} from '../lib/projects';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { useUi } from '../state/ui';
import { EmptyState, MenuButton, MultiSelect, PriorityBadge, SearchInput, type MenuItem } from './common';
import { useOpenFile } from './FileLink';

const PAGE = 50;

function ProjectCard({
  p,
  showLocation,
  editMode,
  pending,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  p: ProjectView;
  showLocation: boolean;
  editMode: boolean;
  pending: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const openFile = useOpenFile();
  const open = () => navigate(`/project/${p.id}`);
  const menu: MenuItem[] = [
    { label: 'Mở chi tiết', icon: <ExternalLink size={14} />, onClick: open },
    { label: 'Chỉnh sửa', icon: <Pencil size={14} />, onClick: () => actions.openEdit(p) },
    p.isCompleted
      ? { label: 'Bỏ hoàn thành', icon: <RotateCcw size={14} />, onClick: () => void actions.setCompleted(p, false) }
      : { label: 'Đánh dấu hoàn thành', icon: <CheckCircle2 size={14} />, onClick: () => void actions.setCompleted(p, true) },
    { label: 'Di chuyển…', icon: <FolderInput size={14} />, onClick: () => actions.openMove(p) },
    ...(p.filePath ? [{ label: `Mở file ${p.fileName ?? ''}`, icon: <FileText size={14} />, onClick: () => void openFile(p.filePath!) }] : []),
    { label: '', onClick: () => {}, separator: true },
    { label: 'Xóa dự án', icon: <Trash2 size={14} />, danger: true, onClick: () => void actions.remove(p) },
  ];
  const meta = [p.clientName, p.designUnitName].filter(Boolean).join(' · ');
  return (
    <article
      className={`pcard st-${p.status} ${p.status === 'COMPLETED' ? 'completed' : ''} ${pending ? 'pending' : ''} ${dragging ? 'dragging' : ''}`}
      tabIndex={0}
      draggable={editMode}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', p.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
      aria-label={`${p.projectName}, ${STATUS_LABEL[p.status]}`}
    >
      <div className="pcard-menu">
        <MenuButton items={menu} />
      </div>
      <div className="pcard-title">{p.projectName}</div>
      {meta && <div className="pcard-meta">{meta}</div>}
      <div className="pcard-foot">
        <PriorityBadge value={p.priorityPoint} />
        {p.stageName && <span className="badge">{p.stageName}</span>}
        {p.filePath && (
          <span className="icon-chip" title={p.fileName ?? ''}>
            <FileText size={12} />
            {p.fileExtension?.toUpperCase()}
          </span>
        )}
        {p.hasImport && (
          <span className="icon-chip" title="Có dữ liệu Excel đã import">
            <FileSpreadsheet size={12} />
            XLSX
          </span>
        )}
      </div>
      <div className="pcard-foot">
        <span className="small muted">Hạn {formatDate(p.dueDate)}</span>
        {p.status !== 'COMPLETED' ? (
          <span className="pcard-due small">· {describeRemaining(p.remaining)}</span>
        ) : (
          <span className="small faint">· Đã hoàn thành</span>
        )}
        {pending && <span className="badge accent">Chưa lưu</span>}
      </div>
      {showLocation && <div className="pcard-loc">{p.location}</div>}
    </article>
  );
}

function BoardColumn({
  status,
  items,
  showLocation,
  editMode,
  pending,
  draggingId,
  dragSourceCompleted,
  onDragStart,
  onDragEnd,
  onDropCard,
}: {
  status: DeadlineStatus;
  items: ProjectView[];
  showLocation: boolean;
  editMode: boolean;
  pending: Map<string, boolean>;
  draggingId: string | null;
  dragSourceCompleted: boolean | null;
  onDragStart: (p: ProjectView) => void;
  onDragEnd: () => void;
  onDropCard: (id: string, status: DeadlineStatus) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [over, setOver] = useState(false);
  const dragging = draggingId !== null;
  const valid = dragging && (status === 'COMPLETED' ? dragSourceCompleted === false : dragSourceCompleted === true);
  return (
    <section
      className={`board-col st-${status} ${dragging && over && valid ? 'drop-ok' : ''} ${dragging && !valid ? 'drop-bad' : ''}`}
      onDragOver={(e) => {
        if (!editMode) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onDropCard(id, status);
      }}
      aria-label={`${STATUS_LABEL[status]}: ${items.length} dự án`}
    >
      <header className="board-col-head">
        <span className="status-dot" />
        {STATUS_LABEL[status]}
        <span className="count">{items.length}</span>
      </header>
      <div className="board-col-body">
        {items.length === 0 && <div className="faint small" style={{ textAlign: 'center', padding: '18px 0' }}>Không có dự án</div>}
        {items.slice(0, limit).map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            showLocation={showLocation}
            editMode={editMode}
            pending={pending.has(p.id)}
            dragging={draggingId === p.id}
            onDragStart={() => onDragStart(p)}
            onDragEnd={onDragEnd}
          />
        ))}
        {items.length > limit && (
          <button className="more-btn" onClick={() => setLimit((l) => l + PAGE)}>
            Xem thêm {Math.min(PAGE, items.length - limit)} / còn {items.length - limit}
          </button>
        )}
      </div>
    </section>
  );
}

export interface ProjectsViewProps {
  scopeKey: string;
  baseList: ProjectView[];
  showLocationFilters?: boolean;
  initialFilter?: Partial<ProjectFilter>;
  onAdd: () => void;
  addLabel?: string;
}

/** Toolbar (Thêm mới, Chỉnh sửa Board, Search, Filter, Sort) + board 4 cột. */
export function ProjectsView({ scopeKey, baseList, showLocationFilters, initialFilter, onAdd, addLabel = 'Thêm Project' }: ProjectsViewProps) {
  const { masters, years, today, thresholds, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [filter, setFilter] = useSessionState<ProjectFilter>(`filter:${scopeKey}`, { ...EMPTY_FILTER, ...initialFilter });
  const [sort, setSort] = useLocalState<SortState>('board-sort', DEFAULT_SORT);
  const [editMode, setEditMode] = useState(false);
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [drag, setDrag] = useState<{ id: string; completed: boolean } | null>(null);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      const changes = [...pendingRef.current].map(([id, completed]) => ({ id, completed }));
      if (changes.length) void api.applyBoardChanges(changes).then(() => refresh('projects'));
    },
    [refresh],
  );

  const effective = useMemo(() => {
    if (!pending.size) return baseList;
    return baseList.map((p) => {
      if (!pending.has(p.id)) return p;
      const isCompleted = pending.get(p.id)!;
      return { ...p, isCompleted, status: computeStatus({ isCompleted, dueDate: p.dueDate }, today, thresholds) };
    });
  }, [baseList, pending, today, thresholds]);

  const filtered = useMemo(() => sortProjects(applyFilter(effective, filter), sort), [effective, filter, sort]);
  const groups = useMemo(() => groupByStatus(filtered), [filtered]);
  const columns = filter.statuses.length ? STATUS_ORDER.filter((s) => filter.statuses.includes(s)) : STATUS_ORDER;

  const setF = <K extends keyof ProjectFilter>(k: K, v: ProjectFilter[K]) => setFilter((f) => ({ ...f, [k]: v }));
  const clientOpts = masters.clients.map((m) => ({ id: m.id, name: m.name }));
  const unitOpts = masters.designUnits.map((m) => ({ id: m.id, name: m.name }));
  const yearOpts = [...new Set(years.filter((y) => !filter.jobs.length || filter.jobs.includes(y.jobType)).map((y) => y.yearLabel))]
    .sort()
    .reverse()
    .map((l) => ({ id: l, name: l }));

  const onDropCard = async (id: string, target: DeadlineStatus) => {
    setDrag(null);
    const p = effective.find((x) => x.id === id);
    if (!p) return;
    const toCompleted = target === 'COMPLETED';
    if (p.isCompleted === toCompleted) {
      if (!toCompleted && p.status !== target)
        toast('warn', 'Không thể kéo dự án giữa các cột thời hạn — trạng thái được tính tự động theo ngày tới hạn.');
      return;
    }
    const ok = await confirm({
      title: toCompleted ? 'Xác nhận hoàn thành' : 'Bỏ hoàn thành',
      message: toCompleted ? (
        <>
          Đánh dấu <b>“{p.projectName}”</b> là đã hoàn thành?
        </>
      ) : (
        <>
          Đưa <b>“{p.projectName}”</b> trở lại hoạt động? Dự án sẽ vào cột theo ngày tới hạn hiện tại.
        </>
      ),
      confirmText: toCompleted ? 'Hoàn thành' : 'Bỏ hoàn thành',
    });
    if (!ok) return;
    const original = baseList.find((x) => x.id === id)!;
    setPending((m) => {
      const next = new Map(m);
      if (original.isCompleted === toCompleted) next.delete(id);
      else next.set(id, toCompleted);
      return next;
    });
  };

  const saveBoard = async () => {
    const changes = [...pending].map(([id, completed]) => ({ id, completed }));
    try {
      if (changes.length) {
        await api.applyBoardChanges(changes);
        setPending(new Map());
        await refresh('projects');
        toast('success', `Đã lưu ${changes.length} thay đổi trạng thái hoàn thành.`);
      }
      setEditMode(false);
    } catch (e) {
      toastError(e);
    }
  };

  const cancelBoard = async () => {
    if (pending.size && !(await confirm({ title: 'Hủy thay đổi', message: `Bỏ ${pending.size} thay đổi chưa lưu trên board?`, confirmText: 'Bỏ thay đổi', danger: true })))
      return;
    setPending(new Map());
    setEditMode(false);
  };

  const anyFilter = isFilterActive(filter);

  return (
    <>
      <div className="toolbar">
        <SearchInput value={filter.q} onChange={(v) => setF('q', v)} placeholder="Tìm tên dự án, CĐT, đơn vị TK, giai đoạn, note…" width={320} />
        <MultiSelect label="CĐT" options={clientOpts} value={filter.clients} onChange={(v) => setF('clients', v)} />
        <MultiSelect label="Đơn vị thiết kế" options={unitOpts} value={filter.designUnits} onChange={(v) => setF('designUnits', v)} />
        {showLocationFilters && (
          <>
            <MultiSelect
              label="Job"
              options={JOB_TYPES.map((j) => ({ id: j, name: JOB_LABEL[j] }))}
              value={filter.jobs}
              onChange={(v) => setF('jobs', v as ProjectFilter['jobs'])}
            />
            <MultiSelect label="Năm" options={yearOpts} value={filter.years} onChange={(v) => setF('years', v)} />
            <MultiSelect
              label="Nhóm"
              options={PROJECT_CATEGORIES.map((c) => ({ id: c, name: CATEGORY_LABEL[c] }))}
              value={filter.categories}
              onChange={(v) => setF('categories', v as ProjectFilter['categories'])}
            />
            <MultiSelect
              label="Trạng thái"
              options={STATUS_ORDER.map((s) => ({ id: s, name: STATUS_LABEL[s] }))}
              value={filter.statuses}
              onChange={(v) => setF('statuses', v as DeadlineStatus[])}
            />
          </>
        )}
        {anyFilter && (
          <button className="btn ghost sm" onClick={() => setFilter(EMPTY_FILTER)}>
            <X size={14} /> Xóa bộ lọc
          </button>
        )}
        <span className="small muted">{filtered.length} dự án</span>
        <div className="grow" />
        <div className="row" style={{ gap: 4 }}>
          <span className="small muted nowrap">Sắp xếp</span>
          <select className="select" style={{ width: 160 }} value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })} aria-label="Sắp xếp theo">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            className="btn icon"
            title={sort.dir === 'asc' ? 'Tăng dần' : 'Giảm dần'}
            aria-label={sort.dir === 'asc' ? 'Đang tăng dần, bấm để giảm dần' : 'Đang giảm dần, bấm để tăng dần'}
            onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {sort.dir === 'asc' ? <ArrowUpNarrowWide size={16} /> : <ArrowDownWideNarrow size={16} />}
          </button>
        </div>
        <button className={`btn ${editMode ? 'toggled' : ''}`} onClick={() => (editMode ? void saveBoard() : setEditMode(true))} aria-pressed={editMode}>
          {editMode ? <Unlock size={15} /> : <Lock size={15} />} Chỉnh sửa Board
        </button>
        <button className="btn primary" onClick={onAdd}>
          <Plus size={16} /> {addLabel}
        </button>
      </div>

      {editMode && (
        <div className="edit-banner">
          <Unlock size={16} />
          <span className="grow">
            Đang chỉnh sửa Board: kéo thẻ sang <b>Đã hoàn thành</b> để hoàn thành, hoặc kéo thẻ hoàn thành về cột hoạt động để bỏ hoàn thành. Ba cột thời hạn luôn do hệ thống tính.
            {pending.size > 0 && <b> · {pending.size} thay đổi chưa lưu</b>}
          </span>
          <button className="btn sm" onClick={cancelBoard}>
            Hủy
          </button>
          <button className="btn sm primary" onClick={saveBoard}>
            <Save size={14} /> Lưu &amp; thoát
          </button>
        </div>
      )}

      {baseList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileText size={36} />}
            title="Chưa có dự án nào"
            text="Thêm dự án đầu tiên để bắt đầu theo dõi thời hạn và ưu tiên."
            action={
              <button className="btn primary" onClick={onAdd}>
                <Plus size={16} /> {addLabel}
              </button>
            }
          />
        </div>
      ) : (
        <div className="board" style={{ '--cols': columns.length } as React.CSSProperties}>
          {columns.map((s) => (
            <BoardColumn
              key={s}
              status={s}
              items={groups[s]}
              showLocation={!!showLocationFilters}
              editMode={editMode}
              pending={pending}
              draggingId={drag?.id ?? null}
              dragSourceCompleted={drag ? drag.completed : null}
              onDragStart={(p) => setDrag({ id: p.id, completed: p.isCompleted })}
              onDragEnd={() => setDrag(null)}
              onDropCard={onDropCard}
            />
          ))}
        </div>
      )}
    </>
  );
}
