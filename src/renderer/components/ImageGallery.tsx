import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Trash2, X } from 'lucide-react';
import type { ImageRef } from '../../shared/types';
import { api, imgUrl } from '../api';
import { useUi } from '../state/ui';
import { useEscape } from './Modal';
import { formatBytes } from './common';

function Lightbox({ images, index, onClose, onIndex }: { images: ImageRef[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  useEscape(onClose);
  const img = images[index];
  const go = (d: number) => onIndex((index + d + images.length) % images.length);
  return (
    <div
      className="lightbox"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <button className="btn icon lb-close" aria-label="Đóng" onClick={onClose}>
        <X size={20} />
      </button>
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
        {img.fileName} · {formatBytes(img.sizeBytes)} · {index + 1}/{images.length}
      </div>
    </div>
  );
}

/** Thumbnail + preview + thêm/xóa ảnh (FR-WAR-011, FR-EXP-010). */
export function ImageGallery({ images, onChange, editable }: { images: ImageRef[]; onChange?: (v: ImageRef[]) => void; editable?: boolean }) {
  const [preview, setPreview] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { toastError, toast } = useUi();

  const add = async () => {
    setBusy(true);
    try {
      const picked = await api.pickImages();
      if (picked.length) {
        onChange?.([...images, ...picked]);
        const usage = await api.getStorageUsage();
        if (usage.bytes > usage.quotaMb * 1024 * 1024)
          toast('warn', `Dung lượng ảnh (${formatBytes(usage.bytes)}) đã vượt ngưỡng ${usage.quotaMb} MB cấu hình trong Settings.`);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="thumbs">
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
        <button type="button" className="thumb-add" onClick={add} disabled={busy}>
          <ImagePlus size={20} />
          {busy ? 'Đang thêm…' : 'Thêm ảnh'}
        </button>
      )}
      {!editable && images.length === 0 && <span className="faint small">Không có ảnh</span>}
      {preview !== null && images[preview] && <Lightbox images={images} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />}
    </div>
  );
}
