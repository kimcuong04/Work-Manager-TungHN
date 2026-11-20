import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, LayoutList, MapPin, Pencil, Plus, Smartphone, Trash2, X } from 'lucide-react';
import { buildHaystack, matchesQuery, normalizeText } from '../../shared/text';
import { PLACE_CATEGORIES, PLACE_CATEGORY_LABEL, type KnowledgePlace, type KnowledgePlaceInput, type PlaceCategory } from '../../shared/types';
import { LIMITS, hasErrors, validatePlaceInput } from '../../shared/validation';
import { api } from '../api';
import { Breadcrumbs, EmptyState, Field, SearchInput } from '../components/common';
import { LinkedText, LinkNoteField } from '../components/LinkNote';
import { Modal } from '../components/Modal';
import { useSessionState } from '../lib/persist';
import { useTableResize } from '../lib/tableResize';
import { usePageTitle, useUi } from '../state/ui';

/** Mục cố định trong Kiến thức (đường dẫn /knowledge/places). */
export const PLACES = 'places';
export const PLACES_TITLE = 'Website - App - Địa điểm';

type CatFilter = 'all' | PlaceCategory | 'none';

const CAT_ICON: Record<PlaceCategory, React.ReactNode> = {
  WEBSITE: <Globe size={13} />,
  APP: <Smartphone size={13} />,
  PLACE: <MapPin size={13} />,
};

export function PlaceCategoryChip({ category }: { category: PlaceCategory | null }) {
  if (!category) return <span className="faint">—</span>;
  return (
    <span className={`place-chip c-${category.toLowerCase()}`}>
      {CAT_ICON[category]} {PLACE_CATEGORY_LABEL[category]}
    </span>
  );
}

function PlaceForm({ item, onClose, onSaved }: { item?: KnowledgePlace; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useUi();
  const [form, setForm] = useState<KnowledgePlaceInput>({ category: item?.category ?? null, name: item?.name ?? '', note: item?.note ?? '' });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validatePlaceInput(form);
  const err = (k: string) => (submitted ? errors[k] : undefined);

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setSaving(true);
    try {
      if (item) await api.updatePlace(item.id, form);
      else await api.createPlace(form);
      toast('success', item ? `Đã cập nhật "${form.name.trim()}".` : `Đã thêm "${form.name.trim()}".`);
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
      title={item ? `Sửa — ${item.name}` : `Thêm vào ${PLACES_TITLE}`}
      onClose={onClose}
      footer={() => (
        <>
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
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
        <Field label="Phân loại" error={err('category')} hint="Không bắt buộc." htmlFor="pl-cat">
          <select
            id="pl-cat"
            className="select"
            value={form.category ?? ''}
            onChange={(e) => setForm({ ...form, category: (e.target.value || null) as PlaceCategory | null })}
          >
            <option value="">— Chưa phân loại —</option>
            {PLACE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PLACE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tên" required error={err('name')} htmlFor="pl-name">
          <input id="pl-name" autoFocus className="input" maxLength={LIMITS.projectName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Note" error={err('note')} hint="Ghi chú tự do, chèn được link để mở thẳng website / bản đồ." htmlFor="pl-note">
          <LinkNoteField id="pl-note" value={form.note} onChange={(note) => setForm({ ...form, note })} maxLength={LIMITS.note} placeholder="Vd: tra cứu bảo hành, xem [bản đồ](https://maps.google.com/…)" />
        </Field>
      </form>
    </Modal>
  );
}

/** Kiến thức › Website - App - Địa điểm: một bảng chung STT / Phân loại / Tên / Note, tìm theo Tên, lọc theo Phân loại. */
export function KnowledgePlacesPage() {
  usePageTitle(`Kiến thức · ${PLACES_TITLE}`);
  const tableRef = useTableResize('knowledge-places');
  const { confirm, toast, toastError } = useUi();
  const [items, setItems] = useState<KnowledgePlace[] | null>(null);
  const [q, setQ] = useSessionState('places-q', '');
  const [cat, setCat] = useSessionState<CatFilter>('places-cat', 'all');
  const [form, setForm] = useState<{ item?: KnowledgePlace } | null>(null);

  const load = useCallback(() => {
    api.listPlaces().then(setItems).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);

  const numbered = useMemo(() => (items ?? []).map((x, i) => ({ x, stt: i + 1 })), [items]);
  const nq = normalizeText(q);
  const byCat = (f: CatFilter) => numbered.filter(({ x }) => f === 'all' || (f === 'none' ? !x.category : x.category === f));
  const shown = byCat(cat).filter(({ x }) => matchesQuery(nq, buildHaystack([x.name])));

  const remove = async (p: KnowledgePlace) => {
    if (!(await confirm({ title: 'Xóa mục', message: `Xóa "${p.name}" khỏi ${PLACES_TITLE}? Không hoàn tác được.`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await api.deletePlace(p.id);
      toast('success', `Đã xóa "${p.name}".`);
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const add = (
    <button className="btn primary" onClick={() => setForm({})}>
      <Plus size={16} /> Thêm
    </button>
  );
  const filters: { key: CatFilter; label: string }[] = [
    { key: 'all', label: 'Tất cả' },
    ...PLACE_CATEGORIES.map((c) => ({ key: c as CatFilter, label: PLACE_CATEGORY_LABEL[c] })),
    { key: 'none', label: 'Chưa phân loại' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Kiến thức', to: '/knowledge' }, { label: PLACES_TITLE }]} />
          <h1 className="row">
            <LayoutList size={20} style={{ color: 'var(--accent)' }} /> {PLACES_TITLE}
          </h1>
          <div className="muted small">Danh sách chung các website, app và địa điểm hay dùng — ghi chú chèn được link để mở nhanh.</div>
        </div>
        <div className="actions">{add}</div>
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm theo Tên…" width={280} />
        <div className="seg" role="group" aria-label="Lọc theo Phân loại">
          {filters.map((f) => (
            <button key={f.key} className={cat === f.key ? 'on' : ''} aria-pressed={cat === f.key} onClick={() => setCat(f.key)}>
              {f.label}
              {items && <span className="seg-count">{byCat(f.key).length}</span>}
            </button>
          ))}
        </div>
        {(q || cat !== 'all') && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setQ('');
              setCat('all');
            }}
          >
            <X size={14} /> Clear Filters
          </button>
        )}
        <span className="small muted">
          {shown.length}/{items?.length ?? 0} mục
        </span>
      </div>
      {items === null ? (
        <div className="faint">Đang tải…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon={<LayoutList size={36} />} title={`Chưa có mục nào trong ${PLACES_TITLE}`} text="Lưu website tra cứu, app hay dùng, địa điểm (kho, văn phòng khách hàng…) kèm ghi chú và link." action={add} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl places-table" ref={tableRef}>
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Phân loại</th>
                <th>Tên</th>
                <th style={{ width: '50%' }}>Note</th>
                <th style={{ width: 1 }} data-col="__actions" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                    Không có mục phù hợp bộ lọc.
                  </td>
                </tr>
              )}
              {shown.map(({ x, stt }) => (
                <tr key={x.id} data-row={x.id} onDoubleClick={() => setForm({ item: x })}>
                  <td className="num">{stt}</td>
                  <td className="nowrap">
                    <PlaceCategoryChip category={x.category} />
                  </td>
                  <td style={{ fontWeight: 600, minWidth: 160 }}>{x.name}</td>
                  <td className="note-cell">
                    <LinkedText text={x.note} />
                  </td>
                  <td>
                    <div className="row nowrap" style={{ gap: 2 }}>
                      <button className="btn sm icon ghost" aria-label={`Sửa ${x.name}`} title="Sửa" onClick={() => setForm({ item: x })}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn sm icon ghost" aria-label={`Xóa ${x.name}`} title="Xóa" style={{ color: 'var(--danger)' }} onClick={() => void remove(x)}>
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
      {form && <PlaceForm item={form.item} onClose={() => setForm(null)} onSaved={load} />}
    </>
  );
}
