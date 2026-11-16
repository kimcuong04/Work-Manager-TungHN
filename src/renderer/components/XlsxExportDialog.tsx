import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { api } from '../api';
import { useUi } from '../state/ui';
import { Modal } from './Modal';

export interface ExportColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null;
}

/** Chọn cột rồi xuất .xlsx (mặc định chọn tất cả; không đổi gì thì bấm Xuất luôn). */
export function XlsxExportDialog<T>({
  title,
  columns,
  rows,
  fileName,
  sheetName,
  onClose,
}: {
  title: string;
  columns: ExportColumn<T>[];
  rows: T[];
  fileName: string;
  sheetName: string;
  onClose: () => void;
}) {
  const { toast, toastError } = useUi();
  const [picked, setPicked] = useState<string[]>(() => columns.map((c) => c.key));
  const [busy, setBusy] = useState(false);
  const chosen = columns.filter((c) => picked.includes(c.key));
  const run = async () => {
    setBusy(true);
    try {
      const saved = await api.exportXlsx({
        defaultName: fileName,
        sheetName,
        rows: [chosen.map((c) => c.label), ...rows.map((r) => chosen.map((c) => c.value(r)))],
      });
      if (saved) {
        toast('success', `Đã xuất ${rows.length} dòng ra ${saved}`);
        onClose();
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={title}
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="left small muted">{rows.length} dòng · {chosen.length} cột</span>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" disabled={!chosen.length || busy} onClick={() => void run()}>
            <FileDown size={15} /> {busy ? 'Đang xuất…' : 'Xuất .xlsx'}
          </button>
        </>
      )}
    >
      <div className="stack" style={{ gap: 10 }}>
        <div className="row small">
          <span className="grow muted">Chọn các cột cần xuất:</span>
          <button className="btn ghost sm" onClick={() => setPicked(columns.map((c) => c.key))}>
            Chọn tất cả
          </button>
          <button className="btn ghost sm" onClick={() => setPicked([])}>
            Bỏ chọn
          </button>
        </div>
        <div className="export-cols">
          {columns.map((c) => (
            <label key={c.key} className="row small" style={{ cursor: 'pointer', gap: 8 }}>
              <input type="checkbox" checked={picked.includes(c.key)} onChange={() => setPicked((p) => (p.includes(c.key) ? p.filter((k) => k !== c.key) : [...p, c.key]))} />
              {c.label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
