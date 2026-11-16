import type { ImportedItem } from '../../shared/types';

/** Dữ liệu import từ Excel: chỉ hiển thị bảng thông tin các thiết bị. */
export function ImportedContent({ items, compact }: { items: ImportedItem[]; compact?: boolean }) {
  return (
    <section>
      <h3 className="card-title" style={{ fontSize: 14 }}>
        Thông tin các thiết bị <span className="badge">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <div className="faint small">Không có dòng thiết bị.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: compact ? 420 : 560 }}>
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
  );
}
