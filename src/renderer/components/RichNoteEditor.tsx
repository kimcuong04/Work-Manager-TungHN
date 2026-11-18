import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Baseline,
  Bold,
  ClipboardPaste,
  Heading2,
  Highlighter,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { isNoteEmpty, noteImageSrc, sanitizeNoteHtml } from '../../shared/noteHtml';
import type { ImageRef } from '../../shared/types';
import { api, droppedPaths } from '../api';
import { useUi } from '../state/ui';
import { useClickOutside } from './common';
import { NoteImageTools } from './NoteImageTools';

const TEXT_COLORS = [
  { label: 'Mặc định', value: '' },
  { label: 'Đỏ', value: '#d92d20' },
  { label: 'Cam', value: '#c27803' },
  { label: 'Xanh lá', value: '#2f8f46' },
  { label: 'Xanh dương', value: '#2563eb' },
  { label: 'Tím', value: '#7c3aed' },
];
const HIGHLIGHTS = [
  { label: 'Vàng', value: '#fff3a3' },
  { label: 'Xanh lá nhạt', value: '#d9f99d' },
  { label: 'Xanh dương nhạt', value: '#bae6fd' },
  { label: 'Hồng', value: '#fbcfe8' },
];

type Active = Partial<Record<'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList' | 'heading' | 'quote', boolean>>;

function caretToEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function clipboardHasImage(dt: DataTransfer): boolean {
  return [...dt.items].some((i) => i.kind === 'file' && i.type.startsWith('image/')) || dt.types.includes('Files');
}

const imagesHtml = (imgs: ImageRef[]) => imgs.map((i) => `<img src="${noteImageSrc(i.storageKey)}" data-key="${i.storageKey}" alt="">`).join('');

/**
 * Soạn ghi chú định dạng tự do: đậm/nghiêng/gạch, tiêu đề, danh sách, màu chữ, tô nền, và ảnh
 * (Ctrl+V ảnh chụp màn hình/ảnh đã copy, hoặc nút Chèn ảnh). Nội dung dán từ nơi khác được lọc trước khi chèn.
 */
export function RichNoteEditor({
  initialHtml,
  onChange,
  placeholder = 'Viết ghi chú… (dán ảnh Ctrl+V hoặc kéo thả ảnh vào đây; bấm ảnh để kéo đổi cỡ, chuột phải để nhập tỉ lệ / căn lề)',
  autoFocus,
  minHeight = 160,
  onSubmit,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Active>({});
  const [empty, setEmpty] = useState(() => isNoteEmpty(initialHtml));
  const [busy, setBusy] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const { toast, toastError } = useUi();
  useClickOutside(colorRef, () => setColorOpen(false), colorOpen);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = sanitizeNoteHtml(initialHtml);
    if (autoFocus) {
      el.focus();
      caretToEnd(el);
    }
    // Nội dung ban đầu chỉ nạp một lần; sau đó contentEditable tự giữ trạng thái.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSelection = () => {
      const el = ref.current;
      const sel = document.getSelection();
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return;
      savedRange.current = sel.getRangeAt(0).cloneRange();
      const block = String(document.queryCommandValue('formatBlock')).toLowerCase();
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
        heading: /^h[2-4]$/.test(block),
        quote: block === 'blockquote',
      });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    setEmpty(isNoteEmpty(html));
    onChange(html);
  };

  const restoreSelection = () => {
    const el = ref.current!;
    el.focus();
    const sel = document.getSelection();
    const r = savedRange.current;
    if (sel && r && el.contains(r.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    } else caretToEnd(el);
  };

  const exec = (cmd: string, arg?: string) => {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, arg);
    emit();
  };

  const insertImages = async (load: () => Promise<ImageRef[]>) => {
    setBusy(true);
    try {
      const imgs = await load();
      if (!imgs.length) return;
      restoreSelection();
      document.execCommand('insertHTML', false, `${imagesHtml(imgs)}<br>`);
      emit();
      toast('success', `Đã chèn ${imgs.length} ảnh vào ghi chú.`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const dt = e.clipboardData;
    const text = dt.getData('text/plain');
    e.preventDefault();
    // Copy ô Excel cũng kèm ảnh chụp vùng chọn: có chữ thì ưu tiên dán chữ/bảng.
    if (!text.trim() && clipboardHasImage(dt)) {
      const sel = document.getSelection();
      if (sel?.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange();
      void insertImages(() => api.pasteImages());
      return;
    }
    const html = dt.getData('text/html');
    const clean = html ? sanitizeNoteHtml(html) : '';
    if (clean) document.execCommand('insertHTML', false, clean);
    else document.execCommand('insertText', false, text);
    emit();
  };

  const tool = (key: keyof Active | null, title: string, icon: React.ReactNode, run: () => void) => (
    <button
      type="button"
      className={key && active[key] ? 'on' : ''}
      title={title}
      aria-label={title}
      aria-pressed={key ? !!active[key] : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div className="note-editor-wrap">
      <div className="note-toolbar" role="toolbar" aria-label="Định dạng ghi chú">
        {tool('bold', 'Đậm (Ctrl+B)', <Bold size={15} />, () => exec('bold'))}
        {tool('italic', 'Nghiêng (Ctrl+I)', <Italic size={15} />, () => exec('italic'))}
        {tool('underline', 'Gạch chân (Ctrl+U)', <Underline size={15} />, () => exec('underline'))}
        {tool('strikeThrough', 'Gạch ngang', <Strikethrough size={15} />, () => exec('strikeThrough'))}
        <span className="sep" />
        {tool('heading', 'Tiêu đề', <Heading2 size={15} />, () => exec('formatBlock', active.heading ? 'div' : 'h3'))}
        {tool('insertUnorderedList', 'Danh sách chấm', <List size={15} />, () => exec('insertUnorderedList'))}
        {tool('insertOrderedList', 'Danh sách số', <ListOrdered size={15} />, () => exec('insertOrderedList'))}
        {tool('quote', 'Trích dẫn', <Quote size={15} />, () => exec('formatBlock', active.quote ? 'div' : 'blockquote'))}
        <span className="sep" />
        <div className="pop-anchor" ref={colorRef}>
          {tool(null, 'Màu chữ & tô nền', <Baseline size={15} />, () => setColorOpen((o) => !o))}
          {colorOpen && (
            <div className="popover color-pop" onMouseDown={(e) => e.preventDefault()}>
              <div className="small muted">Màu chữ</div>
              <div className="swatches">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className="swatch"
                    title={c.label}
                    aria-label={`Màu chữ ${c.label}`}
                    style={{ background: c.value || 'var(--text)' }}
                    onClick={() => {
                      exec('foreColor', c.value || 'inherit');
                      setColorOpen(false);
                    }}
                  />
                ))}
              </div>
              <div className="small muted">
                <Highlighter size={12} /> Tô nền
              </div>
              <div className="swatches">
                {HIGHLIGHTS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className="swatch"
                    title={c.label}
                    aria-label={`Tô nền ${c.label}`}
                    style={{ background: c.value }}
                    onClick={() => {
                      exec('hiliteColor', c.value);
                      setColorOpen(false);
                    }}
                  />
                ))}
                <button
                  type="button"
                  className="swatch none"
                  title="Bỏ tô nền"
                  aria-label="Bỏ tô nền"
                  onClick={() => {
                    exec('hiliteColor', 'transparent');
                    setColorOpen(false);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
        {tool(null, 'Xóa định dạng', <RemoveFormatting size={15} />, () => exec('removeFormat'))}
        <span className="sep" />
        <button type="button" title="Chèn ảnh từ máy" aria-label="Chèn ảnh" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void insertImages(() => api.pickImages())}>
          <ImagePlus size={15} /> <span className="small">Ảnh</span>
        </button>
        <button
          type="button"
          title="Dán ảnh trong clipboard (hoặc Ctrl+V)"
          aria-label="Dán ảnh"
          disabled={busy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void insertImages(() => api.pasteImages())}
        >
          <ClipboardPaste size={15} /> <span className="small">Dán ảnh</span>
        </button>
        {busy && <span className="small faint" style={{ alignSelf: 'center', marginLeft: 6 }}>Đang chèn ảnh…</span>}
      </div>
      <div className="note-editor-body" ref={bodyRef}>
        {empty && <div className="note-placeholder">{placeholder}</div>}
        <NoteImageTools editor={ref} body={bodyRef} onChange={emit} />
        <div
          ref={ref}
          className="note-editor note-rich"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Nội dung ghi chú"
          style={{ minHeight }}
          onInput={emit}
          onPaste={onPaste}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            const paths = droppedPaths(e.dataTransfer);
            if (!paths.length) {
              toast('warn', 'Không đọc được file kéo vào — hãy kéo file ảnh từ thư mục trên máy.');
              return;
            }
            // Chèn ảnh đúng chỗ thả chuột.
            const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
            if (at && ref.current?.contains(at.startContainer)) savedRange.current = at;
            void insertImages(() => api.importDroppedImages(paths));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>
    </div>
  );
}
