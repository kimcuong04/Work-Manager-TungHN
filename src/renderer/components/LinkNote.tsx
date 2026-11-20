import { useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { linkMarkup, parseLinkNote } from '../../shared/linkNote';
import { isWebLink } from '../../shared/webLink';
import { api } from '../api';
import { useUi } from '../state/ui';

/** Ghi chú có link: link `[Tên](link)` hoặc link dán thẳng thành nút bấm mở trên trình duyệt mặc định. */
export function LinkedText({ text, className }: { text: string; className?: string }) {
  const { toastError } = useUi();
  if (!text) return <span className="faint">—</span>;
  return (
    <span className={`linked-text ${className ?? ''}`}>
      {parseLinkNote(text).map((seg, i) =>
        seg.url ? (
          <button
            key={i}
            type="button"
            className="note-link"
            title={`Mở ${seg.url}`}
            onClick={(e) => {
              e.stopPropagation();
              void api.openExternalUrl(seg.url!).catch(toastError);
            }}
          >
            {seg.text}
          </button>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Ô nhập Ghi chú có nút "Chèn link": nhập tên hiển thị (không bắt buộc) và link, chèn vào đúng chỗ con trỏ dạng
 * `[Tên](link)`. Dán link thẳng vào ghi chú cũng được. Có xem trước khi ghi chú có link.
 */
export function LinkNoteField({ id, value, onChange, maxLength = 5000, placeholder, rows = 4 }: { id?: string; value: string; onChange: (v: string) => void; maxLength?: number; placeholder?: string; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState<{ label: string; url: string; start: number; end: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const segments = parseLinkNote(value);

  const openForm = () => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setErr(null);
    setForm({ label: value.slice(start, end), url: '', start, end });
  };
  const insert = () => {
    if (!form) return;
    const url = form.url.trim();
    if (!isWebLink(url)) {
      setErr('Nhập link website hợp lệ, vd https://maps.google.com/… hoặc axis.com/support');
      return;
    }
    const text = linkMarkup(form.label, url);
    const next = value.slice(0, form.start) + text + value.slice(form.end);
    onChange(next.slice(0, maxLength));
    setForm(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const at = form.start + text.length;
      el.setSelectionRange(at, at);
    });
  };

  return (
    <div className="link-note">
      <textarea id={id} ref={ref} className="textarea" rows={rows} maxLength={maxLength} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button type="button" className="btn sm" onClick={openForm} aria-expanded={!!form}>
          <Link2 size={13} /> Chèn link
        </button>
        <span className="small faint grow">Hoặc dán link thẳng vào ghi chú (bắt đầu bằng http://, https:// hoặc www.).</span>
      </div>
      {form && (
        <div className="link-note-form" role="group" aria-label="Chèn link">
          <input className="input" autoFocus placeholder="Tên hiển thị (không bắt buộc)" aria-label="Tên hiển thị của link" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input
            className="input"
            placeholder="Link, vd https://example.com"
            aria-label="Link website"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insert();
              }
            }}
          />
          <button type="button" className="btn sm primary" onClick={insert}>
            Chèn
          </button>
          <button type="button" className="btn sm ghost" onClick={() => setForm(null)}>
            Hủy
          </button>
          {err && <div className="field-error" style={{ flexBasis: '100%' }}>{err}</div>}
        </div>
      )}
      {segments.some((s) => s.url) && (
        <div className="link-note-preview small">
          <span className="faint">Xem trước: </span>
          <LinkedText text={value} />
        </div>
      )}
    </div>
  );
}
