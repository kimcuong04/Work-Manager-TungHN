import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, FolderOpen, Info, RefreshCw, Wand2 } from 'lucide-react';
import {
  BULK_FIELDS,
  BULK_TARGET_LABEL,
  autoBulkConfig,
  buildBulkRows,
  bulkConfigFromMappings,
  bulkConfigToMappings,
  lastDataRow,
  nameSttRatio,
  type BulkConfig,
} from '../../shared/bulkImport';
import { formatDate } from '../../shared/dates';
import { MASTER_LABEL, type BulkTarget, type WorkbookData } from '../../shared/types';
import { getSheet } from '../../shared/xlsxMapping';
import { api, errorMessage } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { formatBytes, shortenPath } from './common';
import { ColSelect, RowInput, SheetSelect } from './ImportWizard';
import { Modal } from './Modal';

const PREVIEW_MAX = 300;

/**
 * Import nhiều dòng từ .xlsx: chọn file → tự nhận diện dòng header + cột theo tên tiêu đề → người dùng chỉnh mapping
 * → xem trước (dòng lỗi được đánh dấu và bỏ qua) → ghi các dòng hợp lệ vào hệ thống.
 */
export function BulkImportWizard({
  target,
  jobYearId,
  scopeLabel,
  usedStt,
  onClose,
  onDone,
}: {
  target: BulkTarget;
  jobYearId?: string;
  /** Vd "Pre-sales 2026" — hiện trên tiêu đề. */
  scopeLabel: string;
  usedStt: Set<number>;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { settings, refresh } = useAppData();
  const { toast, toastError } = useUi();
  const fields = BULK_FIELDS[target];
  const isProject = target === 'PRE_SALES' || target === 'POST_SALES';
  const [phase, setPhase] = useState<'loading' | 'map' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [config, setConfig] = useState<BulkConfig | null>(null);
  const [usedSaved, setUsedSaved] = useState(false);
  const [saveMapping, setSaveMapping] = useState(true);
  const [makeFolders, setMakeFolders] = useState(isProject && !!settings.projectRootDir);
  const [folderParent, setFolderParent] = useState<string | null>(settings.projectRootDir);
  const [saving, setSaving] = useState(false);
  const [sttFromNameChoice, setSttFromName] = useState<boolean | null>(null);

  const load = async () => {
    setPhase('loading');
    setError(null);
    try {
      const path = await api.pickWorkbook();
      if (!path) return onClose();
      const data = await api.readWorkbook(path);
      const saved = bulkConfigFromMappings(target, data.sheets, data.savedMappings);
      setWb(data);
      setConfig(saved ?? autoBulkConfig(data.sheets, fields));
      setUsedSaved(!!saved);
      setPhase('map');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  };

  // StrictMode (dev) chạy effect 2 lần — không được mở hộp thoại chọn file 2 lần.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheet = wb && config ? getSheet(wb.sheets, config.sheet) : undefined;
  const hasSttField = target !== 'WARRANTY';
  const ratio = useMemo(() => (config && hasSttField ? nameSttRatio(sheet, config) : 0), [config, sheet, hasSttField]);
  // Tự bật khi file không có cột STT mà phần lớn tên dự án mở đầu bằng số ("01. ABC") — tránh đánh số ngược thứ tự.
  const sttFromName = hasSttField && (sttFromNameChoice ?? (ratio >= 0.5 && config?.columns.stt === undefined));
  const rows = useMemo(
    () => (config ? buildBulkRows(target, sheet, config, usedStt, { sttFromName }) : []),
    [target, sheet, config, usedStt, sttFromName],
  );
  const valid = rows.filter((r) => !r.errors.length);
  const invalid = rows.length - valid.length;

  if (phase !== 'map' || !wb || !config)
    return (
      <Modal size="sm" title={`Import .xlsx — ${scopeLabel}`} onClose={onClose}>
        {phase === 'loading' && <div className="empty">Đang đọc workbook…</div>}
        {phase === 'error' && (
          <div className="stack">
            <div className="alert error">
              <AlertTriangle size={16} />
              <div>
                <b>Không đọc được file.</b>
                <div>{error}</div>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose}>
                Đóng
              </button>
              <button className="btn primary" onClick={load}>
                Chọn file khác
              </button>
            </div>
          </div>
        )}
      </Modal>
    );

  const upd = (fn: (c: BulkConfig) => BulkConfig) => setConfig((c) => (c ? fn(structuredClone(c)) : c));
  const mappedFields = fields.filter((f) => config.columns[f.key] !== undefined);
  const missingRequired = fields.filter((f) => f.required && config.columns[f.key] === undefined);

  const pickParent = async () => {
    try {
      const dir = await api.pickFolder('Chọn nơi lưu thư mục dự án');
      if (dir) {
        setFolderParent(dir);
        setMakeFolders(true);
      }
    } catch (e) {
      toastError(e);
    }
  };

  const commit = async () => {
    if (!valid.length) return;
    if (isProject && makeFolders && !folderParent) {
      toast('error', 'Chọn nơi lưu thư mục dự án hoặc bỏ chọn "Tạo thư mục".');
      return;
    }
    setSaving(true);
    try {
      const res = await api.bulkImport({
        target,
        jobYearId,
        rows: valid.map(({ rowNumber, values }) => ({ rowNumber, values })),
        folderParent: isProject && makeFolders ? folderParent : null,
        workbookSignature: wb.signature,
        mappings: saveMapping ? bulkConfigToMappings(target, config) : [],
      });
      await refresh('masters', 'projects', 'years', 'freelance', 'settings');
      toast('success', `Đã import ${res.created} dòng vào ${scopeLabel}.`);
      const skipped = invalid + res.skipped.length;
      if (res.skipped.length)
        toast('warn', `Bỏ qua ${skipped} dòng lỗi: ${res.skipped.slice(0, 3).map((s) => `dòng ${s.rowNumber} — ${s.error}`).join('; ')}${res.skipped.length > 3 ? '…' : ''}`);
      else if (skipped) toast('warn', `Đã bỏ qua ${skipped} dòng lỗi (xem lại ở bước xem trước).`);
      if (res.newMasters.length)
        toast('info', `Đã thêm vào danh mục: ${res.newMasters.slice(0, 8).map((m) => `${MASTER_LABEL[m.kind]} "${m.name}"`).join(', ')}${res.newMasters.length > 8 ? '…' : ''}`);
      for (const n of res.notices.slice(0, 2)) toast('warn', n);
      await onDone();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const show = (key: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return <span className="faint">—</span>;
    const f = fields.find((x) => x.key === key);
    if (f?.type === 'date') return formatDate(String(v));
    if (key === 'password') return '••••••';
    return String(v);
  };

  return (
    <Modal
      size="xl"
      title={
        <span className="row">
          <FileSpreadsheet size={18} /> Import .xlsx vào {scopeLabel} — {wb.fileName}
        </span>
      }
      onClose={onClose}
      bodyStyle={{ overflow: 'hidden' }}
      footer={(close) => (
        <>
          <label className="row left small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={saveMapping} onChange={(e) => setSaveMapping(e.target.checked)} />
            Lưu mapping để dùng lại cho file cùng cấu trúc
          </label>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" disabled={!valid.length || saving} onClick={() => void commit()}>
            {saving ? 'Đang import…' : `Import ${valid.length} dòng`}
          </button>
        </>
      )}
    >
      <div className="wizard">
        <div className="wizard-left">
          <div className="card card-pad" style={{ padding: 12 }}>
            <div className="small">
              <b>{wb.fileName}</b> · {formatBytes(wb.sizeBytes)} · {wb.sheets.length} sheet
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn sm"
                onClick={() => {
                  setConfig(autoBulkConfig(wb.sheets, fields));
                  setUsedSaved(false);
                }}
              >
                <Wand2 size={13} /> Tự nhận diện lại
              </button>
              <button className="btn sm" onClick={load}>
                <RefreshCw size={13} /> Chọn file khác
              </button>
            </div>
          </div>
          {usedSaved && (
            <div className="alert info">
              <Info size={15} />
              <div>Đã áp dụng mapping đã lưu cho file cùng cấu trúc. Kiểm tra lại bản xem trước trước khi import.</div>
            </div>
          )}
          {wb.warnings.length > 0 && (
            <div className="alert warn">
              <AlertTriangle size={15} />
              <ul style={{ margin: 0 }}>
                {wb.warnings.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="form-section">
            <h3>Vùng dữ liệu</h3>
            <div className="stack" style={{ gap: 8 }}>
              <div className="field">
                <label>Sheet</label>
                <SheetSelect
                  sheets={wb.sheets}
                  value={config.sheet}
                  onChange={(v) => {
                    const auto = autoBulkConfig(wb.sheets.filter((s) => s.name === v), fields);
                    setConfig({ ...auto, sheet: v });
                  }}
                />
              </div>
              <div className="map-grid">
                <div className="field">
                  <label>Dòng header</label>
                  <RowInput label="Dòng header" min={0} value={config.headerRow} onChange={(v) => upd((c) => ((c.headerRow = v), c))} />
                </div>
                <div className="field">
                  <label>Đến dòng</label>
                  <div className="row" style={{ gap: 4 }}>
                    <RowInput label="Đến dòng" value={config.endRow} onChange={(v) => upd((c) => ((c.endRow = v), c))} />
                    <button
                      className="btn icon sm"
                      title="Tự xác định dòng cuối"
                      aria-label="Tự xác định dòng cuối"
                      onClick={() => sheet && upd((c) => ((c.endRow = lastDataRow(sheet, c.headerRow, Object.values(c.columns).filter((x): x is number => x !== undefined))), c))}
                    >
                      <Wand2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h3>Map cột → thông tin {BULK_TARGET_LABEL[target]}</h3>
            <div className="map-grid">
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label>
                    {f.label}
                    {f.required && <span className="req">*</span>}
                  </label>
                  <ColSelect sheet={sheet} headerRow={config.headerRow} value={config.columns[f.key]} onChange={(v) => upd((c) => ((c.columns[f.key] = v), c))} />
                  {f.hint && <div className="field-hint">{f.hint}</div>}
                </div>
              ))}
            </div>
            {hasSttField && (
              <label className="row small" style={{ cursor: 'pointer', marginTop: 10, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={sttFromName} onChange={(e) => setSttFromName(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  Lấy STT từ số ở đầu Tên dự án (vd “01. ABC” → STT 1, tên “ABC”) cho các dòng không có STT
                  {ratio > 0 && <span className="faint"> · {Math.round(ratio * 100)}% tên dự án có số ở đầu</span>}
                </span>
              </label>
            )}
            {missingRequired.length > 0 && (
              <div className="field-error" style={{ marginTop: 8 }}>
                Chưa chọn cột cho: {missingRequired.map((f) => f.label).join(', ')}
              </div>
            )}
          </section>

          {isProject && (
            <section className="form-section">
              <h3>Thư mục dự án trên máy</h3>
              <label className="row small" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={makeFolders} onChange={(e) => setMakeFolders(e.target.checked)} />
                Tạo thư mục “STT.Tên dự án_Tên SI_Hãng” cho từng dự án
              </label>
              {makeFolders && (
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="small grow ellipsis" title={folderParent ?? ''}>
                    {folderParent ? shortenPath(folderParent, 48) : <span className="field-error">Chưa chọn nơi lưu</span>}
                  </span>
                  <button className="btn sm" onClick={() => void pickParent()}>
                    <FolderOpen size={13} /> {folderParent ? 'Đổi nơi lưu…' : 'Chọn nơi lưu…'}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="wizard-right">
          <div className="row small" style={{ fontWeight: 650 }}>
            Xem trước — {rows.length} dòng ·<span style={{ color: 'var(--success, inherit)' }}>{valid.length} hợp lệ</span>
            {invalid > 0 && <span style={{ color: 'var(--danger)' }}>· {invalid} lỗi (sẽ bỏ qua)</span>}
          </div>
          <div style={{ overflow: 'auto', flex: 1, paddingRight: 4 }}>
            {!mappedFields.length || !rows.length ? (
              <div className="alert warn">
                <AlertTriangle size={15} />
                <div>Chưa có dòng dữ liệu nào. Hãy chọn sheet, dòng header và map các cột ở bên trái.</div>
              </div>
            ) : (
              <table className="tbl bulk-preview">
                <thead>
                  <tr>
                    <th>Dòng</th>
                    <th>Lỗi / lưu ý</th>
                    {mappedFields.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_MAX).map((r) => (
                    <tr key={r.rowNumber} className={r.errors.length ? 'bulk-bad' : ''}>
                      <td className="num faint">{r.rowNumber}</td>
                      <td className="bulk-err">
                        {r.errors.join(' ')}
                        {r.warnings.length > 0 && <span className="bulk-warn">{r.warnings.join(' ')}</span>}
                        {!r.errors.length && !r.warnings.length && <span className="faint">—</span>}
                      </td>
                      {mappedFields.map((f) => (
                        <td key={f.key}>{show(f.key, r.values[f.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rows.length > PREVIEW_MAX && <div className="small faint" style={{ marginTop: 6 }}>Chỉ hiển thị {PREVIEW_MAX} dòng đầu; khi import sẽ xử lý đủ {rows.length} dòng.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
