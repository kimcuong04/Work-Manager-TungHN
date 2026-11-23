import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, ListFilter, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { formatDate, parseDisplayDate } from '../../shared/dates';
import { STATUS_LABEL } from '../../shared/status';
import { compareVi, nameKey, normalizeText } from '../../shared/text';
import type { DeadlineStatus } from '../../shared/types';

/** `also`: phần tử nằm ngoài `ref` trong DOM nhưng vẫn tính là "bên trong" (ví dụ popover render qua portal). */
export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active = true, also?: React.RefObject<HTMLElement | null>) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (also?.current?.contains(t)) return;
      if (ref.current && !ref.current.contains(t)) cb.current();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, active, also]);
}

/**
 * Danh sách thả xuống gắn vào document.body (position: fixed) nên không bị khung modal / form cắt mất.
 * Cao tối đa `rows` dòng (cuộn được), tự lật lên trên khi phía dưới không đủ chỗ, bám theo ô nhập khi cuộn/đổi kích thước.
 */
export function FloatingPopover({
  anchor,
  popRef,
  rows = 5,
  minWidth = 260,
  className = '',
  children,
  ...rest
}: {
  anchor: React.RefObject<HTMLElement | null>;
  popRef: React.RefObject<HTMLDivElement>;
  rows?: number;
  minWidth?: number;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'style'>) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const update = () => {
      const a = anchor.current;
      const p = popRef.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(p);
      const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const rowH = p.querySelector<HTMLElement>('.opt')?.getBoundingClientRect().height || 34;
      const want = rowH * rows + chrome;
      const need = Math.min(want, p.scrollHeight);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < need && above > below;
      const width = Math.max(r.width, minWidth);
      setStyle({
        position: 'fixed',
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(rowH + chrome, Math.min(want, up ? above : below)),
        ...(up ? { top: 'auto', bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4, bottom: 'auto' }),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    if (anchor.current) ro.observe(anchor.current);
    if (popRef.current) ro.observe(popRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, popRef, rows, minWidth]);
  return createPortal(
    <div ref={popRef} className={`popover floating ${className}`} style={style} {...rest}>
      {children}
    </div>,
    document.body,
  );
}

export function StatusBadge({ status }: { status: DeadlineStatus }) {
  return <span className={`badge status st-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Mức ưu tiên: 1 thấp nhất … 5 cao nhất (từ v1.14; dữ liệu cũ đã được đảo khi nâng cấp). */
export const PRIO_HINT = ['', 'Thấp nhất', 'Thấp', 'Trung bình', 'Cao', 'Cao nhất'];

export function PriorityBadge({ value }: { value: number }) {
  return (
    <span className={`badge prio p${value}`} title={`Priority Point ${value}: ${PRIO_HINT[value] ?? ''} (5 là cao nhất, 1 thấp nhất)`}>
      P{value}
    </span>
  );
}

export function PriorityPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="prio-picker" role="radiogroup" aria-label="Priority Point">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button"
            key={n}
            role="radio"
            aria-checked={value === n}
            className={`p${n} ${value === n ? 'on' : ''}`}
            title={PRIO_HINT[n]}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="field-hint" style={{ marginTop: 4 }}>
        {value}: {PRIO_HINT[value]} — 5 là ưu tiên cao nhất, 1 thấp nhất
      </div>
    </div>
  );
}

export function Field({
  label,
  required,
  error,
  hint,
  warn,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  warn?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : warn ? <div className="field-warn">{warn}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

/** Ô ngày hiển thị dd/mm/yyyy (không phụ thuộc locale hệ điều hành), có nút mở date picker. */
export function DateInput({
  value,
  onChange,
  onBlur,
  invalid,
  id,
  placeholder = 'dd/mm/yyyy',
  clearable,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  onBlur?: () => void;
  invalid?: boolean;
  id?: string;
  placeholder?: string;
  clearable?: boolean;
}) {
  const [text, setText] = useState(formatDate(value));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(formatDate(value));
    setBad(false);
  }, [value]);
  const commit = () => {
    if (!text.trim()) {
      setBad(false);
      if (value !== null) onChange(null);
    } else {
      const iso = parseDisplayDate(text);
      if (iso) {
        setBad(false);
        setText(formatDate(iso));
        if (iso !== value) onChange(iso);
      } else setBad(true);
    }
    onBlur?.();
  };
  return (
    <div className="combo-input">
      <input
        id={id}
        className={`input ${invalid || bad ? 'invalid' : ''}`}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-invalid={invalid || bad}
      />
      <div className="combo-icons">
        {clearable && value && (
          <button type="button" aria-label="Xóa ngày" onClick={() => onChange(null)}>
            <X size={14} />
          </button>
        )}
        <button type="button" aria-label="Chọn ngày" onClick={() => picker.current?.showPicker()}>
          <CalendarDays size={16} />
        </button>
      </div>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, width }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <div className="search-box" style={width ? { width } : undefined}>
      <Search size={16} />
      <input className="input" value={value} placeholder={placeholder ?? 'Tìm kiếm…'} onChange={(e) => onChange(e.target.value)} aria-label={placeholder ?? 'Tìm kiếm'} />
      {value && (
        <button className="clear" aria-label="Xóa từ khóa" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="row" style={{ gap: 4 }}>
          {i > 0 && <ChevronRight size={13} />}
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export function MenuButton({ items, label, align = 'right', small = true }: { items: MenuItem[]; label?: ReactNode; align?: 'left' | 'right'; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="pop-anchor" ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        className={`btn ${label ? '' : 'icon'} ${small ? 'sm' : ''} ${label ? '' : 'ghost'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ? undefined : 'Thao tác'}
        onClick={() => setOpen((o) => !o)}
      >
        {label ?? <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div className={`popover ${align === 'right' ? 'right' : ''}`} role="menu" style={{ minWidth: 210 }}>
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={`opt ${it.danger ? 'danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export interface Option {
  id: string;
  name: string;
  inactive?: boolean;
  hint?: string;
}

export function MultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const nq = normalizeText(q);
  const shown = options.filter((o) => !nq || normalizeText(o.name).includes(nq));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const selectedNames = options.filter((o) => value.includes(o.id)).map((o) => o.name);
  return (
    <div className="pop-anchor" ref={ref} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className={`chip-btn ${value.length ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        {value.length > 0 && <span>: {selectedNames.length === 1 ? selectedNames[0] : `${value.length} mục`}</span>}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="popover" style={{ minWidth: 260 }}>
          {options.length > 6 && (
            <input autoFocus className="input" style={{ marginBottom: 6 }} placeholder="Tìm…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {shown.length === 0 && <div className="opt-empty">Không có mục phù hợp</div>}
          {shown.map((o) => (
            <button type="button" key={o.id} className="opt" onClick={() => toggle(o.id)} role="menuitemcheckbox" aria-checked={value.includes(o.id)}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: '1px solid var(--border-strong)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: value.includes(o.id) ? 'var(--accent)' : 'transparent',
                  color: 'var(--accent-contrast)',
                }}
              >
                {value.includes(o.id) && <Check size={12} />}
              </span>
              <span className={o.inactive ? 'faint' : ''}>{o.name}</span>
              {o.hint && <span className="faint small" style={{ marginLeft: 'auto' }}>{o.hint}</span>}
            </button>
          ))}
          {value.length > 0 && (
            <>
              <div className="menu-sep" />
              <button type="button" className="opt" onClick={() => onChange([])}>
                <X size={14} /> Bỏ chọn tất cả
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Dropdown tìm kiếm được, có action "+ Thêm mới" (FR-FORM-002/003).
 * onCreate trả về id mục mới; nếu tên đã tồn tại (không phân biệt hoa/thường) thì chọn mục cũ và cảnh báo.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  invalid,
  id,
  clearable = true,
  createLabel = 'Thêm mới',
  onBlur,
  keepOrder,
}: {
  /** Giữ thứ tự options truyền vào (ví dụ dự án vừa sửa lên đầu) thay vì xếp A–Z. */
  keepOrder?: boolean;
  options: Option[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate?: (name: string) => Promise<string | null>;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  clearable?: boolean;
  createLabel?: string;
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;
  const close = () => {
    setOpen(false);
    setQ('');
    onBlur?.();
  };
  useClickOutside(ref, close, open);

  const shown = useMemo(() => {
    const nq = normalizeText(q);
    return options
      .filter((o) => (!o.inactive || o.id === value) && (!nq || normalizeText(o.name).includes(nq)))
      .sort((a, b) => (keepOrder ? 0 : compareVi(a.name, b.name)));
  }, [options, q, value, keepOrder]);
  const exact = q.trim() ? options.find((o) => nameKey(o.name) === nameKey(q)) : undefined;
  const canCreate = !!onCreate && !!q.trim() && !exact;
  const total = shown.length + (canCreate ? 1 : 0);

  const pick = (o: Option) => {
    onChange(o.id);
    setNote(null);
    close();
  };
  const create = async () => {
    if (!onCreate || busy) return;
    if (exact) {
      pick(exact);
      setNote(`"${exact.name}" đã tồn tại — đã chọn mục có sẵn.`);
      return;
    }
    setBusy(true);
    try {
      const newId = await onCreate(q.trim());
      if (newId) {
        onChange(newId);
        setNote(null);
        close();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pop-anchor" ref={ref}>
      <div className="combo-input">
        <input
          id={id}
          className={`input ${invalid ? 'invalid' : ''}`}
          value={open ? q : selected?.name ?? ''}
          placeholder={open && selected ? selected.name : placeholder ?? 'Chọn…'}
          onFocus={() => {
            setOpen(true);
            setHl(0);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHl(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHl((h) => Math.min(total - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHl((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (!open) return setOpen(true);
              if (hl < shown.length) shown[hl] && pick(shown[hl]);
              else if (canCreate) void create();
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              close();
            } else if (e.key === 'Tab') close();
          }}
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
        />
        <div className="combo-icons">
          {clearable && value && (
            <button type="button" aria-label="Bỏ chọn" onClick={() => onChange(null)}>
              <X size={14} />
            </button>
          )}
          <button type="button" tabIndex={-1} aria-label="Mở danh sách" onClick={() => (open ? close() : setOpen(true))}>
            <ChevronDown size={15} />
          </button>
        </div>
      </div>
      {open && (
        <div className="popover" role="listbox">
          {shown.length === 0 && !canCreate && <div className="opt-empty">Không có mục phù hợp</div>}
          {shown.map((o, i) => (
            <button
              type="button"
              key={o.id}
              className={`opt ${i === hl ? 'hl' : ''} ${o.id === value ? 'selected' : ''}`}
              onMouseEnter={() => setHl(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              role="option"
              aria-selected={o.id === value}
            >
              <span className={`grow ellipsis ${o.inactive ? 'faint' : ''}`}>{o.name}</span>
              {o.hint && <span className="faint small">{o.hint}</span>}
              {o.id === value && <Check size={14} />}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className={`opt add ${hl === shown.length ? 'hl' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void create()}
              disabled={busy}
            >
              <Plus size={14} /> {createLabel} “{q.trim()}”
            </button>
          )}
          {onCreate && !q.trim() && <div className="opt-empty">Gõ tên để tìm hoặc thêm mới</div>}
        </div>
      )}
      {note && <div className="field-warn" style={{ marginTop: 4 }}>{note}</div>}
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function shortenPath(p: string, max = 60): string {
  if (p.length <= max) return p;
  const parts = p.split(/[\\/]/);
  const file = parts.pop() ?? '';
  const head = parts.slice(0, 2).join('\\');
  return `${head}\\…\\${file}`.length < p.length ? `${head}\\…\\${file}` : p;
}

/** Ẩn/hiện cột của bảng; danh sách cột ẩn do nơi dùng lưu (localStorage). */
export function ColumnToggle({
  columns,
  hidden,
  onChange,
  compact,
}: {
  columns: { key: string; label: string }[];
  hidden: string[];
  onChange: (v: string[]) => void;
  /** Chỉ hiện icon + số cột đang hiện (xx/xx), không có chữ "Cột". */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const hiddenCount = columns.filter((c) => hidden.includes(c.key)).length;
  return (
    <div className="pop-anchor" ref={ref}>
      <button
        className="btn"
        onClick={() => {
          // Nút nằm sát bên trái thì mở popover sang phải để không bị sidebar che.
          const r = ref.current?.getBoundingClientRect();
          setAlignRight(!r || r.right > 520);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        title={compact ? `Ẩn/hiện cột — đang hiện ${columns.length - hiddenCount}/${columns.length} cột` : undefined}
        aria-label={compact ? `Ẩn/hiện cột, đang hiện ${columns.length - hiddenCount}/${columns.length}` : undefined}
      >
        {compact ? (
          <>
            <Columns3 size={15} /> {columns.length - hiddenCount}/{columns.length}
          </>
        ) : (
          <>
            <Columns3 size={15} /> Cột {hiddenCount > 0 && `(${columns.length - hiddenCount}/${columns.length})`}
          </>
        )}
      </button>
      {open && (
        <div className={`popover ${alignRight ? 'right' : ''}`} style={{ minWidth: 220, maxHeight: 420, overflow: 'auto' }}>
          {columns.map((c) => (
            <label key={c.key} className="opt" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => onChange(hidden.includes(c.key) ? hidden.filter((h) => h !== c.key) : [...hidden, c.key])} />
              {c.label}
            </label>
          ))}
          {hiddenCount > 0 && (
            <button className="opt" onClick={() => onChange([])}>
              Hiện tất cả cột
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick?: () => void;
}) {
  return (
    <th className={onClick ? 'sortable' : ''} data-col={label} onClick={onClick} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <span className="row" style={{ gap: 4 }}>
        {label}
        {active && <span className="sort-arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}

/** Chọn nhiều mục (ví dụ nhiều Hãng cho một dự án) có ô tìm và thêm mới ngay. */
export function MultiSearchSelect({
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  createLabel = 'Thêm mới',
}: {
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
  onCreate?: (name: string) => Promise<string | null>;
  placeholder?: string;
  createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, () => setOpen(false), open, popRef);
  const byId = new Map(options.map((o) => [o.id, o]));
  const nq = normalizeText(q);
  const shown = options.filter((o) => (!o.inactive || value.includes(o.id)) && (!nq || normalizeText(o.name).includes(nq))).sort((a, b) => compareVi(a.name, b.name));
  const exact = q.trim() ? options.find((o) => nameKey(o.name) === nameKey(q)) : undefined;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const create = async () => {
    if (!onCreate || busy || !q.trim()) return;
    if (exact) {
      if (!value.includes(exact.id)) onChange([...value, exact.id]);
      setQ('');
      return;
    }
    setBusy(true);
    try {
      const id = await onCreate(q.trim());
      if (id) {
        onChange([...value, id]);
        setQ('');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pop-anchor" ref={ref}>
      <div className="multi-input" ref={boxRef} onClick={() => (setOpen(true), inputRef.current?.focus())}>
        {value.map((id) => (
          <span key={id} className="chip">
            {byId.get(id)?.name ?? '…'}
            <button
              type="button"
              aria-label={`Bỏ ${byId.get(id)?.name ?? ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(id);
              }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          value={q}
          placeholder={value.length ? '' : placeholder ?? 'Chọn…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (shown.length === 1 && !value.includes(shown[0].id)) {
                toggle(shown[0].id);
                setQ('');
              } else void create();
            }
            if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
            if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <FloatingPopover anchor={boxRef} popRef={popRef} rows={5} role="listbox" aria-multiselectable>
          {shown.length === 0 && !q.trim() && <div className="opt-empty">Chưa có mục nào</div>}
          {shown.length === 0 && q.trim() && !onCreate && <div className="opt-empty">Không có mục phù hợp</div>}
          {shown.map((o) => (
            <button
              type="button"
              key={o.id}
              className={`opt ${value.includes(o.id) ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(o.id)}
              role="option"
              aria-selected={value.includes(o.id)}
            >
              <span className={`check-box ${value.includes(o.id) ? 'on' : ''}`}>{value.includes(o.id) && <Check size={12} />}</span>
              <span className={o.inactive ? 'faint' : ''}>{o.name}</span>
            </button>
          ))}
          {onCreate && q.trim() && !exact && (
            <button type="button" className="opt add" onMouseDown={(e) => e.preventDefault()} onClick={() => void create()} disabled={busy}>
              <Plus size={14} /> {createLabel} “{q.trim()}”
            </button>
          )}
        </FloatingPopover>
      )}
    </div>
  );
}

/** Một thuộc tính lọc trong FilterMenu: danh sách đối tượng để tick, hoặc nội dung tùy biến (ví dụ khoảng thời gian). */
export interface FilterAttr {
  key: string;
  label: string;
  options?: Option[];
  value?: string[];
  onChange?: (v: string[]) => void;
  /** Chỉ chọn một đối tượng; bấm lại mục đang chọn để bỏ lọc. */
  single?: boolean;
  /** Nội dung tùy biến thay cho danh sách đối tượng. */
  render?: () => ReactNode;
  /** Mô tả giá trị đang lọc của mục tùy biến; rỗng = chưa lọc. */
  summary?: string;
}

const attrSummary = (a: FilterAttr): string => {
  if (a.render) return a.summary ?? '';
  const v = a.value ?? [];
  if (!v.length) return '';
  if (v.length === 1) return a.options?.find((o) => o.id === v[0])?.name ?? '1 mục';
  return `${v.length} mục`;
};

/**
 * Bộ lọc gộp vào một icon: bấm icon → chọn thuộc tính cần lọc → chọn đối tượng theo thuộc tính đó.
 * Badge trên icon là số thuộc tính đang lọc.
 */
export function FilterMenu({ attrs, onClear }: { attrs: FilterAttr[]; onClear?: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setStep(null);
    setQ('');
  };
  useClickOutside(ref, close, open);
  const active = attrs.filter((a) => attrSummary(a));
  const current = attrs.find((a) => a.key === step) ?? null;
  const nq = normalizeText(q);
  const shown = current?.options?.filter((o) => !nq || normalizeText(o.name).includes(nq)) ?? [];
  const value = current?.value ?? [];
  const toggle = (id: string) => {
    if (!current?.onChange) return;
    if (current.single) current.onChange(value.includes(id) ? [] : [id]);
    else current.onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  const title = active.length ? `Bộ lọc: ${active.map((a) => `${a.label} = ${attrSummary(a)}`).join(' · ')}` : 'Lọc theo thuộc tính';

  return (
    <div
      className="pop-anchor"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          if (step) setStep(null);
          else close();
        }
      }}
    >
      <button
        type="button"
        className={`btn icon filter-btn ${active.length ? 'toggled' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={title}
        title={title}
      >
        <ListFilter size={16} />
        {active.length > 0 && <span className="filter-count">{active.length}</span>}
      </button>
      {open && (
        <div className="popover filter-pop" role="dialog" aria-label="Bộ lọc">
          {!current ? (
            <>
              <div className="filter-pop-head">Lọc theo</div>
              {attrs.map((a) => {
                const sum = attrSummary(a);
                return (
                  <button type="button" key={a.key} className="opt" onClick={() => (setStep(a.key), setQ(''))}>
                    <span className="grow">{a.label}</span>
                    {sum && <span className="filter-sum ellipsis">{sum}</span>}
                    <ChevronRight size={14} className="faint" />
                  </button>
                );
              })}
              {active.length > 0 && onClear && (
                <>
                  <div className="menu-sep" />
                  <button
                    type="button"
                    className="opt"
                    onClick={() => {
                      onClear();
                      close();
                    }}
                  >
                    <X size={14} /> Xóa tất cả bộ lọc
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="filter-pop-head row">
                <button type="button" className="btn ghost icon sm" aria-label="Quay lại danh sách thuộc tính" onClick={() => setStep(null)}>
                  <ChevronLeft size={16} />
                </button>
                <span className="grow">{current.label}</span>
              </div>
              {current.render ? (
                <div className="filter-custom">{current.render()}</div>
              ) : (
                <>
                  {(current.options?.length ?? 0) > 6 && (
                    <input autoFocus className="input" style={{ marginBottom: 6 }} placeholder={`Tìm ${current.label}…`} value={q} onChange={(e) => setQ(e.target.value)} />
                  )}
                  <div className="filter-values" role="listbox" aria-multiselectable={!current.single}>
                    {shown.length === 0 && <div className="opt-empty">Không có mục phù hợp</div>}
                    {shown.map((o) => {
                      const on = value.includes(o.id);
                      return (
                        <button type="button" key={o.id} className={`opt ${on ? 'selected' : ''}`} onClick={() => toggle(o.id)} role="option" aria-selected={on}>
                          <span className={`check-box ${current.single ? 'radio' : ''} ${on ? 'on' : ''}`}>{on && <Check size={12} />}</span>
                          <span className={`grow ${o.inactive ? 'faint' : ''}`}>{o.name}</span>
                          {o.hint && <span className="faint small">{o.hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {attrSummary(current) && current.onChange && (
                <>
                  <div className="menu-sep" />
                  <button type="button" className="opt" onClick={() => current.onChange?.([])}>
                    <X size={14} /> Bỏ lọc {current.label}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Icon file bảng tính màu xanh lá (kiểu file Excel) cho nút Import xlsx. */
export function ExcelIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M6 2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="#1F7A45" />
      <path d="M14.5 2v4a1.5 1.5 0 0 0 1.5 1.5h4" fill="#5FB585" />
      <path d="M7 11h10v8H7z" fill="#fff" opacity=".95" />
      <path d="M7 13.7h10M7 16.3h10M10.3 11v8M13.7 11v8" stroke="#1F7A45" strokeWidth="1" />
    </svg>
  );
}
