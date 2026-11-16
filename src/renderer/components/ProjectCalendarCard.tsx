import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarClock, ExternalLink, Flag, PenLine, Rocket } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { CALENDAR_KIND_LABEL, type CalendarEvent } from '../../shared/types';
import { api } from '../api';
import { useUi } from '../state/ui';

const SHOW = 8;

/** Các mục trên Calendar gắn với dự án (bắt đầu, những lần "Lưu và thêm vào Calendar", sự kiện tự tạo). */
export function ProjectCalendarCard({ projectId, dueDate, version }: { projectId: string; dueDate: string; version: string }) {
  const navigate = useNavigate();
  const { toastError } = useUi();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    api
      .listCalendarEvents({ projectId })
      .then((list) => setEvents([...list].sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt))))
      .catch(toastError);
  }, [projectId, version, toastError]);

  const open = (date: string) => navigate('/calendar', { state: { date } });
  const shown = events ? (all ? events : events.slice(0, SHOW)) : [];

  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="card-title grow" style={{ margin: 0 }}>
          <CalendarClock size={18} /> Calendar
        </h2>
        <button className="btn sm" onClick={() => open(dueDate)}>
          <Flag size={13} /> Hạn chót {formatDate(dueDate)}
        </button>
        <button className="btn sm" onClick={() => navigate('/calendar')}>
          <ExternalLink size={13} /> Mở Calendar
        </button>
      </div>
      {events === null ? (
        <div className="faint small">Đang tải…</div>
      ) : events.length === 0 ? (
        <div className="faint small">Chưa có mục nào trên Calendar. Khi chỉnh sửa dự án, chọn “Lưu và thêm vào Calendar” để ghi lại thay đổi.</div>
      ) : (
        <div className="timeline">
          {shown.map((e) => (
            <button key={e.id} type="button" className={`timeline-item ev-c-${e.color ?? (e.kind === 'PROJECT_UPDATE' ? 'blue' : e.kind === 'PROJECT_START' ? 'sage' : 'purple')}`} onClick={() => open(e.eventDate)}>
              <span className="timeline-dot">{e.kind === 'PROJECT_START' ? <Rocket size={12} /> : e.kind === 'PROJECT_UPDATE' ? <PenLine size={12} /> : <CalendarClock size={12} />}</span>
              <span className="timeline-date small">
                {formatDate(e.eventDate)}
                {e.startTime ? ` ${e.startTime}` : ''}
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="small" style={{ fontWeight: 650 }}>
                  {e.kind === 'CUSTOM' ? e.title : CALENDAR_KIND_LABEL[e.kind]}
                </span>
                {e.note && <span className="pre small muted timeline-note">{e.note}</span>}
              </span>
            </button>
          ))}
          {events.length > SHOW && (
            <button className="more-btn" onClick={() => setAll((v) => !v)}>
              {all ? 'Thu gọn' : `Xem tất cả ${events.length} mục`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
