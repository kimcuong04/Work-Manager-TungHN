import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarRange, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import { formatDate, monthRange } from '../../shared/dates';
import { STATUS_LABEL, describeRemaining } from '../../shared/status';
import { CATEGORY_LABEL } from '../../shared/types';
import { useSessionState } from '../lib/persist';
import { latestNote, type ProjectView } from '../lib/projects';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { EmptyState, StatusBadge } from './common';
import { SelectBox } from './Selection';
import { XlsxExportDialog, type ExportColumn } from './XlsxExportDialog';
import { useTableResize } from '../lib/tableResize';

/** Ghi chú tổng hợp mở đầu bằng "dd/mm/yyyy: …" (xem notes.ts); file xuất dùng mm/dd/yyyy cho đồng nhất với cột ngày. */
function toUsDatePrefix(note: string): string {
  return note.replace(/^(\d{2})\/(\d{2})\/(\d{4}):/, '$2/$1/$3:');
}

type Basis = 'any' | 'received' | 'due';
const BASIS_LABEL: Record<Basis, string> = { any: 'Bắt đầu hoặc tới hạn', received: 'Theo ngày bắt đầu', due: 'Theo ngày tới hạn' };

function shiftMonth(ym: string, d: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

const EXPORT_COLUMNS: ExportColumn<ProjectView>[] = [
  { key: 'stt', label: 'STT', value: (p) => p.stt },
  { key: 'name', label: 'Tên dự án', value: (p) => p.projectName },
  { key: 'category', label: 'Nhóm', value: (p) => CATEGORY_LABEL[p.workCategory] },
  { key: 'location', label: 'Vị trí', value: (p) => p.location },
  { key: 'brands', label: 'Hãng', value: (p) => p.brandNames },
  { key: 'si', label: 'Tên SI', value: (p) => p.siName },
  { key: 'sale', label: 'Sale', value: (p) => p.salespersonName },
  { key: 'department', label: 'Phòng ban', value: (p) => p.salespersonDepartment },
  { key: 'eu', label: 'EU', value: (p) => p.clientName },
  { key: 'received', label: 'Ngày bắt đầu', type: 'date', value: (p) => p.receivedDate },
  { key: 'due', label: 'Ngày tới hạn', type: 'date', value: (p) => p.dueDate },
  { key: 'status', label: 'Trạng thái', value: (p) => STATUS_LABEL[p.status] },
  { key: 'remaining', label: 'Còn lại', value: (p) => (p.isCompleted ? '' : describeRemaining(p.remaining)) },
  { key: 'priority', label: 'Priority', value: (p) => p.priorityPoint },
  { key: 'folder', label: 'Thư mục', value: (p) => p.folderPath },
  { key: 'note', label: 'Ghi chú gần nhất', value: (p) => toUsDatePrefix(latestNote(p)) },
];

/**
 * Ghi chú theo ngày trong tháng gộp vào một ô (chỉ chữ, bỏ ảnh/định dạng):
 * • Ngày dd/mm/yyyy
 *     - từng dòng ghi chú
 */
export function monthNotesCell(rows: { noteDate: string; text: string }[]): string {
  return rows
    .map((n) => {
      const lines = n.text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      return [`• Ngày ${formatDate(n.noteDate)}`, ...lines.map((l) => `    - ${l}`)].join('\n');
    })
    .join('\n');
}

/** Dashboard: tóm tắt các dự án có ngày bắt đầu và/hoặc ngày tới hạn rơi vào tháng đang xem; xuất được ra .xlsx. */
export function MonthProjects({ scoped }: { scoped: ProjectView[] }) {
  const tableRef = useTableResize('month-projects');
  const { today } = useAppData();
  const navigate = useNavigate();
  const thisMonth = today.slice(0, 7);
  const [ym, setYm] = useSessionState('dash-month', thisMonth);
  const [basis, setBasis] = useSessionState<Basis>('dash-month-basis', 'any');
  const [exporting, setExporting] = useState(false);
  const [monthNotes, setMonthNotes] = useState<Map<string, string> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { toastError } = useUi();
  const [y, m] = ym.split('-').map(Number);
  const { from, to } = monthRange(y, m);
  const inMonth = (d: string | null) => !!d && d >= from && d <= to;

  const list = useMemo(
    () =>
      scoped
        .filter((p) => (basis === 'received' ? inMonth(p.receivedDate) : basis === 'due' ? inMonth(p.dueDate) : inMonth(p.receivedDate) || inMonth(p.dueDate)))
        .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.stt - b.stt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, basis, from, to],
  );
  // Chỉ tính các dự án đã tick còn nằm trong danh sách đang xem; không tick dự án nào = xuất tất cả.
  const chosen = list.filter((p) => picked.has(p.id));
  const exportRows = chosen.length ? chosen : list;
  const allOn = list.length > 0 && chosen.length === list.length;
  const togglePick = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // Ghi chú theo ngày của đúng tháng đang xem, gộp sẵn thành nội dung một ô cho từng dự án.
  const openExport = async () => {
    try {
      const rows = await api.listProjectNotesInRange(from, to);
      const byProject = new Map<string, { noteDate: string; text: string }[]>();
      for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
      setMonthNotes(new Map([...byProject].map(([id, list]) => [id, monthNotesCell(list)])));
      setExporting(true);
    } catch (e) {
      toastError(e);
    }
  };
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
          <button
            className="btn sm"
            disabled={!list.length}
            onClick={() => void openExport()}
            title={chosen.length ? `Xuất ${chosen.length} dự án đã chọn ra file Excel` : 'Chưa chọn dự án nào: xuất tất cả dự án trong tháng'}
          >
            <FileDown size={14} /> {chosen.length ? `Xuất ${chosen.length} dự án đã chọn` : 'Xuất xlsx (tất cả)'}
          </button>
        </span>
      </h2>
      {list.length === 0 ? (
        <EmptyState title={`Không có dự án nào trong tháng ${m}/${y}`} text="Thử đổi tháng hoặc tiêu chí lọc." />
      ) : (
        <>
          <div className="row small muted" style={{ gap: 14, marginBottom: 10 }}>
            <span>
              <b>{received}</b> bắt đầu trong tháng
            </span>
            <span>
              <b>{due}</b> tới hạn trong tháng
            </span>
            <span>
              <b>{done}</b> đã hoàn thành
            </span>
            <span className="grow" />
            {chosen.length > 0 ? (
              <span>
                Đã chọn <b>{chosen.length}</b> dự án để xuất ·{' '}
                <button className="link-btn" onClick={() => setPicked(new Set())}>
                  Bỏ chọn
                </button>
              </span>
            ) : (
              <span>Tick các dự án cần xuất (không tick = xuất tất cả)</span>
            )}
          </div>
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table className="tbl" ref={tableRef}>
              <thead>
                <tr>
                  <th className="select-col" data-col="__sel">
                    <SelectBox
                      checked={allOn}
                      indeterminate={chosen.length > 0 && !allOn}
                      onChange={() => setPicked(allOn ? new Set() : new Set(list.map((p) => p.id)))}
                      label="Chọn tất cả dự án trong tháng"
                    />
                  </th>
                  <th className="num">STT</th>
                  <th>Tên dự án</th>
                  <th>Hãng</th>
                  <th>Tên SI</th>
                  <th>Sale</th>
                  <th>Ngày bắt đầu</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} data-row={p.id} className={`clickable ${p.isCompleted ? 'row-done' : ''} ${picked.has(p.id) ? 'selected' : ''}`} onClick={() => navigate(`/project/${p.id}`)}>
                    <td className="select-col" onClick={(e) => e.stopPropagation()}>
                      <SelectBox checked={picked.has(p.id)} onChange={() => togglePick(p.id)} label={`Chọn ${p.stt}. ${p.projectName} để xuất`} />
                    </td>
                    <td className="num">
                      <b>{p.stt}</b>
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 600 }}>{p.projectName}</div>
                      <div className="small faint">{p.location}</div>
                    </td>
                    <td>{p.brandNames || <span className="faint">—</span>}</td>
                    <td>{p.siName ?? <span className="faint">—</span>}</td>
                    <td className="nowrap">{p.salespersonName ?? <span className="faint">—</span>}</td>
                    <td className={`nowrap ${inMonth(p.receivedDate) ? 'hl-date' : ''}`}>{p.receivedDate ? formatDate(p.receivedDate) : <span className="faint">—</span>}</td>
                    <td className="nowrap">
                      <StatusBadge status={p.status} />
                      {p.dueDate && !p.isCompleted && (
                        <div className={`small st-${p.status}`} style={{ color: 'var(--st)', fontWeight: 600, marginTop: 3 }}>
                          {describeRemaining(p.remaining)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {exporting && monthNotes && (
        <XlsxExportDialog
          title={chosen.length ? `Xuất ${chosen.length} dự án đã chọn — tháng ${m}/${y}` : `Xuất dự án tháng ${m}/${y}`}
          columns={[
            ...EXPORT_COLUMNS,
            { key: 'monthNotes', label: `Ghi chú trong tháng ${m}/${y}`, type: 'multiline', value: (p) => monthNotes.get(p.id) ?? '' },
          ]}
          rows={exportRows}
          fileName={`Du-an-thang-${String(m).padStart(2, '0')}-${y}`}
          sheetName={`Tháng ${m}-${y}`}
          onClose={() => {
            setExporting(false);
            setMonthNotes(null);
          }}
        />
      )}
    </section>
  );
}
