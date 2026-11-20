import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { CATEGORY_LABEL, SEARCH_MODE_LABEL, type SearchHit, type SearchMode } from '../../shared/types';
import { api } from '../api';
import { EmptyState } from '../components/common';
import { HitIcon, SEARCH_PLACEHOLDER, SearchDateFilter, hitKindLabel, useOpenHit, useSearchState } from '../components/GlobalSearch';
import { useAppData } from '../state/AppData';
import { usePageTitle, useUi } from '../state/ui';
import { resolveDateRange } from './WarrantyPage';
import { useTableResize } from '../lib/tableResize';

/** Kết quả tìm kiếm đầy đủ (Enter ở ô tìm trên topbar), chỉnh được kiểu tìm và khoảng ngày ngay tại trang. */
export function SearchPage() {
  const tableRef = useTableResize('search');
  usePageTitle('Tìm kiếm');
  const { today } = useAppData();
  const { toastError } = useUi();
  const openHit = useOpenHit();
  const [st, setSt] = useSearchState();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const range = resolveDateRange(st.dateMode, st, today);

  useEffect(() => {
    if (!st.text.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .globalSearch({ mode: st.mode, text: st.text, from: range.from, to: range.to, limit: 1000 })
        .then(setHits)
        .catch(toastError);
    }, 150);
    return () => clearTimeout(t);
  }, [st.mode, st.text, range.from, range.to, toastError]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="row">
            <Search size={22} style={{ color: 'var(--accent)' }} /> Kết quả tìm kiếm
          </h1>
          <div className="muted small">
            Tìm theo <b>{SEARCH_MODE_LABEL[st.mode]}</b>
            {st.dateMode !== 'all' && (
              <>
                {' '}
                · ngày {formatDate(range.from) || '…'} → {formatDate(range.to) || '…'}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="toolbar">
        <select className="select" style={{ width: 170 }} value={st.mode} onChange={(e) => setSt({ mode: e.target.value as SearchMode })} aria-label="Tìm theo">
          {(Object.keys(SEARCH_MODE_LABEL) as SearchMode[]).map((m) => (
            <option key={m} value={m}>
              {SEARCH_MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <div className="search-box" style={{ width: 340 }}>
          <Search size={16} />
          <input className="input" autoFocus value={st.text} placeholder={SEARCH_PLACEHOLDER[st.mode]} onChange={(e) => setSt({ text: e.target.value })} aria-label="Từ khóa" />
        </div>
        <SearchDateFilter st={st} onChange={setSt} />
        {st.dateMode !== 'all' && (
          <button className="btn ghost sm" onClick={() => setSt({ dateMode: 'all', from: null, to: null })}>
            <X size={14} /> Bỏ lọc ngày
          </button>
        )}
        <span className="small muted">{hits?.length ?? 0} kết quả</span>
      </div>
      {!st.text.trim() ? (
        <EmptyState icon={<Search size={36} />} title="Nhập từ khóa để tìm" text="Chọn kiểu tìm: Tên dự án, Tên SI, Serial number, Hãng hoặc Model/Mã thiết bị." />
      ) : hits === null ? (
        <div className="faint">Đang tìm…</div>
      ) : hits.length === 0 ? (
        <EmptyState title="Không có kết quả" text="Thử từ khóa khác, đổi kiểu tìm hoặc bỏ lọc ngày." />
      ) : (
        <div className="table-wrap">
          <table className="tbl" ref={tableRef}>
            <thead>
              <tr>
                <th>Loại</th>
                <th>Tên</th>
                <th>Khớp ({SEARCH_MODE_LABEL[st.mode]})</th>
                <th>Vị trí</th>
                <th>Ngày</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={`${h.kind}:${h.id}`} data-row={`${h.kind}:${h.id}`} className="clickable" onClick={() => openHit(h, st.text)}>
                  <td className="nowrap">
                    <span className="row" style={{ gap: 6 }}>
                      <HitIcon kind={h.kind} /> {hitKindLabel(h, h.workCategory ? CATEGORY_LABEL[h.workCategory] : null)}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600, minWidth: 220 }}>{h.title}</td>
                  <td>
                    <span className="hl-match">{h.matched}</span>
                  </td>
                  <td className="small muted">{h.subtitle}</td>
                  <td className="nowrap">{h.date ? formatDate(h.date) : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
