import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ExternalLink, Globe, Image as ImageIcon, Lightbulb, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { formatDate, formatDateTime, inRange, todayISO } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import type { ExperienceInput, ExperienceRecord, MasterItem } from '../../shared/types';
import { hasErrors, validateExperienceInput, validateMasterName } from '../../shared/validation';
import { api } from '../api';
import { Breadcrumbs, DateInput, EmptyState, Field, SearchInput, SearchableSelect } from '../components/common';
import { ImageGallery } from '../components/ImageGallery';
import { Drawer, Modal } from '../components/Modal';
import { useLocalState, useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';
import { DateFilterControls, resolveDateRange } from './WarrantyPage';

type DateMode = Parameters<typeof resolveDateRange>[0];

function useOpenUrl() {
  const { toastError } = useUi();
  return (url: string) => api.openExternalUrl(url).catch(toastError);
}

export function ExperienceHomePage() {
  usePageTitle('Experience');
  const { masters, refresh } = useAppData();
  const { prompt, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [all, setAll] = useState<ExperienceRecord[] | null>(null);
  const [q, setQ] = useSessionState('exp-home-q', '');

  useEffect(() => {
    api.listExperience(null).then(setAll).catch(toastError);
  }, [toastError, masters.brands]);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last: string }>();
    for (const e of all ?? []) {
      const s = m.get(e.brandId) ?? { count: 0, last: '' };
      s.count++;
      if (e.experienceDate > s.last) s.last = e.experienceDate;
      m.set(e.brandId, s);
    }
    return m;
  }, [all]);

  const nq = normalizeText(q);
  const brands = masters.brands
    .filter((b) => b.isActive || (stats.get(b.id)?.count ?? 0) > 0)
    .filter((b) => !nq || normalizeText(b.name).includes(nq))
    .sort((a, b) => compareVi(a.name, b.name));

  const addBrand = async () => {
    const name = await prompt({ title: 'Thêm Hãng', label: 'Tên Hãng', confirmText: 'Thêm', validate: validateMasterName });
    if (name === null) return;
    try {
      const b = await api.createMaster('brands', name);
      await refresh('masters');
      toast('success', `Đã thêm Hãng "${b.name}".`);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="row">
            <Lightbulb size={22} style={{ color: 'var(--accent)' }} /> Experience — Tổng hợp kinh nghiệm
          </h1>
          <div className="muted small">Kinh nghiệm/sự kiện kỹ thuật phân theo Hãng. Danh sách Hãng lấy từ danh mục dùng chung trong Settings.</div>
        </div>
        <div className="actions">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm tên Hãng…" width={240} />
          <button className="btn" onClick={addBrand}>
            <Plus size={15} /> Thêm Hãng
          </button>
        </div>
      </div>
      {masters.brands.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Tag size={36} />}
            title="Chưa có Hãng nào"
            text="Thêm Hãng tại đây, trong Settings › Danh mục, hoặc ngay trong form Warranty."
            action={
              <button className="btn primary" onClick={addBrand}>
                <Plus size={15} /> Thêm Hãng
              </button>
            }
          />
        </div>
      ) : brands.length === 0 ? (
        <EmptyState title="Không có Hãng phù hợp" />
      ) : (
        <div className="brand-grid">
          {brands.map((b) => {
            const s = stats.get(b.id);
            return (
              <button key={b.id} className="card brand-card" onClick={() => navigate(`/experience/${b.id}`)}>
                <span className="bname">
                  <Tag size={16} style={{ color: 'var(--accent)' }} />
                  {b.name}
                  {!b.isActive && <span className="badge">Ngừng dùng</span>}
                </span>
                <span className="muted small">{s ? `${s.count} kinh nghiệm · gần nhất ${formatDate(s.last)}` : 'Chưa có kinh nghiệm'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ExpFilter {
  q: string;
  mode: DateMode;
  month: number;
  monthYear: number;
  from: string | null;
  to: string | null;
}

function ExperienceForm({ brand, record, onClose, onSaved }: { brand: MasterItem; record?: ExperienceRecord; onClose: () => void; onSaved: () => void }) {
  const { projects } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [initial] = useState<ExperienceInput>(() =>
    record
      ? {
          brandId: record.brandId,
          experienceDate: record.experienceDate,
          projectId: record.projectExists ? record.projectId : null,
          projectText: record.projectExists ? null : record.projectText,
          deviceModel: record.deviceModel,
          event: record.event,
          webUrl: record.webUrl,
          images: record.images,
        }
      : { brandId: brand.id, experienceDate: todayISO(), projectId: null, projectText: '', deviceModel: '', event: '', webUrl: '', images: [] },
  );
  const [form, setForm] = useState(initial);
  const [linkMode, setLinkMode] = useState<'internal' | 'text'>(initial.projectId ? 'internal' : 'text');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateExperienceInput(form);
  const err = (k: string) => (submitted || touched[k] ? errors[k] : undefined);
  const set = <K extends keyof ExperienceInput>(k: K, v: ExperienceInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.projectName, hint: `${p.yearLabel} · ${p.workCategory === 'PRE_SALES' ? 'Pre' : 'Post'}` }));

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Bỏ thay đổi?', message: 'Form có thay đổi chưa lưu. Đóng và bỏ thay đổi?', confirmText: 'Bỏ thay đổi', danger: true }))) return;
    onClose();
  };
  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
    setSaving(true);
    try {
      if (record) await api.updateExperience(record.id, form);
      else await api.createExperience(form);
      toast('success', record ? 'Đã cập nhật Experience.' : 'Đã thêm Experience.');
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
      size="lg"
      title={record ? 'Sửa Experience' : `Thêm Experience — ${brand.name}`}
      onClose={close}
      footer={() => (
        <>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      )}
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="Date" required error={err('experienceDate')}>
            <DateInput value={form.experienceDate || null} onChange={(v) => set('experienceDate', v ?? '')} onBlur={() => setTouched((t) => ({ ...t, experienceDate: true }))} />
          </Field>
          <Field label="Mode Device" error={err('deviceModel')}>
            <input className="input" value={form.deviceModel} onChange={(e) => set('deviceModel', e.target.value)} placeholder="Model / dòng thiết bị" />
          </Field>
        </div>
        <Field label="Project" error={err('projectText')}>
          <div className="seg" style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
            <button
              type="button"
              className={linkMode === 'internal' ? 'on' : ''}
              onClick={() => {
                setLinkMode('internal');
                setForm((f) => ({ ...f, projectText: null }));
              }}
            >
              Liên kết Project nội bộ
            </button>
            <button
              type="button"
              className={linkMode === 'text' ? 'on' : ''}
              onClick={() => {
                setLinkMode('text');
                setForm((f) => ({ ...f, projectId: null, projectText: f.projectText ?? '' }));
              }}
            >
              Nhập tên dạng text
            </button>
          </div>
          {linkMode === 'internal' ? (
            <SearchableSelect options={projectOptions} value={form.projectId} onChange={(v) => set('projectId', v)} placeholder="Chọn Project Pre-sales / Post-sales" />
          ) : (
            <input className="input" value={form.projectText ?? ''} onChange={(e) => set('projectText', e.target.value)} placeholder="Tên Project (không bắt buộc)" />
          )}
        </Field>
        <Field label="Event" required error={err('event')}>
          <textarea
            className={`textarea ${err('event') ? 'invalid' : ''}`}
            rows={6}
            value={form.event}
            onChange={(e) => set('event', e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, event: true }))}
            placeholder="Mô tả sự kiện, tình huống hoặc kinh nghiệm…"
          />
        </Field>
        <Field label="Link web" error={err('webUrl')} hint="Chỉ chấp nhận http:// hoặc https://, mở bằng trình duyệt mặc định.">
          <input
            className={`input ${err('webUrl') ? 'invalid' : ''}`}
            value={form.webUrl}
            onChange={(e) => set('webUrl', e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, webUrl: true }))}
            placeholder="https://"
          />
        </Field>
        <Field label="Image">
          <ImageGallery images={form.images} editable onChange={(v) => set('images', v)} />
        </Field>
      </div>
    </Modal>
  );
}

function ProjectCell({ r }: { r: ExperienceRecord }) {
  if (r.projectId && r.projectExists)
    return (
      <Link to={`/project/${r.projectId}`} onClick={(e) => e.stopPropagation()}>
        {r.projectText}
      </Link>
    );
  if (!r.projectText) return <span className="faint">—</span>;
  return (
    <span>
      {r.projectText}
      {r.projectId && <span className="faint small"> (đã xóa)</span>}
    </span>
  );
}

function ExperienceDetail({ r, onClose, onEdit, onDelete }: { r: ExperienceRecord; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const openUrl = useOpenUrl();
  return (
    <Drawer
      title={`${r.brandName} · ${formatDate(r.experienceDate)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn danger left" onClick={onDelete}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn primary" onClick={onEdit}>
            <Pencil size={15} /> Sửa
          </button>
        </>
      }
    >
      <div className="info-grid" style={{ gridTemplateColumns: '110px 1fr' }}>
        <span className="k">Date</span>
        <span>{formatDate(r.experienceDate)}</span>
        <span className="k">Hãng</span>
        <span>{r.brandName}</span>
        <span className="k">Project</span>
        <span>
          <ProjectCell r={r} />
        </span>
        <span className="k">Mode Device</span>
        <span>{r.deviceModel || <span className="faint">—</span>}</span>
        <span className="k">Link web</span>
        <span>
          {r.webUrl ? (
            <button className="btn sm" onClick={() => openUrl(r.webUrl)} title={r.webUrl}>
              <ExternalLink size={13} /> <span className="ellipsis" style={{ maxWidth: 280 }}>{r.webUrl}</span>
            </button>
          ) : (
            <span className="faint">—</span>
          )}
        </span>
      </div>
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 14 }}>
        Event
      </h3>
      <div className="pre card card-pad" style={{ boxShadow: 'none' }}>
        {r.event}
      </div>
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 14 }}>
        Ảnh ({r.images.length})
      </h3>
      <ImageGallery images={r.images} />
      <div className="small faint" style={{ marginTop: 16 }}>
        Tạo {formatDateTime(r.createdAt)} · Cập nhật {formatDateTime(r.updatedAt)}
      </div>
    </Drawer>
  );
}

type ExpSort = 'dateDesc' | 'dateAsc' | 'project';

export function ExperienceBrandPage() {
  const { brandId = '' } = useParams();
  return <ExperienceBrandView key={brandId} brandId={brandId} />;
}

function ExperienceBrandView({ brandId }: { brandId: string }) {
  const { masters, today, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const brand = masters.brands.find((b) => b.id === brandId);
  usePageTitle(brand ? `Experience · ${brand.name}` : 'Experience');
  const [records, setRecords] = useState<ExperienceRecord[] | null>(null);
  const [f, setF] = useSessionState<ExpFilter>(`exp:${brandId}`, {
    q: '',
    mode: 'all',
    month: Number(today.slice(5, 7)),
    monthYear: Number(today.slice(0, 4)),
    from: null,
    to: null,
  });
  const [sort, setSort] = useLocalState<ExpSort>('exp-sort', 'dateDesc');
  const [form, setForm] = useState<{ record?: ExperienceRecord } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const openUrl = useOpenUrl();

  const load = useCallback(() => {
    setRecords(null);
    api.listExperience(brandId).then(setRecords).catch(toastError);
  }, [brandId, toastError]);
  useEffect(load, [load]);

  const indexed = useMemo(() => (records ?? []).map((r) => ({ r, hay: buildHaystack([r.projectText, r.deviceModel, r.event]) })), [records]);
  const range = resolveDateRange(f.mode, f, today);
  const shown = useMemo(() => {
    const nq = normalizeText(f.q);
    const list = indexed.filter(({ r, hay }) => inRange(r.experienceDate, range.from, range.to) && matchesQuery(nq, hay)).map((x) => x.r);
    return list.sort((a, b) =>
      sort === 'dateAsc'
        ? a.experienceDate.localeCompare(b.experienceDate)
        : sort === 'dateDesc'
          ? b.experienceDate.localeCompare(a.experienceDate)
          : compareVi(a.projectText ?? '￿', b.projectText ?? '￿'),
    );
  }, [indexed, f.q, range.from, range.to, sort]);

  if (!brand) return <EmptyState title="Không tìm thấy Hãng" text="Hãng có thể đã bị xóa khỏi danh mục." />;

  const detail = records?.find((r) => r.id === detailId) ?? null;
  const afterChange = () => {
    load();
    void refresh('masters');
  };
  const remove = async (r: ExperienceRecord) => {
    if (!(await confirm({ title: 'Xóa Experience', message: `Xóa kinh nghiệm ngày ${formatDate(r.experienceDate)}${r.deviceModel ? ` (${r.deviceModel})` : ''}? Ảnh đính kèm cũng bị xóa.`, confirmText: 'Xóa', danger: true })))
      return;
    try {
      await api.deleteExperience(r.id);
      setDetailId(null);
      toast('success', 'Đã xóa Experience.');
      afterChange();
    } catch (e) {
      toastError(e);
    }
  };
  const activeFilter = !!f.q || f.mode !== 'all';

  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Experience', to: '/experience' }, { label: brand.name }]} />
          <h1 className="row">
            <Tag size={20} style={{ color: 'var(--accent)' }} /> {brand.name}
            {!brand.isActive && <span className="badge">Ngừng dùng</span>}
          </h1>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setForm({})}>
            <Plus size={16} /> Add Experience
          </button>
        </div>
      </div>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tìm Project, Mode Device, Event…" width={300} />
        <DateFilterControls mode={f.mode} month={f.month} monthYear={f.monthYear} from={f.from} to={f.to} onChange={(p) => setF({ ...f, ...p })} />
        {activeFilter && (
          <button className="btn ghost sm" onClick={() => setF({ ...f, q: '', mode: 'all', from: null, to: null })}>
            <X size={14} /> Clear Filters
          </button>
        )}
        <span className="small muted">
          {shown.length}/{records?.length ?? 0} bản ghi
        </span>
        <div className="grow" />
        <select className="select" style={{ width: 190 }} value={sort} onChange={(e) => setSort(e.target.value as ExpSort)} aria-label="Sắp xếp">
          <option value="dateDesc">Date mới nhất</option>
          <option value="dateAsc">Date cũ nhất</option>
          <option value="project">Tên Project</option>
        </select>
      </div>
      {records === null ? (
        <div className="faint">Đang tải…</div>
      ) : records.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Lightbulb size={36} />}
            title={`Chưa có kinh nghiệm cho ${brand.name}`}
            action={
              <button className="btn primary" onClick={() => setForm({})}>
                <Plus size={16} /> Add Experience
              </button>
            }
          />
        </div>
      ) : (
        <div className="table-wrap" style={{ flex: 1 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Mode Device</th>
                <th style={{ width: '50%' }}>Event</th>
                <th>Link / Ảnh</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                    Không có bản ghi phù hợp bộ lọc.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id} className="clickable" tabIndex={0} onClick={() => setDetailId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setDetailId(r.id)}>
                  <td className="nowrap">{formatDate(r.experienceDate)}</td>
                  <td>
                    <ProjectCell r={r} />
                  </td>
                  <td>{r.deviceModel}</td>
                  <td className="clamp">
                    <div style={{ maxWidth: 'none' }}>{r.event}</div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ gap: 6 }}>
                      {r.webUrl && (
                        <button className="btn sm icon" title={r.webUrl} aria-label="Mở link web" onClick={() => openUrl(r.webUrl)}>
                          <Globe size={14} />
                        </button>
                      )}
                      {r.images.length > 0 && (
                        <span className="icon-chip">
                          <ImageIcon size={13} /> {r.images.length}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && <ExperienceDetail r={detail} onClose={() => setDetailId(null)} onEdit={() => setForm({ record: detail })} onDelete={() => void remove(detail)} />}
      {form && <ExperienceForm brand={brand} record={form.record} onClose={() => setForm(null)} onSaved={afterChange} />}
    </>
  );
}
