import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlignCenter, AlignLeft, AlignRight, Minus } from 'lucide-react';
import { IMAGE_SCALE_MAX, IMAGE_SCALE_MIN, IMAGE_WIDTH_MAX, IMAGE_WIDTH_MIN, parseImageScale, type ImageAlign } from '../../shared/noteHtml';

type Box = { left: number; top: number; width: number; height: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Tỉ lệ hiện tại so với kích thước gốc của ảnh (1 = chưa chỉnh). */
const scaleOf = (img: HTMLImageElement) => {
  const w = Number(img.getAttribute('width'));
  if (!w || !img.naturalWidth) return 1;
  return Number(img.dataset.scale) || round2(w / img.naturalWidth);
};

/**
 * Chỉnh ảnh trong ô soạn ghi chú: bấm ảnh để chọn rồi kéo góc dưới phải để phóng to / thu nhỏ (giữ tỉ lệ khung);
 * chuột phải vào ảnh để nhập tỉ lệ (1 = kích thước gốc, tối đa 2 chữ số thập phân) và căn lề trái / giữa / phải.
 * Chỉ sửa thuộc tính width / data-scale / data-align của <img> (đã được noteHtml cho phép), rồi gọi `onChange`.
 */
export function NoteImageTools({ editor, body, onChange }: { editor: React.RefObject<HTMLDivElement | null>; body: React.RefObject<HTMLDivElement | null>; onChange: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState('1');
  const [err, setErr] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const b = body.current;
    if (!img || !b || !img.isConnected) {
      setBox(null);
      return;
    }
    // Khung chọn chỉ phủ phần ảnh đang thấy trong ô soạn (ảnh lớn bị cuộn), để góc kéo luôn bấm được.
    const r = img.getBoundingClientRect();
    const er = editor.current?.getBoundingClientRect() ?? r;
    const br = b.getBoundingClientRect();
    const left = Math.max(r.left, er.left);
    const top = Math.max(r.top, er.top);
    const right = Math.min(r.right, er.right);
    const bottom = Math.min(r.bottom, er.bottom);
    if (right - left < 8 || bottom - top < 8) {
      setBox(null);
      return;
    }
    setBox({ left: left - br.left, top: top - br.top, width: right - left, height: bottom - top });
  }, [img, body, editor]);
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      setImg(t instanceof HTMLImageElement ? t : null);
      if (!(t instanceof HTMLImageElement)) setMenu(null);
    };
    const onContext = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLImageElement)) return;
      e.preventDefault();
      setImg(t);
      setDraft(String(scaleOf(t)));
      setErr(null);
      setMenu({ x: Math.min(e.clientX, window.innerWidth - 270), y: Math.min(e.clientY, window.innerHeight - 230) });
    };
    const onLoad = (e: Event) => e.target instanceof HTMLImageElement && measure();
    el.addEventListener('click', onClick);
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('scroll', measure);
    el.addEventListener('input', measure);
    el.addEventListener('load', onLoad, true);
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('scroll', measure);
      el.removeEventListener('input', measure);
      el.removeEventListener('load', onLoad, true);
      window.removeEventListener('resize', measure);
    };
  }, [editor, measure]);

  useEffect(() => {
    if (!img) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (body.current?.contains(t) || menuRef.current?.contains(t)) return;
      setImg(null);
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [img, body]);

  const done = () => {
    measure();
    onChange();
  };
  const setWidth = (target: HTMLImageElement, width: number | null, scale?: number) => {
    if (width === null) {
      target.removeAttribute('width');
      delete target.dataset.scale;
      return;
    }
    const w = Math.round(Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, width)));
    target.setAttribute('width', String(w));
    const s = scale ?? (target.naturalWidth ? round2(w / target.naturalWidth) : 0);
    if (s >= IMAGE_SCALE_MIN && s <= IMAGE_SCALE_MAX && s !== 1) target.dataset.scale = String(s);
    else delete target.dataset.scale;
  };

  const applyScale = (raw: string) => {
    if (!img) return;
    const s = parseImageScale(raw);
    if (s === null) {
      setErr(`Nhập số thập phân từ ${IMAGE_SCALE_MIN} đến ${IMAGE_SCALE_MAX}, tối đa 2 chữ số sau dấu (vd 0.5 hoặc 1.25).`);
      return;
    }
    setErr(null);
    setDraft(String(s));
    setWidth(img, s === 1 ? null : (img.naturalWidth || img.getBoundingClientRect().width) * s, s);
    done();
  };
  const align = (a: ImageAlign | null) => {
    if (!img) return;
    if (a) img.dataset.align = a;
    else delete img.dataset.align;
    done();
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!img || !editor.current) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const target = img;
    const startX = e.clientX;
    const startW = target.getBoundingClientRect().width;
    const maxW = Math.max(IMAGE_WIDTH_MIN, editor.current.clientWidth - 24);
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.min(maxW, Math.max(24, startW + ev.clientX - startX));
      target.setAttribute('width', String(Math.round(w)));
      measure();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (Math.abs(w - startW) >= 1) {
        setWidth(target, w);
        done();
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const current = img ? scaleOf(img) : 1;
  return (
    <>
      {img && box && (
        <div className="img-sel" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          <span className="img-sel-badge">
            {Math.round(img.getBoundingClientRect().width)}px · tỉ lệ {current}
          </span>
          <div className="img-handle" role="slider" aria-label="Kéo để phóng to / thu nhỏ ảnh" aria-valuenow={current} title="Kéo để phóng to / thu nhỏ" onPointerDown={startDrag} />
        </div>
      )}
      {img &&
        menu &&
        createPortal(
          <div className="popover img-menu" ref={menuRef} style={{ position: 'fixed', left: menu.x, top: menu.y }} role="dialog" aria-label="Chỉnh ảnh">
            <form
              className="stack"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault();
                applyScale(draft);
              }}
            >
              <label className="small muted" htmlFor="img-scale">
                Tỉ lệ ảnh (1 = kích thước gốc)
              </label>
              <div className="row" style={{ gap: 6 }}>
                <input id="img-scale" className="input" style={{ width: 90, height: 30 }} inputMode="decimal" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Tỉ lệ ảnh" />
                <button className="btn sm primary" type="submit">
                  Áp dụng
                </button>
              </div>
              {err && <div className="field-error">{err}</div>}
              <div className="row" style={{ gap: 4 }}>
                {[0.25, 0.5, 0.75, 1].map((s) => (
                  <button key={s} type="button" className={`btn sm ${current === s ? 'toggled' : ''}`} onClick={() => applyScale(String(s))}>
                    {s}
                  </button>
                ))}
              </div>
            </form>
            <div className="small muted" style={{ marginTop: 8 }}>
              Căn lề
            </div>
            <div className="seg" role="group" aria-label="Căn lề ảnh">
              {(
                [
                  [null, 'Theo dòng', <Minus key="n" size={14} />],
                  ['left', 'Căn trái', <AlignLeft key="l" size={14} />],
                  ['center', 'Căn giữa', <AlignCenter key="c" size={14} />],
                  ['right', 'Căn phải', <AlignRight key="r" size={14} />],
                ] as [ImageAlign | null, string, React.ReactNode][]
              ).map(([a, label, icon]) => (
                <button key={label} type="button" className={(img.dataset.align ?? null) === a ? 'on' : ''} title={label} aria-label={label} aria-pressed={(img.dataset.align ?? null) === a} onClick={() => align(a)}>
                  {icon}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
