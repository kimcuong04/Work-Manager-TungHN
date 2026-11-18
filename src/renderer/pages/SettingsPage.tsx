import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpCircle,
  RefreshCw,
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Moon,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Sun,
  Trash2,
} from 'lucide-react';
import { addDays, formatDate, formatDateTime } from '../../shared/dates';
import { ACTIVE_STATUSES, DEFAULT_THRESHOLDS, computeStatus, describeRules, validateThresholds } from '../../shared/status';
import { nameKey } from '../../shared/text';
import {
  COLORED_MASTER_KINDS,
  JOB_LABEL,
  JOB_TYPES,
  MASTER_LABEL,
  ORDERED_MASTER_KINDS,
  type AppInfo,
  type JobType,
  type MasterGroup,
  type MasterItem,
  type MasterKind,
  type StorageUsage,
  type Theme,
} from '../../shared/types';
import { validateMasterName, validateYearLabel } from '../../shared/validation';
import { api } from '../api';
import { Field, StatusBadge, formatBytes } from '../components/common';
import { DataLocationSection } from '../components/DataLocationSection';
import { Modal } from '../components/Modal';
import { UpdateDialog, useUpdateStatus } from '../components/UpdateNotice';
import { useSessionState } from '../lib/persist';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';

type Tab = 'appearance' | 'rules' | 'master' | 'years' | 'data';
const TABS: { key: Tab; label: string }[] = [
  { key: 'appearance', label: 'Giao diện' },
  { key: 'rules', label: 'Quy tắc trạng thái' },
  { key: 'master', label: 'Danh mục (Master Data)' },
  { key: 'years', label: 'Quản lý năm' },
  { key: 'data', label: 'Dữ liệu & Backup' },
];

function WorkspaceName() {
  const { settings, updateSettings } = useAppData();
  const { toast, toastError } = useUi();
  const [name, setName] = useState(settings.workspaceName);
  useEffect(() => setName(settings.workspaceName), [settings.workspaceName]);
  const changed = name.trim() !== settings.workspaceName;
  const save = async () => {
    try {
      const next = await updateSettings({ workspaceName: name });
      setName(next.workspaceName);
      toast('success', `Đã đổi tên workspace thành "${next.workspaceName}".`);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <form
      className="row"
      style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Tên workspace" htmlFor="ws-name" hint="Hiển thị ở đầu sidebar. Để trống = My Workspace.">
        <input id="ws-name" className="input" style={{ width: 320 }} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <button className="btn primary" type="submit" disabled={!changed} style={{ alignSelf: 'center' }}>
        Lưu tên
      </button>
    </form>
  );
}

function Appearance() {
  const { settings, updateSettings } = useAppData();
  const { toastError } = useUi();
  const card = (theme: Theme, label: string, icon: React.ReactNode, colors: [string, string, string]) => (
    <button className={`theme-card ${settings.theme === theme ? 'on' : ''}`} onClick={() => void updateSettings({ theme }).catch(toastError)} aria-pressed={settings.theme === theme}>
      <div className="theme-preview">
        <div style={{ background: colors[0] }} />
        <div style={{ background: colors[1], padding: 10 }}>
          <div style={{ height: 10, width: '60%', background: colors[2], borderRadius: 4, marginBottom: 8 }} />
          <div style={{ height: 28, background: colors[2], opacity: 0.35, borderRadius: 6 }} />
        </div>
      </div>
      <div className="row" style={{ fontWeight: 600 }}>
        {icon} {label} {settings.theme === theme && <Check size={15} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
      </div>
    </button>
  );
  return (
    <section className="card card-pad">
      <h2 className="card-title">Appearance</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Lựa chọn được lưu và áp dụng cho các lần mở tiếp theo.
      </p>
      <div className="theme-cards">
        {card('light', 'Light Mode', <Sun size={16} />, ['#f1f3ea', '#ffffff', '#5c6b4e'])}
        {card('dark', 'Dark Mode', <Moon size={16} />, ['#17171a', '#111113', '#818cf8'])}
      </div>
      <WorkspaceName />
    </section>
  );
}

function StatusRules() {
  const { settings, updateSettings, today, projects } = useAppData();
  const { toast, toastError } = useUi();
  const [urgent, setUrgent] = useState(String(settings.urgentThresholdDays));
  const [attention, setAttention] = useState(String(settings.attentionThresholdDays));
  const u = Number(urgent);
  const a = Number(attention);
  const error = urgent.trim() === '' || attention.trim() === '' ? 'Nhập đủ hai ngưỡng.' : validateThresholds(u, a);
  const th = { urgent: u, attention: a };
  const changed = u !== settings.urgentThresholdDays || a !== settings.attentionThresholdDays;

  const impact = useMemo(() => {
    if (error) return 0;
    return projects.filter((p) => !p.isCompleted && computeStatus(p, today, th) !== p.status).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, today, u, a, error]);

  const save = async () => {
    try {
      await updateSettings({ urgentThresholdDays: u, attentionThresholdDays: a });
      toast('success', 'Đã lưu ngưỡng. Toàn bộ dự án đang hoạt động đã được phân loại lại.');
    } catch (e) {
      toastError(e);
    }
  };

  const examples = error ? [] : [-1, 0, 1, 2, 3, 4, 5, 6, 7, 10].filter((d, i, arr) => arr.indexOf(d) === i).concat(a + 1 > 10 ? [a, a + 1] : []);
  const rules = error ? null : describeRules(th);

  return (
    <section className="card card-pad">
      <h2 className="card-title">Status Rules</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Trạng thái tính theo số ngày lịch còn lại từ hôm nay đến Ngày tới hạn. Mới tiếp nhận là lớn hơn ngưỡng Cần chú ý.
      </p>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ width: 230 }}>
          <Field label="Ngưỡng Khẩn cấp (ngày)" hint="Còn ít hơn số ngày này → Khẩn cấp">
            <input className={`input ${error ? 'invalid' : ''}`} type="number" min={0} value={urgent} onChange={(e) => setUrgent(e.target.value)} />
          </Field>
        </div>
        <div style={{ width: 230 }}>
          <Field label="Ngưỡng Cần chú ý (ngày)" hint="Từ ngưỡng Khẩn cấp đến số này → Cần chú ý">
            <input className={`input ${error ? 'invalid' : ''}`} type="number" min={0} value={attention} onChange={(e) => setAttention(e.target.value)} />
          </Field>
        </div>
      </div>
      {error && (
        <div className="field-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {rules && (
        <div className="stack" style={{ marginTop: 16, gap: 10 }}>
          <div className="small" style={{ fontWeight: 650 }}>
            Preview quy tắc (hôm nay {formatDate(today)})
          </div>
          <div className="row wrap">
            {ACTIVE_STATUSES.map((s) => (
              <span key={s} className="row small" style={{ marginRight: 14 }}>
                <StatusBadge status={s} /> {rules[s]}
              </span>
            ))}
          </div>
          <div className="table-wrap" style={{ maxWidth: 560 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ngày tới hạn</th>
                  <th>Số ngày còn lại</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((d) => (
                  <tr key={d}>
                    <td>{formatDate(addDays(today, d))}</td>
                    <td>{d < 0 ? `Quá hạn ${-d}` : d}</td>
                    <td>
                      <StatusBadge status={computeStatus({ isCompleted: false, dueDate: addDays(today, d) }, today, th)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changed && <div className="small muted">Sau khi lưu: {impact} dự án đang hoạt động sẽ đổi cột.</div>}
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={!!error || !changed} onClick={save}>
          Lưu ngưỡng
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setUrgent(String(DEFAULT_THRESHOLDS.urgent));
            setAttention(String(DEFAULT_THRESHOLDS.attention));
          }}
        >
          <RotateCcw size={14} /> Mặc định (2 / 5)
        </button>
      </div>
    </section>
  );
}

function DeleteMasterDialog({ kind, item, items, onClose, onDone }: { kind: MasterKind; item: MasterItem; items: MasterItem[]; onClose: () => void; onDone: () => void }) {
  const { toastError } = useUi();
  const nullable = kind !== 'brands';
  const others = items.filter((i) => i.id !== item.id);
  const [mode, setMode] = useState<'replace' | 'unlink'>(others.length ? 'replace' : 'unlink');
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const submit = async () => {
    try {
      await api.deleteMaster(kind, item.id, mode === 'replace' ? { replaceWithId: target } : { unlink: true });
      onDone();
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Modal
      size="sm"
      title={`Xóa ${MASTER_LABEL[kind]} đang được dùng`}
      onClose={onClose}
      footer={(close) => (
        <>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn danger solid" disabled={mode === 'replace' && !target} onClick={submit}>
            Xử lý liên kết &amp; xóa
          </button>
        </>
      )}
    >
      <div className="stack">
        <div>
          <b>“{item.name}”</b> đang được <b>{item.usageCount}</b> dự án sử dụng. Chọn cách xử lý trước khi xóa:
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="radio" checked={mode === 'replace'} disabled={!others.length} onChange={() => setMode('replace')} />
          Gán lại các dự án sang:
        </label>
        <select className="select" disabled={mode !== 'replace'} value={target} onChange={(e) => setTarget(e.target.value)}>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {nullable && (
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'unlink'} onChange={() => setMode('unlink')} />
            Gỡ liên kết (để trống {MASTER_LABEL[kind]} ở các dự án đó)
          </label>
        )}
        {!nullable && !others.length && <div className="field-error">Cần tạo một {MASTER_LABEL[kind]} khác để gán lại trước khi xóa.</div>}
      </div>
    </Modal>
  );
}

function MasterList({ kind }: { kind: MasterKind }) {
  const { masters, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const items = masters[kind];
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<MasterItem | null>(null);
  const dup = newName.trim() ? items.find((i) => nameKey(i.name) === nameKey(newName)) : undefined;
  const reload = () => refresh('masters', 'projects', 'freelance');
  const ordered = ORDERED_MASTER_KINDS.includes(kind);
  const colored = COLORED_MASTER_KINDS.includes(kind);
  const move = async (item: MasterItem, dir: -1 | 1) => {
    try {
      await api.moveMaster(kind, item.id, dir);
      await reload();
    } catch (e) {
      toastError(e);
    }
  };

  const add = async () => {
    const err = validateMasterName(newName);
    if (err) return toast('error', err);
    if (dup) return toast('warn', `"${dup.name}" đã tồn tại.`);
    try {
      await api.createMaster(kind, newName);
      setNewName('');
      await reload();
      toast('success', `Đã thêm ${MASTER_LABEL[kind]}.`);
    } catch (e) {
      toastError(e);
    }
  };
  const rename = async () => {
    if (!editing) return;
    const err = validateMasterName(editing.name);
    if (err) return toast('error', err);
    try {
      await api.renameMaster(kind, editing.id, editing.name);
      setEditing(null);
      await reload();
      toast('success', 'Đã đổi tên. Mọi nơi tham chiếu tự cập nhật theo ID.');
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (item: MasterItem) => {
    if (item.usageCount > 0) {
      if (kind === 'brands') {
        const ok = await confirm({
          title: 'Hãng đang được sử dụng',
          message: `Hãng "${item.name}" đang được ${item.usageCount} dự án / bản ghi Warranty / Experience / Kiến thức tham chiếu nên không thể xóa cứng. Chuyển sang Ngừng dùng (Deactivate) để giữ dữ liệu lịch sử?`,
          confirmText: 'Deactivate',
        });
        if (ok) await toggleActive(item);
        return;
      }
      setDeleting(item);
      return;
    }
    if (!(await confirm({ title: `Xóa ${MASTER_LABEL[kind]}`, message: `Xóa "${item.name}"?`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await api.deleteMaster(kind, item.id, null);
      await reload();
      toast('success', 'Đã xóa.');
    } catch (e) {
      toastError(e);
    }
  };
  const toggleActive = async (item: MasterItem) => {
    try {
      await api.setMasterActive(kind, item.id, !item.isActive);
      await reload();
      toast('success', item.isActive ? `Đã ngừng dùng "${item.name}" (dữ liệu cũ vẫn giữ nguyên).` : `Đã kích hoạt lại "${item.name}".`);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" style={{ maxWidth: 360 }} placeholder={`Tên ${MASTER_LABEL[kind]} mới`} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn primary" type="submit" disabled={!newName.trim()}>
          <Plus size={15} /> Thêm
        </button>
        {dup && <span className="field-warn">“{dup.name}” đã tồn tại</span>}
      </form>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Tên</th>
              <th className="num">Đang dùng</th>
              {kind === 'brands' && <th>Trạng thái</th>}
              {kind === 'salespersons' && <th>Phòng ban</th>}
              {colored && <th>Màu</th>}
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="faint" style={{ textAlign: 'center' }}>
                  Chưa có mục nào.
                </td>
              </tr>
            )}
            {items.map((it, idx) => (
              <tr key={it.id}>
                <td>
                  {editing?.id === it.id ? (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rename();
                      }}
                    >
                      <input autoFocus className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                      <button className="btn sm primary" type="submit">
                        Lưu
                      </button>
                      <button className="btn sm" type="button" onClick={() => setEditing(null)}>
                        Hủy
                      </button>
                    </form>
                  ) : (
                    <span className={it.isActive ? '' : 'faint'}>
                      {colored ? <ColorChip name={it.name} color={it.color ?? null} /> : it.name}
                    </span>
                  )}
                </td>
                <td className="num">{it.usageCount}</td>
                {kind === 'brands' && <td>{it.isActive ? <span className="badge accent">Đang dùng</span> : <span className="badge">Ngừng dùng</span>}</td>}
                {kind === 'salespersons' && (
                  <td>
                    <select
                      className="select"
                      style={{ minWidth: 160, height: 30 }}
                      value={it.departmentId ?? ''}
                      aria-label={`Phòng ban của ${it.name}`}
                      onChange={async (e) => {
                        try {
                          await api.setSalespersonDepartment(it.id, e.target.value || null);
                          await reload();
                        } catch (err) {
                          toastError(err);
                        }
                      }}
                    >
                      <option value="">— Chưa có —</option>
                      {masters.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                {colored && (
                  <td>
                    <MasterColor kind={kind} item={it} onSaved={reload} />
                  </td>
                )}
                <td>
                  <div className="row nowrap" style={{ gap: 2 }}>
                    {ordered && (
                      <>
                        <button className="btn sm icon ghost" disabled={idx === 0} aria-label={`Đưa ${it.name} lên`} title="Lên" onClick={() => void move(it, -1)}>
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="btn sm icon ghost"
                          disabled={idx === items.length - 1}
                          aria-label={`Đưa ${it.name} xuống`}
                          title="Xuống"
                          onClick={() => void move(it, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </>
                    )}
                    <button className="btn sm icon ghost" aria-label="Sửa tên" title="Sửa tên" onClick={() => setEditing({ id: it.id, name: it.name })}>
                      <Pencil size={14} />
                    </button>
                    {kind === 'brands' && (
                      <button className="btn sm icon ghost" aria-label={it.isActive ? 'Deactivate' : 'Activate'} title={it.isActive ? 'Ngừng dùng (Deactivate)' : 'Dùng lại (Activate)'} onClick={() => toggleActive(it)}>
                        {it.isActive ? <PowerOff size={14} /> : <Power size={14} />}
                      </button>
                    )}
                    <button className="btn sm icon ghost" aria-label="Xóa" title="Xóa" onClick={() => remove(it)} style={{ color: 'var(--danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleting && <DeleteMasterDialog kind={kind} item={deleting} items={items} onClose={() => setDeleting(null)} onDone={() => void reload().then(() => toast('success', 'Đã xử lý liên kết và xóa.'))} />}
    </div>
  );
}

const MASTER_TABS: Record<MasterGroup, { kind: MasterKind; label: string }[]> = {
  MAIN: [
    { kind: 'clients', label: 'EU' },
    { kind: 'siPartners', label: 'Tên SI' },
    { kind: 'brands', label: 'Hãng' },
    { kind: 'salespersons', label: 'Sale & Phòng ban' },
  ],
  FREELANCE: [
    { kind: 'freelanceStatuses', label: 'Tình trạng' },
    { kind: 'freelancePaymentStatuses', label: 'Trạng thái thanh toán' },
    { kind: 'freelanceHirers', label: 'Bên thuê' },
  ],
  EQUIPMENT: [{ kind: 'equipmentCategories', label: 'Phân loại' }],
};

const GROUP_LABEL: Record<MasterGroup, string> = { MAIN: JOB_LABEL.MAIN, FREELANCE: JOB_LABEL.FREELANCE, EQUIPMENT: 'Kho thiết bị' };

const MASTER_GROUP_NOTE: Record<MasterGroup, string> = {
  MAIN: 'Danh mục của Job Chính: dự án Pre-sales / Post-sales (EU, Tên SI, Hãng, Sale), Warranty, Experience và Kiến thức. Đổi tên tự cập nhật mọi nơi (liên kết theo ID). Hãng đang được dùng chỉ có thể Deactivate.',
  FREELANCE:
    'Danh mục riêng của Job Freelance (Tình trạng, Trạng thái thanh toán, Bên thuê), không dùng chung với Job Chính dù trùng tên. Tình trạng và Trạng thái thanh toán hiển thị theo thứ tự ở đây (nút lên/xuống) và theo màu bạn chọn.',
  EQUIPMENT: 'Danh mục riêng của Kho thiết bị (Phân loại). Hãng, Tên SI, Sale của Kho thiết bị dùng chung với Job Chính — quản lý ở phân loại Job Chính.',
};

export function ColorChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="color-chip" style={color ? { background: `${color}24`, borderColor: color } : undefined}>
      <span className="dot" style={{ background: color ?? 'var(--border-strong)' }} />
      {name}
    </span>
  );
}

/** Ô chọn màu cho một mục danh mục; lưu sau khi ngừng kéo trong bảng màu một lúc. */
function MasterColor({ kind, item, onSaved }: { kind: MasterKind; item: MasterItem; onSaved: () => Promise<unknown> }) {
  const { toastError } = useUi();
  const [value, setValue] = useState(item.color ?? '#94a3b8');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setValue(item.color ?? '#94a3b8'), [item.color]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const commit = (color: string | null) => {
    window.clearTimeout(timer.current);
    api
      .setMasterColor(kind, item.id, color)
      .then(onSaved)
      .catch(toastError);
  };
  return (
    <div className="row nowrap" style={{ gap: 6 }}>
      <input
        type="color"
        className="color-input"
        value={value}
        aria-label={`Màu của ${item.name}`}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(v), 350);
        }}
      />
      {item.color ? (
        <button className="btn sm ghost" type="button" onClick={() => commit(null)} aria-label={`Bỏ màu của ${item.name}`}>
          Bỏ màu
        </button>
      ) : (
        <span className="small faint">Chưa chọn</span>
      )}
    </div>
  );
}

function MasterData() {
  const [group, setGroup] = useSessionState<MasterGroup>('settings-master-group', 'MAIN');
  const [stored, setKind] = useSessionState<MasterKind>('settings-master-kind', 'clients');
  const tabs = MASTER_TABS[group] ?? MASTER_TABS.MAIN;
  // Tab đã lưu có thể là danh mục đã bỏ (Đơn vị thiết kế, Giai đoạn) hoặc thuộc phân loại khác → về tab đầu.
  const kind: MasterKind = group === 'MAIN' && stored === 'departments' ? 'salespersons' : tabs.some((t) => t.kind === stored) ? stored : tabs[0].kind;
  return (
    <section className="card card-pad">
      <div className="row" style={{ marginBottom: 6, gap: 12 }}>
        <h2 className="card-title grow" style={{ margin: 0 }}>
          Master Data
        </h2>
        <span className="small muted">Phân loại</span>
        <div className="seg" role="group" aria-label="Phân loại danh mục">
          {(['MAIN', 'FREELANCE', 'EQUIPMENT'] as MasterGroup[]).map((g) => (
            <button key={g} className={group === g ? 'on' : ''} aria-pressed={group === g} onClick={() => setGroup(g)}>
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {MASTER_GROUP_NOTE[group] ?? MASTER_GROUP_NOTE.MAIN}
      </p>
      <div className="tabs small">
        {tabs.map((t) => (
          <button key={t.kind} className={kind === t.kind ? 'on' : ''} onClick={() => setKind(t.kind)}>
            {t.label}
          </button>
        ))}
      </div>
      {kind === 'salespersons' ? (
        <div className="sales-dept">
          <div>
            <h3 className="card-title" style={{ fontSize: 14 }}>
              Sale
            </h3>
            <MasterList key="salespersons" kind="salespersons" />
          </div>
          <div>
            <h3 className="card-title" style={{ fontSize: 14 }}>
              Phòng ban
            </h3>
            <MasterList key="departments" kind="departments" />
          </div>
        </div>
      ) : (
        <MasterList key={kind} kind={kind} />
      )}
    </section>
  );
}

function Years() {
  const { years, refresh, today } = useAppData();
  const { prompt, confirm, toast, toastError } = useUi();
  const exists = (job: JobType, v: string, except?: string) => years.some((y) => y.jobType === job && y.id !== except && nameKey(y.yearLabel) === nameKey(v));

  const add = async (job: JobType) => {
    const current = today.slice(0, 4);
    const label = await prompt({
      title: `Thêm năm — ${JOB_LABEL[job]}`,
      label: 'Năm',
      initial: exists(job, current) ? '' : current,
      confirmText: 'Thêm năm',
      validate: (v) => validateYearLabel(v) ?? (exists(job, v) ? 'Năm này đã tồn tại trong Job.' : null),
    });
    if (label === null) return;
    try {
      await api.createYear(job, label);
      await refresh('years');
      toast('success', 'Đã thêm năm kèm 3 nhóm Pre-sales, Post-sales, Warranty.');
    } catch (e) {
      toastError(e);
    }
  };
  const rename = async (id: string, job: JobType, current: string) => {
    const label = await prompt({
      title: 'Đổi tên năm',
      label: 'Tên / nhãn năm',
      initial: current,
      validate: (v) => validateYearLabel(v) ?? (exists(job, v, id) ? 'Năm này đã tồn tại trong Job.' : null),
    });
    if (label === null) return;
    try {
      await api.renameYear(id, label);
      await refresh('years', 'projects');
      toast('success', 'Đã đổi tên năm; Project/Warranty vẫn giữ liên kết.');
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (id: string, label: string) => {
    if (!(await confirm({ title: 'Xóa năm', message: `Xóa năm "${label}"? Chỉ xóa được năm không còn Project/Warranty Record.`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await api.deleteYear(id);
      await refresh('years');
      toast('success', 'Đã xóa năm.');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="detail-grid">
      {JOB_TYPES.map((job) => (
        <section key={job} className="card card-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 className="card-title grow" style={{ margin: 0 }}>
              {JOB_LABEL[job]}
            </h2>
            <button className="btn sm primary" onClick={() => add(job)}>
              <Plus size={14} /> Thêm năm
            </button>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Năm</th>
                  <th className="num">Project</th>
                  <th className="num">Warranty</th>
                  <th style={{ width: 1 }} />
                </tr>
              </thead>
              <tbody>
                {years
                  .filter((y) => y.jobType === job)
                  .map((y) => (
                    <tr key={y.id}>
                      <td style={{ fontWeight: 600 }}>{y.yearLabel}</td>
                      <td className="num">{y.projectCount}</td>
                      <td className="num">{y.warrantyCount}</td>
                      <td>
                        <div className="row nowrap" style={{ gap: 2 }}>
                          <button className="btn sm icon ghost" aria-label="Đổi tên" title="Đổi tên" onClick={() => rename(y.id, job, y.yearLabel)}>
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn sm icon ghost"
                            aria-label="Xóa"
                            title={y.projectCount + y.warrantyCount ? 'Còn dữ liệu, không thể xóa' : 'Xóa'}
                            disabled={y.projectCount + y.warrantyCount > 0}
                            onClick={() => remove(y.id, y.yearLabel)}
                            style={{ color: 'var(--danger)' }}
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
        </section>
      ))}
      <section className="card card-pad">
        <h2 className="card-title">{JOB_LABEL.FREELANCE}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Job Freelance là một bảng chung, không chia theo năm — lọc theo năm của Ngày bắt đầu ngay trong bảng Job Freelance.
        </p>
      </section>
    </div>
  );
}

const UPDATE_TEXT: Record<string, string> = {
  idle: 'Chưa kiểm tra.',
  checking: 'Đang kiểm tra bản mới…',
  'up-to-date': 'Bạn đang dùng bản mới nhất.',
};

function UpdateSection() {
  const { settings, updateSettings } = useAppData();
  const { toastError } = useUi();
  const status = useUpdateStatus();
  const [dialog, setDialog] = useState(false);
  if (!status) return null;
  const s = status.state;
  return (
    <section className="card card-pad">
      <h2 className="card-title">
        <RefreshCw size={17} /> Cập nhật phần mềm
      </h2>
      <div className="info-grid">
        <span className="k">Phiên bản hiện tại</span>
        <span>{status.currentVersion}</span>
        <span className="k">Trạng thái</span>
        <span>
          {s === 'disabled' && <span className="muted">{status.message}</span>}
          {s === 'error' && <span style={{ color: 'var(--danger)' }}>{status.error}</span>}
          {s === 'downloading' && `Đang tải bản ${status.version}… ${status.percent ?? 0}%`}
          {s === 'downloaded' && <b>Bản {status.version} đã tải xong, sẵn sàng cài đặt.</b>}
          {UPDATE_TEXT[s]}
          {status.checkedAt && (s === 'up-to-date' || s === 'error') && <span className="faint small"> · kiểm tra lúc {formatDateTime(status.checkedAt)}</span>}
        </span>
      </div>
      <label className="row small" style={{ marginTop: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => updateSettings({ autoUpdate: e.target.checked }).catch(toastError)} />
        Tự kiểm tra bản mới khi mở ứng dụng và mỗi 4 giờ (chỉ tải thông tin phiên bản từ GitHub, không gửi dữ liệu)
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        {s === 'downloaded' ? (
          <button className="btn primary" onClick={() => setDialog(true)}>
            <ArrowUpCircle size={15} /> Cập nhật lên {status.version}
          </button>
        ) : (
          <button className="btn" disabled={s === 'disabled' || s === 'checking' || s === 'downloading'} onClick={() => api.checkForUpdates().catch(toastError)}>
            <RefreshCw size={15} /> Kiểm tra cập nhật
          </button>
        )}
      </div>
      {dialog && <UpdateDialog status={status} onClose={() => setDialog(false)} />}
    </section>
  );
}

function DataManagement() {
  const { settings, updateSettings } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [quota, setQuota] = useState(String(settings.imageQuotaMb));
  const [xlsxMb, setXlsxMb] = useState(String(settings.xlsxMaxMb));
  const [xlsxRows, setXlsxRows] = useState(String(settings.xlsxMaxRows));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAppInfo().then(setInfo).catch(toastError);
    api.getStorageUsage().then(setUsage).catch(toastError);
  }, [toastError, settings.imageQuotaMb]);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const path = await api.exportBackup();
      if (path) toast('success', `Đã lưu backup:\n${path}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    try {
      const b = await api.pickBackup();
      if (!b) return;
      const ok = await confirm({
        title: 'Khôi phục dữ liệu từ backup?',
        danger: true,
        confirmText: 'Ghi đè & khôi phục',
        message: (
          <div className="stack" style={{ gap: 8 }}>
            <div>
              File: <b>{b.fileName}</b>
              <br />
              Tạo lúc: {formatDateTime(b.createdAt)} (phiên bản {b.appVersion})
              <br />
              Gồm: {b.counts.projects ?? 0} Project · {b.counts.warranty ?? 0} Warranty · {b.counts.experience ?? 0} Experience
              {b.counts.knowledge !== undefined && ` · ${b.counts.knowledge} Kiến thức`}
              {b.counts.calendar !== undefined && ` · ${b.counts.calendar} sự kiện Calendar`}
              {b.counts.freelance !== undefined && ` · ${b.counts.freelance} Job Freelance`}
              {b.counts.equipment !== undefined && ` · ${b.counts.equipment} thiết bị trong Kho`} · {b.counts.images ?? 0} ảnh
            </div>
            <div className="alert warn">
              <AlertTriangle size={16} />
              <div>
                Toàn bộ dữ liệu hiện tại sẽ bị <b>ghi đè</b>. Ứng dụng tự tạo một bản sao lưu dữ liệu hiện tại trong thư mục <code>backups</code> trước khi khôi phục.
              </div>
            </div>
          </div>
        ),
      });
      if (!ok) return;
      setBusy(true);
      await api.restoreBackup(b.path);
      toast('success', 'Khôi phục thành công. Đang tải lại…');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = async () => {
    try {
      await updateSettings({ imageQuotaMb: Number(quota), xlsxMaxMb: Number(xlsxMb), xlsxMaxRows: Number(xlsxRows) });
      toast('success', 'Đã lưu giới hạn.');
    } catch (e) {
      toastError(e);
    }
  };

  const over = usage ? usage.bytes > usage.quotaMb * 1024 * 1024 : false;

  return (
    <div className="stack">
      <UpdateSection />
      <DataLocationSection />
      <section className="card card-pad">
        <h2 className="card-title">Backup &amp; Restore</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          File backup (.zip) gồm database và toàn bộ ảnh do ứng dụng quản lý. Nên sao lưu định kỳ ra ổ khác/USB. Ngoài ra ứng dụng tự giữ bản sao database của 10 lần mở gần nhất và
          trước mỗi lần nâng cấp dữ liệu (thư mục <code>backups</code>). Mật khẩu Warranty được mã hóa theo tài khoản Windows — khôi phục trên máy khác sẽ không xem được mật khẩu cũ.
        </p>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={exportBackup}>
            <Download size={15} /> Xuất backup…
          </button>
          <button className="btn danger" disabled={busy} onClick={restore}>
            <ArchiveRestore size={15} /> Khôi phục từ backup…
          </button>
        </div>
      </section>

      <section className="card card-pad">
        <h2 className="card-title">
          <HardDrive size={17} /> Dung lượng ảnh &amp; giới hạn import
        </h2>
        {usage && (
          <div className={`alert ${over ? 'warn' : 'info'}`} style={{ marginBottom: 14 }}>
            {over ? <AlertTriangle size={16} /> : <HardDrive size={16} />}
            <div>
              Ảnh đang dùng: <b>{formatBytes(usage.bytes)}</b> ({usage.count} ảnh) / ngưỡng cảnh báo {usage.quotaMb} MB.
              {over && ' Đã vượt ngưỡng — cân nhắc xóa bớt ảnh hoặc tăng ngưỡng.'}
            </div>
          </div>
        )}
        <div className="grid-3" style={{ maxWidth: 720 }}>
          <Field label="Ngưỡng cảnh báo ảnh (MB)">
            <input className="input" type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} />
          </Field>
          <Field label="Giới hạn file XLSX (MB)">
            <input className="input" type="number" min={1} value={xlsxMb} onChange={(e) => setXlsxMb(e.target.value)} />
          </Field>
          <Field label="Giới hạn dòng mỗi sheet">
            <input className="input" type="number" min={1} value={xlsxRows} onChange={(e) => setXlsxRows(e.target.value)} />
          </Field>
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={saveLimits}>
          Lưu giới hạn
        </button>
      </section>

      <section className="card card-pad">
        <h2 className="card-title">Thông tin ứng dụng</h2>
        {info && (
          <div className="info-grid">
            <span className="k">Phiên bản</span>
            <span>{info.version}</span>
            <span className="k">Thư mục dữ liệu</span>
            <span className="row">
              <code className="small">{info.dataDir}</code>
              <button className="btn sm" onClick={() => api.openDataFolder().catch(toastError)}>
                <FolderOpen size={13} /> Mở
              </button>
            </span>
            <span className="k">Mã hóa mật khẩu</span>
            <span>{info.encryption === 'os' ? 'Windows DPAPI (safeStorage)' : 'AES-256-GCM (khóa cục bộ)'}</span>
            <span className="k">Quyền riêng tư</span>
            <span>Dữ liệu chỉ lưu trên máy này; Phase 1 không gửi dữ liệu hay file ra ngoài.</span>
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsPage() {
  usePageTitle('Settings');
  const [tab, setTab] = useSessionState<Tab>('settings-tab', 'appearance');
  return (
    <div>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'appearance' && <Appearance />}
      {tab === 'rules' && <StatusRules />}
      {tab === 'master' && <MasterData />}
      {tab === 'years' && <Years />}
      {tab === 'data' && <DataManagement />}
    </div>
  );
}
