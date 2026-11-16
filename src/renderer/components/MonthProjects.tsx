import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate, monthRange } from '../../shared/dates';
import { describeRemaining } from '../../shared/status';
import { useSessionState } from '../lib/persist';
import type { ProjectView } from '../lib/projects';
import { useAppData } from '../state/AppData';
import { EmptyState, PriorityBadge, StatusBadge } from './common';

type Basis = 'any' | 'received' | 'due';
const BASIS_LABEL: Record<Basis, string> = { any: 'Tiếp nhận hoặc tới hạn', received: 'Theo ngày tiếp nhận', due: 'Theo ngày tới hạn' };

function shiftMonth(ym: string, d: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Dashboard: tóm tắt các dự án có ngày tiếp nhận và/hoặc ngày tới hạn rơi vào tháng đang xem. */
export function MonthProjects({ scoped }: { scoped: ProjectView[] }) {
  const { today } = useAppData();
  const navigate = useNavigate();
  const thisMonth = today.slice(0, 7);
  const [ym, setYm] = useSessionState('dash-month', thisMonth);
  const [basis, setBasis] = useSessionState<Basis>('dash-month-basis', 'any');
  const [y, m] = ym.split('-').map(Number);
  const { from, to } = monthRange(y, m);
  const inMonth = (d: string) => d >= from && d <= to;

  const list = useMemo(
    () =>
      scoped
        .filter((p) => (basis === 'received' ? inMonth(p.receivedDate) : basis === 'due' ? inMonth(p.dueDate) : inMonth(p.receivedDate) || inMonth(p.dueDate)))
        .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.dueDate.localeCompare(b.dueDate) || a.priorityPoint - b.priorityPoint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, basis, from, to],
  );
  const received = list.filter((p) => inMonth(p.receivedDate)).length;
  const due = list.filter((p) => inMonth(p.dueDate)).length;
  const done = list.filter((p) => p.isCompleted).length;

  return (
    <section className="card card-pad">
      <h2 className="card-title wrap-title">
        <CalendarRange size={18} /> Dự án trong tháng
        <span className="badge accent">{list.length}</span>
        <span className="grow" />
        <span className="row" style={{ gap: 4, fontWeight: 400 }}>
          <button className="btn sm icon ghost" aria-label="Tháng trước" onClick={() => setYm(shiftMonth(ym, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span className="month-label">
            Tháng {m}/{y}
          </span>
          <button className="btn sm icon ghost" aria-label="Tháng sau" onClick={() => setYm(shiftMonth(ym, 1))}>
            <ChevronRight size={16} />
          </button>
          {ym !== thisMonth && (
            <button className="btn sm ghost" onClick={() => setYm(thisMonth)}>
              Tháng này
            </button>
          )}
          <select className="select" style={{ width: 200, height: 30, fontSize: 13 }} value={basis} onChange={(e) => setBasis(e.target.value as Basis)} aria-label="Tiêu chí tháng">
            {(Object.keys(BASIS_LABEL) as Basis[]).map((k) => (
              <option key={k} value={k}>
                {BASIS_LABEL[k]}
              </option>
            ))}
          </select>
        </span>
      </h2>
      {list.length === 0 ? (
        <EmptyState title={`Không có dự án nào trong tháng ${m}/${y}`} text="Thử đổi tháng hoặc tiêu chí lọc." />
      ) : (
        <>
          <div className="row small muted" style={{ gap: 14, marginBottom: 10 }}>
            <span>
              <b>{received}</b> tiếp nhận trong tháng
            </span>
            <span>
              <b>{due}</b> tới hạn trong tháng
            </span>
            <span>
              <b>{done}</b> đã hoàn thành
            </span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dự án</th>
                  <th>CĐT</th>
                  <th>Salesperson</th>
                  <th>Giai đoạn</th>
                  <th>Tiếp nhận</th>
                  <th>Tới hạn</th>
                  <th>Trạng thái</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className={`clickable ${p.isCompleted ? 'row-done' : ''}`} onClick={() => navigate(`/project/${p.id}`)}>
                    <td style={{ minWidth: 200 }}>
                      <div style={{ fontWeight: 600 }}>{p.projectName}</div>
                      <div className="small faint">{p.location}</div>
                    </td>
                    <td className="nowrap">{p.clientName}</td>
                    <td className="nowrap">{p.salespersonName ?? <span className="faint">—</span>}</td>
                    <td className="nowrap">{p.stageName ?? <span className="faint">—</span>}</td>
                    <td className={`nowrap ${inMonth(p.receivedDate) ? 'hl-date' : ''}`}>{formatDate(p.receivedDate)}</td>
                    <td className="nowrap">
                      <div className={inMonth(p.dueDate) ? 'hl-date' : ''}>{formatDate(p.dueDate)}</div>
                      {!p.isCompleted && (
                        <div className={`small st-${p.status}`} style={{ color: 'var(--st)', fontWeight: 600 }}>
                          {describeRemaining(p.remaining)}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <PriorityBadge value={p.priorityPoint} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
