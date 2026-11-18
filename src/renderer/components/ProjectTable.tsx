import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2,
  Copy, ExternalLink, FileSpreadsheet, FileText, FolderInput, FolderOpen, Maximize2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { describeRemaining } from '../../shared/status';
import { api } from '../api';
import { latestNote, salesLabel, type ProjectView, type SortKey, type SortState } from '../lib/projects';
import { useProjectActions } from '../state/projectActions';
import { useUi } from '../state/ui';
import { MenuButton, PriorityBadge, SortHeader, StatusBadge, shortenPath, type MenuItem } from './common';
import { useOpenFile } from './FileLink';
import { ProjectNotesReadonly } from './ProjectNotes';
import { SelectAllHeader, SelectCell, type Selection } from './Selection';
import { SidePanel } from './Modal';
import { useTableResize } from '../lib/tableResize';

const PAGE = 100;

interface Col {
  key: string;
  label: string;
  sort?: SortKey;
  cls?: string;
  render: (p: ProjectView, showLocation: boolean) => React.ReactNode;
}

const dash = <span className="faint">—</span>;

function DueCell({ p }: { p: ProjectView }) {
  if (!p.dueDate) return dash;
  return (
    <>
      <div>{formatDate(p.dueDate)}</div>
      <div className={`small st-${p.status}`} style={{ color: p.status === 'COMPLETED' ? 'var(--text-faint)' : 'var(--st)', fontWeight: 600 }}>
        {p.status === 'COMPLETED' ? 'Đã hoàn thành' : describeRemaining(p.remaining)}
      </div>
    </>
  );
}

export const PROJECT_COLUMNS: Col[] = [
  { key: 'stt', label: 'STT', sort: 'stt', cls: 'num nowrap', render: (p) => <b>{p.stt}</b> },
  {
    key: 'name',
    label: 'Tên dự án',
    sort: 'name',
    cls: 'pt-name',
    render: (p, showLocation) => (
      <>
        <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <span className="pt-title">{p.projectName}</span>
          {p.hasImport && (
            <span className="icon-chip" title="Có bảng thiết bị import từ Excel">
              <FileSpreadsheet size={11} />
            </span>
          )}
        </div>
        {showLocation && <div className="small faint">{p.location}</div>}
      </>
    ),
  },
  { key: 'status', label: 'Trạng thái', sort: 'status', cls: 'nowrap', render: (p) => <StatusBadge status={p.status} /> },
  { key: 'si', label: 'Tên SI', sort: 'si', cls: 'pt-text', render: (p) => p.siName ?? dash },
  { key: 'brands', label: 'Hãng', cls: 'pt-text', render: (p) => p.brandNames || dash },
  { key: 'sale', label: 'Sale', cls: 'pt-text', render: (p) => p.salespersonName ?? dash },
  { key: 'client', label: 'EU', sort: 'client', cls: 'pt-text', render: (p) => p.clientName ?? dash },
  { key: 'received', label: 'Ngày bắt đầu', sort: 'received', cls: 'nowrap', render: (p) => (p.receivedDate ? formatDate(p.receivedDate) : dash) },
  { key: 'due', label: 'Ngày tới hạn', sort: 'due', cls: 'nowrap', render: (p) => <DueCell p={p} /> },
  { key: 'priority', label: 'Priority', sort: 'priority', render: (p) => <PriorityBadge value={p.priorityPoint} /> },
  { key: 'note', label: 'Ghi chú', cls: 'clamp', render: (p) => <div>{latestNote(p)}</div> },
];

export const DEFAULT_HIDDEN_PROJECT_COLS = ['note'];

export function useProjectMenu() {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const openFile = useOpenFile();
  const { toastError } = useUi();
  return (p: ProjectView): MenuItem[] => [
    { label: 'Mở chi tiết', icon: <ExternalLink size={14} />, onClick: () => navigate(`/project/${p.id}`) },
    { label: 'Chỉnh sửa', icon: <Pencil size={14} />, onClick: () => actions.openEdit(p) },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => actions.openDuplicate(p) },
    p.isCompleted
      ? { label: 'Bỏ hoàn thành', icon: <RotateCcw size={14} />, onClick: () => void actions.setCompleted(p, false) }
      : { label: 'Đánh dấu hoàn thành', icon: <CheckCircle2 size={14} />, onClick: () => void actions.setCompleted(p, true) },
    { label: 'Di chuyển…', icon: <FolderInput size={14} />, onClick: () => actions.openMove(p) },
    ...(p.folderPath ? [{ label: 'Mở thư mục dự án', icon: <FolderOpen size={14} />, onClick: () => void api.openProjectFolder(p.id).catch(toastError) }] : []),
    ...p.files.slice(0, 8).map((f) => ({ label: `Mở file ${f.name}`, icon: <FileText size={14} />, onClick: () => void openFile(f.path) })),
    { label: '', onClick: () => {}, separator: true },
    { label: 'Xóa dự án', icon: <Trash2 size={14} />, danger: true, onClick: () => void actions.remove(p) },
  ];
}

/** Chế độ xem "Danh sách" (mặc định cho Pre-sales/Post-sales): bấm một dòng mở panel xem nhanh, nhấp đúp mở chi tiết. */
export function ProjectTable({
  list,
  showLocation,
  sort,
  onSort,
  hidden,
  selectedId,
  onSelect,
  selection,
}: {
  list: ProjectView[];
  showLocation: boolean;
  sort: SortState;
  onSort: (s: SortState) => void;
  hidden: string[];
  selectedId: string | null;
  onSelect: (p: ProjectView) => void;
  /** Đang ở chế độ Chọn: thêm cột tick, bấm dòng = tick/bỏ tick. */
  selection?: Selection;
}) {
  const tableRef = useTableResize('projects');
  const picking = !!selection?.active;
  const navigate = useNavigate();
  const menu = useProjectMenu();
  const [limit, setLimit] = useState(PAGE);
  const cols = PROJECT_COLUMNS.filter((c) => !hidden.includes(c.key));
  return (
    <div className="table-wrap project-table">
      <table className="tbl" ref={tableRef}>
        <thead>
          <tr>
            {picking && <SelectAllHeader sel={selection!} />}
            {cols.map((c) => (
              <SortHeader
                key={c.key}
                label={c.label}
                active={!!c.sort && sort.key === c.sort}
                dir={sort.dir}
                onClick={c.sort ? () => onSort({ key: c.sort!, dir: sort.key === c.sort && sort.dir === 'asc' ? 'desc' : 'asc' }) : undefined}
              />
            ))}
            <th style={{ width: 1 }} aria-label="Thao tác" data-col="__actions" />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={cols.length + 2} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                Không có dự án phù hợp bộ lọc.
              </td>
            </tr>
          )}
          {list.slice(0, limit).map((p) => (
            <tr
              key={p.id}
              data-row={p.id}
              className={`clickable st-${p.status} ${p.isCompleted ? 'row-done' : ''} ${(picking ? selection!.selected.has(p.id) : p.id === selectedId) ? 'selected' : ''}`}
              tabIndex={0}
              aria-selected={picking ? selection!.selected.has(p.id) : p.id === selectedId}
              onClick={() => (picking ? selection!.toggle(p.id) : onSelect(p))}
              onDoubleClick={() => !picking && navigate(`/project/${p.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && (picking ? selection!.toggle(p.id) : onSelect(p))}
              aria-label={p.label}
            >
              {picking && <SelectCell sel={selection!} id={p.id} label={p.label} />}
              {cols.map((c) => (
                <td key={c.key} className={c.cls}>
                  {c.render(p, showLocation)}
                </td>
              ))}
              <td onClick={(e) => e.stopPropagation()}>
                <MenuButton items={menu(p)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > limit && (
        <button className="more-btn" style={{ margin: 10, width: 'calc(100% - 20px)' }} onClick={() => setLimit((l) => l + PAGE)}>
          Xem thêm {Math.min(PAGE, list.length - limit)} / còn {list.length - limit}
        </button>
      )}
    </div>
  );
}

/** Panel xem nhanh bên phải danh sách (giống Warranty): View info mở trang chi tiết, Edit mở form. */
export function ProjectPreviewPanel({ p, onClose }: { p: ProjectView; onClose: () => void }) {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const openFile = useOpenFile();
  const { toastError } = useUi();
  const row = (k: string, v: React.ReactNode) => (
    <>
      <span className="k">{k}</span>
      <span>{v || dash}</span>
    </>
  );
  const [noteCount, setNoteCount] = useState(0);
  return (
    <SidePanel
      title={p.label}
      subtitle={p.location}
      label="Thông tin dự án"
      onClose={onClose}
      footer={
        <>
          <button className="btn danger left" onClick={() => void actions.remove(p)}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn" onClick={() => actions.openDuplicate(p)} title="Tạo dự án mới chép từ dự án này">
            <Copy size={15} /> Duplicate
          </button>
          <button className="btn" onClick={() => navigate(`/project/${p.id}`)} title="Mở trang chi tiết dự án">
            <Maximize2 size={15} /> View info
          </button>
          <button className="btn primary" onClick={() => actions.openEdit(p)}>
            <Pencil size={15} /> Edit
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <StatusBadge status={p.status} />
        <PriorityBadge value={p.priorityPoint} />
        {p.status !== 'COMPLETED' && p.dueDate && (
          <span className={`small st-${p.status}`} style={{ color: 'var(--st)', fontWeight: 600 }}>
            {describeRemaining(p.remaining)}
          </span>
        )}
      </div>
      <div className="info-grid" style={{ gridTemplateColumns: '110px minmax(0, 1fr)' }}>
        {row('STT', <b>{p.stt}</b>)}
        {row('Tên dự án', <b>{p.projectName}</b>)}
        {row('Tên SI', p.siName)}
        {row(
          'Hãng',
          p.brands.length ? (
            <span className="row wrap" style={{ gap: 4 }}>
              {p.brands.map((b) => (
                <span key={b.id} className="badge">
                  {b.name}
                </span>
              ))}
            </span>
          ) : null,
        )}
        {row('Sale', salesLabel(p))}
        {row('EU', p.clientName)}
        {row('Ngày bắt đầu', p.receivedDate ? formatDate(p.receivedDate) : null)}
        {row('Ngày tới hạn', p.dueDate ? formatDate(p.dueDate) : null)}
        {row(
          'Thư mục',
          p.folderPath ? (
            <button className="link-btn" title={p.folderPath} onClick={() => void api.openProjectFolder(p.id).catch(toastError)}>
              <FolderOpen size={13} /> {shortenPath(p.folderPath, 46)}
            </button>
          ) : null,
        )}
        {p.files.length > 0 &&
          row(
            p.files.length > 1 ? `File (${p.files.length})` : 'File',
            <div className="stack" style={{ gap: 2 }}>
              {p.files.map((f) => (
                <button key={f.path} className="link-btn" title={f.path} onClick={() => void openFile(f.path)}>
                  <FileText size={13} /> {f.name}
                </button>
              ))}
            </div>,
          )}
      </div>
      <div className="row" style={{ marginTop: 18, marginBottom: 8 }}>
        <h3 className="card-title grow" style={{ margin: 0, fontSize: 14 }}>
          Ghi chú theo ngày {noteCount ? <span className="badge">{noteCount}</span> : null}
        </h3>
        <button className="btn sm ghost" onClick={() => navigate(`/project/${p.id}`)} title="Mở trang chi tiết để viết / sửa ghi chú">
          <Pencil size={13} /> Sửa ghi chú
        </button>
      </div>
      <ProjectNotesReadonly projectId={p.id} version={p.updatedAt} onCount={setNoteCount} />
    </SidePanel>
  );
}
