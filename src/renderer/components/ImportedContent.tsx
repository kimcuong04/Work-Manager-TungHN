import { formatDate, isValidISODate } from '../../shared/dates';
import type { ImportedInfoRow, ImportedItem, ImportedRequirement } from '../../shared/types';
import { INFO_FIELDS } from '../../shared/xlsxMapping';

function displayValue(key: string, value: string): string {
  const def = INFO_FIELDS.find((f) => f.key === key);
  return def?.isDate && isValidISODate(value) ? formatDate(value) : value;
}

/** Ba vùng nội dung theo ảnh tham chiếu: thông tin dự án (key-value), nội dung yêu cầu theo lần, bảng thiết bị. */
export function ImportedContent({
  info,
  requirements,
  items,
  compact,
}: {
  info: ImportedInfoRow[];
  requirements: ImportedRequirement[];
  items: ImportedItem[];
  compact?: boolean;
}) {
  const byKey = new Map(info.map((r) => [r.fieldKey, r]));
  const extras = info.filter((r) => !INFO_FIELDS.some((f) => f.key === r.fieldKey));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section>
        <h3 className="card-title" style={{ fontSize: 14 }}>
          A. Thông tin dự án
        </h3>
        <div className="kv">
          {INFO_FIELDS.map((f) => {
            const row = byKey.get(f.key);
            return [
              <div key={`${f.key}-k`} className="k">
                {f.label}
              </div>,
              <div key={`${f.key}-v`} className="v">
                {row?.fieldValue ? displayValue(f.key, row.fieldValue) : <span className="faint">—</span>}
              </div>,
            ];
          })}
          {extras.map((r) => [
            <div key={`${r.fieldKey}-k`} className="k">
              {r.fieldLabel}
            </div>,
            <div key={`${r.fieldKey}-v`} className="v">
              {r.fieldValue || <span className="faint">—</span>}
            </div>,
          ])}
        </div>
      </section>

      <section>
        <h3 className="card-title" style={{ fontSize: 14 }}>
          B. Nội dung yêu cầu
        </h3>
        {requirements.length === 0 ? (
          <div className="faint small">Không có nội dung yêu cầu.</div>
        ) : (
          requirements.map((r) => (
            <div key={`${r.roundNumber}-${r.content.slice(0, 10)}`} className="req-round">
              <div className="req-round-head">
                Lần {r.roundNumber}
                {r.createdDate && <span className="small muted">· {formatDate(r.createdDate)}</span>}
              </div>
              <div className="req-round-body">{r.content}</div>
            </div>
          ))
        )}
      </section>

      <section>
        <h3 className="card-title" style={{ fontSize: 14 }}>
          C. Thiết bị / sản phẩm / vật tư <span className="badge">{items.length}</span>
        </h3>
        {items.length === 0 ? (
          <div className="faint small">Không có dòng thiết bị.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: compact ? 320 : 560 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Model / Mã thiết bị</th>
                  <th>Hãng</th>
                  <th>Mô tả</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="faint num">{i + 1}</td>
                    <td className="wrap" style={{ minWidth: 160, fontWeight: 600 }}>
                      {it.model}
                    </td>
                    <td className="wrap" style={{ minWidth: 100 }}>
                      {it.brand}
                    </td>
                    <td className="wrap" style={{ minWidth: 320 }}>
                      {it.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
