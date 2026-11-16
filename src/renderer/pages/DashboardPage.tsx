import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Activity, ExternalLink, FileText, PartyPopper, Plus, X } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { ACTIVE_STATUSES, STATUS_LABEL, describeRemaining } from '../../shared/status';
import { CATEGORY_LABEL, JOB_LABEL, JOB_TYPES, PROJECT_CATEGORIES, type ActiveStatus, type DeadlineStatus, type JobType, type ProjectCategory } from '../../shared/types';
import { EmptyState, PriorityBadge } from '../components/common';
import { useFileCheck, useOpenFile } from '../components/FileLink';
import { MonthProjects } from '../components/MonthProjects';
import { setSessionValue, useSessionState } from '../lib/persist';
import { EMPTY_FILTER, type ProjectView } from '../lib/projects';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { usePageTitle } from '../state/ui';

interface DashFilter {
  job: JobType | '';
  year: string;
  category: ProjectCategory | '';
}

const COLOR_VAR: Record<ActiveStatus, string> = { URGENT: 'var(--urgent)', ATTENTION: 'var(--attention)', NEW: 'var(--new)' };

function Donut({ counts, onSelect }: { counts: Record<ActiveStatus, number>; onSelect: (s: ActiveStatus) => void }) {
  const total = ACTIVE_STATUSES.reduce((s, k) => s + counts[k], 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Tỷ trọng dự án theo trạng thái">
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--border)" strokeWidth="26" />
        {total > 0 &&
          ACTIVE_STATUSES.map((s) => {
            const len = (counts[s] / total) * C;
            const el = (
              <circle
                key={s}
                className="donut-seg"
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={COLOR_VAR[s]}
                strokeWidth="26"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 100 100)"
                onClick={() => onSelect(s)}
              >
                <title>
                  {STATUS_LABEL[s]}: {counts[s]} ({Math.round((counts[s] / total) * 100)}%)
                </title>
              </circle>
            );
            offset += len;
            return counts[s] ? el : null;
          })}
        <text x="100" y="96" textAnchor="middle" fontSize="30" fontWeight="750" fill="var(--text)">
          {total}
        </text>
        <text x="100" y="118" textAnchor="middle" fontSize="12" fill="var(--text-muted)">
          đang hoạt động
        </text>
      </svg>
      <div className="legend">
        {ACTIVE_STATUSES.map((s) => (
          <button key={s} className={`st-${s}`} onClick={() => onSelect(s)}>
            <span className="sw" />
            {STATUS_LABEL[s]}
            <span className="num">
              {counts[s]} <span className="faint small">({total ? Math.round((counts[s] / total) * 100) : 0}%)</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UrgentRow({ p }: { p: ProjectView }) {
  const navigate = useNavigate();
  const openFile = useOpenFile();
  const [check] = useFileCheck(p.filePath);
  return (
    <tr className="clickable" onClick={() => navigate(`/project/${p.id}`)}>
      <td style={{ minWidth: 240 }}>
        <div style={{ fontWeight: 600 }}>{p.projectName}</div>
        <div className="small faint">{p.location}</div>
      </td>
      <td style={{ minWidth: 110 }}>{p.clientName}</td>
      <td style={{ minWidth: 110 }}>{p.designUnitName ?? <span className="faint">—</span>}</td>
      <td className="nowrap">
        <div>{formatDate(p.dueDate)}</div>
        <div className="small" style={{ color: 'var(--urgent)', fontWeight: 600 }}>
          {describeRemaining(p.remaining)}
        </div>
      </td>
      <td>
        <PriorityBadge value={p.priorityPoint} />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 4 }}>
          {p.filePath &&
            (check?.accessible ? (
              <button className="btn sm" title={`Mở ${p.fileName}`} onClick={() => openFile(p.filePath!)}>
                <FileText size={13} /> {p.fileExtension?.toUpperCase()}
              </button>
            ) : (
              <span className="icon-chip bad" title={check?.message}>
                <FileText size={12} /> Mất liên kết
              </span>
            ))}
          <button className="btn sm icon ghost" title="Mở chi tiết" aria-label="Mở chi tiết" onClick={() => navigate(`/project/${p.id}`)}>
            <ExternalLink size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function DashboardPage() {
  usePageTitle('Dashboard');
  const { projects, years } = useAppData();
  const { openCreate } = useProjectActions();
  const navigate = useNavigate();
  const [f, setF] = useSessionState<DashFilter>('dash-filter', { job: '', year: '', category: '' });

  const yearLabels = useMemo(
    () => [...new Set(years.filter((y) => !f.job || y.jobType === f.job).map((y) => y.yearLabel))].sort().reverse(),
    [years, f.job],
  );
  const scoped = useMemo(
    () =>
      projects.filter(
        (p) => (!f.job || p.jobType === f.job) && (!f.year || p.yearLabel === f.year) && (!f.category || p.workCategory === f.category),
      ),
    [projects, f],
  );
  const counts = useMemo(() => {
    const c: Record<DeadlineStatus, number> = { URGENT: 0, ATTENTION: 0, NEW: 0, COMPLETED: 0 };
    for (const p of scoped) c[p.status]++;
    return c;
  }, [scoped]);
  const active = counts.URGENT + counts.ATTENTION + counts.NEW;
  const urgent = useMemo(
    () =>
      scoped
        .filter((p) => p.status === 'URGENT')
        .sort((a, b) => a.priorityPoint - b.priorityPoint || a.dueDate.localeCompare(b.dueDate)),
    [scoped],
  );

  const goAll = (statuses: DeadlineStatus[]) => {
    setSessionValue('filter:all', {
      ...EMPTY_FILTER,
      statuses,
      jobs: f.job ? [f.job] : [],
      years: f.year ? [f.year] : [],
      categories: f.category ? [f.category] : [],
    });
    navigate('/all');
  };

  const kpis: { label: string; value: number; statuses: DeadlineStatus[]; cls: string }[] = [
    { label: 'Đang hoạt động', value: active, statuses: ['URGENT', 'ATTENTION', 'NEW'], cls: '' },
    { label: STATUS_LABEL.URGENT, value: counts.URGENT, statuses: ['URGENT'], cls: 'st-URGENT' },
    { label: STATUS_LABEL.ATTENTION, value: counts.ATTENTION, statuses: ['ATTENTION'], cls: 'st-ATTENTION' },
    { label: STATUS_LABEL.NEW, value: counts.NEW, statuses: ['NEW'], cls: 'st-NEW' },
    { label: STATUS_LABEL.COMPLETED, value: counts.COMPLETED, statuses: ['COMPLETED'], cls: 'st-COMPLETED' },
  ];
  const filtered = !!(f.job || f.year || f.category);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tổng quan</h1>
          <div className="muted small">Toàn bộ workspace: Job Chính và Job Freelance</div>
        </div>
        <div className="actions">
          <select className="select" style={{ width: 150 }} value={f.job} onChange={(e) => setF({ ...f, job: e.target.value as JobType | '', year: '' })} aria-label="Lọc theo Job">
            <option value="">Tất cả Job</option>
            {JOB_TYPES.map((j) => (
              <option key={j} value={j}>
                {JOB_LABEL[j]}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 120 }} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} aria-label="Lọc theo năm">
            <option value="">Tất cả năm</option>
            {yearLabels.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 150 }} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ProjectCategory | '' })} aria-label="Lọc theo nhóm">
            <option value="">Tất cả nhóm</option>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          {filtered && (
            <button className="btn ghost" onClick={() => setF({ job: '', year: '', category: '' })}>
              <X size={14} /> Bỏ lọc
            </button>
          )}
          <button className="btn primary" onClick={() => openCreate({ jobType: f.job || undefined, workCategory: f.category || undefined })}>
            <Plus size={16} /> Thêm Project
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Activity size={40} />}
            title="Chào mừng! Bạn chưa có dự án nào."
            text={
              <>
                Bắt đầu bằng cách thêm Project vào <b>Job Chính</b> hoặc <b>Job Freelance</b> ở sidebar (chọn năm → Pre-sales/Post-sales → nút “+”), hoặc bấm nút dưới đây.
              </>
            }
            action={
              <button className="btn primary" onClick={() => openCreate()}>
                <Plus size={16} /> Thêm Project đầu tiên
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="kpis">
            {kpis.map((k) => (
              <button key={k.label} className={`kpi ${k.cls}`} onClick={() => goAll(k.statuses)} title="Mở danh sách với bộ lọc tương ứng">
                <div className="kpi-label">
                  {k.cls && <span className="status-dot" />}
                  {k.label}
                </div>
                <div className="kpi-value">{k.value}</div>
              </button>
            ))}
          </div>

          <div className="dash-grid">
            <section className="card card-pad">
              <h2 className="card-title">Trạng thái dự án đang hoạt động</h2>
              {active === 0 ? (
                <EmptyState title="Không có dự án đang hoạt động" text="Tất cả dự án trong phạm vi lọc đã hoàn thành." />
              ) : (
                <Donut counts={counts} onSelect={(s) => goAll([s])} />
              )}
            </section>

            <section className="card card-pad">
              <h2 className="card-title st-URGENT">
                <span className="status-dot" /> Dự án khẩn cấp
                <span className="badge status st-URGENT" style={{ marginLeft: 'auto' }}>
                  {urgent.length}
                </span>
              </h2>
              {urgent.length === 0 ? (
                <EmptyState icon={<PartyPopper size={36} />} title="Không có dự án khẩn cấp" text="Mọi việc đang trong tầm kiểm soát. Tiếp tục phát huy!" />
              ) : (
                <div className="table-wrap" style={{ maxHeight: 520 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Dự án</th>
                        <th>CĐT</th>
                        <th>Đơn vị thiết kế</th>
                        <th>Ngày tới hạn</th>
                        <th>Priority</th>
                        <th>File / Mở</th>
                      </tr>
                    </thead>
                    <tbody>
                      {urgent.map((p) => (
                        <UrgentRow key={p.id} p={p} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="dash-full">
              <MonthProjects scoped={scoped} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
