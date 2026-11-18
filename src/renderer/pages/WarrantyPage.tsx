import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, FileSpreadsheet, Image as ImageIcon, KeyRound, Maximize2, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { QUICK_RANGE_LABEL, formatDate, formatDateTime, inRange, monthRange, quickRange, todayISO, type QuickRangeKey } from '../../shared/dates';
import { buildHaystack, compareVi, matchesQuery, normalizeText } from '../../shared/text';
import type { ImageRef, JobYear, WarrantyInput, WarrantyRecord } from '../../shared/types';
import { hasErrors, validateWarrantyInput } from '../../shared/validation';
import { api } from '../api';
import { Breadcrumbs, ColumnToggle, DateInput, EmptyState, Field, MultiSelect, SearchInput, SearchableSelect, type Crumb } from '../components/common';
import { ImageGallery } from '../components/ImageGallery';
import { BulkImportWizard } from '../components/BulkImportWizard';
import { SelectAllHeader, SelectCell, SelectToggleButton, SelectionBar, useSelection } from '../components/Selection';
import { Modal, SidePanel } from '../components/Modal';
import { useLocalState, useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';
import { useLocation } from 'react-router';
import { useTableResize } from '../lib/tableResize';

type DateField = 'receivedDate' | 'testedDate';
type DateMode = 'all' | 'month' | 'range' | QuickRangeKey;

interface WarrantyFilter {
  q: string;
  brands: string[];
  sis?: string[];
  dateField: DateField;
  mode: DateMode;
  month: number;
  monthYear: number;
  from: string | null;
  to: string | null;
}

type SortKey = 'stt' | 'receivedDate' | 'testedDate' | 'brand' | 'model' | 'caseNumber';

interface Column {
  key: string;
  label: string;
  sort?: SortKey;
  render: (r: WarrantyRecord) => React.ReactNode;
  cls?: string;
}

const COLUMNS: Column[] = [
  { key: 'stt', label: 'STT', sort: 'stt', render: (r) => <b>{r.stt}</b>, cls: 'num nowrap' },
  { key: 'caseNumber', label: 'Case no', sort: 'caseNumber', render: (r) => r.caseNumber, cls: 'nowrap' },
  { key: 'model', label: 'Model', sort: 'model', render: (r) => r.model, cls: 'nowrap' },
  { key: 'brand', label: 'Hãng', sort: 'brand', render: (r) => r.brandName ?? <span className="faint">—</span>, cls: 'nowrap' },
  { key: 'si', label: 'Tên SI', render: (r) => r.siName ?? <span className="faint">—</span>, cls: 'nowrap' },
  { key: 'ip', label: 'IP', render: (r) => r.ipAddress, cls: 'nowrap' },
  { key: 'user', label: 'User', render: (r) => r.username, cls: 'nowrap' },
  { key: 'pass', label: 'Pass', render: (r) => (r.hasPassword ? <span className="faint">••••••</span> : ''), cls: 'nowrap' },
  { key: 'mac', label: 'MAC', render: (r) => r.macAddress, cls: 'nowrap' },
  { key: 'serial', label: 'Serial number', render: (r) => r.serialNumber, cls: 'nowrap' },
  { key: 'received', label: 'Ngày nhận', sort: 'receivedDate', render: (r) => formatDate(r.receivedDate), cls: 'nowrap' },
  { key: 'tested', label: 'Ngày test', sort: 'testedDate', render: (r) => formatDate(r.testedDate), cls: 'nowrap' },
  { key: 'customerReport', label: 'Khách hàng báo', render: (r) => <div>{r.customerReport}</div>, cls: 'clamp' },
  { key: 'inspection', label: 'Kiểm tra', render: (r) => <div>{r.inspection}</div>, cls: 'clamp' },
  { key: 'result', label: 'Kết quả', render: (r) => <div>{r.result}</div>, cls: 'clamp' },
  { key: 'resolution', label: 'Xử lý', render: (r) => <div>{r.resolution}</div>, cls: 'clamp' },
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

export function resolveDateRange(mode: DateMode, f: { month: number; monthYear: number; from: string | null; to: string | null }, today: string) {
  if (mode === 'all') return { from: null, to: null };
  if (mode === 'month') return monthRange(f.monthYear, f.month);
  if (mode === 'range') return { from: f.from, to: f.to };
  return quickRange(mode, today);
}

export function DateFilterControls({
  mode,
  month,
  monthYear,
  from,
  to,
  onChange,
}: {
  mode: DateMode;
  month: number;
  monthYear: number;
  from: string | null;
  to: string | null;
  onChange: (patch: Partial<{ mode: DateMode; month: number; monthYear: number; from: string | null; to: string | null }>) => void;
}) {
  const thisYear = Number(todayISO().slice(0, 4));
  return (
    <>
      <select className="select" style={{ width: 170 }} value={mode} onChange={(e) => onChange({ mode: e.target.value as DateMode })} aria-label="Khoảng thời gian">
        <option value="all">Mọi thời gian</option>
        {(Object.keys(QUICK_RANGE_LABEL) as QuickRangeKey[]).map((k) => (
          <option key={k} value={k}>
            {QUICK_RANGE_LABEL[k]}
          </option>
        ))}
        <option value="month">Theo tháng/năm…</option>
        <option value="range">Tùy chọn khoảng ngày…</option>
      </select>
      {mode === 'month' && (
        <>
          <select className="select" style={{ width: 110 }} value={month} onChange={(e) => onChange({ month: Number(e.target.value) })} aria-label="Tháng">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Tháng {i + 1}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            value={monthYear}
            min={2000}
            max={thisYear + 5}
            onChange={(e) => onChange({ monthYear: Number(e.target.value) || thisYear })}
            aria-label="Năm"
          />
        </>
      )}
      {mode === 'range' && (
        <>
          <div style={{ width: 150 }}>
            <DateInput value={from} onChange={(v) => onChange({ from: v })} placeholder="Từ ngày" clearable />
          </div>
          <div style={{ width: 150 }}>
            <DateInput value={to} onChange={(v) => onChange({ to: v })} placeholder="Đến ngày" clearable />
          </div>
        </>
      )}
    </>
  );
}

function emptyInput(yearId: string): WarrantyInput {
  return {
    jobYearId: yearId,
    model: '',
    brandId: null,
    siId: null,
    ipAddress: '',
    username: '',
    password: '',
    macAddress: '',
    serialNumber: '',
    receivedDate: todayISO(),
    testedDate: null,
    customerReport: '',
    inspection: '',
    result: '',
    resolution: '',
    caseNumber: '',
    images: [],
  };
}

function toInput(r: WarrantyRecord): WarrantyInput {
  return {
    stt: r.stt,
    jobYearId: r.jobYearId,
    model: r.model,
    brandId: r.brandId,
    siId: r.siId,
    ipAddress: r.ipAddress,
    username: r.username,
    password: undefined,
    macAddress: r.macAddress,
    serialNumber: r.serialNumber,
    receivedDate: r.receivedDate,
    testedDate: r.testedDate,
    customerReport: r.customerReport,
    inspection: r.inspection,
    result: r.result,
    resolution: r.resolution,
    caseNumber: r.caseNumber,
    images: r.images,
  };
}

export function useBrandOptions() {
  const { masters, refresh } = useAppData();
  const { toast, toastError } = useUi();
  const options = masters.brands.map((b) => ({ id: b.id, name: b.name, inactive: !b.isActive }));
  const create = async (name: string) => {
    try {
      const b = await api.createMaster('brands', name);
      await refresh('masters');
      toast('success', `Đã thêm Hãng "${b.name}" vào danh mục dùng chung.`);
      return b.id;
    } catch (e) {
      toastError(e);
      return null;
    }
  };
  return { options, create };
}

/** Duplicate: chép mọi thông tin của bản gốc (trừ ảnh), STT lấy số tiếp theo, mật khẩu dùng lại của bản gốc nếu có. */
function duplicateInput(r: WarrantyRecord): WarrantyInput {
  return { ...toInput(r), stt: undefined, images: [], password: undefined, copyPasswordFrom: r.hasPassword ? r.id : undefined };
}

function WarrantyForm({
  year,
  record,
  template,
  onClose,
  onSaved,
}: {
  year: JobYear;
  record?: WarrantyRecord;
  template?: WarrantyRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { confirm, toast, toastError } = useUi();
  const brands = useBrandOptions();
  const { masters, refresh } = useAppData();
  const siOptions = masters.siPartners.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }));
  const createSi = async (name: string) => {
    try {
      const si = await api.createMaster('siPartners', name);
      await refresh('masters');
      toast('success', `Đã thêm SI "${si.name}".`);
      return si.id;
    } catch (e) {
      toastError(e);
      return null;
    }
  };
  const [initial, setInitial] = useState(() => (record ? toInput(record) : template ? duplicateInput(template) : emptyInput(year.id)));
  const [form, setForm] = useState<WarrantyInput>(initial);
  const keepsPassword = record ? record.hasPassword : !!template?.hasPassword;
  // Bản ghi mới / Duplicate: gợi ý STT tiếp theo trong năm (sửa được).
  useEffect(() => {
    if (record) return;
    api
      .nextWarrantyStt(year.id)
      .then((stt) => {
        setInitial((i) => ({ ...i, stt }));
        setForm((f) => ({ ...f, stt: f.stt ?? stt }));
      })
      .catch(toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showPwd, setShowPwd] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateWarrantyInput(form);
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof WarrantyInput>(k: K, v: WarrantyInput[K]) => setForm((f) => ({ ...f, [k]: v }));
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
      if (record) await api.updateWarranty(record.id, form);
      else await api.createWarranty(form);
      toast('success', record ? 'Đã cập nhật Warranty Record.' : 'Đã tạo Warranty Record.');
      onSaved();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const text = (k: 'model' | 'ipAddress' | 'username' | 'macAddress' | 'serialNumber' | 'caseNumber', label: string, placeholder?: string) => (
    <Field label={label} error={err(k)}>
      <input className={`input ${err(k) ? 'invalid' : ''}`} value={form[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const area = (k: 'customerReport' | 'inspection' | 'result' | 'resolution', label: string) => (
    <Field label={label} error={err(k)}>
      <textarea className="textarea" rows={3} value={form[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <Modal
      size="lg"
      title={record ? 'Sửa Warranty Record' : template ? `Duplicate Warranty Record — ${year.yearLabel}` : `Thêm Warranty Record — ${year.yearLabel}`}
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
              Bản sao của <b>{recordTitle(template)}</b> — đã chép đủ thông tin (trừ ảnh). Sửa những gì cần rồi bấm Lưu.
            </div>
          </div>
        )}
        <section className="form-section">
          <h3>Thông tin chung</h3>
          <div className="grid-3" style={{ gridTemplateColumns: '140px 1fr' }}>
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
            {text('caseNumber', 'Case no', 'Nhập tự do, vd RMA-2026-001')}
          </div>
        </section>
        <section className="form-section">
          <h3>Thiết bị</h3>
          <div className="grid-2">
            {text('model', 'Model', 'Tên/mã model thiết bị')}
            <Field label="Hãng">
              <SearchableSelect options={brands.options} value={form.brandId} onChange={(v) => set('brandId', v)} onCreate={brands.create} createLabel="Thêm Hãng" placeholder="Chọn hoặc thêm Hãng" />
            </Field>
            <Field label="Tên SI">
              <SearchableSelect options={siOptions} value={form.siId ?? null} onChange={(v) => set('siId', v)} onCreate={createSi} createLabel="Thêm SI" placeholder="Không bắt buộc" />
            </Field>
            {text('serialNumber', 'Serial number')}
            {text('macAddress', 'MAC', 'AA:BB:CC:DD:EE:FF')}
          </div>
        </section>
        <section className="form-section">
          <h3>Truy cập thiết bị</h3>
          <div className="grid-3">
            {text('ipAddress', 'IP', 'IPv4 / IPv6')}
            {text('username', 'User')}
            <Field label="Pass" error={err('password')} hint="Được mã hóa khi lưu, che mặc định.">
              {(record || keepsPassword) && form.password === undefined ? (
                <div className="row">
                  <span className="muted small grow">{keepsPassword ? (record ? '•••••••• (đã lưu)' : '•••••••• (dùng lại của bản gốc)') : 'Chưa có'}</span>
                  <button type="button" className="btn sm" onClick={() => set('password', '')}>
                    <KeyRound size={13} /> {keepsPassword ? 'Đổi' : 'Đặt'}
                  </button>
                </div>
              ) : (
                <div className="combo-input">
                  <input
                    className="input"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={form.password ?? ''}
                    placeholder={record?.hasPassword ? 'Để trống = xóa mật khẩu' : ''}
                    onChange={(e) => set('password', e.target.value)}
                  />
                  <div className="combo-icons">
                    {(record || keepsPassword) && (
                      <button type="button" title="Giữ mật khẩu cũ" aria-label="Giữ mật khẩu cũ" onClick={() => set('password', undefined)}>
                        <X size={14} />
                      </button>
                    )}
                    <button type="button" aria-label={showPwd ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShowPwd((s) => !s)}>
                      {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              )}
            </Field>
          </div>
        </section>
        <section className="form-section">
          <h3>Thời gian</h3>
          <div className="grid-3">
            <Field label="Ngày nhận" error={err('receivedDate')}>
              <DateInput value={form.receivedDate} onChange={(v) => set('receivedDate', v)} clearable />
            </Field>
            <Field label="Ngày test" error={err('testedDate')}>
              <DateInput value={form.testedDate} onChange={(v) => set('testedDate', v)} clearable />
            </Field>
          </div>
        </section>
        <section className="form-section">
          <h3>Nội dung xử lý</h3>
          <div className="grid-2">
            {area('customerReport', 'Khách hàng báo')}
            {area('inspection', 'Kiểm tra')}
            {area('result', 'Kết quả')}
            {area('resolution', 'Xử lý')}
          </div>
        </section>
        <section className="form-section">
          <h3>Ảnh</h3>
          <ImageGallery images={form.images} editable onChange={(v: ImageRef[]) => set('images', v)} />
        </section>
      </div>
    </Modal>
  );
}

function PasswordReveal({ id }: { id: string }) {
  const [value, setValue] = useState<string | null>(null);
  const { toast, toastError } = useUi();
  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setValue(null), 20_000);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className="row">
      <code>{value ?? '••••••••'}</code>
      <button
        className="btn sm icon"
        aria-label={value === null ? 'Hiện mật khẩu' : 'Ẩn mật khẩu'}
        title={value === null ? 'Hiện mật khẩu (tự ẩn sau 20 giây)' : 'Ẩn'}
        onClick={async () => {
          if (value !== null) return setValue(null);
          try {
            setValue(await api.revealWarrantyPassword(id));
          } catch (e) {
            toastError(e);
          }
        }}
      >
        {value === null ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      {value !== null && (
        <button
          className="btn sm icon"
          aria-label="Sao chép mật khẩu"
          title="Sao chép"
          onClick={() => navigator.clipboard.writeText(value).then(() => toast('info', 'Đã sao chép mật khẩu.'))}
        >
          <Copy size={14} />
        </button>
      )}
    </span>
  );
}

function InfoRow({ k, v, id, hasPassword }: { k: string; v: React.ReactNode; id: string; hasPassword: boolean }) {
  if (k === 'Pass')
    return (
      <>
        <span className="k">Pass</span>
        <span>{hasPassword ? <PasswordReveal id={id} /> : <span className="faint">—</span>}</span>
      </>
    );
  return (
    <>
      <span className="k">{k}</span>
      <span className="pre">{v || <span className="faint">—</span>}</span>
    </>
  );
}

function InfoRows({ r, rows }: { r: WarrantyRecord; rows: [string, React.ReactNode][] }) {
  return (
    <div className="info-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
      {rows.map(([k, v]) => (
        <InfoRow key={k} k={k} v={v} id={r.id} hasPassword={r.hasPassword} />
      ))}
    </div>
  );
}

const recordTitle = (r: WarrantyRecord) => `${r.stt}. ${r.model || 'Warranty'}${r.caseNumber ? ` · ${r.caseNumber}` : ''}`;

/** Panel tóm tắt bên phải bảng: chọn dòng khác trong bảng thì panel đổi theo. */
function WarrantyDetail({
  r,
  onClose,
  onEdit,
  onView,
  onDuplicate,
  onDelete,
}: {
  r: WarrantyRecord;
  onClose: () => void;
  onEdit: () => void;
  onView: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <SidePanel
      title={recordTitle(r)}
      subtitle={[r.brandName, r.receivedDate && `Nhận ${formatDate(r.receivedDate)}`].filter(Boolean).join(' · ')}
      label="Thông tin Warranty"
      onClose={onClose}
      footer={
        <>
          <button className="btn danger left" onClick={onDelete}>
            <Trash2 size={15} /> Xóa
          </button>
          <button className="btn" onClick={onDuplicate} title="Tạo bản ghi mới chép từ bản ghi này">
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
      <InfoRows
        r={r}
        rows={[
          ['STT', r.stt],
          ['Case no', r.caseNumber],
          ['Model', r.model],
          ['Hãng', r.brandName],
          ['Tên SI', r.siName],
          ['Serial number', r.serialNumber],
          ['MAC', r.macAddress],
          ['IP', r.ipAddress],
          ['User', r.username],
          ['Pass', null],
          ['Ngày nhận', formatDate(r.receivedDate)],
          ['Ngày test', formatDate(r.testedDate)],
          ['Khách hàng báo', r.customerReport],
          ['Kiểm tra', r.inspection],
          ['Kết quả', r.result],
          ['Xử lý', r.resolution],
        ]}
      />
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

/** "View info": toàn bộ thông tin một bản ghi trên màn hình lớn, vẫn Edit được và chuyển bản trước/sau. */
function WarrantyInfoModal({
  r,
  index,
  total,
  onClose,
  onEdit,
  onStep,
}: {
  r: WarrantyRecord;
  index: number;
  total: number;
  onClose: () => void;
  onEdit: () => void;
  onStep: (d: -1 | 1) => void;
}) {
  const block = (label: string, text: string) => (
    <div className="info-block">
      <div className="info-block-label">{label}</div>
      <div className="pre">{text || <span className="faint">—</span>}</div>
    </div>
  );
  return (
    <Modal
      size="xl"
      title={
        <span className="row" style={{ gap: 8 }}>
          <ShieldCheck size={18} style={{ color: 'var(--accent)' }} /> {recordTitle(r)}
        </span>
      }
      onClose={onClose}
      bodyStyle={{ background: 'var(--surface-2)' }}
      footer={(close) => (
        <>
          <div className="left row" style={{ gap: 6 }}>
            <button className="btn sm" disabled={index <= 0} onClick={() => onStep(-1)} aria-label="Bản ghi trước">
              <ChevronLeft size={15} /> Trước
            </button>
            <span className="small muted">{index >= 0 ? `${index + 1}/${total}` : ''}</span>
            <button className="btn sm" disabled={index < 0 || index >= total - 1} onClick={() => onStep(1)} aria-label="Bản ghi sau">
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
        <section className="card card-pad">
          <h3 className="card-title">Thiết bị</h3>
          <InfoRows r={r} rows={[['Model', r.model], ['Hãng', r.brandName], ['Tên SI', r.siName], ['Serial number', r.serialNumber], ['MAC', r.macAddress]]} />
        </section>
        <section className="card card-pad">
          <h3 className="card-title">Truy cập thiết bị</h3>
          <InfoRows r={r} rows={[['IP', r.ipAddress], ['User', r.username], ['Pass', null]]} />
        </section>
        <section className="card card-pad">
          <h3 className="card-title">Thời gian &amp; case</h3>
          <InfoRows
            r={r}
            rows={[
              ['Ngày nhận', formatDate(r.receivedDate)],
              ['Ngày test', formatDate(r.testedDate)],
              ['STT', r.stt],
              ['Case no', r.caseNumber],
              ['Năm', r.yearLabel],
            ]}
          />
        </section>
        <section className="card card-pad span-all">
          <h3 className="card-title">Nội dung xử lý</h3>
          <div className="info-blocks">
            {block('Khách hàng báo', r.customerReport)}
            {block('Kiểm tra', r.inspection)}
            {block('Kết quả', r.result)}
            {block('Xử lý', r.resolution)}
          </div>
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

export function WarrantyPage({ year, crumbs }: { year: JobYear; crumbs: Crumb[] }) {
  const tableRef = useTableResize('warranty');
  usePageTitle(`Warranty ${year.yearLabel}`);
  const { masters, refresh, today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [records, setRecords] = useState<WarrantyRecord[] | null>(null);
  const thisMonth = Number(today.slice(5, 7));
  const thisYear = Number(today.slice(0, 4));
  const [f, setF] = useSessionState<WarrantyFilter>(`warranty:${year.id}`, {
    q: '',
    brands: [],
    dateField: 'receivedDate',
    mode: 'all',
    month: thisMonth,
    monthYear: thisYear,
    from: null,
    to: null,
  });
  const [sort, setSort] = useLocalState<{ key: SortKey; dir: 'asc' | 'desc' }>('warranty-sort', { key: 'receivedDate', dir: 'desc' });
  const [hidden, setHidden] = useLocalState<string[]>('warranty-hidden-cols', []);
  const [form, setForm] = useState<{ record?: WarrantyRecord; template?: WarrantyRecord } | null>(null);
  const location = useLocation();
  const [detailId, setDetailId] = useState<string | null>((location.state as { select?: string } | null)?.select ?? null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const usedStt = useMemo(() => new Set((records ?? []).map((r) => r.stt)), [records]);

  const load = useCallback(() => {
    api.listWarranty(year.id).then(setRecords).catch(toastError);
  }, [year.id, toastError]);
  useEffect(load, [load]);

  const afterChange = () => {
    load();
    void refresh('years', 'masters');
  };

  const indexed = useMemo(
    () =>
      (records ?? []).map((r) => ({
        r,
        hay: buildHaystack([r.model, r.brandName, r.siName, r.ipAddress, r.macAddress, r.serialNumber, r.caseNumber, r.customerReport, r.inspection, r.result, r.resolution]),
      })),
    [records],
  );

  const range = resolveDateRange(f.mode, f, today);
  const shown = useMemo(() => {
    const nq = normalizeText(f.q);
    const list = indexed
      .filter(
        ({ r, hay }) =>
          (!f.brands.length || (r.brandId && f.brands.includes(r.brandId))) && (!f.sis?.length || (r.siId && f.sis.includes(r.siId))) && inRange(r[f.dateField], range.from, range.to) && matchesQuery(nq, hay))
      .map((x) => x.r);
    const sign = sort.dir === 'asc' ? 1 : -1;
    const val = (r: WarrantyRecord): string =>
      sort.key === 'brand' ? r.brandName ?? '' : sort.key === 'receivedDate' ? r.receivedDate ?? '' : sort.key === 'testedDate' ? r.testedDate ?? '' : sort.key === 'stt' ? '' : r[sort.key];
    return list.sort((a, b) => {
      if (sort.key === 'stt') return sign * (a.stt - b.stt);
      const va = val(a);
      const vb = val(b);
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      return sign * compareVi(va, vb);
    });
  }, [indexed, f, range.from, range.to, sort]);

  const shownIds = useMemo(() => shown.map((r) => r.id), [shown]);
  const sel = useSelection(shownIds);
  const removeSelected = async () => {
    const ids = shownIds.filter((id) => sel.selected.has(id));
    if (!ids.length) return;
    const ok = await confirm({
      title: `Xóa ${ids.length} Warranty Record`,
      message: `Xóa ${ids.length} bản ghi đã chọn? Ảnh đính kèm của các bản ghi này cũng bị xóa. Không hoàn tác được.`,
      confirmText: `Xóa ${ids.length} bản ghi`,
      danger: true,
    });
    if (!ok) return;
    try {
      const n = await api.deleteWarranties(ids);
      setDetailId(null);
      setViewId(null);
      sel.stop();
      toast('success', `Đã xóa ${n} Warranty Record.`);
      afterChange();
    } catch (e) {
      toastError(e);
    }
  };
  const detail = records?.find((r) => r.id === detailId) ?? null;
  const viewing = records?.find((r) => r.id === viewId) ?? null;
  const viewIndex = viewing ? shown.findIndex((r) => r.id === viewing.id) : -1;
  const stepView = (d: -1 | 1) => {
    const next = shown[viewIndex + d];
    if (next) {
      setViewId(next.id);
      setDetailId(next.id);
    }
  };
  const remove = async (r: WarrantyRecord) => {
    const ok = await confirm({
      title: 'Xóa Warranty Record',
      message: (
        <>
          Xóa bản ghi <b>Model: {r.model || '—'}</b> · <b>Case no: {r.caseNumber || '—'}</b>? Ảnh đính kèm cũng bị xóa.
        </>
      ),
      confirmText: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteWarranty(r.id);
      setDetailId(null);
      setViewId(null);
      toast('success', 'Đã xóa Warranty Record.');
      afterChange();
    } catch (e) {
      toastError(e);
    }
  };

  const activeFilter = !!f.q || f.brands.length > 0 || (f.sis?.length ?? 0) > 0 || f.mode !== 'all';
  const cols = COLUMNS.filter((c) => !hidden.includes(c.key));
  const brandOpts = masters.brands.map((b) => ({ id: b.id, name: b.name, inactive: !b.isActive }));

  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={crumbs} />
          <h1 className="row">
            <ShieldCheck size={22} style={{ color: 'var(--accent)' }} /> Warranty · {year.yearLabel}
          </h1>
        </div>
        <div className="actions">
          <SelectToggleButton sel={sel} disabled={!records?.length} />
          <ColumnToggle columns={COLUMNS} hidden={hidden} onChange={setHidden} />
          <button className="btn" onClick={() => setImporting(true)}>
            <FileSpreadsheet size={15} /> Import xlsx
          </button>
          <button className="btn primary" onClick={() => setForm({})}>
            <Plus size={16} /> Add Record
          </button>
        </div>
      </div>
      <div className="toolbar">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tìm Model, Hãng, IP, MAC, Serial, Case no, nội dung…" width={320} />
        <MultiSelect label="Hãng" options={brandOpts} value={f.brands} onChange={(brands) => setF({ ...f, brands })} />
        <MultiSelect label="Tên SI" options={masters.siPartners.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }))} value={f.sis ?? []} onChange={(sis) => setF({ ...f, sis })} />
        <select className="select" style={{ width: 150 }} value={f.dateField} onChange={(e) => setF({ ...f, dateField: e.target.value as DateField })} aria-label="Trường ngày lọc">
          <option value="receivedDate">Theo Ngày nhận</option>
          <option value="testedDate">Theo Ngày test</option>
        </select>
        <DateFilterControls mode={f.mode} month={f.month} monthYear={f.monthYear} from={f.from} to={f.to} onChange={(p) => setF({ ...f, ...p })} />
        {activeFilter && (
          <button className="btn ghost sm" onClick={() => setF({ ...f, q: '', brands: [], sis: [], mode: 'all', from: null, to: null })}>
            <X size={14} /> Clear Filters
          </button>
        )}
        <span className="small muted">
          {shown.length}/{records?.length ?? 0} bản ghi
          {range.from || range.to ? ` · ${formatDate(range.from) || '…'} → ${formatDate(range.to) || '…'}` : ''}
        </span>
      </div>

      {sel.active && <SelectionBar sel={sel} total={shown.length} noun="bản ghi" onDelete={() => void removeSelected()} />}
      {records === null ? (
        <div className="faint">Đang tải…</div>
      ) : records.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ShieldCheck size={36} />}
            title={`Chưa có Warranty Record trong ${year.yearLabel}`}
            text="Ghi nhận case bảo hành/kiểm tra thiết bị với đầy đủ Model, Hãng, IP, Serial, kết quả xử lý và ảnh."
            action={
              <button className="btn primary" onClick={() => setForm({})}>
                <Plus size={16} /> Add Record
              </button>
            }
          />
        </div>
      ) : (
        <div className="split">
        <div className="table-wrap">
          <table className="tbl" ref={tableRef}>
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
                    Không có bản ghi phù hợp bộ lọc.
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
                  onClick={() => (sel.active ? sel.toggle(r.id) : setDetailId(r.id))}
                  onDoubleClick={() => !sel.active && setViewId(r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && (sel.active ? sel.toggle(r.id) : setDetailId(r.id))}
                >
                  {sel.active && <SelectCell sel={sel} id={r.id} label={r.caseNumber || r.model || 'bản ghi'} />}
                  {cols.map((c) => (
                    <td key={c.key} className={c.cls}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail && !sel.active && (
          <WarrantyDetail
            key={detail.id}
            r={detail}
            onClose={() => setDetailId(null)}
            onEdit={() => setForm({ record: detail })}
            onView={() => setViewId(detail.id)}
            onDuplicate={() => setForm({ template: detail })}
            onDelete={() => void remove(detail)}
          />
        )}
        </div>
      )}

      {viewing && (
        <WarrantyInfoModal
          key={viewing.id}
          r={viewing}
          index={viewIndex}
          total={shown.length}
          onClose={() => setViewId(null)}
          onEdit={() => setForm({ record: viewing })}
          onStep={stepView}
        />
      )}
      {form && <WarrantyForm year={year} record={form.record} template={form.template} onClose={() => setForm(null)} onSaved={afterChange} />}
      {importing && (
        <BulkImportWizard target="WARRANTY" jobYearId={year.id} scopeLabel={`Warranty ${year.yearLabel}`} usedStt={usedStt} onClose={() => setImporting(false)} onDone={afterChange} />
      )}
    </>
  );
}
