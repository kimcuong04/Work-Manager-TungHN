import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Trash2, X } from 'lucide-react';

/** Chế độ "Chọn" của một danh sách: tick từng dòng hoặc tất cả các dòng đang hiển thị (theo bộ lọc). */
export interface Selection {
  active: boolean;
  selected: Set<string>;
  start: () => void;
  stop: () => void;
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  allOn: boolean;
  someOn: boolean;
}

export function useSelection(visibleIds: string[]): Selection {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);

  // Đổi bộ lọc / mục đã bị xóa: bỏ khỏi lựa chọn để không xóa nhầm mục đang bị ẩn.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => visible.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [visible]);

  const count = [...selected].filter((id) => visible.has(id)).length;
  return {
    active,
    selected,
    start: () => {
      setSelected(new Set());
      setActive(true);
    },
    stop: () => {
      setActive(false);
      setSelected(new Set());
    },
    toggle: (id) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    setAll: (on) => setSelected(on ? new Set(visibleIds) : new Set()),
    allOn: visibleIds.length > 0 && count === visibleIds.length,
    someOn: count > 0 && count < visibleIds.length,
  };
}

export function SelectBox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="select-box"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Ô tick đầu bảng: tick = chọn tất cả dòng đang hiển thị, tick lại = bỏ chọn. */
export function SelectAllHeader({ sel }: { sel: Selection }) {
  return (
    <th className="select-col" data-col="__sel">
      <SelectBox checked={sel.allOn} indeterminate={sel.someOn} onChange={() => sel.setAll(!sel.allOn)} label="Chọn tất cả" />
    </th>
  );
}

export function SelectCell({ sel, id, label }: { sel: Selection; id: string; label: string }) {
  return (
    <td className="select-col" onClick={(e) => e.stopPropagation()}>
      <SelectBox checked={sel.selected.has(id)} onChange={() => sel.toggle(id)} label={`Chọn ${label}`} />
    </td>
  );
}

export function SelectToggleButton({ sel, disabled, title, iconOnly }: { sel: Selection; disabled?: boolean; title?: string; iconOnly?: boolean }) {
  const tip = title ?? (sel.active ? 'Thoát chế độ chọn' : 'Chọn nhiều mục để xóa cùng lúc');
  return (
    <button
      className={`btn ${iconOnly ? 'icon' : ''} ${sel.active ? 'toggled' : ''}`}
      aria-pressed={sel.active}
      disabled={disabled}
      title={tip}
      aria-label={iconOnly ? tip : undefined}
      onClick={() => (sel.active ? sel.stop() : sel.start())}
    >
      <CheckSquare size={15} />
      {!iconOnly && ` ${sel.active ? 'Đang chọn' : 'Chọn'}`}
    </button>
  );
}

/** Thanh thao tác khi đang chọn: số mục đã chọn, Chọn tất cả / Bỏ chọn, Xóa đã chọn, Xong. */
export function SelectionBar({ sel, total, noun, onDelete }: { sel: Selection; total: number; noun: string; onDelete: () => void }) {
  const n = sel.selected.size;
  return (
    <div className="edit-banner select-banner" role="region" aria-label="Đang chọn">
      <CheckSquare size={16} />
      <span className="grow">
        Đã chọn <b>{n}</b>/{total} {noun}. Bấm vào dòng hoặc ô tick để chọn; ô tick ở đầu bảng chọn tất cả.
      </span>
      {sel.allOn ? (
        <button className="btn sm" onClick={() => sel.setAll(false)}>
          Bỏ chọn tất cả
        </button>
      ) : (
        <button className="btn sm" onClick={() => sel.setAll(true)} disabled={!total}>
          Chọn tất cả ({total})
        </button>
      )}
      <button className="btn sm danger solid" disabled={!n} onClick={onDelete}>
        <Trash2 size={14} /> Xóa {n ? `${n} mục` : ''}
      </button>
      <button className="btn sm" onClick={sel.stop}>
        <X size={14} /> Xong
      </button>
    </div>
  );
}
