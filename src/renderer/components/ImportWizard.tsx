import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Info, RefreshCw, Wand2 } from 'lucide-react';
import type { ImportPayload, ProjectImport, WorkbookData, WorkbookSheet } from '../../shared/types';
import { ITEM_FIELDS, autoDetect, buildImport, cellText, colName, configFromMappings, configToMappings, detectItemsInSheet, detectTableEnd, getSheet, type ImportConfig } from '../../shared/xlsxMapping';
import { importTabBase } from '../../shared/validation';
import { api, errorMessage } from '../api';
import { useUi } from '../state/ui';
import { formatBytes } from './common';
import { ImportedContent } from './ImportedContent';
import { Modal } from './Modal';
import { formatDateTime } from '../../shared/dates';

export function ColSelect({
  sheet,
  headerRow,
  value,
  onChange,
  optional,
}: {
  sheet: WorkbookSheet | undefined;
  headerRow: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  optional?: boolean;
}) {
  const count = Math.max(sheet?.colCount ?? 0, (value ?? -1) + 1, 1);
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
      {optional !== false && <option value="">— Không map —</option>}
      {Array.from({ length: count }, (_, c) => {
        const head = sheet && headerRow >= 0 ? cellText(sheet.rows[headerRow]?.[c]) : '';
        return (
          <option key={c} value={c}>
            {colName(c)}
            {head ? ` — ${head.slice(0, 30)}` : ''}
          </option>
        );
      })}
    </select>
  );
}

export function RowInput({ value, onChange, min = 1, label }: { value: number; onChange: (v: number) => void; min?: number; label: string }) {
  return (
    <input
      className="input"
      type="number"
      min={min}
      value={value + 1}
      aria-label={label}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.max(min - 1, Math.floor(n) - 1));
      }}
    />
  );
}

export function SheetSelect({ sheets, value, onChange }: { sheets: WorkbookSheet[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {sheets.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name} ({s.rowCount}×{s.colCount})
        </option>
      ))}
    </select>
  );
}

/** Chỉ import bảng thiết bị: tắt hẳn phần Thông tin dự án / Nội dung yêu cầu của bộ nhận diện. */
function itemsOnly(c: ImportConfig): ImportConfig {
  return { ...c, info: { ...c.info, enabled: false }, requirements: { ...c.requirements, enabled: false } };
}

/**
 * Luồng import: Chọn file → Đọc workbook → Chọn sheet/vùng + map cột thiết bị → Preview → Xác nhận.
 * Chỉ ghi khi người dùng xác nhận; lỗi giữa chừng không đụng dữ liệu import cũ.
 */
export function ImportWizard({
  projectId,
  hasExisting,
  replaceImport,
  commitTo,
  existing,
  onClose,
  onDone,
}: {
  projectId: string;
  /** Các bảng đã import của cùng chủ sở hữu: import lại cùng file thì tự chọn sẵn sheet chưa import. */
  existing?: ProjectImport[];
  /** Lưu bảng import vào nơi khác dự án (vd Sự kiện tạm thời); bỏ trống = bảng import của dự án `projectId`. */
  commitTo?: (payload: ImportPayload, replaceImportId: string | null) => Promise<ProjectImport>;
  hasExisting: boolean;
  /** Import lại: thay đúng bảng này; bỏ trống = thêm một bảng mới (Import thêm). */
  replaceImport?: ProjectImport | null;
  onClose: () => void;
  onDone: (saved: ProjectImport) => void;
}) {
  const { confirm, toast, toastError } = useUi();
  const [phase, setPhase] = useState<'loading' | 'map' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [config, setConfig] = useState<ImportConfig | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [usedSaved, setUsedSaved] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [saveMapping, setSaveMapping] = useState(true);
  const [saving, setSaving] = useState(false);

  const applyAuto = (sheets: WorkbookSheet[]) => {
    const auto = autoDetect(sheets);
    setConfig(itemsOnly(auto.config));
    setNotes(auto.config.items.enabled ? [] : ['Không nhận diện được bảng thiết bị — hãy chọn sheet, dòng header và cột ở bên trái.']);
    setUsedSaved(false);
  };

  const load = async () => {
    setPhase('loading');
    setError(null);
    try {
      const path = await api.pickWorkbook();
      if (!path) return onClose();
      const data = await api.readWorkbook(path);
      const saved = configFromMappings(data.sheets, data.savedMappings);
      setWb(data);
      let cfg: ImportConfig;
      let fromSaved = false;
      let warn: string[] = [];
      if (saved && saved.items.enabled) {
        cfg = itemsOnly(saved);
        fromSaved = true;
      } else {
        const auto = autoDetect(data.sheets);
        cfg = itemsOnly(auto.config);
        if (!auto.config.items.enabled) warn = ['Không nhận diện được bảng thiết bị — hãy chọn sheet, dòng header và cột ở bên trái.'];
      }
      // Cùng một file đã import (vd sheet 1) thì chọn sẵn sheet chưa import có bảng thiết bị, để import tiếp sheet khác
      // của file đó; không sheet nào khác có bảng thì giữ sheet cũ (import lại bản cập nhật vẫn được).
      const done = importedSheetsOf(data);
      let message: string | null = null;
      if (!replaceImport && done.has(cfg.items.sheet)) {
        const next = data.sheets.filter((s) => !done.has(s.name)).map((s) => detectItemsInSheet(s)).find((x) => !!x) ?? null;
        const doneList = [...done].map((n) => `"${n}"`).join(', ');
        if (next) {
          cfg = { ...cfg, items: next };
          fromSaved = false;
          warn = [];
          message = `File này đã import sheet ${doneList} — đã chọn sẵn sheet "${next.sheet}" chưa import. Bấm sheet khác ở trên nếu cần.`;
        } else
          message = `File này đã import sheet ${doneList} — vẫn import thêm được (tạo thêm một bảng). Muốn lấy sheet khác thì bấm sheet ở trên rồi chọn dòng header / cột.`;
      }
      setConfig(cfg);
      setNotes(warn);
      setUsedSaved(fromSaved);
      setInfo(message);
      setPhase('map');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  };

  const importedSheetsOf = (data: WorkbookData) => {
    const same = (existing ?? []).filter(
      (i) =>
        i.id !== replaceImport?.id &&
        (i.sourcePath && data.filePath ? i.sourcePath.toLowerCase() === data.filePath.toLowerCase() : i.sourceFileName.toLowerCase() === data.fileName.toLowerCase()),
    );
    return new Set(same.flatMap((i) => i.sheetNames));
  };

  // StrictMode (dev) chạy effect 2 lần — không được mở hộp thoại chọn file 2 lần.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const built = useMemo(() => (wb && config ? buildImport(wb.sheets, config) : null), [wb, config]);

  if (phase !== 'map' || !wb || !config || !built)
    return (
      <Modal size="sm" title={replaceImport ? 'Import lại .xlsx' : hasExisting ? 'Import thêm .xlsx' : 'Import .xlsx'} onClose={onClose}>
        {phase === 'loading' && <div className="empty">Đang đọc workbook…</div>}
        {phase === 'error' && (
          <div className="stack">
            <div className="alert error">
              <AlertTriangle size={16} />
              <div>
                <b>Không import được.</b>
                <div>{error}</div>
                {hasExisting && <div className="small">Các bảng import hiện có của Project vẫn được giữ nguyên.</div>}
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

  const sheets = wb.sheets;
  const upd = (fn: (c: ImportConfig) => ImportConfig) => setConfig((c) => (c ? fn(structuredClone(c)) : c));
  const itemSheet = getSheet(sheets, config.items.sheet);
  const hasData = built.items.length > 0;
  const importedSheets = importedSheetsOf(wb);
  // Tên tab kèm tên sheet chỉ khi file có nhiều bảng thiết bị (hoặc chọn tay một sheet khác), để phân biệt các tab cùng file.
  const needsSheetInName = () => {
    const tables = sheets.filter((s) => detectItemsInSheet(s)).map((s) => s.name);
    return tables.length > 1 || (sheets.length > 1 && !tables.includes(config.items.sheet));
  };
  const pickSheet = (name: string) => {
    const sheet = getSheet(sheets, name);
    if (!sheet) return;
    const d = detectItemsInSheet(sheet);
    upd((c) => ((c.items = d ?? { ...c.items, enabled: true, sheet: name, columns: {} }), c));
    setNotes(d ? [] : [`Không nhận diện được bảng thiết bị trong sheet "${name}" — hãy chọn dòng header và cột ở bên trái.`]);
    setUsedSaved(false);
  };

  const commit = async () => {
    if (!hasData) return;
    if (
      replaceImport &&
      !(await confirm({
        title: 'Import lại bảng này?',
        message: `Bảng "${replaceImport.name}" (file ${replaceImport.sourceFileName}, import ${formatDateTime(replaceImport.importedAt)}) sẽ được thay hoàn toàn bằng dữ liệu mới, giữ nguyên vị trí tab. Các bảng import khác giữ nguyên. Tiếp tục?`,
        confirmText: 'Thay thế',
        danger: true,
      }))
    )
      return;
    setSaving(true);
    try {
      const saved = await (commitTo ?? ((p: ImportPayload, r: string | null) => api.commitImport(projectId, p, r)))(
        {
        sourceFileName: wb.fileName,
        sourcePath: wb.filePath,
        sheetNames: [config.items.sheet],
        workbookSignature: wb.signature,
        tabName: needsSheetInName() ? importTabBase(wb.fileName, config.items.sheet) : undefined,
        info: [],
        requirements: [],
        items: built.items,
        mappings: saveMapping ? configToMappings(config) : [],
        },
        replaceImport?.id ?? null,
      );
      toast('success', replaceImport ? `Đã import lại ${built.items.length} thiết bị từ ${wb.fileName}.` : `Đã thêm bảng ${built.items.length} thiết bị từ ${wb.fileName}.`);
      onDone(saved);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="xl"
      title={
        <span className="row">
          <FileSpreadsheet size={18} /> {replaceImport ? 'Import lại' : hasExisting ? 'Import thêm' : 'Import'} .xlsx — {wb.fileName}
        </span>
      }
      onClose={onClose}
      bodyStyle={{ overflow: 'hidden' }}
      footer={(close) => (
        <>
          <label className="row left small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={saveMapping} onChange={(e) => setSaveMapping(e.target.checked)} />
            Lưu mapping để tái sử dụng cho workbook cùng cấu trúc
          </label>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" disabled={!hasData || saving} onClick={commit} title={hasData ? undefined : 'Chưa có dòng thiết bị nào'}>
            {saving ? 'Đang import…' : 'Xác nhận Import'}
          </button>
        </>
      )}
    >
      <div className="wizard">
        <div className="wizard-left">
          <div className="card card-pad" style={{ padding: 12 }}>
            <div className="small">
              <b>{wb.fileName}</b> · {formatBytes(wb.sizeBytes)} · {sheets.length} sheet
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {sheets.map((s) => `${s.name} (${s.rowCount} dòng × ${s.colCount} cột)`).join(' · ')}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => applyAuto(sheets)}>
                <Wand2 size={13} /> Tự nhận diện lại
              </button>
              <button className="btn sm" onClick={load}>
                <RefreshCw size={13} /> Chọn file khác
              </button>
            </div>
          </div>
          {info && (
            <div className="alert info">
              <Info size={15} />
              <div>{info}</div>
            </div>
          )}
          {usedSaved && (
            <div className="alert info">
              <Info size={15} />
              <div>Đã áp dụng mapping đã lưu cho workbook có cấu trúc tương tự. Kiểm tra lại preview trước khi import.</div>
            </div>
          )}
          {(notes.length > 0 || wb.warnings.length > 0) && (
            <div className="alert warn">
              <AlertTriangle size={15} />
              <ul style={{ margin: 0 }}>
                {[...wb.warnings, ...notes].map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="form-section">
            <h3>Thông tin các thiết bị</h3>
            <div className="stack" style={{ gap: 8 }}>
              <div className="field">
                <label>Sheet {sheets.length > 1 && <span className="faint small">— mỗi lần import một sheet, import lại cùng file để lấy sheet khác</span>}</label>
                <div className="sheet-chips" role="radiogroup" aria-label="Sheet cần import">
                  {sheets.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      role="radio"
                      aria-checked={config.items.sheet === s.name}
                      className={`sheet-chip ${config.items.sheet === s.name ? 'on' : ''}`}
                      title={`${s.name}: ${s.rowCount} dòng × ${s.colCount} cột${importedSheets.has(s.name) ? ' — đã import từ file này' : ''}`}
                      onClick={() => pickSheet(s.name)}
                    >
                      <FileSpreadsheet size={13} />
                      <span className="ellipsis">{s.name}</span>
                      {importedSheets.has(s.name) && <span className="badge">đã import</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="map-grid">
                <div className="field">
                  <label>Dòng header</label>
                  <RowInput label="Dòng header" min={0} value={config.items.headerRow} onChange={(v) => upd((c) => ((c.items.enabled = true), (c.items.headerRow = v), c))} />
                </div>
                <div className="field">
                  <label>Đến dòng</label>
                  <div className="row" style={{ gap: 4 }}>
                    <RowInput label="Đến dòng" value={config.items.endRow} onChange={(v) => upd((c) => ((c.items.endRow = v), c))} />
                    <button
                      className="btn icon sm"
                      title="Tự xác định dòng cuối"
                      aria-label="Tự xác định dòng cuối"
                      onClick={() =>
                        itemSheet && upd((c) => ((c.items.endRow = detectTableEnd(itemSheet, c.items.headerRow, Object.values(c.items.columns) as number[])), c))
                      }
                    >
                      <Wand2 size={13} />
                    </button>
                  </div>
                </div>
                {ITEM_FIELDS.map((f) => (
                  <div className="field" key={f.key}>
                    <label>{f.label}</label>
                    <ColSelect
                      sheet={itemSheet}
                      headerRow={config.items.headerRow}
                      value={config.items.columns[f.key]}
                      onChange={(v) => upd((c) => ((c.items.enabled = true), (c.items.columns[f.key] = v), c))}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="wizard-right">
          <div className="small" style={{ fontWeight: 650 }}>
            Preview — {built.items.length} thiết bị
          </div>
          {built.warnings.length > 0 && (
            <div className="alert warn">
              <AlertTriangle size={15} />
              <ul style={{ margin: 0 }}>
                {built.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ overflow: 'auto', flex: 1, paddingRight: 4 }}>
            {!hasData ? (
              <div className="alert warn">
                <AlertTriangle size={15} />
                <div>Chưa có dòng thiết bị nào. Hãy chọn sheet, dòng header và các cột Model / Hãng / Mô tả ở bên trái.</div>
              </div>
            ) : (
              <ImportedContent items={built.items} compact />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
