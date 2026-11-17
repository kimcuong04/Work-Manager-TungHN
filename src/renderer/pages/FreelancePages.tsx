import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, FileSpreadsheet, Laptop, Pencil, Plus, Trash2, X } from 'lucide-react';
import { formatDate, formatDateTime } from '../../shared/dates';
import { isNoteEmpty, sanitizeNoteHtml } from '../../shared/noteHtml';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import type { FreelanceInput, FreelanceJob } from '../../shared/types';
import { hasErrors, validateFreelanceInput } from '../../shared/validation';
import { api } from '../api';
import { BulkImportWizard } from '../components/BulkImportWizard';
import { Breadcrumbs, DateInput, EmptyState, Field, MultiSelect, SearchInput, SearchableSelect, SortHeader } from '../components/common';
import { Modal } from '../components/Modal';
import { SelectAllHeader, SelectCell, SelectToggleButton, SelectionBar, useSelection } from '../components/Selection';
import { DayNotes, type NoteSource } from '../components/ProjectNotes';
import { RichNoteEditor } from '../components/RichNoteEditor';
import { useLocalState, useSessionState } from '../lib/persist';
import { latestNote } from '../lib/projects';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';

const dash = <span className="faint">—</span>;

function useStatusOptions() {
  const { masters } = useAppData();
  return masters.freelanceStatuses.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }));
}

/** Đổi Tình trạng ngay trên bảng / trang chi tiết. */
function StatusSelect({ job, compact }: { job: FreelanceJob; compact?: boolean }) {
  const { refresh } = useAppData();
  const { toastError } = useUi();
  const options = useStatusOptions();
  return (
    <select
      className="select"
      style={compact ? { height: 30, minWidth: 130 } : { maxWidth: 240 }}
      value={job.statusId ?? ''}
      aria-label={`Tình trạng của ${job.projectName}`}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        try {
          await api.setFreelanceStatus(job.id, e.target.value || null);
          await refresh('freelance');
        } catch (err) {
          toastError(err);
        }
      }}
    >
      <option value="">— Chưa có —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** Thêm / sửa job Freelance; ghi chú hôm nay soạn ngay trong form, các ngày khác ở trang chi tiết. */
export function FreelanceForm({ job, onClose, onSaved }: { job?: FreelanceJob; onClose: () => void; onSaved?: (j: FreelanceJob) => void }) {
  const { masters, freelance, today, refresh } = useAppData();
  const { toast, toastError, confirm } = useUi();
  const statusOptions = useStatusOptions();
  const isEdit = !!job;
  const [initial] = useState<FreelanceInput>(() =>
    job
      ? { stt: job.stt, projectName: job.projectName, hirerId: job.hirerId, startDate: job.startDate, statusId: job.statusId }
      : {
          stt: Math.max(0, ...freelance.map((j) => j.stt)) + 1,
          projectName: '',
          hirerId: null,
          startDate: today,
          statusId: masters.freelanceStatuses.find((s) => s.isActive)?.id ?? null,
        },
  );
  const [form, setForm] = useState<FreelanceInput>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteInit, setNoteInit] = useState<string | null>(isEdit ? null : '');
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    if (!job) return;
    api
      .listFreelanceNotes(job.id)
      .then((list) => {
        const html = list.find((n) => n.noteDate === today)?.html ?? '';
        setNoteInit(html);
        setNoteDraft(html);
      })
      .catch(() => setNoteInit(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = validateFreelanceInput(form);
  const dupStt = form.stt ? freelance.find((j) => j.stt === form.stt && j.id !== job?.id) : undefined;
  if (dupStt) errors.stt = `STT ${form.stt} đã dùng cho "${dupStt.projectName}".`;
  const show = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof FreelanceInput>(k: K, v: FreelanceInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const noteChanged = noteInit !== null && sanitizeNoteHtml(noteDraft) !== sanitizeNoteHtml(noteInit);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || noteChanged;

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Bỏ thay đổi?', message: 'Form có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?', confirmText: 'Bỏ thay đổi', danger: true })))
      return;
    onClose();
  };

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) {
      toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
      return;
    }
    setSaving(true);
    try {
      const saved = isEdit
        ? await api.updateFreelance(job!.id, form, { noteHtml: noteChanged ? noteDraft : undefined })
        : await api.createFreelance(form, { noteHtml: isNoteEmpty(noteDraft) ? undefined : noteDraft });
      await refresh('freelance', 'masters');
      toast('success', isEdit ? `Đã cập nhật "${saved.stt}. ${saved.projectName}".` : `Đã thêm job "${saved.stt}. ${saved.projectName}".`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="lg"
      title={isEdit ? 'Chỉnh sửa job Freelance' : 'Thêm job Freelance'}
      onClose={close}
      footer={() => (
        <>
          <span className="left faint small">
            <span className="req" style={{ color: 'var(--danger)' }}>*</span> là trường bắt buộc
          </span>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Thêm job'}
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
        <section className="form-section">
          <h3>Thông tin job</h3>
          <div className="grid-3" style={{ gridTemplateColumns: '120px 1fr' }}>
            <Field label="STT" required error={show('stt')} htmlFor="fl-stt">
              <input
                id="fl-stt"
                className={`input ${show('stt') ? 'invalid' : ''}`}
                type="number"
                min={1}
                value={form.stt ?? ''}
                onChange={(e) => set('stt', e.target.value === '' ? null : Math.floor(Number(e.target.value)))}
              />
            </Field>
            <Field label="Tên dự án" required error={show('projectName')} htmlFor="fl-name">
              <input id="fl-name" autoFocus className={`input ${show('projectName') ? 'invalid' : ''}`} value={form.projectName} onChange={(e) => set('projectName', e.target.value)} />
            </Field>
          </div>
          <div className="grid-3" style={{ marginTop: 12 }}>
            <Field label="Bên thuê" htmlFor="fl-hirer">
              <SearchableSelect
                id="fl-hirer"
                options={masters.freelanceHirers.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }))}
                value={form.hirerId}
                onChange={(id) => set('hirerId', id)}
                onCreate={async (name) => {
                  try {
                    const item = await api.createMaster('freelanceHirers', name);
                    await refresh('masters');
                    toast('success', `Đã thêm Bên thuê "${item.name}" vào danh mục.`);
                    return item.id;
                  } catch (e) {
                    toastError(e);
                    return null;
                  }
                }}
                createLabel="Thêm Bên thuê"
                placeholder="Không bắt buộc"
              />
            </Field>
            <Field label="Ngày bắt đầu" error={show('startDate')}>
              <DateInput value={form.startDate} onChange={(v) => set('startDate', v)} invalid={!!show('startDate')} clearable />
            </Field>
            <Field label="Tình trạng">
              <SearchableSelect
                options={statusOptions}
                keepOrder
                value={form.statusId}
                onChange={(id) => set('statusId', id)}
                onCreate={async (name) => {
                  try {
                    const item = await api.createMaster('freelanceStatuses', name);
                    await refresh('masters');
                    toast('success', `Đã thêm Tình trạng "${item.name}".`);
                    return item.id;
                  } catch (e) {
                    toastError(e);
                    return null;
                  }
                }}
                placeholder="Không bắt buộc"
              />
            </Field>
          </div>
        </section>

        <section className="form-section">
          <h3>Ghi chú hôm nay · {formatDate(today)}</h3>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            {isEdit ? 'Sửa ghi chú của hôm nay; ghi chú các ngày trước xem/sửa ở trang chi tiết job.' : 'Không bắt buộc. Mỗi ngày một mục ghi chú, dán ảnh bằng Ctrl+V.'}
          </div>
          {noteInit === null ? <div className="faint small">Đang tải…</div> : <RichNoteEditor initialHtml={noteInit} onChange={setNoteDraft} minHeight={120} />}
        </section>
      </form>
    </Modal>
  );
}

type SortKey = 'stt' | 'projectName' | 'hirer' | 'startDate' | 'status';
const SORT_COLS: { key: SortKey; label: string }[] = [
  { key: 'stt', label: 'STT' },
  { key: 'projectName', label: 'Tên dự án' },
  { key: 'hirer', label: 'Bên thuê' },
  { key: 'startDate', label: 'Ngày bắt đầu' },
  { key: 'status', label: 'Tình trạng' },
];

interface FreelanceFilter {
  q: string;
  statuses: string[];
  hirers?: string[];
  years: string[];
}
const EMPTY: FreelanceFilter = { q: '', statuses: [], hirers: [], years: [] };

export async function confirmDeleteFreelance(job: FreelanceJob, confirm: ReturnType<typeof useUi>['confirm']): Promise<boolean> {
  return confirm({
    title: 'Xóa job Freelance',
    message: (
      <>
        Xóa <b>“{job.stt}. {job.projectName}”</b> cùng toàn bộ ghi chú theo ngày? Không hoàn tác được.
      </>
    ),
    confirmText: 'Xóa',
    danger: true,
  });
}

export function FreelanceListPage() {
  usePageTitle('Job Freelance');
  const { freelance, masters, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [filter, setFilter] = useSessionState<FreelanceFilter>('filter:freelance', EMPTY);
  const [sort, setSort] = useLocalState<{ key: SortKey; dir: 'asc' | 'desc' }>('freelance-sort', { key: 'stt', dir: 'desc' });
  const [form, setForm] = useState<{ job?: FreelanceJob } | null>(null);
  const [importing, setImporting] = useState(false);
  const statusOrder = useMemo(() => new Map(masters.freelanceStatuses.map((s, i) => [s.id, i])), [masters.freelanceStatuses]);

  const indexed = useMemo(() => freelance.map((j) => ({ j, hay: buildHaystack([String(j.stt), j.projectName, j.hirer, j.statusName, j.note]) })), [freelance]);
  const yearOpts = useMemo(
    () =>
      [...new Set(freelance.map((j) => j.startDate?.slice(0, 4)).filter((y): y is string => !!y))]
        .sort()
        .reverse()
        .map((y) => ({ id: y, name: y })),
    [freelance],
  );
  const shown = useMemo(() => {
    const nq = normalizeText(filter.q);
    const list = indexed
      .filter(
        ({ j, hay }) =>
          (!filter.statuses.length || (j.statusId !== null && filter.statuses.includes(j.statusId))) &&
          (!filter.hirers?.length || (j.hirerId !== null && filter.hirers.includes(j.hirerId))) &&
          (!filter.years.length || (!!j.startDate && filter.years.includes(j.startDate.slice(0, 4)))) &&
          matchesQuery(nq, hay),
      )
      .map((x) => x.j);
    const sign = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (sort.key === 'stt') return sign * (a.stt - b.stt);
      if (sort.key === 'status') return sign * ((statusOrder.get(a.statusId ?? '') ?? 999) - (statusOrder.get(b.statusId ?? '') ?? 999)) || b.stt - a.stt;
      const va = sort.key === 'startDate' ? a.startDate ?? '' : a[sort.key];
      const vb = sort.key === 'startDate' ? b.startDate ?? '' : b[sort.key];
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      return sign * compareVi(va, vb) || b.stt - a.stt;
    });
  }, [indexed, filter, sort, statusOrder]);

  const shownIds = useMemo(() => shown.map((j) => j.id), [shown]);
  const sel = useSelection(shownIds);
  const removeSelected = async () => {
    const ids = shownIds.filter((id) => sel.selected.has(id));
    if (!ids.length) return;
    const ok = await confirm({
      title: `Xóa ${ids.length} job Freelance`,
      message: `Xóa ${ids.length} job đã chọn cùng toàn bộ ghi chú theo ngày của chúng? Không hoàn tác được.`,
      confirmText: `Xóa ${ids.length} job`,
      danger: true,
    });
    if (!ok) return;
    try {
      const n = await api.deleteFreelances(ids);
      sel.stop();
      await refresh('freelance');
      toast('success', `Đã xóa ${n} job Freelance.`);
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (j: FreelanceJob) => {
    if (!(await confirmDeleteFreelance(j, confirm))) return;
    try {
      await api.deleteFreelance(j.id);
      await refresh('freelance');
      toast('success', 'Đã xóa job Freelance.');
    } catch (e) {
      toastError(e);
    }
  };

  const anyFilter = !!filter.q.trim() || filter.statuses.length > 0 || (filter.hirers?.length ?? 0) > 0 || filter.years.length > 0;
  const usedStt = useMemo(() => new Set(freelance.map((j) => j.stt)), [freelance]);
  const actions = (
    <>
      {freelance.length > 0 && <SelectToggleButton sel={sel} />}
      <button className="btn" onClick={() => setImporting(true)}>
        <FileSpreadsheet size={15} /> Import xlsx
      </button>
      <button className="btn primary" onClick={() => setForm({})}>
        <Plus size={16} /> Thêm job
      </button>
    </>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Job Freelance', to: '/freelance' }]} />
          <h1 className="row">
            <Laptop size={22} style={{ color: 'var(--accent)' }} /> Job Freelance
          </h1>
          <div className="muted small">Bảng chung cho mọi năm · danh mục Tình trạng quản lý riêng ở Settings › Master Data › Job Freelance</div>
        </div>
        <div className="actions">{actions}</div>
      </div>
      <div className="toolbar">
        <SearchInput value={filter.q} onChange={(q) => setFilter({ ...filter, q })} placeholder="Tìm STT, tên dự án, bên thuê, ghi chú…" width={320} />
        <MultiSelect label="Tình trạng" options={masters.freelanceStatuses.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }))} value={filter.statuses} onChange={(statuses) => setFilter({ ...filter, statuses })} />
        <MultiSelect
          label="Bên thuê"
          options={masters.freelanceHirers.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }))}
          value={filter.hirers ?? []}
          onChange={(hirers) => setFilter({ ...filter, hirers })}
        />
        <MultiSelect label="Năm" options={yearOpts} value={filter.years} onChange={(years) => setFilter({ ...filter, years })} />
        {anyFilter && (
          <button className="btn ghost sm" onClick={() => setFilter(EMPTY)}>
            <X size={14} /> Xóa bộ lọc
          </button>
        )}
        <span className="small muted">
          {shown.length}/{freelance.length} job
        </span>
      </div>

      {sel.active && <SelectionBar sel={sel} total={shown.length} noun="job" onDelete={() => void removeSelected()} />}
      {freelance.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Laptop size={36} />}
            title="Chưa có job Freelance nào"
            text="Thêm từng job, hoặc Import xlsx khi đã có sẵn danh sách nhiều job."
            action={<div className="row">{actions}</div>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl freelance-table">
            <thead>
              <tr>
                {sel.active && <SelectAllHeader sel={sel} />}
                {SORT_COLS.map((c) => (
                  <SortHeader
                    key={c.key}
                    label={c.label}
                    active={sort.key === c.key}
                    dir={sort.dir}
                    onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 'asc' ? 'desc' : 'asc' })}
                  />
                ))}
                <th>Ghi chú gần nhất</th>
                <th style={{ width: 1 }} />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="faint" style={{ textAlign: 'center' }}>
                    Không có job khớp bộ lọc.
                  </td>
                </tr>
              )}
              {shown.map((j) => (
                <tr
                  key={j.id}
                  className={`clickable ${sel.active && sel.selected.has(j.id) ? 'selected' : ''}`}
                  aria-selected={sel.active ? sel.selected.has(j.id) : undefined}
                  onClick={() => (sel.active ? sel.toggle(j.id) : navigate(`/freelance/${j.id}`))}
                >
                  {sel.active && <SelectCell sel={sel} id={j.id} label={`${j.stt}. ${j.projectName}`} />}
                  <td className="num">{j.stt}</td>
                  <td style={{ fontWeight: 600, minWidth: 200 }}>{j.projectName}</td>
                  <td>{j.hirer || dash}</td>
                  <td className="nowrap">{j.startDate ? formatDate(j.startDate) : dash}</td>
                  <td>
                    <StatusSelect job={j} compact />
                  </td>
                  <td className="clamp small muted">
                    <div>{latestNote(j) || dash}</div>
                  </td>
                  <td>
                    <div className="row nowrap" style={{ gap: 2 }}>
                      <button
                        className="btn sm icon ghost"
                        aria-label={`Sửa ${j.projectName}`}
                        title="Sửa"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForm({ job: j });
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn sm icon ghost"
                        aria-label={`Xóa ${j.projectName}`}
                        title="Xóa"
                        style={{ color: 'var(--danger)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(j);
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
      )}
      {form && <FreelanceForm job={form.job} onClose={() => setForm(null)} />}
      {importing && <BulkImportWizard target="FREELANCE" scopeLabel="Job Freelance" usedStt={usedStt} onClose={() => setImporting(false)} onDone={() => refresh('freelance')} />}
    </>
  );
}

export function FreelanceDetailPage() {
  const { id } = useParams();
  const { freelance, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const job = freelance.find((j) => j.id === id);
  usePageTitle(job ? `${job.stt}. ${job.projectName}` : 'Job Freelance');

  const source = useMemo<NoteSource>(
    () => ({
      list: () => api.listFreelanceNotes(id!),
      save: (noteDate, html) => api.saveFreelanceNote(id!, { noteDate, html }),
      remove: (noteId) => api.deleteFreelanceNote(noteId),
      calendar: false,
      onChanged: () => refresh('freelance'),
    }),
    [id, refresh],
  );

  if (!job)
    return (
      <EmptyState
        title="Không tìm thấy job Freelance"
        text="Job có thể đã bị xóa."
        action={
          <button className="btn" onClick={() => navigate('/freelance')}>
            <ArrowLeft size={15} /> Về Job Freelance
          </button>
        }
      />
    );

  const remove = async () => {
    if (!(await confirmDeleteFreelance(job, confirm))) return;
    try {
      await api.deleteFreelance(job.id);
      await refresh('freelance');
      toast('success', 'Đã xóa job Freelance.');
      navigate('/freelance', { replace: true });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Breadcrumbs items={[{ label: 'Job Freelance', to: '/freelance' }, { label: `${job.stt}. ${job.projectName}` }]} />
          <h1 style={{ wordBreak: 'break-word' }}>
            {job.stt}. {job.projectName}
          </h1>
          {job.statusName && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="badge accent">{job.statusName}</span>
            </div>
          )}
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

      <section className="card card-pad">
        <h2 className="card-title">Thông tin job</h2>
        <div className="info-grid">
          <span className="k">STT</span>
          <span style={{ fontWeight: 600 }}>{job.stt}</span>
          <span className="k">Tên dự án</span>
          <span style={{ fontWeight: 600 }}>{job.projectName}</span>
          <span className="k">Bên thuê</span>
          <span>{job.hirer || dash}</span>
          <span className="k">Ngày bắt đầu</span>
          <span>{job.startDate ? formatDate(job.startDate) : dash}</span>
          <span className="k">Tình trạng</span>
          <span>
            <StatusSelect job={job} />
          </span>
        </div>
        <div className="small faint" style={{ marginTop: 14 }}>
          Tạo lúc {formatDateTime(job.createdAt)} · Cập nhật lúc {formatDateTime(job.updatedAt)}
        </div>
      </section>
      <div style={{ marginTop: 16 }}>
        <DayNotes source={source} version={job.updatedAt} />
      </div>
      {editing && <FreelanceForm job={job} onClose={() => setEditing(false)} />}
    </div>
  );
}
