import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarPlus, NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react';
import { addDays, formatDate, formatDateTime, parseDisplayDate } from '../../shared/dates';
import { noteImageKeys, sanitizeNoteHtml } from '../../shared/noteHtml';
import type { ImageRef, ProjectNote } from '../../shared/types';
import { api } from '../api';
import { WEEKDAY_LONG, weekdayIndex } from '../lib/calendar';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { Lightbox } from './ImageGallery';
import { RichNoteEditor } from './RichNoteEditor';

export function noteDayLabel(date: string, today: string): string {
  const full = `${WEEKDAY_LONG[weekdayIndex(date)]}, ${formatDate(date)}`;
  if (date === today) return `Hôm nay · ${full}`;
  if (date === addDays(today, -1)) return `Hôm qua · ${full}`;
  return full;
}

/** Hiển thị ghi chú đã lọc; bấm ảnh để phóng to, bấm link mở bằng trình duyệt. */
export function NoteContent({ html }: { html: string }) {
  const { toastError } = useUi();
  const clean = useMemo(() => sanitizeNoteHtml(html), [html]);
  const images = useMemo<ImageRef[]>(() => noteImageKeys(clean).map((k) => ({ storageKey: k, fileName: 'Ảnh trong ghi chú', mimeType: '', sizeBytes: 0 })), [clean]);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <>
      <div
        className="note-content note-rich"
        dangerouslySetInnerHTML={{ __html: clean }}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          const img = t.closest('img');
          if (img) {
            const i = images.findIndex((x) => x.storageKey === img.getAttribute('data-key'));
            if (i >= 0) setPreview(i);
            return;
          }
          const a = t.closest('a');
          if (a) {
            e.preventDefault();
            const href = a.getAttribute('href');
            if (href) api.openExternalUrl(href).catch(toastError);
          }
        }}
      />
      {preview !== null && images[preview] && <Lightbox images={images} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />}
    </>
  );
}

/**
 * Ghi chú của dự án theo ngày: mỗi ngày một mục (mới nhất ở trên), sửa được mục của ngày cũ.
 * Lưu kèm "Lưu và thêm vào Calendar" như form dự án.
 */
export function ProjectNotes({ projectId, version }: { projectId: string; version: string }) {
  const { today, refresh } = useAppData();
  const { confirm, prompt, toast, toastError } = useUi();
  const [notes, setNotes] = useState<ProjectNote[] | null>(null);
  const [editing, setEditing] = useState<{ date: string; initial: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState<false | 'save' | 'calendar'>(false);

  const load = useCallback(() => {
    api.listProjectNotes(projectId).then(setNotes).catch(toastError);
  }, [projectId, toastError]);
  useEffect(load, [load, version]);

  const dirty = !!editing && sanitizeNoteHtml(draft) !== sanitizeNoteHtml(editing.initial);
  const discardOk = async () =>
    !dirty || (await confirm({ title: 'Bỏ thay đổi?', message: 'Ghi chú đang sửa chưa được lưu. Bỏ thay đổi?', confirmText: 'Bỏ thay đổi', danger: true }));

  const startEdit = async (date: string) => {
    if (editing?.date === date) return;
    if (!(await discardOk())) return;
    const html = notes?.find((n) => n.noteDate === date)?.html ?? '';
    setEditing({ date, initial: html });
    setDraft(html);
  };

  const pickOtherDay = async () => {
    const v = await prompt({
      title: 'Ghi chú cho ngày khác',
      label: 'Ngày (dd/mm/yyyy)',
      initial: formatDate(addDays(today, -1)),
      confirmText: 'Mở ghi chú',
      validate: (s) => {
        const iso = parseDisplayDate(s);
        if (!iso) return 'Ngày không hợp lệ (dd/mm/yyyy).';
        if (iso > today) return 'Không ghi chú cho ngày trong tương lai.';
        return null;
      },
    });
    if (v !== null) await startEdit(parseDisplayDate(v)!);
  };

  const save = async (addToCalendar: boolean) => {
    if (!editing) return;
    setSaving(addToCalendar ? 'calendar' : 'save');
    try {
      const res = await api.saveProjectNote(projectId, { noteDate: editing.date, html: draft }, { addToCalendar });
      toast(
        'success',
        !res ? `Đã xóa ghi chú trống ngày ${formatDate(editing.date)}.` : addToCalendar ? 'Đã lưu ghi chú và thêm vào Calendar hôm nay.' : `Đã lưu ghi chú ngày ${formatDate(editing.date)}.`,
      );
      setEditing(null);
      load();
      await refresh('projects');
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: ProjectNote) => {
    if (!(await confirm({ title: 'Xóa ghi chú', message: `Xóa ghi chú ngày ${formatDate(n.noteDate)}? Ảnh trong ghi chú cũng bị xóa.`, confirmText: 'Xóa', danger: true })))
      return;
    try {
      await api.deleteProjectNote(n.id);
      toast('success', 'Đã xóa ghi chú.');
      load();
      await refresh('projects');
    } catch (e) {
      toastError(e);
    }
  };

  const editor = (date: string) => (
    <div className="note-editing" key={`edit:${date}`}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`note-date ${date === today ? 'today' : ''}`}>{noteDayLabel(date, today)}</span>
        <span className="grow" />
        <span className="small faint">Ctrl+V dán ảnh · Ctrl+Enter lưu</span>
      </div>
      <RichNoteEditor key={date} initialHtml={editing!.initial} onChange={setDraft} autoFocus onSubmit={() => void save(false)} minHeight={180} />
      <div className="row note-actions">
        <span className="small faint grow">Để trống rồi Lưu = xóa ghi chú của ngày này.</span>
        <button
          className="btn"
          onClick={async () => {
            if (await discardOk()) setEditing(null);
          }}
        >
          Hủy
        </button>
        <button className="btn primary" disabled={!!saving} onClick={() => void save(false)}>
          {saving === 'save' ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button className="btn success" disabled={!!saving} onClick={() => void save(true)} title="Lưu và ghi một mục “Cập nhật dự án” kèm tóm tắt ghi chú vào Calendar hôm nay">
          <CalendarCheck size={15} /> {saving === 'calendar' ? 'Đang lưu…' : 'Lưu và thêm vào Calendar'}
        </button>
      </div>
    </div>
  );

  const hasToday = !!notes?.some((n) => n.noteDate === today);
  const editingNew = editing && !notes?.some((n) => n.noteDate === editing.date);

  return (
    <section className="card card-pad notes-card" aria-label="Ghi chú theo ngày">
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <h2 className="card-title grow" style={{ margin: 0 }}>
          <NotebookPen size={18} /> Ghi chú
          <span className="small muted" style={{ fontWeight: 400 }}>
            theo ngày
          </span>
          {!!notes?.length && <span className="badge">{notes.length}</span>}
        </h2>
        <button className="btn sm" onClick={() => void pickOtherDay()} title="Viết hoặc sửa ghi chú của một ngày trước">
          <CalendarPlus size={14} /> Ngày khác
        </button>
        <button className="btn sm primary" onClick={() => void startEdit(today)}>
          {hasToday ? <Pencil size={14} /> : <Plus size={14} />} {hasToday ? 'Sửa ghi chú hôm nay' : 'Ghi chú hôm nay'}
        </button>
      </div>
      {notes === null ? (
        <div className="faint small">Đang tải…</div>
      ) : (
        <div className="note-list">
          {editingNew && editor(editing.date)}
          {notes.length === 0 && !editing && (
            <div className="faint small" style={{ padding: '10px 0' }}>
              Chưa có ghi chú. Bấm <b>Ghi chú hôm nay</b> để bắt đầu — mỗi ngày một mục, định dạng tự do, dán ảnh bằng Ctrl+V.
            </div>
          )}
          {notes.map((n) =>
            editing?.date === n.noteDate ? (
              editor(n.noteDate)
            ) : (
              <article key={n.id} className="note-entry">
                <header className="note-entry-head">
                  <span className={`note-date ${n.noteDate === today ? 'today' : ''}`}>{noteDayLabel(n.noteDate, today)}</span>
                  <span className="small faint">· sửa lúc {formatDateTime(n.updatedAt)}</span>
                  <span className="note-tools">
                    <button className="btn sm ghost" onClick={() => void startEdit(n.noteDate)} aria-label={`Sửa ghi chú ngày ${formatDate(n.noteDate)}`}>
                      <Pencil size={13} /> Sửa
                    </button>
                    <button className="btn sm ghost icon" onClick={() => void remove(n)} aria-label={`Xóa ghi chú ngày ${formatDate(n.noteDate)}`} title="Xóa">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </header>
                <NoteContent html={n.html} />
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}
