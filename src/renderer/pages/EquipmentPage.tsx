import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Image as ImageIcon, Maximize2, Package, PackageCheck, Pencil, Plus, Trash2, X } from 'lucide-react';
import { diffDays, formatDate, formatDateTime, inRange, todayISO } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import type { EquipmentInput, EquipmentItem, EquipmentLoan, EquipmentLoanInput, ImageRef, MasterKind } from '../../shared/types';
import { hasErrors, validateEquipmentInput, validateEquipmentLoanInput } from '../../shared/validation';
import { api } from '../api';
import { ColumnToggle, DateInput, EmptyState, Field, MultiSelect, SearchInput, SearchableSelect } from '../components/common';
import { ImageGallery } from '../components/ImageGallery';
import { Modal, SidePanel } from '../components/Modal';
import { SelectAllHeader, SelectCell, SelectToggleButton, SelectionBar, useSelection } from '../components/Selection';
import { useLocalState, useSessionState } from '../lib/persist';
import { useTableResize } from '../lib/tableResize';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';
import { DateFilterControls, resolveDateRange, useBrandOptions } from './WarrantyPage';

type LoanState = 'all' | 'lent' | 'overdue' | 'in';
type DateField = 'currentBorrowDate' | 'currentDueDate' | 'handoverDate';
type DateMode = Parameters<typeof resolveDateRange>[0];

interface EquipmentFilter {
  q: string;
  categories: string[];
  brands: string[];
  sis: string[];
  state: LoanState;
  dateField: DateField;
  mode: DateMode;
  month: number;
  monthYear: number;
  from: string | null;
  to: string | null;
}

type SortKey = 'stt' | 'productName' | 'category' | 'brand' | 'handoverDate' | 'currentBorrowDate' | 'currentDueDate';

const dash = <span className="faint">—</span>;

/** Trạng thái theo lần mượn chưa hoàn trả: quá Ngày hẹn trả mà chưa bấm "Đã hoàn trả" thì là Quá hạn. */
export function equipmentState(r: Pick<EquipmentItem, 'currentBorrowDate' | 'currentDueDate'>, today: string): Exclude<LoanState, 'all'> {
  if (!r.currentBorrowDate) return 'in';
  return r.currentDueDate && r.currentDueDate < today ? 'overdue' : 'lent';
}

const STATE_LABEL: Record<Exclude<LoanState, 'all'>, string> = { lent: 'Đang cho mượn', overdue: 'Quá hạn', in: 'Trong kho' };

function StateBadge({ r, today }: { r: EquipmentItem; today: string }) {
  const s = equipmentState(r, today);
  return <span className={`badge ${s === 'overdue' ? 'danger' : s === 'lent' ? 'warn' : 'accent'}`}>{STATE_LABEL[s]}</span>;
}

const openLoan = (r: EquipmentItem) => r.loans.find((l) => !l.returnDate) ?? null;
const lastReturn = (r: EquipmentItem) =>
  r.loans.filter((l) => l.returnDate && l.returnCondition.trim()).sort((a, b) => (b.returnDate! < a.returnDate! ? -1 : b.returnDate! > a.returnDate! ? 1 : b.updatedAt.localeCompare(a.updatedAt)))[0] ?? null;
const itemTitle = (r: EquipmentItem) => `${r.stt}. ${r.productName}`;
const currentLoan = (r: EquipmentItem) => (r.currentBorrowDate ? openLoan(r) : null);

interface Column {
  key: string;
  label: string;
  sort?: SortKey;
  cls?: string;
  render: (r: EquipmentItem, today: string) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { key: 'stt', label: 'STT', sort: 'stt', cls: 'num nowrap', render: (r) => <b>{r.stt}</b> },
  { key: 'name', label: 'Tên sp', sort: 'productName', cls: 'eq-name', render: (r) => <span style={{ fontWeight: 600 }}>{r.productName}</span> },
  { key: 'category', label: 'Phân loại', sort: 'category', cls: 'nowrap', render: (r) => r.categoryName ?? dash },
  { key: 'brand', label: 'Hãng', sort: 'brand', cls: 'nowrap', render: (r) => r.brandName ?? dash },
  { key: 'serial', label: 'Serial number', cls: 'nowrap', render: (r) => r.serialNumber || dash },
  { key: 'description', label: 'Mô tả', cls: 'clamp', render: (r) => <div>{r.description}</div> },
  { key: 'handover', label: 'Ngày nhận bàn giao', sort: 'handoverDate', cls: 'nowrap', render: (r) => formatDate(r.handoverDate) || dash },
  { key: 'state', label: 'Trạng thái', cls: 'nowrap', render: (r, today) => <StateBadge r={r} today={today} /> },
  { key: 'condition', label: 'Tình trạng', cls: 'clamp', render: (r) => <div>{r.condition}</div> },
  { key: 'borrow', label: 'Ngày mượn hiện tại', sort: 'currentBorrowDate', cls: 'nowrap', render: (r) => formatDate(r.currentBorrowDate) || dash },
  {
    key: 'due',
    label: 'Ngày hẹn trả hiện tại',
    sort: 'currentDueDate',
    cls: 'nowrap',
    render: (r, today) =>
      r.currentDueDate ? (
        <>
          <div>{formatDate(r.currentDueDate)}</div>
          {r.currentBorrowDate && <DueHint due={r.currentDueDate} today={today} />}
        </>
      ) : (
        dash
      ),
  },
  { key: 'si', label: 'Tên SI mượn', cls: 'pt-text', render: (r) => currentLoan(r)?.siName ?? dash },
  { key: 'sale', label: 'Sale mượn', cls: 'pt-text', render: (r) => currentLoan(r)?.salespersonName ?? dash },
  { key: 'loans', label: 'Số lần mượn', cls: 'num', render: (r) => r.loans.length || '' },
  {
    key: 'images',
    label: 'Ảnh',
    render: (r) =>
      r.images.length ? (
        <span className="icon-chip">
          <ImageIcon size={13} /> {r.images.length}
        </span>
      ) : (
        ''
      ),
  },
];

function DueHint({ due, today }: { due: string; today: string }) {
  const d = diffDays(due, today);
  const text = d < 0 ? `Quá hạn ${-d} ngày` : d === 0 ? 'Hẹn trả hôm nay' : `Còn ${d} ngày`;
  return (
    <div className="small" style={{ color: d < 0 ? 'var(--urgent)' : d <= 2 ? 'var(--attention)' : 'var(--text-faint)', fontWeight: 600 }}>
      {text}
    </div>
  );
}

/** Danh mục chọn được trong Kho thiết bị (Tên SI, Sale dùng chung Job Chính; Phân loại riêng), thêm mới ngay trong ô chọn. */
function useMasterOptions(kind: Extract<MasterKind, 'siPartners' | 'salespersons' | 'equipmentCategories'>, noun: string) {
  const { masters, refresh } = useAppData();
  const { toast, toastError } = useUi();
  const options = masters[kind].map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }));
  const create = async (name: string) => {
    try {
      const m = await api.createMaster(kind, name);
      await refresh('masters');
      toast('success', `Đã thêm ${noun} "${m.name}" vào danh mục.`);
      return m.id;
    } catch (e) {
      toastError(e);
      return null;
    }
  };
  return { options, create };
}

function emptyInput(): EquipmentInput {
  return { productName: '', categoryId: null, brandId: null, serialNumber: '', description: '', handoverDate: null, condition: '', images: [] };
}

function toInput(r: EquipmentItem): EquipmentInput {
  return {
    stt: r.stt,
    productName: r.productName,
    categoryId: r.categoryId,
    brandId: r.brandId,
    serialNumber: r.serialNumber,
    description: r.description,
    handoverDate: r.handoverDate,
    condition: r.condition,
    images: r.images,
  };
}

/** Duplicate: thêm một thiết bị cùng loại — chép Tên sp, Phân loại, Hãng, Mô tả, Tình trạng; Serial, ngày, ảnh và lịch sử để trống. */
function duplicateInput(r: EquipmentItem): EquipmentInput {
  return { ...emptyInput(), productName: r.productName, categoryId: r.categoryId, brandId: r.brandId, description: r.description, condition: r.condition };
}

function EquipmentForm({ item, template, onClose, onSaved }: { item?: EquipmentItem; template?: EquipmentItem; onClose: () => void; onSaved: (r: EquipmentItem) => void }) {
  const { confirm, toast, toastError } = useUi();
  const brands = useBrandOptions();
  const categories = useMasterOptions('equipmentCategories', 'Phân loại');
  const [initial, setInitial] = useState<EquipmentInput>(() => (item ? toInput(item) : template ? duplicateInput(template) : emptyInput()));
  const [form, setForm] = useState<EquipmentInput>(initial);
  useEffect(() => {
    if (item) return;
    api
      .nextEquipmentStt()
      .then((stt) => {
        setInitial((i) => ({ ...i, stt }));
        setForm((f) => ({ ...f, stt: f.stt ?? stt }));
      })
      .catch(toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateEquipmentInput(form);
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof EquipmentInput>(k: K, v: EquipmentInput[K]) => setForm((f) => ({ ...f, [k]: v }));
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
      const saved = item ? await api.updateEquipment(item.id, form) : await api.createEquipment(form);
      toast('success', item ? 'Đã cập nhật thiết bị.' : 'Đã thêm thiết bị vào Kho.');
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
      title={item ? 'Sửa thiết bị' : template ? 'Duplicate thiết bị' : 'Thêm thiết bị vào Kho'}
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
        {template && (
          <div className="alert info small">
            <div>
              Thiết bị cùng loại với <b>{itemTitle(template)}</b> — đã chép Tên sp, Phân loại, Hãng, Mô tả, Tình trạng. Nhập Serial number của thiết bị mới rồi bấm Lưu.
            </div>
          </div>
        )}
        <section className="form-section">
          <h3>Thiết bị</h3>
          <div className="grid-3" style={{ gridTemplateColumns: '120px 1fr' }}>
            <Field label="STT" required error={err('stt')}>
              <input
                className={`input ${err('stt') ? 'invalid' : ''}`}
                type="number"
                min={1}
                aria-label="STT"
                value={form.stt ?? ''}
                onChange={(e) => set('stt', e.target.value === '' ? null : Math.floor(Number(e.target.value)))}
              />
            </Field>
            <Field label="Tên sp" required error={err('productName')} htmlFor="eq-name">
              <input id="eq-name" className={`input ${err('productName') ? 'invalid' : ''}`} value={form.productName} autoFocus onChange={(e) => set('productName', e.target.value)} />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Phân loại">
              <SearchableSelect
                id="eq-category"
                options={categories.options}
                value={form.categoryId}
                onChange={(v) => set('categoryId', v)}
                onCreate={categories.create}
                createLabel="Thêm Phân loại"
                placeholder="Chọn hoặc thêm Phân loại"
              />
            </Field>
            <Field label="Hãng">
              <SearchableSelect id="eq-brand" options={brands.options} value={form.brandId} onChange={(v) => set('brandId', v)} onCreate={brands.create} createLabel="Thêm Hãng" placeholder="Chọn hoặc thêm Hãng" />
            </Field>
            <Field label="Serial number" error={err('serialNumber')} htmlFor="eq-serial">
              <input id="eq-serial" className="input" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
            </Field>
            <Field label="Ngày nhận bàn giao" error={err('handoverDate')}>
              <DateInput id="eq-handover" value={form.handoverDate} onChange={(v) => set('handoverDate', v)} clearable />
            </Field>
          </div>
          <Field label="Mô tả" error={err('description')}>
            <textarea className="textarea" rows={3} aria-label="Mô tả" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Tình trạng" error={err('condition')} hint="Nhập tay; khi bấm “Đã hoàn trả” có ghi “Tình trạng khi trả”, mục này tự lấy theo lần trả mới nhất.">
            <textarea className="textarea" rows={2} aria-label="Tình trạng" value={form.condition} onChange={(e) => set('condition', e.target.value)} />
          </Field>
          <div className="field-hint">Ngày mượn / hẹn trả hiện tại tự cập nhật theo Lịch sử mượn / trả (thêm lần mượn, bấm “Đã hoàn trả”).</div>
        </section>
        <section className="form-section">
          <h3>Ảnh</h3>
          <ImageGallery images={form.images} editable onChange={(v: ImageRef[]) => set('images', v)} />
        </section>
      </div>
    </Modal>
  );
}

type LoanMode = 'new' | 'edit' | 'return';

/** Thêm / sửa một lần mượn; `return` = bấm "Đã hoàn trả": ghi Ngày trả thực tế (mặc định hôm nay) và tình trạng khi trả. */
function LoanForm({ item, loan, mode, onClose, onSaved }: { item: EquipmentItem; loan?: EquipmentLoan; mode: LoanMode; onClose: () => void; onSaved: (r: EquipmentItem) => void }) {
  const { today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const sis = useMasterOptions('siPartners', 'Tên SI');
  const sales = useMasterOptions('salespersons', 'Sale');
  const [initial] = useState<EquipmentLoanInput>(() =>
    loan
      ? {
          siId: loan.siId,
          salespersonId: loan.salespersonId,
          borrowDate: loan.borrowDate,
          dueDate: loan.dueDate,
          returnDate: loan.returnDate ?? (mode === 'return' ? today : null),
          reason: loan.reason,
          returnCondition: loan.returnCondition,
          images: loan.images,
        }
      : { siId: null, salespersonId: null, borrowDate: today, dueDate: null, returnDate: null, reason: '', returnCondition: '', images: [] },
  );
  const [form, setForm] = useState<EquipmentLoanInput>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const returned = mode === 'return' || !!loan?.returnDate;
  const errors = validateEquipmentLoanInput(form, today);
  if (returned && !form.returnDate) errors.returnDate = 'Bắt buộc nhập Ngày trả thực tế.';
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof EquipmentLoanInput>(k: K, v: EquipmentLoanInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Bỏ thay đổi?', message: 'Lần mượn/trả có thay đổi chưa lưu. Đóng và bỏ thay đổi?', confirmText: 'Bỏ thay đổi', danger: true }))) return;
    onClose();
  };
  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
    setSaving(true);
    try {
      const saved = await api.saveEquipmentLoan(item.id, loan?.id ?? null, form);
      toast(
        'success',
        mode === 'return' ? `Đã hoàn trả ngày ${formatDate(form.returnDate)} — thiết bị về kho.` : loan ? 'Đã cập nhật lần mượn.' : `Đã ghi lần mượn ngày ${formatDate(form.borrowDate)}.`,
      );
      onSaved(saved);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const area = (k: 'reason' | 'returnCondition', label: string, hint?: string) => (
    <Field label={label} error={err(k)} hint={hint}>
      <textarea className="textarea" rows={3} aria-label={label} value={form[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const returnDateField = (
    <Field label="Ngày trả thực tế" required error={err('returnDate')} hint={mode === 'return' ? 'Mặc định hôm nay, sửa được.' : undefined}>
      <DateInput id="loan-return" value={form.returnDate} onChange={(v) => set('returnDate', v)} />
    </Field>
  );
  const conditionHint = 'Lần trả mới nhất có ghi mục này sẽ thành Tình trạng của thiết bị.';

  return (
    <Modal
      title={`${mode === 'return' ? 'Đã hoàn trả' : mode === 'edit' ? 'Sửa lần mượn' : 'Thêm lần mượn'} — ${itemTitle(item)}`}
      onClose={close}
      footer={() => (
        <>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : mode === 'return' ? 'Xác nhận hoàn trả' : 'Lưu'}
          </button>
        </>
      )}
    >
      <div className="stack">
        {mode === 'return' && loan ? (
          <>
            <div className="loan-current">
              <div className="info-grid loan-grid">
                <span className="k">Tên SI</span>
                <span>{loan.siName ?? dash}</span>
                <span className="k">Sale</span>
                <span>{loan.salespersonName ?? dash}</span>
                <span className="k">Ngày mượn</span>
                <span>{formatDate(loan.borrowDate)}</span>
                <span className="k">Ngày hẹn trả</span>
                <span>
                  {loan.dueDate ? formatDate(loan.dueDate) : dash}
                  {loan.dueDate && <DueHint due={loan.dueDate} today={today} />}
                </span>
              </div>
            </div>
            <div style={{ width: 240 }}>{returnDateField}</div>
            {area('returnCondition', 'Tình trạng khi trả', conditionHint)}
          </>
        ) : (
          <>
            <div className="grid-2">
              <Field label="Tên SI">
                <SearchableSelect options={sis.options} value={form.siId} onChange={(v) => set('siId', v)} onCreate={sis.create} createLabel="Thêm SI" placeholder="Chọn hoặc thêm SI" id="loan-si" />
              </Field>
              <Field label="Sale">
                <SearchableSelect options={sales.options} value={form.salespersonId} onChange={(v) => set('salespersonId', v)} onCreate={sales.create} createLabel="Thêm Sale" placeholder="Chọn hoặc thêm Sale" id="loan-sale" />
              </Field>
              <Field label="Ngày mượn" required error={err('borrowDate')}>
                <DateInput id="loan-borrow" value={form.borrowDate} onChange={(v) => set('borrowDate', v ?? '')} />
              </Field>
              <Field label="Ngày hẹn trả" error={err('dueDate')} hint="Quá ngày này mà chưa bấm “Đã hoàn trả” thì thiết bị chuyển sang Quá hạn.">
                <DateInput id="loan-due" value={form.dueDate} onChange={(v) => set('dueDate', v)} clearable />
              </Field>
              {returned && returnDateField}
            </div>
            {area('reason', 'Lý do mượn')}
            {returned && area('returnCondition', 'Tình trạng khi trả', conditionHint)}
          </>
        )}
        <Field label="Ảnh">
          <ImageGallery images={form.images} editable onChange={(v: ImageRef[]) => set('images', v)} />
        </Field>
      </div>
    </Modal>
  );
}

function LoanBadge({ l, today }: { l: EquipmentLoan; today: string }) {
  if (l.returnDate) return <span className="badge">Đã trả {formatDate(l.returnDate)}</span>;
  return l.dueDate && l.dueDate < today ? <span className="badge danger">Quá hạn</span> : <span className="badge warn">Đang mượn</span>;
}

/** Lịch sử mượn/trả của một thiết bị (mới nhất trước): thêm / sửa / "Đã hoàn trả" / xóa ngay tại chỗ, kèm ảnh từng lần. */
function LoanLog({ item, onChanged }: { item: EquipmentItem; onChanged: (r: EquipmentItem) => void }) {
  const { today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [form, setForm] = useState<{ loan?: EquipmentLoan; mode: LoanMode } | null>(null);
  const open = openLoan(item);
  const remove = async (l: EquipmentLoan) => {
    if (!(await confirm({ title: 'Xóa lần mượn', message: `Xóa lần mượn ngày ${formatDate(l.borrowDate)}${l.siName ? ` (${l.siName})` : ''} cùng ảnh của lần này?`, confirmText: 'Xóa', danger: true })))
      return;
    try {
      onChanged(await api.deleteEquipmentLoan(l.id));
      toast('success', 'Đã xóa lần mượn.');
    } catch (e) {
      toastError(e);
    }
  };
  const field = (k: string, v: React.ReactNode) => (
    <>
      <span className="k">{k}</span>
      <span className="pre">{v || dash}</span>
    </>
  );
  return (
    <div className="loan-log" aria-label="Lịch sử mượn trả">
      <div className="row" style={{ marginBottom: 8 }}>
        <h3 className="card-title grow" style={{ margin: 0, fontSize: 14 }}>
          Lịch sử mượn / trả {item.loans.length ? <span className="badge">{item.loans.length}</span> : null}
        </h3>
        <button
          className="btn sm primary"
          onClick={() => setForm({ mode: 'new' })}
          disabled={!!open}
          title={open ? 'Thiết bị đang được mượn — bấm “Đã hoàn trả” trước khi thêm lần mượn mới.' : undefined}
        >
          <Plus size={14} /> Thêm lần mượn
        </button>
      </div>
      {open && (
        <div className="small loan-hint">
          Đang cho mượn từ {formatDate(open.borrowDate)} — bấm <b>Đã hoàn trả</b> khi thiết bị về kho, sau đó mới thêm được lần mượn mới.
        </div>
      )}
      {item.loans.length === 0 ? (
        <div className="faint small">Chưa có lần mượn nào. Bấm “Thêm lần mượn” để ghi Tên SI, Sale, Ngày mượn, Ngày hẹn trả, lý do và ảnh.</div>
      ) : (
        item.loans.map((l) => (
          <article key={l.id} className={`loan-entry ${l.returnDate ? '' : 'open'}`}>
            <header className="note-entry-head">
              <span className="note-date">Mượn {formatDate(l.borrowDate)}</span>
              <LoanBadge l={l} today={today} />
              <span className="note-tools">
                {!l.returnDate && (
                  <button className="btn sm" onClick={() => setForm({ loan: l, mode: 'return' })} aria-label={`Đã hoàn trả lần mượn ngày ${formatDate(l.borrowDate)}`}>
                    <PackageCheck size={13} /> Đã hoàn trả
                  </button>
                )}
                <button className="btn sm ghost icon" onClick={() => setForm({ loan: l, mode: 'edit' })} aria-label={`Sửa lần mượn ngày ${formatDate(l.borrowDate)}`} title="Sửa">
                  <Pencil size={13} />
                </button>
                <button className="btn sm ghost icon" onClick={() => void remove(l)} aria-label={`Xóa lần mượn ngày ${formatDate(l.borrowDate)}`} title="Xóa">
                  <Trash2 size={13} />
                </button>
              </span>
            </header>
            <div className="info-grid loan-grid">
              {field('Tên SI', l.siName)}
              {field('Sale', l.salespersonName)}
              {field(
                'Ngày hẹn trả',
                l.dueDate ? (
                  <>
                    {formatDate(l.dueDate)}
                    {!l.returnDate && <DueHint due={l.dueDate} today={today} />}
                  </>
                ) : null,
              )}
              {l.returnDate && field('Ngày trả thực tế', formatDate(l.returnDate))}
              {field('Lý do mượn', l.reason)}
              {l.returnDate && field('Tình trạng khi trả', l.returnCondition)}
            </div>
            {l.images.length > 0 && (
              <div className="loan-images" aria-label={`Ảnh lần mượn ngày ${formatDate(l.borrowDate)}`}>
                <ImageGallery images={l.images} />
              </div>
            )}
          </article>
        ))
      )}
      {form && createPortal(<LoanForm item={item} loan={form.loan} mode={form.mode} onClose={() => setForm(null)} onSaved={onChanged} />, document.body)}
    </div>
  );
}

function ConditionValue({ r }: { r: EquipmentItem }) {
  const last = lastReturn(r);
  if (!r.condition) return dash;
  return (
    <span>
      <span className="pre">{r.condition}</span>
      {last && last.returnCondition.trim() === r.condition.trim() && <span className="small faint"> (theo lần trả {formatDate(last.returnDate)})</span>}
    </span>
  );
}

function InfoRows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="info-grid" style={{ gridTemplateColumns: '140px minmax(0, 1fr)' }}>
      {rows.map(([k, v]) => (
        <InfoPair key={k} k={k} v={v} />
      ))}
    </div>
  );
}

function InfoPair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <span className="k">{k}</span>
      <span>{v === null || v === undefined || v === '' ? dash : v}</span>
    </>
  );
}

function mainRows(r: EquipmentItem, today: string): [string, React.ReactNode][] {
  const open = currentLoan(r);
  return [
    ['STT', <b key="stt">{r.stt}</b>],
    ['Tên sp', <b key="name">{r.productName}</b>],
    ['Phân loại', r.categoryName],
    ['Hãng', r.brandName],
    ['Serial number', r.serialNumber],
    ['Mô tả', r.description ? <span key="desc" className="pre">{r.description}</span> : null],
    ['Ngày nhận bàn giao', formatDate(r.handoverDate)],
    ['Trạng thái', <StateBadge key="st" r={r} today={today} />],
    ['Tình trạng', <ConditionValue key="cond" r={r} />],
    ['Ngày mượn hiện tại', formatDate(r.currentBorrowDate)],
    [
      'Ngày hẹn trả hiện tại',
      r.currentDueDate ? (
        <span key="due">
          {formatDate(r.currentDueDate)} {r.currentBorrowDate && <DueHint due={r.currentDueDate} today={today} />}
        </span>
      ) : null,
    ],
    ...(open
      ? ([
          ['Tên SI mượn', open.siName],
          ['Sale mượn', open.salespersonName],
        ] as [string, React.ReactNode][])
      : []),
  ];
}

/** Panel tóm tắt bên phải bảng (cuộn được): thông tin, ảnh và toàn bộ lịch sử mượn/trả (kèm ảnh từng lần). */
function EquipmentDetail({
  r,
  onClose,
  onEdit,
  onView,
  onDuplicate,
  onDelete,
  onChanged,
}: {
  r: EquipmentItem;
  onClose: () => void;
  onEdit: () => void;
  onView: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onChanged: (r: EquipmentItem) => void;
}) {
  const { today } = useAppData();
  return (
    <SidePanel
      title={itemTitle(r)}
      subtitle={[r.categoryName, r.brandName, r.serialNumber && `SN ${r.serialNumber}`].filter(Boolean).join(' · ')}
      label="Thông tin thiết bị"
      onClose={onClose}
      footer={
        <>
          <button className="btn danger left" onClick={onDelete}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn" onClick={onDuplicate} title="Thêm thiết bị cùng loại">
            <Copy size={15} /> Duplicate
          </button>
          <button className="btn" onClick={onView} title="Xem đầy đủ thông tin trên màn hình lớn">
            <Maximize2 size={15} /> View info
          </button>
          <button className="btn primary" onClick={onEdit}>
            <Pencil size={15} /> Edit
          </button>
        </>
      }
    >
      <InfoRows rows={mainRows(r, today)} />
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 14 }}>
        Ảnh ({r.images.length})
      </h3>
      <ImageGallery images={r.images} />
      <div style={{ marginTop: 18 }}>
        <LoanLog item={r} onChanged={onChanged} />
      </div>
      <div className="small faint" style={{ marginTop: 16 }}>
        Tạo {formatDateTime(r.createdAt)} · Cập nhật {formatDateTime(r.updatedAt)}
      </div>
    </SidePanel>
  );
}

/** "View info": toàn bộ thông tin một thiết bị trên màn hình lớn, chuyển thiết bị trước/sau. */
function EquipmentInfoModal({
  r,
  index,
  total,
  onClose,
  onEdit,
  onStep,
  onChanged,
}: {
  r: EquipmentItem;
  index: number;
  total: number;
  onClose: () => void;
  onEdit: () => void;
  onStep: (d: -1 | 1) => void;
  onChanged: (r: EquipmentItem) => void;
}) {
  const { today } = useAppData();
  return (
    <Modal
      size="xl"
      title={
        <span className="row" style={{ gap: 8 }}>
          <Package size={18} style={{ color: 'var(--accent)' }} /> {itemTitle(r)}
        </span>
      }
      onClose={onClose}
      bodyStyle={{ background: 'var(--surface-2)' }}
      footer={(close) => (
        <>
          <div className="left row" style={{ gap: 6 }}>
            <button className="btn sm" disabled={index <= 0} onClick={() => onStep(-1)} aria-label="Thiết bị trước">
              <ChevronLeft size={15} /> Trước
            </button>
            <span className="small muted">{index >= 0 ? `${index + 1}/${total}` : ''}</span>
            <button className="btn sm" disabled={index < 0 || index >= total - 1} onClick={() => onStep(1)} aria-label="Thiết bị sau">
              Sau <ChevronRight size={15} />
            </button>
          </div>
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
        <section className="card card-pad span-2">
          <h3 className="card-title">Thiết bị</h3>
          <InfoRows rows={mainRows(r, today)} />
        </section>
        <section className="card card-pad">
          <h3 className="card-title">Ảnh ({r.images.length})</h3>
          <ImageGallery images={r.images} large />
        </section>
        <section className="card card-pad span-all">
          <LoanLog item={r} onChanged={onChanged} />
          <div className="small faint" style={{ marginTop: 14 }}>
            Tạo {formatDateTime(r.createdAt)} · Cập nhật {formatDateTime(r.updatedAt)}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function EquipmentPage() {
  usePageTitle('Kho thiết bị');
  const { masters, refresh, today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [items, setItems] = useState<EquipmentItem[] | null>(null);
  const thisYear = Number((today || todayISO()).slice(0, 4));
  const [f, setF] = useSessionState<EquipmentFilter>('equipment', {
    q: '',
    categories: [],
    brands: [],
    sis: [],
    state: 'all',
    dateField: 'currentBorrowDate',
    mode: 'all',
    month: Number(today.slice(5, 7)),
    monthYear: thisYear,
    from: null,
    to: null,
  });
  const [sort, setSort] = useLocalState<{ key: SortKey; dir: 'asc' | 'desc' }>('equipment-sort', { key: 'stt', dir: 'desc' });
  const [hidden, setHidden] = useLocalState<string[]>('equipment-hidden-cols', ['loans']);
  const [form, setForm] = useState<{ item?: EquipmentItem; template?: EquipmentItem } | null>(null);
  const location = useLocation();
  const [detailId, setDetailId] = useState<string | null>((location.state as { select?: string } | null)?.select ?? null);
  const [viewId, setViewId] = useState<string | null>(null);
  const tableRef = useTableResize('equipment');

  const load = useCallback(() => {
    api.listEquipment().then(setItems).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);
  useEffect(() => {
    const sel = (location.state as { select?: string } | null)?.select;
    if (sel) setDetailId(sel);
  }, [location.state]);

  const replace = (r: EquipmentItem) => {
    setItems((list) => (list ? (list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [r, ...list]) : [r]));
    void refresh('masters');
  };

  const indexed = useMemo(
    () =>
      (items ?? []).map((r) => ({
        r,
        hay: buildHaystack([
          String(r.stt),
          r.productName,
          r.categoryName,
          r.brandName,
          r.serialNumber,
          r.description,
          r.condition,
          ...r.loans.flatMap((l) => [l.siName, l.salespersonName, l.reason, l.returnCondition]),
        ]),
      })),
    [items],
  );

  const range = resolveDateRange(f.mode, f, today);
  const shown = useMemo(() => {
    const nq = normalizeText(f.q);
    const cats = f.categories ?? [];
    const list = indexed
      .filter(
        ({ r, hay }) =>
          (!cats.length || (r.categoryId && cats.includes(r.categoryId))) &&
          (!f.brands.length || (r.brandId && f.brands.includes(r.brandId))) &&
          (!f.sis.length || r.loans.some((l) => l.siId && f.sis.includes(l.siId))) &&
          (f.state === 'all' || (f.state === 'lent' ? equipmentState(r, today) !== 'in' : equipmentState(r, today) === f.state)) &&
          inRange(r[f.dateField], range.from, range.to) &&
          matchesQuery(nq, hay),
      )
      .map((x) => x.r);
    const sign = sort.dir === 'asc' ? 1 : -1;
    const val = (r: EquipmentItem): string =>
      sort.key === 'brand' ? r.brandName ?? '' : sort.key === 'category' ? r.categoryName ?? '' : sort.key === 'productName' ? r.productName : sort.key === 'stt' ? '' : r[sort.key] ?? '';
    return list.sort((a, b) => {
      if (sort.key === 'stt') return sign * (a.stt - b.stt);
      const va = val(a);
      const vb = val(b);
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      return sign * compareVi(va, vb) || b.stt - a.stt;
    });
  }, [indexed, f, range.from, range.to, sort, today]);

  const shownIds = useMemo(() => shown.map((r) => r.id), [shown]);
  const sel = useSelection(shownIds);
  const counts = useMemo(() => {
    const c = { lent: 0, overdue: 0, in: 0 };
    for (const r of items ?? []) c[equipmentState(r, today)]++;
    return c;
  }, [items, today]);

  const removeSelected = async () => {
    const ids = shownIds.filter((id) => sel.selected.has(id));
    if (!ids.length) return;
    const ok = await confirm({
      title: `Xóa ${ids.length} thiết bị`,
      message: `Xóa ${ids.length} thiết bị đã chọn khỏi Kho? Ảnh và lịch sử mượn/trả của các thiết bị này cũng bị xóa. Không hoàn tác được.`,
      confirmText: `Xóa ${ids.length} thiết bị`,
      danger: true,
    });
    if (!ok) return;
    try {
      const n = await api.deleteEquipments(ids);
      setDetailId(null);
      setViewId(null);
      sel.stop();
      toast('success', `Đã xóa ${n} thiết bị.`);
      load();
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (r: EquipmentItem) => {
    const ok = await confirm({
      title: 'Xóa thiết bị',
      message: (
        <>
          Xóa <b>{itemTitle(r)}</b> khỏi Kho? Ảnh và {r.loans.length} lần mượn/trả của thiết bị cũng bị xóa.
        </>
      ),
      confirmText: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteEquipment(r.id);
      setDetailId(null);
      setViewId(null);
      toast('success', 'Đã xóa thiết bị.');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const detail = items?.find((r) => r.id === detailId) ?? null;
  const viewing = items?.find((r) => r.id === viewId) ?? null;
  const viewIndex = viewing ? shown.findIndex((r) => r.id === viewing.id) : -1;
  const stepView = (d: -1 | 1) => {
    const next = shown[viewIndex + d];
    if (next) {
      setViewId(next.id);
      setDetailId(next.id);
    }
  };

  const activeFilter = !!f.q || (f.categories ?? []).length > 0 || f.brands.length > 0 || f.sis.length > 0 || f.state !== 'all' || f.mode !== 'all';
  const cols = COLUMNS.filter((c) => !hidden.includes(c.key));
  const opts = (kind: MasterKind) => masters[kind].map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }));
  const add = (
    <button className="btn primary" onClick={() => setForm({})}>
      <Plus size={16} /> Thêm thiết bị
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row">
            <Package size={22} style={{ color: 'var(--accent)' }} /> Kho thiết bị
          </h1>
          <div className="muted small">
            {items ? `${items.length} thiết bị · ${counts.lent + counts.overdue} đang cho mượn${counts.overdue ? ` (${counts.overdue} quá hạn)` : ''} · ${counts.in} trong kho` : ' '}
          </div>
        </div>
        <div className="actions">
          <SelectToggleButton sel={sel} disabled={!items?.length} />
          <ColumnToggle columns={COLUMNS} hidden={hidden} onChange={setHidden} />
          {add}
        </div>
      </div>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tìm STT, Tên sp, Phân loại, Hãng, Serial, Mô tả, Tình trạng, SI, Sale, lý do…" width={320} />
        <select className="select" style={{ width: 160 }} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as LoanState })} aria-label="Trạng thái mượn">
          <option value="all">Mọi trạng thái</option>
          <option value="lent">Đang cho mượn</option>
          <option value="overdue">Quá hạn</option>
          <option value="in">Trong kho</option>
        </select>
        <MultiSelect label="Phân loại" options={opts('equipmentCategories')} value={f.categories ?? []} onChange={(categories) => setF({ ...f, categories })} />
        <MultiSelect label="Hãng" options={opts('brands')} value={f.brands} onChange={(brands) => setF({ ...f, brands })} />
        <MultiSelect label="Tên SI đã mượn" options={opts('siPartners')} value={f.sis} onChange={(sis) => setF({ ...f, sis })} />
        <select className="select" style={{ width: 190 }} value={f.dateField} onChange={(e) => setF({ ...f, dateField: e.target.value as DateField })} aria-label="Trường ngày lọc">
          <option value="currentBorrowDate">Theo Ngày mượn hiện tại</option>
          <option value="currentDueDate">Theo Ngày hẹn trả hiện tại</option>
          <option value="handoverDate">Theo Ngày nhận bàn giao</option>
        </select>
        <DateFilterControls mode={f.mode} month={f.month} monthYear={f.monthYear} from={f.from} to={f.to} onChange={(p) => setF({ ...f, ...p })} />
        {activeFilter && (
          <button className="btn ghost sm" onClick={() => setF({ ...f, q: '', categories: [], brands: [], sis: [], state: 'all', mode: 'all', from: null, to: null })}>
            <X size={14} /> Clear Filters
          </button>
        )}
        <span className="small muted">
          {shown.length}/{items?.length ?? 0} thiết bị
          {range.from || range.to ? ` · ${formatDate(range.from) || '…'} → ${formatDate(range.to) || '…'}` : ''}
        </span>
      </div>

      {sel.active && <SelectionBar sel={sel} total={shown.length} noun="thiết bị" onDelete={() => void removeSelected()} />}
      {items === null ? (
        <div className="faint">Đang tải…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Package size={36} />}
            title="Kho thiết bị chưa có thiết bị nào"
            text="Quản lý thiết bị cho SI / Sale mượn: Tên sp, Phân loại, Hãng, Serial, Mô tả, Ngày nhận bàn giao, Tình trạng, ảnh và lịch sử từng lần mượn-trả."
            action={add}
          />
        </div>
      ) : (
        <div className="split">
          <div className="table-wrap">
            <table className="tbl equipment-table" ref={tableRef}>
              <thead>
                <tr>
                  {sel.active && <SelectAllHeader sel={sel} />}
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      data-col={c.key}
                      className={c.sort ? 'sortable' : ''}
                      onClick={() => c.sort && setSort({ key: c.sort, dir: sort.key === c.sort && sort.dir === 'asc' ? 'desc' : 'asc' })}
                      aria-sort={c.sort && sort.key === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="row" style={{ gap: 4 }}>
                        {c.label}
                        {c.sort && sort.key === c.sort && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} className="faint" style={{ textAlign: 'center', padding: 24 }}>
                      Không có thiết bị phù hợp bộ lọc.
                    </td>
                  </tr>
                )}
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    data-row={r.id}
                    className={`clickable ${(sel.active ? sel.selected.has(r.id) : r.id === detailId) ? 'selected' : ''}`}
                    tabIndex={0}
                    aria-selected={sel.active ? sel.selected.has(r.id) : r.id === detailId}
                    aria-label={itemTitle(r)}
                    onClick={() => (sel.active ? sel.toggle(r.id) : setDetailId(r.id))}
                    onDoubleClick={() => !sel.active && setViewId(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && (sel.active ? sel.toggle(r.id) : setDetailId(r.id))}
                  >
                    {sel.active && <SelectCell sel={sel} id={r.id} label={itemTitle(r)} />}
                    {cols.map((c) => (
                      <td key={c.key} className={c.cls}>
                        {c.render(r, today)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail && !sel.active && (
            <EquipmentDetail
              key={detail.id}
              r={detail}
              onClose={() => setDetailId(null)}
              onEdit={() => setForm({ item: detail })}
              onView={() => setViewId(detail.id)}
              onDuplicate={() => setForm({ template: detail })}
              onDelete={() => void remove(detail)}
              onChanged={replace}
            />
          )}
        </div>
      )}

      {viewing && (
        <EquipmentInfoModal
          key={viewing.id}
          r={viewing}
          index={viewIndex}
          total={shown.length}
          onClose={() => setViewId(null)}
          onEdit={() => setForm({ item: viewing })}
          onStep={stepView}
          onChanged={replace}
        />
      )}
      {form && (
        <EquipmentForm
          item={form.item}
          template={form.template}
          onClose={() => setForm(null)}
          onSaved={(r) => {
            replace(r);
            setDetailId(r.id);
          }}
        />
      )}
    </>
  );
}
