import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, ExternalLink, FileSpreadsheet, FileText, FolderInput, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { describeRemaining } from '../../shared/status';
import type { ProjectView, SortKey, SortState } from '../lib/projects';
import { useProjectActions } from '../state/projectActions';
import { MenuButton, PriorityBadge, SortHeader, StatusBadge, type MenuItem } from './common';
import { useOpenFile } from './FileLink';

const PAGE = 100;

interface Col {
  key: string;
  label: string;
  sort?: SortKey;
  cls?: string;
  render: (p: ProjectView, showLocation: boolean) => React.ReactNode;
}

const dash = <span className="faint">—</span>;

export const PROJECT_COLUMNS: Col[] = [
  {
    key: 'name',
    label: 'Tên dự án',
    sort: 'name',
    cls: 'pt-name',
    render: (p, showLocation) => (
      <>
        <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <span className="pt-title">{p.projectName}</span>
          {p.filePath && (
            <span className="icon-chip" title={p.fileName ?? ''}>
              <FileText size={11} />
              {p.fileExtension?.toUpperCase()}
            </span>
          )}
          {p.hasImport && (
            <span className="icon-chip" title="Có dữ liệu Excel đã import">
              <FileSpreadsheet size={11} />
            </span>
          )}
        </div>
        {showLocation && <div className="small faint">{p.location}</div>}
      </>
    ),
  },
  { key: 'status', label: 'Trạng thái', sort: 'status', cls: 'nowrap', render: (p) => <StatusBadge status={p.status} /> },
  { key: 'client', label: 'CĐT', sort: 'client', cls: 'pt-text', render: (p) => p.clientName },
  { key: 'designUnit', label: 'Đơn vị thiết kế', cls: 'pt-text', render: (p) => p.designUnitName ?? dash },
  { key: 'salesperson', label: 'Salesperson', cls: 'pt-text', render: (p) => p.salespersonName ?? dash },
  { key: 'stage', label: 'Giai đoạn', cls: 'pt-text', render: (p) => p.stageName ?? dash },
  { key: 'received', label: 'Ngày tiếp nhận', sort: 'received', cls: 'nowrap', render: (p) => formatDate(p.receivedDate) },
  {
    key: 'due',
    label: 'Ngày tới hạn',
    sort: 'due',
    cls: 'nowrap',
    render: (p) => (
      <>
        <div>{formatDate(p.dueDate)}</div>
        <div className={`small st-${p.status}`} style={{ color: p.status === 'COMPLETED' ? 'var(--text-faint)' : 'var(--st)', fontWeight: 600 }}>
          {p.status === 'COMPLETED' ? 'Đã hoàn thành' : describeRemaining(p.remaining)}
        </div>
      </>
    ),
  },
  { key: 'priority', label: 'Priority', sort: 'priority', render: (p) => <PriorityBadge value={p.priorityPoint} /> },
  { key: 'note', label: 'Ghi chú', cls: 'clamp', render: (p) => <div>{p.note}</div> },
];

export const DEFAULT_HIDDEN_PROJECT_COLS = ['note'];

function RowMenu({ p }: { p: ProjectView }) {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const openFile = useOpenFile();
  const items: MenuItem[] = [
    { label: 'Mở chi tiết', icon: <ExternalLink size={14} />, onClick: () => navigate(`/project/${p.id}`) },
    { label: 'Chỉnh sửa', icon: <Pencil size={14} />, onClick: () => actions.openEdit(p) },
    p.isCompleted
      ? { label: 'Bỏ hoàn thành', icon: <RotateCcw size={14} />, onClick: () => void actions.setCompleted(p, false) }
      : { label: 'Đánh dấu hoàn thành', icon: <CheckCircle2 size={14} />, onClick: () => void actions.setCompleted(p, true) },
    { label: 'Di chuyển…', icon: <FolderInput size={14} />, onClick: () => actions.openMove(p) },
    ...(p.filePath ? [{ label: `Mở file ${p.fileName ?? ''}`, icon: <FileText size={14} />, onClick: () => void openFile(p.filePath!) }] : []),
    { label: '', onClick: () => {}, separator: true },
    { label: 'Xóa dự án', icon: <Trash2 size={14} />, danger: true, onClick: () => void actions.remove(p) },
  ];
  return <MenuButton items={items} />;
}

/** Chế độ xem "Danh sách" (mặc định cho Pre-sales/Post-sales): bảng sắp xếp theo cột, ẩn/hiện cột như Warranty. */
export function ProjectTable({
  list,
  showLocation,
  sort,
  onSort,
  hidden,
}: {
  list: ProjectView[];
  showLocation: boolean;
  sort: SortState;
  onSort: (s: SortState) => void;
  hidden: string[];
}) {
  const navigate = useNavigate();
  const [limit, setLimit] = useState(PAGE);
  const cols = PROJECT_COLUMNS.filter((c) => !hidden.includes(c.key));
  const open = (p: ProjectView) => navigate(`/project/${p.id}`);
  return (
    <div className="table-wrap project-table" style={{ flex: 1 }}>
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <SortHeader
                key={c.key}
                label={c.label}
                active={!!c.sort && sort.key === c.sort}
                dir={sort.dir}
                onClick={c.sort ? () => onSort({ key: c.sort!, dir: sort.key === c.sort && sort.dir === 'asc' ? 'desc' : 'asc' }) : undefined}
              />
            ))}
            <th style={{ width: 1 }} aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={cols.length + 1} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                Không có dự án phù hợp bộ lọc.
              </td>
            </tr>
          )}
          {list.slice(0, limit).map((p) => (
            <tr
              key={p.id}
              className={`clickable st-${p.status} ${p.isCompleted ? 'row-done' : ''}`}
              tabIndex={0}
              onClick={() => open(p)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open(p)}
              aria-label={p.projectName}
            >
              {cols.map((c) => (
                <td key={c.key} className={c.cls}>
                  {c.render(p, showLocation)}
                </td>
              ))}
              <td onClick={(e) => e.stopPropagation()}>
                <RowMenu p={p} />
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
