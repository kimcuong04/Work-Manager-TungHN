import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, CalendarRange, FileSpreadsheet, FileText, FolderOpen, Link2Off, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { formatDate, formatDateTime } from '../../shared/dates';
import { isNoteEmpty } from '../../shared/noteHtml';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import type { DayNote, LinkedFile, ProjectImport, TempEvent, TempEventInput } from '../../shared/types';
import { hasErrors, validateEventInput } from '../../shared/validation';
import { api } from '../api';
import { Breadcrumbs, DateInput, EmptyState, Field, MultiSearchSelect, MultiSelect, SearchInput, SortHeader } from '../components/common';
import { FileStatusRow } from '../components/FileLink';
import { LocalLinkButton } from '../components/LinkFields';
import { Modal, SidePanel } from '../components/Modal';
import { ProjectImports, type ImportOps } from '../components/ProjectImports';
import { DayNotes, NoteContent, noteDayLabel, type NoteSource } from '../components/ProjectNotes';
import { RichNoteEditor } from '../components/RichNoteEditor';
import { latestNote } from '../lib/projects';
import { useLocalState, useSessionState } from '../lib/persist';
import { useTableResize } from '../lib/tableResize';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';
import { useBrandOptions } from './WarrantyPage';

export const EVENTS_TITLE = 'Sự kiện tạm thời';
const dash = <span className="faint">—</span>;

/** Thêm / sửa sự kiện: STT (tự gợi ý), Tên event, Ngày, Hãng (danh mục dùng chung); khi thêm có ô ghi chú hôm nay. */
function EventForm({ event, onClose, onSaved }: { event?: TempEvent; onClose: () => void; onSaved: (e: TempEvent) => void }) {
  const { today } = useAppData();
  const { toast, toastError } = useUi();
  const brands = useBrandOptions();
  const [form, setForm] = useState<TempEventInput>(() =>
    event ? { stt: event.stt, name: event.name, eventDate: event.eventDate, brandIds: event.brands.map((b) => b.id) } : { stt: undefined, name: '', eventDate: today, brandIds: [] },
  );
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (event) return;
    api
      .nextEventStt()
      .then((stt) => setForm((f) => ({ ...f, stt: f.stt ?? stt })))
      .catch(toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const errors = validateEventInput(form);
  const err = (k: string) => (submitted ? errors[k] : undefined);

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setSaving(true);
    try {
      const saved = event ? await api.updateEvent(event.id, form) : await api.createEvent(form, { noteHtml: isNoteEmpty(note) ? undefined : note });
      toast('success', event ? `Đã cập nhật "${saved.name}".` : `Đã thêm sự kiện "${saved.stt}. ${saved.name}".`);
      onSaved(saved);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size={event ? 'md' : 'lg'}
      title={event ? `Sửa sự kiện — ${event.stt}. ${event.name}` : `Thêm ${EVENTS_TITLE.toLowerCase()}`}
      onClose={onClose}
      footer={() => (
        <>
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Đang lưu…' : event ? 'Lưu' : 'Thêm sự kiện'}
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
        <div className="grid-3" style={{ gridTemplateColumns: '120px 1fr 190px' }}>
          <Field label="STT" required error={err('stt')} htmlFor="ev-stt">
            <input
              id="ev-stt"
              className={`input ${err('stt') ? 'invalid' : ''}`}
              type="number"
              min={1}
              value={form.stt ?? ''}
              onChange={(e) => setForm({ ...form, stt: e.target.value === '' ? null : Math.floor(Number(e.target.value)) })}
            />
          </Field>
          <Field label="Tên event" required error={err('name')} htmlFor="ev-name">
            <input id="ev-name" autoFocus className={`input ${err('name') ? 'invalid' : ''}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Ngày" error={err('eventDate')}>
            <DateInput value={form.eventDate} onChange={(v) => setForm({ ...form, eventDate: v })} clearable />
          </Field>
        </div>
        <Field label="Hãng" hint="Chọn được nhiều Hãng — danh mục Hãng dùng chung (Settings › Master Data › Job Chính).">
          <MultiSearchSelect options={brands.options} value={form.brandIds} onChange={(ids) => setForm({ ...form, brandIds: ids })} onCreate={brands.create} createLabel="Thêm Hãng" placeholder="Không bắt buộc" />
        </Field>
        {!event && (
          <Field label={`Note · hôm nay ${formatDate(today)}`} hint="Không bắt buộc. Ghi chú theo ngày, dán ảnh Ctrl+V; các ngày sau ghi ở trang chi tiết sự kiện.">
            <RichNoteEditor initialHtml="" onChange={setNote} minHeight={110} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

type SortKey = 'stt' | 'name' | 'eventDate' | 'brand';
const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: 'stt', label: 'STT' },
  { key: 'name', label: 'Tên event' },
  { key: 'eventDate', label: 'Ngày' },
  { key: 'brand', label: 'Hãng' },
];

async function confirmDeleteEvent(e: TempEvent, confirm: ReturnType<typeof useUi>['confirm']) {
  return confirm({
    title: 'Xóa sự kiện',
    message: (
      <>
        Xóa <b>“{e.stt}. {e.name}”</b> cùng ghi chú theo ngày, danh sách file liên kết và các bảng import xlsx? File / thư mục trên máy không bị xóa. Không hoàn tác được.
      </>
    ),
    confirmText: 'Xóa',
    danger: true,
  });
}

const brandNames = (e: TempEvent) => e.brands.map((b) => b.name).join(', ');

/**
 * Xem nhanh một sự kiện (panel bên phải bảng): thông tin, các ghi chú gần nhất (rút gọn), file / thư mục và các bảng
 * import — trước khi mở trang chi tiết.
 */
function EventPreview({ event, onClose, onOpen, onEdit, onDelete }: { event: TempEvent; onClose: () => void; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const { today } = useAppData();
  const { toastError } = useUi();
  const [notes, setNotes] = useState<DayNote[] | null>(null);
  const [imports, setImports] = useState<ProjectImport[] | null>(null);
  useEffect(() => {
    let alive = true;
    setNotes(null);
    setImports(null);
    api
      .listEventNotes(event.id)
      .then((n) => alive && setNotes(n))
      .catch(toastError);
    api
      .listEventImports(event.id)
      .then((i) => alive && setImports(i))
      .catch(toastError);
    return () => {
      alive = false;
    };
  }, [event.id, event.updatedAt, toastError]);

  return (
    <SidePanel
      title={`${event.stt}. ${event.name}`}
      subtitle={[event.eventDate ? formatDate(event.eventDate) : null, brandNames(event) || null].filter(Boolean).join(' · ') || EVENTS_TITLE}
      label="Xem nhanh sự kiện"
      onClose={onClose}
      footer={
        <>
          <button className="btn danger left" onClick={onDelete}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn" onClick={onEdit}>
            <Pencil size={15} /> Sửa
          </button>
          <button className="btn primary" onClick={onOpen}>
            Mở chi tiết <ArrowRight size={15} />
          </button>
        </>
      }
    >
      <div className="info-grid">
        <span className="k">Ngày</span>
        <span>{event.eventDate ? formatDate(event.eventDate) : dash}</span>
        <span className="k">Hãng</span>
        <span>
          {event.brands.length ? (
            <span className="row wrap" style={{ gap: 4 }}>
              {event.brands.map((b) => (
                <span key={b.id} className="badge">
                  {b.name}
                </span>
              ))}
            </span>
          ) : (
            dash
          )}
        </span>
        <span className="k">Thư mục</span>
        <span style={{ minWidth: 0 }}>{event.folderPath ? <LocalLinkButton path={event.folderPath} /> : dash}</span>
        <span className="k">File</span>
        <span className="stack" style={{ gap: 4, minWidth: 0 }}>
          {event.files.length
            ? event.files.map((f) => (
                <button key={f.path} className="btn sm link-chip" title={`Mở ${f.path}`} onClick={() => void api.openFile(f.path).catch(toastError)}>
                  <FileText size={13} /> <span className="ellipsis">{f.name}</span>
                </button>
              ))
            : dash}
        </span>
        <span className="k">Bảng import</span>
        <span>
          {imports === null
            ? '…'
            : imports.length
              ? imports.map((i) => `${i.name} (${i.items.length})`).join(' · ')
              : dash}
        </span>
      </div>
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 14 }}>
        Ghi chú gần nhất {notes && notes.length > 0 && <span className="badge">{notes.length}</span>}
      </h3>
      {notes === null ? (
        <div className="faint small">Đang tải…</div>
      ) : notes.length === 0 ? (
        <div className="faint small">Chưa có ghi chú.</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {notes.slice(0, 3).map((n) => (
            <div key={n.id} className="preview-note">
              <div className="small muted" style={{ marginBottom: 4 }}>
                {noteDayLabel(n.noteDate, today)}
              </div>
              <NoteContent html={n.html} />
            </div>
          ))}
          {notes.length > 3 && <div className="small faint">+ {notes.length - 3} ngày ghi chú khác — mở chi tiết để xem đầy đủ.</div>}
        </div>
      )}
      <div className="small faint" style={{ marginTop: 16 }}>
        Tạo {formatDateTime(event.createdAt)} · Cập nhật {formatDateTime(event.updatedAt)}
      </div>
    </SidePanel>
  );
}

/** Bảng Sự kiện tạm thời: STT, Tên event, Ngày, Hãng, Note (ghi chú gần nhất); bấm một dòng để xem nhanh, bấm đúp để mở chi tiết. */
export function EventsListPage() {
  usePageTitle(EVENTS_TITLE);
  const tableRef = useTableResize('temp-events');
  const { masters } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [items, setItems] = useState<TempEvent[] | null>(null);
  const [q, setQ] = useSessionState('events-q', '');
  const [brandIds, setBrandIds] = useSessionState<string[]>('events-brands', []);
  const [sort, setSort] = useLocalState<{ key: SortKey; dir: 'asc' | 'desc' }>('events-sort', { key: 'stt', dir: 'desc' });
  const [form, setForm] = useState<{ event?: TempEvent } | null>(null);
  const [selId, setSelId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listEvents().then(setItems).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const nq = normalizeText(q);
    const sign = sort.dir === 'asc' ? 1 : -1;
    return (items ?? [])
      .filter((e) => (!brandIds.length || e.brands.some((b) => brandIds.includes(b.id))) && matchesQuery(nq, buildHaystack([String(e.stt), e.name, ...e.brands.map((b) => b.name), e.note])))
      .sort((a, b) => {
        if (sort.key === 'name') return sign * compareVi(a.name, b.name);
        if (sort.key === 'brand') return sign * compareVi(brandNames(a), brandNames(b)) || b.stt - a.stt;
        if (sort.key === 'eventDate') return sign * (a.eventDate ?? '').localeCompare(b.eventDate ?? '') || b.stt - a.stt;
        return sign * (a.stt - b.stt);
      });
  }, [items, q, brandIds, sort]);

  const remove = async (e: TempEvent) => {
    if (!(await confirmDeleteEvent(e, confirm))) return;
    try {
      await api.deleteEvent(e.id);
      toast('success', 'Đã xóa sự kiện.');
      if (selId === e.id) setSelId(null);
      load();
    } catch (x) {
      toastError(x);
    }
  };

  const add = (
    <button className="btn primary" onClick={() => setForm({})}>
      <Plus size={16} /> Thêm sự kiện
    </button>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row">
            <CalendarRange size={22} style={{ color: 'var(--accent)' }} /> {EVENTS_TITLE}
          </h1>
          <div className="muted small">Sự kiện ngắn hạn (demo, triển lãm, hội thảo…): file / thư mục đính kèm, ghi chú theo ngày và các bảng thiết bị import xlsx.</div>
        </div>
        <div className="actions">{add}</div>
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm STT, tên event, Hãng, ghi chú…" width={300} />
        <MultiSelect label="Hãng" options={masters.brands.map((b) => ({ id: b.id, name: b.name, inactive: !b.isActive }))} value={brandIds} onChange={setBrandIds} />
        {(q || brandIds.length > 0) && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setQ('');
              setBrandIds([]);
            }}
          >
            <X size={14} /> Xóa bộ lọc
          </button>
        )}
        <span className="small muted">
          {shown.length}/{items?.length ?? 0} sự kiện
        </span>
      </div>
      {items === null ? (
        <div className="faint">Đang tải…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon={<CalendarRange size={36} />} title="Chưa có sự kiện nào" text="Thêm sự kiện để gom file, ghi chú và danh sách thiết bị (import xlsx) vào một chỗ." action={add} />
        </div>
      ) : (
        <div className="split">
        <div className="table-wrap">
          <table className="tbl events-table" ref={tableRef}>
            <thead>
              <tr>
                {SORT_COLS.map((c) => (
                  <SortHeader
                    key={c.key}
                    label={c.label}
                    active={sort.key === c.key}
                    dir={sort.dir}
                    onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 'asc' ? 'desc' : 'asc' })}
                  />
                ))}
                <th style={{ width: '40%' }}>Note</th>
                <th>File / Import</th>
                <th style={{ width: 1 }} data-col="__actions" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                    Không có sự kiện phù hợp bộ lọc.
                  </td>
                </tr>
              )}
              {shown.map((e) => (
                <tr
                  key={e.id}
                  data-row={e.id}
                  className={`clickable ${e.id === selId ? 'selected' : ''}`}
                  tabIndex={0}
                  aria-selected={e.id === selId}
                  title="Bấm để xem nhanh, bấm đúp để mở chi tiết"
                  onClick={() => setSelId(e.id)}
                  onDoubleClick={() => navigate(`/events/${e.id}`)}
                  onKeyDown={(x) => x.key === 'Enter' && (selId === e.id ? navigate(`/events/${e.id}`) : setSelId(e.id))}
                >
                  <td className="num">{e.stt}</td>
                  <td style={{ fontWeight: 600, minWidth: 180 }}>{e.name}</td>
                  <td className="nowrap">{e.eventDate ? formatDate(e.eventDate) : dash}</td>
                  <td className="wrap" style={{ minWidth: 110 }}>{e.brands.length ? brandNames(e) : dash}</td>
                  <td className="clamp small muted">
                    <div>{latestNote(e) || dash}</div>
                  </td>
                  <td className="nowrap small muted">
                    {e.files.length || e.folderPath || e.importCount ? (
                      <span className="row" style={{ gap: 8 }}>
                        {e.folderPath && <FolderOpen size={14} />}
                        {e.files.length > 0 && (
                          <span className="icon-chip">
                            <FileText size={13} /> {e.files.length}
                          </span>
                        )}
                        {e.importCount > 0 && (
                          <span className="icon-chip">
                            <FileSpreadsheet size={13} /> {e.importCount}
                          </span>
                        )}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td>
                    <div className="row nowrap" style={{ gap: 2 }}>
                      <button
                        className="btn sm icon ghost"
                        aria-label={`Mở chi tiết ${e.name}`}
                        title="Mở chi tiết"
                        onClick={(x) => {
                          x.stopPropagation();
                          navigate(`/events/${e.id}`);
                        }}
                        onDoubleClick={(x) => x.stopPropagation()}
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="btn sm icon ghost"
                        aria-label={`Sửa ${e.name}`}
                        title="Sửa"
                        onClick={(x) => {
                          x.stopPropagation();
                          setForm({ event: e });
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn sm icon ghost"
                        aria-label={`Xóa ${e.name}`}
                        title="Xóa"
                        style={{ color: 'var(--danger)' }}
                        onClick={(x) => {
                          x.stopPropagation();
                          void remove(e);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(() => {
          const sel = items.find((x) => x.id === selId);
          return sel ? (
            <EventPreview
              key={sel.id}
              event={sel}
              onClose={() => setSelId(null)}
              onOpen={() => navigate(`/events/${sel.id}`)}
              onEdit={() => setForm({ event: sel })}
              onDelete={() => void remove(sel)}
            />
          ) : null;
        })()}
        </div>
      )}
      {form && (
        <EventForm
          event={form.event}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            if (form.event) load();
            else navigate(`/events/${saved.id}`);
          }}
        />
      )}
    </>
  );
}

/** Chi tiết một sự kiện: thông tin, File & Attachments (thư mục + file), ghi chú theo ngày, các bảng import xlsx (tab sheet). */
export function EventDetailPage() {
  const { id = '' } = useParams();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [event, setEvent] = useState<TempEvent | null | undefined>(undefined);
  const [imports, setImports] = useState<ProjectImport[] | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  usePageTitle(event ? `${event.stt}. ${event.name}` : EVENTS_TITLE);

  const load = useCallback(() => {
    api
      .listEvents()
      .then((list) => setEvent(list.find((e) => e.id === id) ?? null))
      .catch(toastError);
    api
      .listEventImports(id)
      .then(setImports)
      .catch(() => setImports([]));
  }, [id, toastError]);
  useEffect(load, [load]);

  const source = useMemo<NoteSource>(
    () => ({
      list: () => api.listEventNotes(id),
      save: (noteDate, html) => api.saveEventNote(id, { noteDate, html }),
      remove: (noteId) => api.deleteEventNote(noteId),
      calendar: false,
      onChanged: async () => load(),
    }),
    [id, load],
  );
  const ops = useMemo<ImportOps>(
    () => ({
      commit: (payload, replaceImportId) => api.commitEventImport(id, payload, replaceImportId),
      remove: (importId) => api.removeEventImport(id, importId),
      rename: (importId, name) => api.renameEventImport(id, importId, name),
      reorder: (ids) => api.reorderEventImports(id, ids),
    }),
    [id],
  );

  if (event === undefined) return <div className="faint">Đang tải…</div>;
  if (event === null)
    return (
      <EmptyState
        title="Không tìm thấy sự kiện"
        text="Sự kiện có thể đã bị xóa."
        action={
          <button className="btn" onClick={() => navigate('/events')}>
            <ArrowLeft size={15} /> Về {EVENTS_TITLE}
          </button>
        }
      />
    );

  const run = async (p: Promise<unknown>, msg: string) => {
    try {
      await p;
      toast('success', msg);
      load();
    } catch (e) {
      toastError(e);
    }
  };
  const saveFiles = (files: LinkedFile[], msg: string) => run(api.setEventFiles(event.id, files), msg);
  const addFiles = async () => {
    try {
      const picked = await api.pickLinkFiles();
      const seen = new Set(event.files.map((f) => f.path.toLowerCase()));
      const fresh = picked.filter((f) => !seen.has(f.path.toLowerCase()));
      if (picked.length && !fresh.length) toast('info', 'File đã chọn đều đã có trong danh sách.');
      if (fresh.length) await saveFiles([...event.files, ...fresh], `Đã thêm ${fresh.length} file liên kết.`);
    } catch (e) {
      toastError(e);
    }
  };
  const replaceFileAt = async (i: number) => {
    try {
      const f = await api.pickLinkFile();
      if (f) await saveFiles(event.files.map((x, j) => (j === i ? f : x)), 'Đã thay file liên kết.');
    } catch (e) {
      toastError(e);
    }
  };
  const removeFileAt = async (i: number) => {
    if (!(await confirm({ title: 'Gỡ liên kết file', message: `Gỡ liên kết "${event.files[i].name}" khỏi sự kiện? File gốc trên máy không bị xóa.`, confirmText: 'Gỡ liên kết' }))) return;
    await saveFiles(
      event.files.filter((_, j) => j !== i),
      'Đã gỡ liên kết file (file gốc không bị xóa).',
    );
  };
  const pickFolder = async () => {
    try {
      const p = await api.pickLocalLink('folder');
      if (p) await run(api.setEventFolder(event.id, p), 'Đã liên kết thư mục.');
    } catch (e) {
      toastError(e);
    }
  };
  const unlinkFolder = async () => {
    if (!(await confirm({ title: 'Bỏ liên kết thư mục', message: 'Bỏ liên kết thư mục khỏi sự kiện? Thư mục trên máy không bị xóa.', confirmText: 'Bỏ liên kết' }))) return;
    await run(api.setEventFolder(event.id, null), 'Đã bỏ liên kết thư mục.');
  };
  const remove = async () => {
    if (!(await confirmDeleteEvent(event, confirm))) return;
    try {
      await api.deleteEvent(event.id);
      toast('success', 'Đã xóa sự kiện.');
      navigate('/events', { replace: true });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Breadcrumbs items={[{ label: EVENTS_TITLE, to: '/events' }, { label: `${event.stt}. ${event.name}` }]} />
          <h1 style={{ wordBreak: 'break-word' }}>
            {event.stt}. {event.name}
          </h1>
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            {event.eventDate && <span className="badge accent">{formatDate(event.eventDate)}</span>}
            {event.brands.map((b) => (
              <span key={b.id} className="badge">
                {b.name}
              </span>
            ))}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} /> Quay lại
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={15} /> Chỉnh sửa
          </button>
          <button className="btn danger" onClick={() => void remove()}>
            <Trash2 size={15} /> Xóa
          </button>
        </div>
      </div>

      <div className="detail-grid notes-row">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad">
            <h2 className="card-title">Thông tin sự kiện</h2>
            <div className="info-grid">
              <span className="k">STT</span>
              <span style={{ fontWeight: 600 }}>{event.stt}</span>
              <span className="k">Tên event</span>
              <span style={{ fontWeight: 600 }}>{event.name}</span>
              <span className="k">Ngày</span>
              <span>{event.eventDate ? formatDate(event.eventDate) : dash}</span>
              <span className="k">Hãng</span>
              <span>{event.brands.length ? brandNames(event) : dash}</span>
            </div>
            <div className="small faint" style={{ marginTop: 14 }}>
              Tạo lúc {formatDateTime(event.createdAt)} · Cập nhật lúc {formatDateTime(event.updatedAt)}
            </div>
          </section>
          <section className="card card-pad">
            <h2 className="card-title">File &amp; Attachments</h2>
            <div className="stack" style={{ gap: 10 }}>
              <div className="file-row">
                <div className="file-ext">
                  <FolderOpen size={18} />
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  {event.folderPath ? <LocalLinkButton path={event.folderPath} /> : <span className="muted small">Chưa liên kết thư mục trên máy.</span>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => void pickFolder()}>
                    <FolderOpen size={13} /> {event.folderPath ? 'Đổi thư mục' : 'Liên kết thư mục…'}
                  </button>
                  {event.folderPath && (
                    <button className="btn sm icon ghost" aria-label="Bỏ liên kết thư mục" title="Bỏ liên kết thư mục" onClick={() => void unlinkFolder()}>
                      <Link2Off size={14} />
                    </button>
                  )}
                </div>
              </div>
              {event.files.map((f, i) => (
                <FileStatusRow key={f.path} file={f} saved onReplace={() => void replaceFileAt(i)} onRemove={() => void removeFileAt(i)} />
              ))}
              <div className="row">
                <FileText size={16} className="faint" />
                <span className="muted small grow">{event.files.length ? `${event.files.length} file liên kết` : 'Chưa liên kết file (DWG, TXT, DOCX, PDF, XLSX).'}</span>
                <button className="btn sm" onClick={() => void addFiles()}>
                  <Upload size={14} /> {event.files.length ? 'Thêm file' : 'Chọn file'}
                </button>
              </div>
            </div>
          </section>
        </div>
        <DayNotes source={source} version={event.updatedAt} />
      </div>

      <ProjectImports key={event.id} projectId={event.id} imports={imports} ops={ops} ownerLabel="sự kiện" ownerKind="event" onChanged={load} />
      {editing && <EventForm event={event} onClose={() => setEditing(false)} onSaved={() => load()} />}
    </div>
  );
}
