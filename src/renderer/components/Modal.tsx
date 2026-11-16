import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const stack: number[] = [];
let seq = 0;

/** Esc chỉ đóng lớp trên cùng khi có nhiều modal/drawer chồng nhau. */
export function useEscape(onEscape: () => void) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    const id = ++seq;
    stack.push(id);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation();
        ref.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      stack.splice(stack.indexOf(id), 1);
    };
  }, []);
}

interface ModalProps {
  title: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  onClose: () => void;
  footer?: (close: () => void) => ReactNode;
  children: ReactNode;
  headExtra?: ReactNode;
  bodyStyle?: React.CSSProperties;
}

export function Modal({ title, size = 'md', onClose, footer, children, headExtra, bodyStyle }: ModalProps) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          {headExtra}
          <button className="btn ghost icon sm" aria-label="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={bodyStyle}>
          {children}
        </div>
        {footer && <div className="modal-foot">{footer(onClose)}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon sm" aria-label="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </div>
  );
}
