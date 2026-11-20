import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { BookMarked, FolderOpen, Globe, GraduationCap, Image as ImageIcon, LayoutList, Maximize2, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { formatDate, formatDateTime, inRange, todayISO } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import type { KnowledgeInput, KnowledgeRecord, MasterItem } from '../../shared/types';
import { hasErrors, validateKnowledgeInput, validateMasterName } from '../../shared/validation';
import { api } from '../api';
import { Breadcrumbs, DateInput, EmptyState, Field, SearchInput, SearchableSelect } from '../components/common';
import { ImageGallery } from '../components/ImageGallery';
import { LocalLinkButton, LocalLinkField, WEB_LINK_HINT, WebLinkButton } from '../components/LinkFields';
import { Modal, SidePanel } from '../components/Modal';
import { useLocalState, useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';
import { useOpenLocal, useOpenUrl } from './ExperiencePages';
import { DateFilterControls, resolveDateRange, useBrandOptions } from './WarrantyPage';
import { useTableResize } from '../lib/tableResize';
import { PLACES, PLACES_TITLE } from './KnowledgePlacesPage';

/** Mục không gắn Hãng nằm ở "Kiến thức chung" (đường dẫn /knowledge/general). */
export const GENERAL = 'general';

const scopeName = (brandName: string | null) => brandName ?? 'Kiến thức chung';
const scopePath = (brandId: string | null) => `/knowledge/${brandId ?? GENERAL}`;

function KnowledgeForm({ defaultBrandId, record, onClose, onSaved }: { defaultBrandId: string | null; record?: KnowledgeRecord; onClose: () => void; onSaved: (r: KnowledgeRecord) => void }) {
  const { confirm, toast, toastError } = useUi();
  const brands = useBrandOptions();
  const [initial] = useState<KnowledgeInput>(() =>
    record
      ? {
          brandId: record.brandId,
          knowledgeDate: record.knowledgeDate,
          title: record.title,
          deviceModel: record.deviceModel,
          content: record.content,
          webUrl: record.webUrl,
          localPath: record.localPath,
          images: record.images,
        }
      : { brandId: defaultBrandId, knowledgeDate: todayISO(), title: '', deviceModel: '', content: '', webUrl: '', localPath: '', images: [] },
  );
  const [form, setForm] = useState(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateKnowledgeInput(form);
  const err = (k: string) => (submitted || touched[k] ? errors[k] : undefined);
  const set = <K extends keyof KnowledgeInput>(k: K, v: KnowledgeInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Bỏ thay đổi?', message: 'Form có thay đổi chưa lưu. Đóng và bỏ thay đổi?', confirmText: 'Bỏ thay đổi', danger: true }))) return;
    onClose();
  };
  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
    setSaving(true);
    try {
      const saved = record ? await api.updateKnowledge(record.id, form) : await api.createKnowledge(form);
      toast('success', record ? 'Đã cập nhật Kiến thức.' : 'Đã thêm Kiến thức.');
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
      size="lg"
      title={record ? 'Sửa Kiến thức' : 'Thêm Kiến thức'}
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
        <Field label="Tiêu đề" required error={err('title')}>
          <input
            autoFocus
            className={`input ${err('title') ? 'invalid' : ''}`}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onBlur={() => touch('title')}
            placeholder="Ví dụ: Cấu hình VLAN cho switch PoE"
          />
        </Field>
        <div className="grid-3">
          <Field label="Ngày" required error={err('knowledgeDate')}>
            <DateInput value={form.knowledgeDate || null} onChange={(v) => set('knowledgeDate', v ?? '')} onBlur={() => touch('knowledgeDate')} />
          </Field>
          <Field label="Hãng" hint="Để trống = Kiến thức chung">
            <SearchableSelect options={brands.options} value={form.brandId} onChange={(v) => set('brandId', v)} onCreate={brands.create} createLabel="Thêm Hãng" placeholder="Kiến thức chung" />
          </Field>
          <Field label="Mode Device" error={err('deviceModel')}>
            <input className="input" value={form.deviceModel} onChange={(e) => set('deviceModel', e.target.value)} placeholder="Model / dòng thiết bị" />
          </Field>
        </div>
        <Field label="Nội dung" error={err('content')}>
          <textarea className="textarea" rows={10} value={form.content} onChange={(e) => set('content', e.target.value)} placeholder="Ghi chú kiến thức, các bước cấu hình, thông số, lưu ý…" />
        </Field>
        <Field label="Hyperlink (file / thư mục trên máy)">
          <LocalLinkField value={form.localPath ?? ''} onChange={(v) => set('localPath', v)} />
        </Field>
        <Field label="Link website" error={err('webUrl')} hint={WEB_LINK_HINT}>
          <input
            className={`input ${err('webUrl') ? 'invalid' : ''}`}
            value={form.webUrl}
            onChange={(e) => set('webUrl', e.target.value)}
            onBlur={() => touch('webUrl')}
            placeholder="Link hoặc từ khóa tìm kiếm"
          />
        </Field>
        <Field label="Ảnh" hint="Bấm Thêm ảnh, hoặc chụp/copy ảnh rồi nhấn Ctrl+V để dán thẳng vào đây.">
          <ImageGallery images={form.images} editable onChange={(v) => set('images', v)} />
        </Field>
      </div>
    </Modal>
  );
}

function KnowledgeMeta({ r }: { r: KnowledgeRecord }) {
  return (
    <div className="info-grid" style={{ gridTemplateColumns: '110px 1fr' }}>
      <span className="k">Ngày</span>
      <span>{formatDate(r.knowledgeDate)}</span>
      <span className="k">Hãng</span>
      <span>{scopeName(r.brandName)}</span>
      <span className="k">Mode Device</span>
      <span>{r.deviceModel || <span className="faint">—</span>}</span>
      <span className="k">Hyperlink</span>
      <span>
        <LocalLinkButton path={r.localPath} />
      </span>
      <span className="k">Link website</span>
      <span>
        <WebLinkButton text={r.webUrl} />
      </span>
    </div>
  );
}

function KnowledgeDetail({ r, onClose, onEdit, onView, onDelete }: { r: KnowledgeRecord; onClose: () => void; onEdit: () => void; onView: () => void; onDelete: () => void }) {
  return (
    <SidePanel
      title={r.title}
      subtitle={`${scopeName(r.brandName)} · ${formatDate(r.knowledgeDate)}`}
      label="Thông tin Kiến thức"
      onClose={onClose}
      footer={
        <>
          <button className="btn danger left" onClick={onDelete}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn" onClick={onView} title="Đọc toàn bộ nội dung trên màn hình lớn">
            <Maximize2 size={15} /> View info
          </button>
          <button className="btn primary" onClick={onEdit}>
            <Pencil size={15} /> Edit
          </button>
        </>
      }
    >
      <KnowledgeMeta r={r} />
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 14 }}>
        Nội dung
      </h3>
      <div className="pre card card-pad" style={{ boxShadow: 'none' }}>
        {r.content || <span className="faint">—</span>}
      </div>
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 14 }}>
        Ảnh ({r.images.length})
      </h3>
      <ImageGallery images={r.images} />
      <div className="small faint" style={{ marginTop: 16 }}>
        Tạo {formatDateTime(r.createdAt)} · Cập nhật {formatDateTime(r.updatedAt)}
      </div>
    </SidePanel>
  );
}

function KnowledgeInfoModal({ r, onClose, onEdit, onDelete }: { r: KnowledgeRecord; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <Modal
      size="xl"
      title={
        <span className="row" style={{ gap: 8 }}>
          <GraduationCap size={18} style={{ color: 'var(--accent)' }} /> {r.title}
        </span>
      }
      onClose={onClose}
      bodyStyle={{ background: 'var(--surface-2)' }}
      footer={(close) => (
        <>
          <button className="btn danger left" onClick={onDelete}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn" onClick={close}>
            Đóng
          </button>
          <button className="btn primary" onClick={onEdit}>
            <Pencil size={15} /> Edit
          </button>
        </>
      )}
    >
      <div className="view-info">
        <section className="card card-pad">
          <h3 className="card-title">Thông tin</h3>
          <KnowledgeMeta r={r} />
        </section>
        <section className="card card-pad span-2">
          <h3 className="card-title">Nội dung</h3>
          <div className="pre reading">{r.content || <span className="faint">Chưa có nội dung.</span>}</div>
        </section>
        <section className="card card-pad span-all">
          <h3 className="card-title">Ảnh ({r.images.length})</h3>
          <ImageGallery images={r.images} large />
          <div className="small faint" style={{ marginTop: 14 }}>
            Tạo {formatDateTime(r.createdAt)} · Cập nhật {formatDateTime(r.updatedAt)}
          </div>
        </section>
      </div>
    </Modal>
  );
}

const hay = (r: KnowledgeRecord) => buildHaystack([r.title, r.deviceModel, r.content, r.brandName]);

/**
 * Xóa Hãng khỏi Kiến thức: chọn chuyển các bài sang Kiến thức chung (mặc định) hoặc xóa luôn. Hãng còn dùng ở Dự án /
 * Warranty / Experience / Kho thiết bị thì chỉ ẩn khỏi Kiến thức; không dùng ở đâu thì xóa hẳn khỏi danh mục Hãng.
 */
function RemoveBrandDialog({ brand, onClose, onDone }: { brand: MasterItem; onClose: () => void; onDone: () => void }) {
  const { refresh } = useAppData();
  const { toast, toastError } = useUi();
  const [mode, setMode] = useState<'move' | 'delete'>('move');
  const [busy, setBusy] = useState(false);
  const count = brand.knowledgeCount ?? 0;
  const other = Math.max(0, brand.usageCount - count);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.removeKnowledgeBrand(brand.id, mode === 'delete');
      const parts = [
        r.deletedBrand ? `Đã xóa Hãng "${brand.name}"` : `Đã ẩn Hãng "${brand.name}" khỏi Kiến thức`,
        r.moved ? `${r.moved} bài chuyển sang Kiến thức chung` : '',
        r.deleted ? `đã xóa ${r.deleted} bài` : '',
      ].filter(Boolean);
      toast('success', `${parts.join(', ')}.`);
      await refresh('masters');
      onDone();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={`Xóa Hãng "${brand.name}" khỏi Kiến thức`}
      onClose={onClose}
      footer={() => (
        <>
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn danger" disabled={busy} onClick={() => void run()}>
            <Trash2 size={15} /> Xóa Hãng
          </button>
        </>
      )}
    >
      <div className="stack">
        {count > 0 ? (
          <fieldset className="radio-list" aria-label="Các bài kiến thức của Hãng">
            <legend className="small muted">Hãng có {count} bài kiến thức:</legend>
            <label>
              <input type="radio" name="kb-mode" checked={mode === 'move'} onChange={() => setMode('move')} /> Chuyển {count} bài sang <b>Kiến thức chung</b> (giữ nguyên nội dung)
            </label>
            <label>
              <input type="radio" name="kb-mode" checked={mode === 'delete'} onChange={() => setMode('delete')} /> Xóa luôn {count} bài (kèm ảnh, không hoàn tác được)
            </label>
          </fieldset>
        ) : (
          <div>Hãng này chưa có bài kiến thức nào.</div>
        )}
        <div className="small muted">
          {other > 0
            ? `Hãng còn được dùng ở ${other} chỗ khác (Dự án, Warranty, Experience, Kho thiết bị) nên chỉ ẩn khỏi Kiến thức — danh mục Hãng giữ nguyên. Thêm lại bằng "Thêm Hãng" hoặc khi viết bài cho Hãng này.`
            : 'Hãng chưa được dùng ở đâu khác nên sẽ bị xóa hẳn khỏi danh mục Hãng (Settings › Master Data).'}
        </div>
      </div>
    </Modal>
  );
}

export function KnowledgeHomePage() {
  const tableRef = useTableResize('knowledge-all');
  usePageTitle('Kiến thức');
  const { masters, refresh } = useAppData();
  const { prompt, toast, toastError } = useUi();
  const navigate = useNavigate();
  const [all, setAll] = useState<KnowledgeRecord[] | null>(null);
  const [q, setQ] = useSessionState('knowledge-home-q', '');
  const [form, setForm] = useState(false);
  const [removing, setRemoving] = useState<MasterItem | null>(null);
  const [placeCount, setPlaceCount] = useState<number | null>(null);

  const load = useCallback(() => {
    api.listKnowledge({}).then(setAll).catch(toastError);
    api
      .listPlaces()
      .then((l) => setPlaceCount(l.length))
      .catch(toastError);
  }, [toastError]);
  useEffect(load, [load, masters.brands]);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last: string }>();
    for (const e of all ?? []) {
      const key = e.brandId ?? GENERAL;
      const s = m.get(key) ?? { count: 0, last: '' };
      s.count++;
      if (e.knowledgeDate > s.last) s.last = e.knowledgeDate;
      m.set(key, s);
    }
    return m;
  }, [all]);

  const nq = normalizeText(q);
  const brands = masters.brands
    .filter((b) => (b.isActive && !b.knowledgeHidden) || (stats.get(b.id)?.count ?? 0) > 0)
    .filter((b) => !nq || normalizeText(b.name).includes(nq))
    .sort((a, b) => compareVi(a.name, b.name));
  const matches = useMemo(() => (nq ? (all ?? []).filter((r) => matchesQuery(nq, hay(r))).slice(0, 50) : []), [all, nq]);

  const addBrand = async () => {
    const name = await prompt({ title: 'Thêm Hãng', label: 'Tên Hãng', confirmText: 'Thêm', validate: validateMasterName });
    if (name === null) return;
    try {
      const b = await api.addKnowledgeBrand(name);
      await refresh('masters');
      toast('success', `Đã thêm Hãng "${b.name}".`);
    } catch (e) {
      toastError(e);
    }
  };

  const card = (key: string, name: string, brand?: MasterItem) => {
    const s = stats.get(key);
    const icon =
      key === GENERAL ? (
        <BookMarked size={16} style={{ color: 'var(--accent)' }} />
      ) : key === PLACES ? (
        <LayoutList size={16} style={{ color: 'var(--accent)' }} />
      ) : (
        <Tag size={16} style={{ color: 'var(--accent)' }} />
      );
    const sub = key === PLACES ? (placeCount === null ? '…' : placeCount ? `${placeCount} mục` : 'Chưa có mục nào') : s ? `${s.count} mục · gần nhất ${formatDate(s.last)}` : 'Chưa có kiến thức';
    return (
      <div key={key} className="brand-card-wrap">
        <button className={`card brand-card ${key === PLACES ? 'fixed' : ''}`} onClick={() => navigate(`/knowledge/${key}`)}>
          <span className="bname">
            {icon}
            {name}
            {brand && !brand.isActive && <span className="badge">Ngừng dùng</span>}
          </span>
          <span className="muted small">{sub}</span>
        </button>
        {brand && (
          <button className="btn sm icon ghost brand-card-del" aria-label={`Xóa Hãng ${name} khỏi Kiến thức`} title="Xóa Hãng khỏi Kiến thức" onClick={() => setRemoving(brand)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="row">
            <GraduationCap size={22} style={{ color: 'var(--accent)' }} /> Kiến thức — Tổng hợp kiến thức
          </h1>
          <div className="muted small">Ghi chép kiến thức kỹ thuật theo Hãng (danh mục dùng chung) hoặc Kiến thức chung không gắn Hãng.</div>
        </div>
        <div className="actions">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm Hãng hoặc nội dung kiến thức…" width={280} />
          <button className="btn" onClick={addBrand}>
            <Plus size={15} /> Thêm Hãng
          </button>
          <button className="btn primary" onClick={() => setForm(true)}>
            <Plus size={16} /> Thêm Kiến thức
          </button>
        </div>
      </div>
      <div className="brand-grid">
        {(!nq || normalizeText('Kiến thức chung').includes(nq)) && card(GENERAL, 'Kiến thức chung')}
        {(!nq || normalizeText(PLACES_TITLE).includes(nq)) && card(PLACES, PLACES_TITLE)}
        {brands.map((b) => card(b.id, b.name, b))}
      </div>
      {nq && (
        <section className="card card-pad" style={{ marginTop: 18 }}>
          <h2 className="card-title">Kết quả trong nội dung ({matches.length})</h2>
          {matches.length === 0 ? (
            <div className="faint small">Không có mục kiến thức nào khớp “{q}”.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl" ref={tableRef}>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Tiêu đề</th>
                    <th>Hãng</th>
                    <th style={{ width: '45%' }}>Nội dung</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((r) => (
                    <tr key={r.id} data-row={r.id} className="clickable" onClick={() => navigate(scopePath(r.brandId), { state: { select: r.id } })}>
                      <td className="nowrap">{formatDate(r.knowledgeDate)}</td>
                      <td style={{ fontWeight: 600 }}>{r.title}</td>
                      <td className="nowrap">{scopeName(r.brandName)}</td>
                      <td className="clamp">
                        <div style={{ maxWidth: 'none' }}>{r.content}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {removing && <RemoveBrandDialog brand={removing} onClose={() => setRemoving(null)} onDone={load} />}
      {form && (
        <KnowledgeForm
          defaultBrandId={null}
          onClose={() => setForm(false)}
          onSaved={(r) => {
            load();
            navigate(scopePath(r.brandId), { state: { select: r.id } });
          }}
        />
      )}
    </div>
  );
}

interface KnowFilter {
  q: string;
  mode: Parameters<typeof resolveDateRange>[0];
  month: number;
  monthYear: number;
  from: string | null;
  to: string | null;
}

type KnowSort = 'dateDesc' | 'dateAsc' | 'title';

export function KnowledgeBrandPage() {
  const { brandId = '' } = useParams();
  return <KnowledgeBrandView key={brandId} scope={brandId} />;
}

function KnowledgeBrandView({ scope }: { scope: string }) {
  const tableRef1 = useTableResize('knowledge');
  const { masters, today, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const location = useLocation();
  const navigate = useNavigate();
  const isGeneral = scope === GENERAL;
  const brand = isGeneral ? null : masters.brands.find((b) => b.id === scope);
  const title = isGeneral ? 'Kiến thức chung' : brand?.name ?? 'Kiến thức';
  usePageTitle(`Kiến thức · ${title}`);
  const [records, setRecords] = useState<KnowledgeRecord[] | null>(null);
  const [f, setF] = useSessionState<KnowFilter>(`knowledge:${scope}`, {
    q: '',
    mode: 'all',
    month: Number(today.slice(5, 7)),
    monthYear: Number(today.slice(0, 4)),
    from: null,
    to: null,
  });
  const [sort, setSort] = useLocalState<KnowSort>('knowledge-sort', 'dateDesc');
  const [form, setForm] = useState<{ record?: KnowledgeRecord } | null>(null);
  const [detailId, setDetailId] = useState<string | null>((location.state as { select?: string } | null)?.select ?? null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [removingBrand, setRemovingBrand] = useState(false);
  const openUrl = useOpenUrl();
  const openLocal = useOpenLocal();

  const load = useCallback(() => {
    api
      .listKnowledge({ brandId: isGeneral ? null : scope })
      .then(setRecords)
      .catch(toastError);
  }, [scope, isGeneral, toastError]);
  useEffect(load, [load]);

  const indexed = useMemo(() => (records ?? []).map((r) => ({ r, hay: hay(r) })), [records]);
  const range = resolveDateRange(f.mode, f, today);
  const shown = useMemo(() => {
    const nq = normalizeText(f.q);
    const list = indexed.filter(({ r, hay: h }) => inRange(r.knowledgeDate, range.from, range.to) && matchesQuery(nq, h)).map((x) => x.r);
    return list.sort((a, b) =>
      sort === 'dateAsc' ? a.knowledgeDate.localeCompare(b.knowledgeDate) : sort === 'dateDesc' ? b.knowledgeDate.localeCompare(a.knowledgeDate) : compareVi(a.title, b.title),
    );
  }, [indexed, f.q, range.from, range.to, sort]);

  if (!isGeneral && !brand) return <EmptyState title="Không tìm thấy Hãng" text="Hãng có thể đã bị xóa khỏi danh mục." />;

  const detail = records?.find((r) => r.id === detailId) ?? null;
  const viewing = records?.find((r) => r.id === viewId) ?? null;
  const afterSave = (r: KnowledgeRecord) => {
    void refresh('masters');
    if ((r.brandId ?? GENERAL) !== scope) {
      toast('info', `Mục đã chuyển sang ${scopeName(r.brandName)}.`);
      navigate(scopePath(r.brandId), { state: { select: r.id } });
      return;
    }
    load();
  };
  const remove = async (r: KnowledgeRecord) => {
    if (!(await confirm({ title: 'Xóa Kiến thức', message: `Xóa “${r.title}”? Ảnh đính kèm cũng bị xóa.`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await api.deleteKnowledge(r.id);
      setDetailId(null);
      setViewId(null);
      toast('success', 'Đã xóa Kiến thức.');
      load();
      void refresh('masters');
    } catch (e) {
      toastError(e);
    }
  };
  const activeFilter = !!f.q || f.mode !== 'all';

  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Kiến thức', to: '/knowledge' }, { label: title }]} />
          <h1 className="row">
            {isGeneral ? <BookMarked size={20} style={{ color: 'var(--accent)' }} /> : <Tag size={20} style={{ color: 'var(--accent)' }} />} {title}
            {brand && !brand.isActive && <span className="badge">Ngừng dùng</span>}
          </h1>
        </div>
        <div className="actions">
          {brand && (
            <button className="btn" onClick={() => setRemovingBrand(true)} title="Xóa Hãng khỏi Kiến thức">
              <Trash2 size={15} /> Xóa Hãng
            </button>
          )}
          <button className="btn primary" onClick={() => setForm({})}>
            <Plus size={16} /> Thêm Kiến thức
          </button>
        </div>
      </div>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tìm tiêu đề, Mode Device, nội dung…" width={300} />
        <DateFilterControls mode={f.mode} month={f.month} monthYear={f.monthYear} from={f.from} to={f.to} onChange={(p) => setF({ ...f, ...p })} />
        {activeFilter && (
          <button className="btn ghost sm" onClick={() => setF({ ...f, q: '', mode: 'all', from: null, to: null })}>
            <X size={14} /> Clear Filters
          </button>
        )}
        <span className="small muted">
          {shown.length}/{records?.length ?? 0} mục
        </span>
        <div className="grow" />
        <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as KnowSort)} aria-label="Sắp xếp">
          <option value="dateDesc">Ngày mới nhất</option>
          <option value="dateAsc">Ngày cũ nhất</option>
          <option value="title">Tiêu đề A–Z</option>
        </select>
      </div>
      {records === null ? (
        <div className="faint">Đang tải…</div>
      ) : records.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<GraduationCap size={36} />}
            title={`Chưa có kiến thức trong ${title}`}
            text="Lưu lại cách cấu hình, thông số, lưu ý kỹ thuật… kèm link và ảnh (dán ảnh chụp màn hình bằng Ctrl+V)."
            action={
              <button className="btn primary" onClick={() => setForm({})}>
                <Plus size={16} /> Thêm Kiến thức
              </button>
            }
          />
        </div>
      ) : (
        <div className="split">
          <div className="table-wrap">
            <table className="tbl" ref={tableRef1}>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Tiêu đề</th>
                  <th>Mode Device</th>
                  <th style={{ width: '45%' }}>Nội dung</th>
                  <th>Link / Ảnh</th>
                  <th style={{ width: 1 }} data-col="__actions" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                      Không có mục phù hợp bộ lọc.
                    </td>
                  </tr>
                )}
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    data-row={r.id}
                    className={`clickable ${r.id === detailId ? 'selected' : ''}`}
                    tabIndex={0}
                    aria-selected={r.id === detailId}
                    onClick={() => setDetailId(r.id)}
                    onDoubleClick={() => setViewId(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setDetailId(r.id)}
                  >
                    <td className="nowrap">{formatDate(r.knowledgeDate)}</td>
                    <td style={{ fontWeight: 600, minWidth: 180 }}>{r.title}</td>
                    <td>{r.deviceModel}</td>
                    <td className="clamp">
                      <div style={{ maxWidth: 'none' }}>{r.content}</div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 6 }}>
                        {r.localPath && (
                          <button className="btn sm icon" title={r.localPath} aria-label="Mở hyperlink" onClick={() => openLocal(r.localPath)}>
                            <FolderOpen size={14} />
                          </button>
                        )}
                        {r.webUrl && (
                          <button className="btn sm icon" title={r.webUrl} aria-label="Mở link website" onClick={() => openUrl(r.webUrl)}>
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
                    <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      <button className="btn sm icon ghost" style={{ color: 'var(--danger)' }} aria-label={`Xóa ${r.title}`} title="Xóa bài kiến thức" onClick={() => void remove(r)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail && (
            <KnowledgeDetail
              key={detail.id}
              r={detail}
              onClose={() => setDetailId(null)}
              onEdit={() => setForm({ record: detail })}
              onView={() => setViewId(detail.id)}
              onDelete={() => void remove(detail)}
            />
          )}
        </div>
      )}
      {viewing && <KnowledgeInfoModal key={viewing.id} r={viewing} onClose={() => setViewId(null)} onEdit={() => setForm({ record: viewing })} onDelete={() => void remove(viewing)} />}
      {removingBrand && brand && <RemoveBrandDialog brand={brand} onClose={() => setRemovingBrand(false)} onDone={() => navigate('/knowledge')} />}
      {form && <KnowledgeForm defaultBrandId={isGeneral ? null : scope} record={form.record} onClose={() => setForm(null)} onSaved={afterSave} />}
    </>
  );
}
