import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flag,
  FolderKanban,
  PenLine,
  Pencil,
  Plus,
  Rocket,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { compareVi } from '../../shared/text';
import { STATUS_LABEL, describeRemaining } from '../../shared/status';
import { CALENDAR_COLORS, CALENDAR_KIND_LABEL, type CalendarColor, type CalendarEvent, type CalendarEventInput } from '../../shared/types';
import { hasErrors, validateCalendarEventInput } from '../../shared/validation';
import { api } from '../api';
import { DateInput, Field, SearchableSelect, StatusBadge, useClickOutside } from '../components/common';
import { Modal, useEscape } from '../components/Modal';
import {
  COLOR_LABEL,
  LAYER_COLOR,
  LAYER_LABEL,
  VIEW_LABEL,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  dueItem,
  eventItem,
  fromMinutes,
  groupByDate,
  layoutTimed,
  monthGrid,
  shiftAnchor,
  shiftMonths,
  timeLabel,
  toMinutes,
  viewRange,
  viewTitle,
  weekdayIndex,
  type CalItem,
  type CalView,
  type LayerKey,
} from '../lib/calendar';
import { useLocalState, useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { usePageTitle, useUi } from '../state/ui';

const HOUR_PX = 48;
const MONTH_MAX_CHIPS = 3;
const LAYERS: LayerKey[] = ['PROJECT_START', 'PROJECT_UPDATE', 'CUSTOM', 'DUE'];
const ALL_LAYERS_ON: Record<LayerKey, boolean> = { PROJECT_START: true, PROJECT_UPDATE: true, CUSTOM: true, DUE: true };

function LayerIcon({ layer, size = 11 }: { layer: LayerKey; size?: number }) {
  if (layer === 'PROJECT_START') return <Rocket size={size} />;
  if (layer === 'PROJECT_UPDATE') return <PenLine size={size} />;
  if (layer === 'DUE') return <Flag size={size} />;
  return null;
}

function colorClass(it: CalItem): string {
  if (it.color === 'due') return `ev-due st-${it.project?.status ?? 'NEW'}`;
  return `ev-c-${it.color}`;
}

function EventChip({ it, onOpen, compact }: { it: CalItem; onOpen: (it: CalItem, el: HTMLElement) => void; compact?: boolean }) {
  const draggable = !!it.event;
  return (
    <button
      type="button"
      className={`ev-chip ${colorClass(it)} ${it.startTime ? 'timed' : ''} ${compact ? 'compact' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-ppm-event', it.event!.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(it, e.currentTarget);
      }}
      title={`${LAYER_LABEL[it.layer]}: ${it.title}${it.startTime ? ` (${timeLabel(it)})` : ''}`}
    >
      {it.startTime ? <span className="ev-dot" /> : <LayerIcon layer={it.layer} />}
      {it.startTime && <span className="ev-time">{it.startTime}</span>}
      <span className="ev-title">{it.layer === 'DUE' ? `Hạn: ${it.title}` : it.title}</span>
    </button>
  );
}

/** Thả sự kiện sang ngày khác (sự kiện tính từ hạn chót dự án thì không kéo được). */
function useDropDay(onMove: (id: string, date: string) => void) {
  const [over, setOver] = useState<string | null>(null);
  const bind = (date: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-ppm-event')) return;
      e.preventDefault();
      if (over !== date) setOver(date);
    },
    onDragLeave: () => setOver((o) => (o === date ? null : o)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData('application/x-ppm-event');
      setOver(null);
      if (id) {
        e.preventDefault();
        onMove(id, date);
      }
    },
  });
  return { over, bind };
}

function MonthView({
  anchor,
  today,
  byDate,
  onOpen,
  onCreate,
  onMore,
  onDay,
  onMove,
}: {
  anchor: string;
  today: string;
  byDate: Map<string, CalItem[]>;
  onOpen: (it: CalItem, el: HTMLElement) => void;
  onCreate: (date: string) => void;
  onMore: (date: string, el: HTMLElement) => void;
  onDay: (date: string) => void;
  onMove: (id: string, date: string) => void;
}) {
  const days = monthGrid(anchor);
  const month = anchor.slice(0, 7);
  const { over, bind } = useDropDay(onMove);
  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={w} className={i >= 5 ? 'weekend' : ''}>
            {w}
          </div>
        ))}
      </div>
      <div className="cal-month-grid">
        {days.map((d) => {
          const items = byDate.get(d) ?? [];
          const hidden = items.length - MONTH_MAX_CHIPS;
          const shown = hidden > 0 ? items.slice(0, MONTH_MAX_CHIPS - 1) : items;
          return (
            <div
              key={d}
              className={`cal-cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today ? 'today' : ''} ${over === d ? 'drop' : ''} ${weekdayIndex(d) >= 5 ? 'weekend' : ''}`}
              onClick={() => onCreate(d)}
              data-date={d}
              {...bind(d)}
            >
              <button
                type="button"
                className="cal-daynum"
                onClick={(e) => {
                  e.stopPropagation();
                  onDay(d);
                }}
                aria-label={`Xem ngày ${formatDate(d)}`}
              >
                {d.endsWith('-01') ? `${Number(d.slice(8))}/${Number(d.slice(5, 7))}` : Number(d.slice(8))}
              </button>
              <div className="cal-cell-items">
                {shown.map((it) => (
                  <EventChip key={it.key} it={it} onOpen={onOpen} compact />
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    className="cal-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMore(d, e.currentTarget);
                    }}
                  >
                    +{hidden + 1} mục khác
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGridView({
  days,
  today,
  byDate,
  onOpen,
  onCreate,
  onDay,
  onMove,
}: {
  days: string[];
  today: string;
  byDate: Map<string, CalItem[]>;
  onOpen: (it: CalItem, el: HTMLElement) => void;
  onCreate: (date: string, start?: string) => void;
  onDay: (date: string) => void;
  onMove: (id: string, date: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  const { over, bind } = useDropDay(onMove);
  useEffect(() => {
    const t = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX - 8;
  }, []);
  const cols = { '--days': days.length } as React.CSSProperties;
  return (
    <div className="cal-tg">
      <div className="cal-tg-head" style={cols}>
        <div className="cal-tg-gutter" />
        {days.map((d) => (
          <button key={d} type="button" className={`cal-tg-day ${d === today ? 'today' : ''}`} onClick={() => onDay(d)}>
            <span className="wd">{WEEKDAY_SHORT[weekdayIndex(d)]}</span>
            <span className="num">{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      <div className="cal-tg-allday" style={cols}>
        <div className="cal-tg-gutter small faint">Cả ngày</div>
        {days.map((d) => (
          <div key={d} className={`cal-tg-allday-cell ${over === d ? 'drop' : ''}`} onClick={() => onCreate(d)} {...bind(d)}>
            {(byDate.get(d) ?? [])
              .filter((i) => !i.startTime)
              .map((it) => (
                <EventChip key={it.key} it={it} onOpen={onOpen} compact />
              ))}
          </div>
        ))}
      </div>
      <div className="cal-tg-scroll" ref={scrollRef}>
        <div className="cal-tg-body" style={{ ...cols, height: 24 * HOUR_PX }}>
          <div className="cal-tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-tg-hour" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutTimed(byDate.get(d) ?? [], HOUR_PX);
            return (
              <div
                key={d}
                className={`cal-tg-col ${d === today ? 'today' : ''} ${over === d ? 'drop' : ''}`}
                onClick={(e) => {
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const min = Math.floor((y / HOUR_PX) * 2) * 30;
                  onCreate(d, fromMinutes(min));
                }}
                {...bind(d)}
              >
                {placed.map((p) => (
                  <button
                    key={p.item.key}
                    type="button"
                    className={`ev-block ${colorClass(p.item)}`}
                    style={{ top: p.top, height: p.height - 2, left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`, width: `calc(${100 / p.lanes}% - 4px)` }}
                    draggable={!!p.item.event}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-ppm-event', p.item.event!.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p.item, e.currentTarget);
                    }}
                  >
                    <span className="ev-title">{p.item.title}</span>
                    <span className="ev-time">{timeLabel(p.item)}</span>
                  </button>
                ))}
                {d === today && <div className="cal-now" style={{ top: (nowMin / 60) * HOUR_PX }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgendaView({ days, today, byDate, onOpen, onDay }: { days: string[]; today: string; byDate: Map<string, CalItem[]>; onOpen: (it: CalItem, el: HTMLElement) => void; onDay: (d: string) => void }) {
  const withItems = days.filter((d) => (byDate.get(d) ?? []).length);
  if (!withItems.length)
    return (
      <div className="cal-agenda">
        <div className="empty">
          <CalendarDays size={36} />
          <h3>Không có sự kiện trong {days.length} ngày tới</h3>
          <p>Bấm “Tạo” để thêm sự kiện, hoặc tạo dự án mới — ngày tiếp nhận được tự đưa lên Calendar.</p>
        </div>
      </div>
    );
  return (
    <div className="cal-agenda">
      {withItems.map((d) => (
        <div key={d} className={`cal-agenda-day ${d === today ? 'today' : ''}`}>
          <button type="button" className="cal-agenda-date" onClick={() => onDay(d)}>
            <span className="num">{Number(d.slice(8))}</span>
            <span className="small muted">
              Th{Number(d.slice(5, 7))}, {WEEKDAY_SHORT[weekdayIndex(d)]}
            </span>
          </button>
          <div className="cal-agenda-items">
            {(byDate.get(d) ?? []).map((it) => (
              <button key={it.key} type="button" className={`cal-agenda-item ${colorClass(it)}`} onClick={(e) => onOpen(it, e.currentTarget)}>
                <span className="ev-swatch" />
                <span className="cal-agenda-time small">{timeLabel(it)}</span>
                <span className="grow ellipsis" style={{ fontWeight: 600 }}>
                  {it.layer === 'DUE' ? `Hạn: ${it.title}` : it.title}
                </span>
                <span className="small muted nowrap row" style={{ gap: 4 }}>
                  <LayerIcon layer={it.layer} size={12} /> {LAYER_LABEL[it.layer]}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniMonth({ anchor, today, view, onPick }: { anchor: string; today: string; view: CalView; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(anchor);
  useEffect(() => setMonth(anchor), [anchor]);
  const days = monthGrid(month);
  const range = view === 'week' ? viewRange('week', anchor) : { from: anchor, to: anchor };
  return (
    <div className="mini-month">
      <div className="row" style={{ marginBottom: 6 }}>
        <b className="grow small">
          Tháng {Number(month.slice(5, 7))}, {month.slice(0, 4)}
        </b>
        <button className="btn ghost icon sm" aria-label="Tháng trước" onClick={() => setMonth(shiftMonths(month, -1))}>
          <ChevronLeft size={15} />
        </button>
        <button className="btn ghost icon sm" aria-label="Tháng sau" onClick={() => setMonth(shiftMonths(month, 1))}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="mini-grid">
        {WEEKDAY_SHORT.map((w) => (
          <span key={w} className="wd">
            {w}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`${d.slice(0, 7) !== month.slice(0, 7) ? 'other' : ''} ${d === today ? 'today' : ''} ${d >= range.from && d <= range.to ? 'in-range' : ''}`}
            onClick={() => onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}

function useFloatingPos(anchor: DOMRect, width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + 8;
    if (left + width > vw - 12) left = anchor.left - width - 8;
    if (left < 12) left = Math.max(12, Math.min(vw - width - 12, anchor.left));
    let top = anchor.top;
    if (top + h > vh - 12) top = Math.max(12, vh - h - 12);
    setPos({ left, top });
  }, [anchor, width]);
  return { ref, style: { left: pos.left, top: pos.top, width } as React.CSSProperties };
}

function EventPopover({
  it,
  anchor,
  onClose,
  onEdit,
  onDelete,
}: {
  it: CalItem;
  anchor: DOMRect;
  onClose: () => void;
  onEdit: (e: CalendarEvent) => void;
  onDelete: (e: CalendarEvent) => void;
}) {
  const navigate = useNavigate();
  const actions = useProjectActions();
  const { projectById } = useAppData();
  const { ref, style } = useFloatingPos(anchor, 360);
  useClickOutside(ref, onClose);
  useEscape(onClose);
  const ev = it.event;
  const projectId = ev?.projectId ?? it.project?.id ?? null;
  const project = projectId ? projectById.get(projectId) : undefined;
  const [y, m, d] = it.date.split('-').map(Number);
  return (
    <div className="cal-pop" ref={ref} style={style} role="dialog" aria-label={it.title}>
      <div className="cal-pop-tools">
        {ev && (
          <>
            <button className="btn ghost icon sm" title="Sửa sự kiện" aria-label="Sửa sự kiện" onClick={() => onEdit(ev)}>
              <Pencil size={15} />
            </button>
            <button className="btn ghost icon sm" title="Xóa sự kiện" aria-label="Xóa sự kiện" onClick={() => onDelete(ev)}>
              <Trash2 size={15} />
            </button>
          </>
        )}
        <button className="btn ghost icon sm" aria-label="Đóng" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="cal-pop-row">
        <span className={`ev-swatch big ${colorClass(it)}`} />
        <div style={{ minWidth: 0 }}>
          <div className="cal-pop-title">{it.layer === 'DUE' ? `Hạn chót: ${it.title}` : it.title}</div>
          <div className="small muted">
            {WEEKDAY_LONG[weekdayIndex(it.date)]}, {d} tháng {m}, {y} · {timeLabel(it)}
          </div>
        </div>
      </div>
      <div className="cal-pop-row small">
        <LayerIcon layer={it.layer} size={15} />
        <span>{ev ? CALENDAR_KIND_LABEL[ev.kind] : LAYER_LABEL.DUE}</span>
      </div>
      {(project || ev?.projectName) && (
        <div className="cal-pop-row small">
          <FolderKanban size={15} />
          <span className="grow" style={{ minWidth: 0 }}>
            {project ? (
              <>
                <b>{project.projectName}</b>
                <div className="faint">{project.location}</div>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  <StatusBadge status={project.status} />
                  <span className="muted">
                    Hạn {formatDate(project.dueDate)}
                    {project.status !== 'COMPLETED' ? ` · ${describeRemaining(project.remaining)}` : ''}
                  </span>
                </div>
              </>
            ) : (
              <span>
                {ev?.projectName} <span className="faint">(dự án đã xóa)</span>
              </span>
            )}
          </span>
        </div>
      )}
      {ev?.note && (
        <div className="cal-pop-row small">
          <StickyNote size={15} />
          <div className="pre cal-pop-note">{ev.note}</div>
        </div>
      )}
      {project && (
        <div className="cal-pop-foot">
          <button className="btn sm" onClick={() => actions.openEdit(project)}>
            <Pencil size={13} /> Sửa dự án
          </button>
          <button className="btn sm primary" onClick={() => navigate(`/project/${project.id}`)}>
            <ExternalLink size={13} /> Mở dự án
          </button>
        </div>
      )}
      {it.layer === 'DUE' && project && <div className="small faint" style={{ marginTop: 8 }}>{STATUS_LABEL[project.status]} — tính tự động từ ngày tới hạn.</div>}
    </div>
  );
}

function DayListPopover({ date, items, anchor, onClose, onOpen }: { date: string; items: CalItem[]; anchor: DOMRect; onClose: () => void; onOpen: (it: CalItem, el: HTMLElement) => void }) {
  const { ref, style } = useFloatingPos(anchor, 260);
  useClickOutside(ref, onClose);
  useEscape(onClose);
  return (
    <div className="cal-pop" ref={ref} style={style} role="dialog" aria-label={`Sự kiện ngày ${formatDate(date)}`}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="grow">
          <div className="small muted">{WEEKDAY_SHORT[weekdayIndex(date)]}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{Number(date.slice(8))}</div>
        </div>
        <button className="btn ghost icon sm" aria-label="Đóng" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="stack" style={{ gap: 3 }}>
        {items.map((it) => (
          <EventChip key={it.key} it={it} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function EventForm({ event, preset, onClose, onSaved, onDelete }: { event?: CalendarEvent; preset?: { date: string; start?: string; projectId?: string }; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const { projects } = useAppData();
  const { toast, toastError, confirm } = useUi();
  const [initial] = useState<CalendarEventInput>(() =>
    event
      ? { eventDate: event.eventDate, startTime: event.startTime, endTime: event.endTime, title: event.title, note: event.note, color: event.color, projectId: event.projectExists ? event.projectId : null }
      : {
          eventDate: preset?.date ?? '',
          startTime: preset?.start ?? null,
          endTime: preset?.start ? fromMinutes(toMinutes(preset.start) + 60) : null,
          title: '',
          note: '',
          color: null,
          projectId: preset?.projectId ?? null,
        },
  );
  const [form, setForm] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateCalendarEventInput(form);
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof CalendarEventInput>(k: K, v: CalendarEventInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const allDay = !form.startTime;
  const projectKind = event && event.kind !== 'CUSTOM';
  const defaultColor = event ? LAYER_COLOR[event.kind] : LAYER_COLOR.CUSTOM;
  // Dự án vừa chỉnh sửa lên đầu (thường là dự án đang làm), phần còn lại xếp A–Z.
  const projectOptions = useMemo(() => {
    const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
    const recentIds = new Set(recent.map((p) => p.id));
    const rest = projects.filter((p) => !recentIds.has(p.id)).sort((a, b) => compareVi(a.projectName, b.projectName));
    return [
      ...recent.map((p) => ({ id: p.id, name: p.label, hint: 'Vừa chỉnh sửa' })),
      ...rest.map((p) => ({ id: p.id, name: p.label, hint: p.location })),
    ];
  }, [projects]);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Bỏ thay đổi?', message: 'Sự kiện có thay đổi chưa lưu. Đóng và bỏ thay đổi?', confirmText: 'Bỏ thay đổi', danger: true }))) return;
    onClose();
  };
  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
    setSaving(true);
    try {
      if (event) await api.updateCalendarEvent(event.id, form);
      else await api.createCalendarEvent(form);
      toast('success', event ? 'Đã cập nhật sự kiện.' : `Đã thêm sự kiện ngày ${formatDate(form.eventDate)}.`);
      onSaved();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="md"
      title={event ? `Sửa sự kiện${projectKind ? ` · ${CALENDAR_KIND_LABEL[event.kind]}` : ''}` : 'Tạo sự kiện'}
      onClose={close}
      footer={() => (
        <>
          {event && onDelete && (
            <button className="btn danger left" onClick={onDelete}>
              <Trash2 size={15} /> Xóa
            </button>
          )}
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      )}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Tiêu đề" required error={err('title')}>
          <input autoFocus className={`input ${err('title') ? 'invalid' : ''}`} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ví dụ: Họp khảo sát hiện trường" />
        </Field>
        <div className="grid-2">
          <Field label="Ngày" required error={err('eventDate')}>
            <DateInput value={form.eventDate || null} onChange={(v) => set('eventDate', v ?? '')} />
          </Field>
          <Field label="Thời gian" error={err('startTime') ?? err('endTime')}>
            <div className="row" style={{ gap: 6 }}>
              <label className="row small nowrap" style={{ gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setForm((f) => (e.target.checked ? { ...f, startTime: null, endTime: null } : { ...f, startTime: '09:00', endTime: '10:00' }))}
                />
                Cả ngày
              </label>
              {!allDay && (
                <>
                  <input className="input" type="time" style={{ width: 110 }} value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} aria-label="Giờ bắt đầu" />
                  <span className="faint">–</span>
                  <input className="input" type="time" style={{ width: 110 }} value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} aria-label="Giờ kết thúc" />
                </>
              )}
            </div>
          </Field>
        </div>
        <Field label="Màu">
          <div className="swatches" role="radiogroup" aria-label="Màu sự kiện">
            <button type="button" className={`swatch ev-c-${defaultColor} ${form.color === null ? 'on' : ''}`} title="Mặc định theo loại" aria-label="Màu mặc định" onClick={() => set('color', null)}>
              {form.color === null && '✓'}
            </button>
            {CALENDAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ev-c-${c} ${form.color === c ? 'on' : ''}`}
                title={COLOR_LABEL[c as CalendarColor]}
                aria-label={COLOR_LABEL[c as CalendarColor]}
                onClick={() => set('color', c)}
              >
                {form.color === c && '✓'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Dự án liên kết" hint={projectKind ? 'Sự kiện được tạo tự động từ dự án này.' : 'Không bắt buộc.'}>
          {projectKind ? (
            <div className="muted">{event?.projectName ?? '—'}</div>
          ) : (
            <SearchableSelect options={projectOptions} keepOrder value={form.projectId} onChange={(v) => set('projectId', v)} placeholder="Chọn dự án (không bắt buộc)" />
          )}
        </Field>
        <Field label="Ghi chú" error={err('note')}>
          <textarea className="textarea" rows={5} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function CalendarPage() {
  usePageTitle('Calendar');
  const { today, projects } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const location = useLocation();
  const [view, setView] = useLocalState<CalView>('calendar-view', 'month');
  const [anchor, setAnchor] = useSessionState('calendar-anchor', today);
  const [layers, setLayers] = useLocalState<Record<LayerKey, boolean>>('calendar-layers', ALL_LAYERS_ON);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pop, setPop] = useState<{ it: CalItem; rect: DOMRect } | null>(null);
  const [more, setMore] = useState<{ date: string; rect: DOMRect } | null>(null);
  const [form, setForm] = useState<{ event?: CalendarEvent; preset?: { date: string; start?: string } } | null>(null);
  // Cú bấm ra ngoài chỉ để đóng thẻ chi tiết thì không được mở luôn form tạo sự kiện ở ô vừa bấm.
  const dismissedAt = useRef(0);
  const closePop = () => {
    dismissedAt.current = Date.now();
    setPop(null);
  };
  const closeMore = () => {
    dismissedAt.current = Date.now();
    setMore(null);
  };

  useEffect(() => {
    const st = location.state as { date?: string; view?: CalView } | null;
    if (st?.date) setAnchor(st.date);
    if (st?.view) setView(st.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const load = useCallback(() => {
    api
      .listCalendarEvents({ from: range.from, to: range.to })
      .then((list) => {
        setEvents(list);
        setLoading(false);
      })
      .catch(toastError);
  }, [range.from, range.to, toastError]);
  useEffect(load, [load, projects]);

  const items = useMemo(() => {
    const out: CalItem[] = events.filter((e) => layers[e.kind] !== false).map(eventItem);
    if (layers.DUE !== false)
      for (const p of projects) if (!p.isCompleted && p.dueDate && p.dueDate >= range.from && p.dueDate <= range.to) out.push(dueItem({ ...p, dueDate: p.dueDate }));
    return out;
  }, [events, projects, layers, range.from, range.to]);
  const byDate = useMemo(() => groupByDate(items), [items]);
  const counts = useMemo(() => {
    const c: Record<LayerKey, number> = { PROJECT_START: 0, PROJECT_UPDATE: 0, CUSTOM: 0, DUE: 0 };
    for (const e of events) c[e.kind]++;
    for (const p of projects) if (!p.isCompleted && p.dueDate && p.dueDate >= range.from && p.dueDate <= range.to) c.DUE++;
    return c;
  }, [events, projects, range.from, range.to]);

  const openItem = (it: CalItem, el: HTMLElement) => {
    setMore(null);
    setPop({ it, rect: el.getBoundingClientRect() });
  };
  const goDay = (d: string) => {
    setAnchor(d);
    setView('day');
  };
  const create = (date: string, start?: string) => {
    if (Date.now() - dismissedAt.current < 400) return;
    setPop(null);
    setForm({ preset: { date, start } });
  };
  const move = async (id: string, date: string) => {
    const ev = events.find((e) => e.id === id);
    if (!ev || ev.eventDate === date) return;
    setEvents((list) => list.map((e) => (e.id === id ? { ...e, eventDate: date } : e)));
    try {
      await api.moveCalendarEvent(id, date);
      toast('success', `Đã chuyển “${ev.title}” sang ${formatDate(date)}.`);
    } catch (e) {
      toastError(e);
    }
    load();
  };
  const remove = async (ev: CalendarEvent) => {
    const ok = await confirm({
      title: 'Xóa sự kiện',
      message: (
        <>
          Xóa <b>“{ev.title}”</b> ngày {formatDate(ev.eventDate)} khỏi Calendar?
          {ev.kind !== 'CUSTOM' && <div className="muted small">Dự án không bị ảnh hưởng.</div>}
        </>
      ),
      confirmText: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCalendarEvent(ev.id);
      setPop(null);
      setForm(null);
      toast('success', 'Đã xóa sự kiện.');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const nav = useRef({ view, anchor });
  nav.current = { view, anchor };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"], .modal, .cal-pop')) return;
      const { view: v, anchor: a } = nav.current;
      const k = e.key.toLowerCase();
      if (k === 't') setAnchor(today);
      else if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'a') setView('agenda');
      else if (k === 'j' || k === 'n') setAnchor(shiftAnchor(v, a, 1));
      else if (k === 'k' || k === 'p') setAnchor(shiftAnchor(v, a, -1));
      else if (k === 'c') setForm({ preset: { date: a } });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today, setAnchor, setView]);

  return (
    <div className="cal-page">
      <aside className="cal-side">
        <button className="btn primary cal-create" onClick={() => setForm({ preset: { date: anchor } })}>
          <Plus size={18} /> Tạo sự kiện
        </button>
        <MiniMonth anchor={anchor} today={today} view={view} onPick={(d) => setAnchor(d)} />
        <div className="cal-layers">
          <div className="small muted" style={{ fontWeight: 650, marginBottom: 6 }}>
            Hiển thị
          </div>
          {LAYERS.map((l) => (
            <label key={l} className="cal-layer">
              <input type="checkbox" checked={layers[l] !== false} onChange={(e) => setLayers({ ...ALL_LAYERS_ON, ...layers, [l]: e.target.checked })} />
              <span className={`ev-swatch ${l === 'DUE' ? 'ev-due st-URGENT' : `ev-c-${LAYER_COLOR[l]}`}`} />
              <span className="grow">{LAYER_LABEL[l]}</span>
              <span className="small faint">{counts[l] || ''}</span>
            </label>
          ))}
        </div>
        <div className="small faint" style={{ marginTop: 'auto', lineHeight: 1.6 }}>
          Dự án mới tự có mục “Bắt đầu dự án” ở ngày tiếp nhận. Khi sửa dự án, chọn <b>Lưu và thêm vào Calendar</b> để ghi lại thay đổi. Kéo thả sự kiện để đổi ngày.
          <br />
          Phím tắt: T hôm nay · J/K sau/trước · D/W/M/A đổi chế độ · C tạo
        </div>
      </aside>
      <section className="cal-main">
        <div className="cal-toolbar">
          <button className="btn" onClick={() => setAnchor(today)}>
            Hôm nay
          </button>
          <button className="btn ghost icon" aria-label="Trước" title="Trước (K)" onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>
            <ChevronLeft size={18} />
          </button>
          <button className="btn ghost icon" aria-label="Sau" title="Sau (J)" onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>
            <ChevronRight size={18} />
          </button>
          <h1 className="cal-title">{viewTitle(view, anchor)}</h1>
          {loading && <span className="small faint">Đang tải…</span>}
          <div className="grow" />
          <div className="seg" role="group" aria-label="Chế độ xem lịch">
            {(['day', 'week', 'month', 'agenda'] as CalView[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        </div>
        {view === 'month' && (
          <MonthView
            anchor={anchor}
            today={today}
            byDate={byDate}
            onOpen={openItem}
            onCreate={create}
            onDay={goDay}
            onMove={move}
            onMore={(date, el) => {
              setPop(null);
              setMore({ date, rect: el.getBoundingClientRect() });
            }}
          />
        )}
        {(view === 'week' || view === 'day') && <TimeGridView key={view} days={range.days} today={today} byDate={byDate} onOpen={openItem} onCreate={create} onDay={goDay} onMove={move} />}
        {view === 'agenda' && <AgendaView days={range.days} today={today} byDate={byDate} onOpen={openItem} onDay={goDay} />}
      </section>

      {more && <DayListPopover date={more.date} items={byDate.get(more.date) ?? []} anchor={more.rect} onClose={closeMore} onOpen={openItem} />}
      {pop && (
        <EventPopover
          key={pop.it.key}
          it={pop.it}
          anchor={pop.rect}
          onClose={closePop}
          onEdit={(ev) => {
            setPop(null);
            setForm({ event: ev });
          }}
          onDelete={(ev) => void remove(ev)}
        />
      )}
      {form && (
        <EventForm
          event={form.event}
          preset={form.preset}
          onClose={() => setForm(null)}
          onSaved={load}
          onDelete={form.event ? () => void remove(form.event!) : undefined}
        />
      )}
    </div>
  );
}
