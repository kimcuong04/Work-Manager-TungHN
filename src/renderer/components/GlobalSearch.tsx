import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { FolderKanban, Laptop, Funnel, Package, Search, ShieldCheck, X } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { SEARCH_MODE_LABEL, type SearchHit, type SearchMode } from '../../shared/types';
import { api } from '../api';
import { nodePath } from '../lib/projects';
import { DateFilterControls, resolveDateRange } from '../pages/WarrantyPage';
import { useAppData } from '../state/AppData';
import { useClickOutside } from './common';
import { requestHighlight } from '../lib/highlight';

type DateMode = Parameters<typeof resolveDateRange>[0];

export interface GlobalSearchState {
  mode: SearchMode;
  text: string;
  dateMode: DateMode;
  month: number;
  monthYear: number;
  from: string | null;
  to: string | null;
}

export function defaultSearchState(today: string): GlobalSearchState {
  return { mode: 'name', text: '', dateMode: 'all', month: Number(today.slice(5, 7)), monthYear: Number(today.slice(0, 4)), from: null, to: null };
}

// Một trạng thái tìm kiếm chung cho ô tìm trên topbar và trang kết quả (giữ trong phiên làm việc).
let searchState: GlobalSearchState | null = null;
const searchSubs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  searchSubs.add(cb);
  return () => {
    searchSubs.delete(cb);
  };
};

export function useSearchState(): [GlobalSearchState, (p: Partial<GlobalSearchState>) => void] {
  const { today } = useAppData();
  if (!searchState) searchState = defaultSearchState(today);
  const snap = useSyncExternalStore(subscribe, () => searchState!);
  const set = useCallback((patch: Partial<GlobalSearchState>) => {
    searchState = { ...searchState!, ...patch };
    searchSubs.forEach((f) => f());
  }, []);
  return [snap, set];
}

export const SEARCH_PLACEHOLDER: Record<SearchMode, string> = {
  name: 'Tìm theo STT / tên dự án (gõ không dấu cũng được)…',
  si: 'Tìm theo tên SI…',
  serial: 'Tìm Serial number trong Warranty và Kho thiết bị…',
  brand: 'Tìm theo Hãng…',
  model: 'Tìm Model / mã thiết bị trong bảng thiết bị và Tên sp trong Kho thiết bị…',
};

/** Mở đúng nơi chứa kết quả: dự án / job Freelance → trang chi tiết; Warranty → bảng Warranty của năm đó với bản ghi được chọn. */
/** Mở kết quả tìm kiếm và tô sáng `query` ở trang đích (bấm chuột bất kỳ đâu để bỏ). */
export function useOpenHit() {
  const navigate = useNavigate();
  return (h: SearchHit, query: string) => {
    requestHighlight(query);
    return h.kind === 'project'
      ? navigate(`/project/${h.id}`)
      : h.kind === 'freelance'
        ? navigate(`/freelance/${h.id}`)
        : h.kind === 'equipment'
          ? navigate('/equipment', { state: { select: h.id } })
          : navigate(nodePath(h.jobType, h.jobYearId, 'WARRANTY'), { state: { select: h.id } });
  };
}

export function HitIcon({ kind }: { kind: SearchHit['kind'] }) {
  return kind === 'project' ? <FolderKanban size={15} /> : kind === 'freelance' ? <Laptop size={15} /> : kind === 'equipment' ? <Package size={15} /> : <ShieldCheck size={15} />;
}

export function SearchDateFilter({ st, onChange }: { st: GlobalSearchState; onChange: (p: Partial<GlobalSearchState>) => void }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <DateFilterControls
        mode={st.dateMode}
        month={st.month}
        monthYear={st.monthYear}
        from={st.from}
        to={st.to}
        onChange={({ mode, ...rest }) => onChange({ ...rest, ...(mode ? { dateMode: mode } : {}) })}
      />
    </div>
  );
}

/** Ô tìm kiếm trên topbar: chọn kiểu tìm cạnh kính lúp, nút lọc ngày phía sau. */
export function GlobalSearch() {
  const { today } = useAppData();
  const navigate = useNavigate();
  const openHit = useOpenHit();
  const [st, setSt] = useSearchState();
  const [open, setOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(
    ref,
    () => {
      setOpen(false);
      setFilterOpen(false);
    },
    open || filterOpen,
  );
  const range = resolveDateRange(st.dateMode, st, today);
  const filterActive = st.dateMode !== 'all';
  const location = useLocation();

  // Chuyển trang hoặc nhấn Esc thì đóng các popover của ô tìm kiếm.
  useEffect(() => {
    setOpen(false);
    setFilterOpen(false);
  }, [location.key]);
  useEffect(() => {
    if (!open && !filterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setFilterOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filterOpen]);

  useEffect(() => {
    if (!st.text.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .globalSearch({ mode: st.mode, text: st.text, from: range.from, to: range.to, limit: 8 })
        .then(setHits)
        .catch(() => setHits([]));
    }, 150);
    return () => clearTimeout(t);
  }, [st.mode, st.text, range.from, range.to]);

  const showAll = () => {
    setOpen(false);
    setFilterOpen(false);
    navigate('/search', { state: { at: Date.now() } });
  };

  return (
    <div className="gsearch pop-anchor" ref={ref}>
      <div className="gsearch-box">
        <Search size={16} className="gsearch-icon" />
        <select className="gsearch-mode" value={st.mode} onChange={(e) => setSt({ mode: e.target.value as SearchMode })} aria-label="Kiểu tìm kiếm" title="Tìm theo">
          {(Object.keys(SEARCH_MODE_LABEL) as SearchMode[]).map((m) => (
            <option key={m} value={m}>
              {SEARCH_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <input
          className="gsearch-input"
          placeholder={SEARCH_PLACEHOLDER[st.mode]}
          value={st.text}
          onChange={(e) => {
            setSt({ text: e.target.value });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && st.text.trim()) showAll();
            if (e.key === 'Escape') setOpen(false);
          }}
          aria-label="Tìm kiếm toàn cục"
        />
        {st.text && (
          <button className="gsearch-clear" aria-label="Xóa từ khóa" onClick={() => setSt({ text: '' })}>
            <X size={14} />
          </button>
        )}
      </div>
      <button
        className={`btn icon gsearch-filter ${filterActive ? 'toggled' : 'ghost'}`}
        title={filterActive ? `Đang lọc ngày: ${formatDate(range.from) || '…'} → ${formatDate(range.to) || '…'}` : 'Lọc theo ngày / tháng'}
        aria-label="Bộ lọc ngày"
        aria-pressed={filterActive}
        onClick={() => {
          setFilterOpen((o) => !o);
          setOpen(false);
        }}
      >
        <Funnel size={16} />
      </button>
      {filterOpen && (
        <div className="popover right gsearch-pop">
          <div className="small" style={{ fontWeight: 650 }}>
            Lọc theo ngày
          </div>
          <div className="small muted">Áp dụng cho Ngày bắt đầu (dự án) và Ngày nhận (Warranty).</div>
          <SearchDateFilter st={st} onChange={setSt} />
          {filterActive && (
            <div className="row">
              <span className="small muted grow">
                {formatDate(range.from) || '…'} → {formatDate(range.to) || '…'}
              </span>
              <button className="btn sm ghost" onClick={() => setSt({ dateMode: 'all', from: null, to: null })}>
                <X size={13} /> Bỏ lọc
              </button>
            </div>
          )}
        </div>
      )}
      {open && st.text.trim() && (
        <div className="popover gsearch-results">
          {hits.length === 0 && <div className="opt-empty">Không có kết quả theo {SEARCH_MODE_LABEL[st.mode]}{filterActive ? ' trong khoảng ngày đã lọc' : ''}</div>}
          {hits.map((h) => (
            <button
              key={`${h.kind}:${h.id}`}
              className="opt"
              onClick={() => {
                setOpen(false);
                openHit(h, st.text);
              }}
            >
              <HitIcon kind={h.kind} />
              <span className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>
                  {h.title}
                </div>
                <div className="small faint ellipsis">
                  {st.mode !== 'name' && <b className="hl-match">{h.matched}</b>} {h.subtitle}
                </div>
              </span>
              {h.date && <span className="small faint nowrap">{formatDate(h.date)}</span>}
            </button>
          ))}
          {hits.length > 0 && (
            <>
              <div className="menu-sep" />
              <button className="opt" onClick={showAll}>
                <Search size={14} /> Xem tất cả kết quả
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
