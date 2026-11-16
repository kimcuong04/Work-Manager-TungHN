import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardPaste, Copy, ImagePlus, Trash2, X } from 'lucide-react';
import type { ImageRef } from '../../shared/types';
import { api, droppedPaths, imgUrl } from '../api';
import { useUi } from '../state/ui';
import { useEscape } from './Modal';
import { formatBytes } from './common';

export function Lightbox({ images, index, onClose, onIndex }: { images: ImageRef[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  useEscape(onClose);
  const { toast, toastError } = useUi();
  const img = images[index];
  const go = (d: number) => onIndex((index + d + images.length) % images.length);
  const copy = () =>
    api
      .copyImageToClipboard(img.storageKey)
      .then(() => toast('info', 'Đã sao chép ảnh — dán (Ctrl+V) vào ứng dụng khác hoặc vào mục ảnh khác.'))
      .catch(toastError);
  return (
    <div
      className="lightbox"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          void copy();
        }
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <div className="lb-tools">
        <button className="btn sm" onClick={copy} title="Sao chép ảnh (Ctrl+C)">
          <Copy size={15} /> Sao chép ảnh
        </button>
        <button className="btn icon" aria-label="Đóng" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {images.length > 1 && (
        <>
          <button className="btn icon lb-nav" style={{ left: 16 }} aria-label="Ảnh trước" onClick={() => go(-1)}>
            <ChevronLeft size={22} />
          </button>
          <button className="btn icon lb-nav" style={{ right: 16 }} aria-label="Ảnh sau" onClick={() => go(1)}>
            <ChevronRight size={22} />
          </button>
        </>
      )}
      <img src={imgUrl(img.storageKey)} alt={img.fileName} />
      <div className="small">
        {img.fileName}
        {img.sizeBytes ? ` · ${formatBytes(img.sizeBytes)}` : ''} · {index + 1}/{images.length}
      </div>
    </div>
  );
}

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'file'].includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

/** Clipboard đang có ảnh (ảnh chụp màn hình, ảnh copy, file ảnh copy từ Explorer)? */
function clipboardHasImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  if ([...data.items].some((i) => i.kind === 'file' && (i.type.startsWith('image/') || i.type === ''))) return true;
  return data.types.includes('Files');
}

/** Thumbnail + preview + thêm/xóa ảnh (FR-WAR-011, FR-EXP-010); form đang mở thì Ctrl+V dán thẳng ảnh vào. */
export function ImageGallery({
  images,
  onChange,
  editable,
  large,
}: {
  images: ImageRef[];
  onChange?: (v: ImageRef[]) => void;
  editable?: boolean;
  large?: boolean;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { toastError, toast } = useUi();
  const latest = useRef({ images, onChange });
  latest.current = { images, onChange };

  const append = useCallback(
    async (load: () => Promise<ImageRef[]>, pasted: boolean) => {
      setBusy(true);
      try {
        const added = await load();
        if (added.length) {
          latest.current.onChange?.([...latest.current.images, ...added]);
          if (pasted) toast('success', `Đã dán ${added.length} ảnh từ clipboard.`);
          const usage = await api.getStorageUsage();
          if (usage.bytes > usage.quotaMb * 1024 * 1024)
            toast('warn', `Dung lượng ảnh (${formatBytes(usage.bytes)}) đã vượt ngưỡng ${usage.quotaMb} MB cấu hình trong Settings.`);
        }
      } catch (e) {
        toastError(e);
      } finally {
        setBusy(false);
      }
    },
    [toast, toastError],
  );

  useEffect(() => {
    if (!editable) return;
    const onPaste = (e: ClipboardEvent) => {
      if (!clipboardHasImage(e.clipboardData)) return;
      // Đang gõ trong ô chữ mà clipboard có cả chữ (copy từ Word/Excel) thì để dán chữ như bình thường.
      if (isTextField(e.target) && e.clipboardData?.types.includes('text/plain')) return;
      e.preventDefault();
      void append(() => api.pasteImages(), true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [editable, append]);

  return (
    <div
      className={`thumbs ${large ? 'lg' : ''} ${editable ? 'droppable' : ''} ${dragOver ? 'drop-over' : ''}`}
      onDragOver={(e) => {
        if (!editable || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDragOver(false);
        const paths = droppedPaths(e.dataTransfer);
        if (paths.length) void append(() => api.importDroppedImages(paths), false);
        else toast('warn', 'Không đọc được file kéo vào — hãy kéo file ảnh từ thư mục trên máy.');
      }}
    >
      {images.map((img, i) => (
        <div key={img.storageKey} style={{ position: 'relative' }}>
          <button type="button" className="thumb" onClick={() => setPreview(i)} title={img.fileName} aria-label={`Xem ảnh ${img.fileName}`}>
            <img src={imgUrl(img.storageKey, true)} alt={img.fileName} loading="lazy" />
          </button>
          {editable && (
            <button
              type="button"
              className="thumb-rm"
              aria-label={`Xóa ảnh ${img.fileName}`}
              onClick={() => onChange?.(images.filter((x) => x.storageKey !== img.storageKey))}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
      {editable && (
        <>
          <button type="button" className="thumb-add" onClick={() => void append(() => api.pickImages(), false)} disabled={busy}>
            <ImagePlus size={20} />
            {busy ? 'Đang thêm…' : 'Thêm ảnh'}
            <span className="faint" style={{ fontSize: 11 }}>
              hoặc kéo thả
            </span>
          </button>
          <button
            type="button"
            className="thumb-add"
            onClick={() => void append(() => api.pasteImages(), true)}
            disabled={busy}
            title="Dán ảnh đang có trong clipboard (ảnh chụp màn hình, ảnh đã copy) — hoặc nhấn Ctrl+V"
          >
            <ClipboardPaste size={20} />
            Dán ảnh
            <span className="faint" style={{ fontSize: 11 }}>
              Ctrl+V
            </span>
          </button>
        </>
      )}
      {!editable && images.length === 0 && <span className="faint small">Không có ảnh</span>}
      {preview !== null && images[preview] && <Lightbox images={images} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />}
    </div>
  );
}
