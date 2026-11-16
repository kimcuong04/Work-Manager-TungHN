import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Info, RefreshCw, Wand2 } from 'lucide-react';
import type { WorkbookData, WorkbookSheet } from '../../shared/types';
import {
  INFO_FIELDS,
  ITEM_FIELDS,
  REQ_FIELDS,
  autoDetect,
  buildImport,
  cellText,
  colName,
  configFromMappings,
  configToMappings,
  detectTableEnd,
  getSheet,
  type ImportConfig,
  type InfoField,
} from '../../shared/xlsxMapping';
import { api, errorMessage } from '../api';
import { useUi } from '../state/ui';
import { formatBytes } from './common';
import { ImportedContent } from './ImportedContent';
import { Modal } from './Modal';

const GRID_ROWS = 400;

function ColSelect({
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

function RowInput({ value, onChange, min = 1, label }: { value: number; onChange: (v: number) => void; min?: number; label: string }) {
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

function SheetSelect({ sheets, value, onChange }: { sheets: WorkbookSheet[]; value: string; onChange: (v: string) => void }) {
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

function SheetGrid({ sheet, config }: { sheet: WorkbookSheet; config: ImportConfig }) {
  const rowClass = (r: number) => {
    const { info, requirements: rq, items } = config;
    if (items.enabled && items.sheet === sheet.name) {
      if (r === items.headerRow) return 'm-item m-head';
      if (r > items.headerRow && r <= items.endRow) return 'm-item';
    }
    if (rq.enabled && rq.sheet === sheet.name) {
      if (r === rq.headerRow) return 'm-req m-head';
      if (r > rq.headerRow && r <= rq.endRow) return 'm-req';
    }
    if (info.enabled && info.sheet === sheet.name && r >= info.startRow && r <= info.endRow) return 'm-info';
    return '';
  };
  const cols = Math.max(sheet.colCount, 1);
  return (
    <div className="table-wrap" style={{ flex: 1 }}>
      <table className="sheet-grid">
        <thead>
          <tr>
            <th />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c}>{colName(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.slice(0, GRID_ROWS).map((row, r) => (
            <tr key={r} className={rowClass(r)}>
              <td className="rn">{r + 1}</td>
              {Array.from({ length: cols }, (_, c) => {
                const t = cellText(row[c]);
                return (
                  <td key={c} title={t.length > 30 ? t : undefined}>
                    {t}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.rows.length > GRID_ROWS && <div className="faint small" style={{ padding: 8 }}>Chỉ hiển thị {GRID_ROWS} dòng đầu để xem trước; import vẫn dùng toàn bộ vùng đã chọn.</div>}
    </div>
  );
}

/**
 * Luồng import: Chọn file → Đọc workbook → Chọn sheet/vùng + mapping → Preview → Xác nhận.
 * Chỉ ghi khi người dùng xác nhận; lỗi giữa chừng không đụng dữ liệu import cũ.
 */
export function ImportWizard({ projectId, hasExisting, onClose, onDone }: { projectId: string; hasExisting: boolean; onClose: () => void; onDone: () => void }) {
  const { confirm, toast, toastError } = useUi();
  const [phase, setPhase] = useState<'loading' | 'map' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [config, setConfig] = useState<ImportConfig | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [usedSaved, setUsedSaved] = useState(false);
  const [viewSheet, setViewSheet] = useState('');
  const [tab, setTab] = useState<'sheet' | 'preview'>('preview');
  const [saveMapping, setSaveMapping] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setPhase('loading');
    setError(null);
    try {
      const path = await api.pickWorkbook();
      if (!path) return onClose();
      const data = await api.readWorkbook(path);
      const saved = configFromMappings(data.sheets, data.savedMappings);
      const auto = autoDetect(data.sheets);
      setWb(data);
      setConfig(saved ?? auto.config);
      setUsedSaved(!!saved);
      setNotes(saved ? [] : auto.notes);
      setViewSheet(data.sheets.find((s) => s.rowCount > 0)?.name ?? data.sheets[0].name);
      setTab(saved || auto.notes.length < 3 ? 'preview' : 'sheet');
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

  const built = useMemo(() => (wb && config ? buildImport(wb.sheets, config) : null), [wb, config]);

  if (phase !== 'map' || !wb || !config || !built)
    return (
      <Modal size="sm" title="Import .xlsx" onClose={onClose}>
        {phase === 'loading' && <div className="empty">Đang đọc workbook…</div>}
        {phase === 'error' && (
          <div className="stack">
            <div className="alert error">
              <AlertTriangle size={16} />
              <div>
                <b>Không import được.</b>
                <div>{error}</div>
                {hasExisting && <div className="small">Dữ liệu import hiện tại của Project vẫn được giữ nguyên.</div>}
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
  const infoSheet = getSheet(sheets, config.info.sheet);
  const reqSheet = getSheet(sheets, config.requirements.sheet);
  const itemSheet = getSheet(sheets, config.items.sheet);
  const hasData = built.info.some((r) => r.fieldValue.trim()) || built.requirements.length > 0 || built.items.length > 0;

  const infoRowOptions: { r: number; label: string }[] = [];
  if (infoSheet)
    for (let r = config.info.startRow; r <= Math.min(config.info.endRow, config.info.startRow + 200); r++) {
      const k = cellText(infoSheet.rows[r]?.[config.info.keyCol]);
      if (k) infoRowOptions.push({ r, label: `Dòng ${r + 1}: ${k.slice(0, 40)}` });
    }

  const redetect = () => {
    const auto = autoDetect(sheets);
    setConfig(auto.config);
    setNotes(auto.notes);
    setUsedSaved(false);
  };

  const commit = async () => {
    if (!hasData) return;
    if (
      hasExisting &&
      !(await confirm({
        title: 'Thay thế dữ liệu import?',
        message: 'Project này đã có dữ liệu Excel. Nội dung import hiện tại sẽ được thay thế hoàn toàn bằng dữ liệu mới. Tiếp tục?',
        confirmText: 'Thay thế',
        danger: true,
      }))
    )
      return;
    setSaving(true);
    try {
      await api.commitImport(projectId, {
        sourceFileName: wb.fileName,
        sourcePath: wb.filePath,
        sheetNames: [...new Set([config.info, config.requirements, config.items].filter((s) => s.enabled).map((s) => s.sheet))],
        workbookSignature: wb.signature,
        info: built.info,
        requirements: built.requirements,
        items: built.items,
        mappings: saveMapping ? configToMappings(config) : [],
      });
      toast('success', `Đã import ${built.items.length} thiết bị, ${built.requirements.length} lần yêu cầu từ ${wb.fileName}.`);
      onDone();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const sectionHead = (title: string, color: string, enabled: boolean, onToggle: (v: boolean) => void) => (
    <label className="row" style={{ fontWeight: 650, cursor: 'pointer' }}>
      <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
      <span className="legend-dot" style={{ background: color }} />
      {title}
    </label>
  );

  return (
    <Modal
      size="xl"
      title={
        <span className="row">
          <FileSpreadsheet size={18} /> Import .xlsx — {wb.fileName}
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
          <button className="btn primary" disabled={!hasData || saving} onClick={commit} title={hasData ? undefined : 'Chưa có dữ liệu nào được map'}>
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
              <button className="btn sm" onClick={redetect}>
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
            {sectionHead('A. Thông tin dự án (key–value)', 'color-mix(in srgb, var(--new) 45%, transparent)', config.info.enabled, (v) =>
              upd((c) => ((c.info.enabled = v), c)),
            )}
            {config.info.enabled && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <SheetSelect sheets={sheets} value={config.info.sheet} onChange={(v) => upd((c) => ((c.info.sheet = v), (c.info.fieldRows = {}), c))} />
                <div className="map-grid">
                  <div className="field">
                    <label>Cột nhãn</label>
                    <ColSelect sheet={infoSheet} headerRow={-1} optional={false} value={config.info.keyCol} onChange={(v) => upd((c) => ((c.info.keyCol = v ?? 0), c))} />
                  </div>
                  <div className="field">
                    <label>Cột giá trị</label>
                    <ColSelect sheet={infoSheet} headerRow={-1} optional={false} value={config.info.valueCol} onChange={(v) => upd((c) => ((c.info.valueCol = v ?? 1), c))} />
                  </div>
                  <div className="field">
                    <label>Từ dòng</label>
                    <RowInput label="Từ dòng" value={config.info.startRow} onChange={(v) => upd((c) => ((c.info.startRow = v), c))} />
                  </div>
                  <div className="field">
                    <label>Đến dòng</label>
                    <RowInput label="Đến dòng" value={config.info.endRow} onChange={(v) => upd((c) => ((c.info.endRow = v), c))} />
                  </div>
                </div>
                {INFO_FIELDS.map((f) => (
                  <div key={f.key} className="row">
                    <span className="small" style={{ width: 120, flexShrink: 0 }}>
                      {f.label}
                    </span>
                    <select
                      className="select"
                      value={config.info.fieldRows[f.key as InfoField] ?? ''}
                      onChange={(e) =>
                        upd((c) => {
                          if (e.target.value === '') delete c.info.fieldRows[f.key as InfoField];
                          else c.info.fieldRows[f.key as InfoField] = Number(e.target.value);
                          return c;
                        })
                      }
                    >
                      <option value="">— Không có —</option>
                      {infoRowOptions.map((o) => (
                        <option key={o.r} value={o.r}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <label className="row small" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={config.info.includeExtra} onChange={(e) => upd((c) => ((c.info.includeExtra = e.target.checked), c))} />
                  Thêm các dòng không map vào bảng như trường bổ sung
                </label>
              </div>
            )}
          </section>

          <section className="form-section">
            {sectionHead('B. Nội dung yêu cầu', 'color-mix(in srgb, var(--attention) 45%, transparent)', config.requirements.enabled, (v) =>
              upd((c) => ((c.requirements.enabled = v), c)),
            )}
            {config.requirements.enabled && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <SheetSelect sheets={sheets} value={config.requirements.sheet} onChange={(v) => upd((c) => ((c.requirements.sheet = v), (c.requirements.columns = {}), c))} />
                <div className="map-grid">
                  <div className="field">
                    <label>Dòng header (0 = không có)</label>
                    <RowInput label="Dòng header" min={0} value={config.requirements.headerRow} onChange={(v) => upd((c) => ((c.requirements.headerRow = v), c))} />
                  </div>
                  <div className="field">
                    <label>Đến dòng</label>
                    <RowInput label="Đến dòng" value={config.requirements.endRow} onChange={(v) => upd((c) => ((c.requirements.endRow = v), c))} />
                  </div>
                  {REQ_FIELDS.map((f) => (
                    <div className="field" key={f.key}>
                      <label>
                        {f.label}
                        {f.key === 'content' && <span className="req">*</span>}
                      </label>
                      <ColSelect
                        sheet={reqSheet}
                        headerRow={config.requirements.headerRow}
                        value={config.requirements.columns[f.key]}
                        onChange={(v) => upd((c) => ((c.requirements.columns[f.key] = v), c))}
                      />
                    </div>
                  ))}
                </div>
                <label className="row small" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.requirements.mergeContinuation}
                    onChange={(e) => upd((c) => ((c.requirements.mergeContinuation = e.target.checked), c))}
                  />
                  Dòng không có số “Lần” là phần tiếp theo của lần phía trên
                </label>
              </div>
            )}
          </section>

          <section className="form-section">
            {sectionHead('C. Thiết bị / sản phẩm', 'color-mix(in srgb, var(--success) 45%, transparent)', config.items.enabled, (v) =>
              upd((c) => ((c.items.enabled = v), c)),
            )}
            {config.items.enabled && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <SheetSelect sheets={sheets} value={config.items.sheet} onChange={(v) => upd((c) => ((c.items.sheet = v), (c.items.columns = {}), c))} />
                <div className="map-grid">
                  <div className="field">
                    <label>Dòng header</label>
                    <RowInput label="Dòng header" min={0} value={config.items.headerRow} onChange={(v) => upd((c) => ((c.items.headerRow = v), c))} />
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
                          itemSheet &&
                          upd((c) => ((c.items.endRow = detectTableEnd(itemSheet, c.items.headerRow, Object.values(c.items.columns) as number[])), c))
                        }
                      >
                        <Wand2 size={13} />
                      </button>
                    </div>
                  </div>
                  {ITEM_FIELDS.map((f) => (
                    <div className="field" key={f.key}>
                      <label>{f.label}</label>
                      <ColSelect sheet={itemSheet} headerRow={config.items.headerRow} value={config.items.columns[f.key]} onChange={(v) => upd((c) => ((c.items.columns[f.key] = v), c))} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="wizard-right">
          <div className="row">
            <div className="tabs small" style={{ marginBottom: 0, flex: 1 }}>
              <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
                Preview kết quả ({built.items.length} thiết bị · {built.requirements.length} lần yêu cầu)
              </button>
              <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
                Dữ liệu sheet
              </button>
            </div>
            {tab === 'sheet' && <SheetSelect sheets={sheets} value={viewSheet} onChange={setViewSheet} />}
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
          {tab === 'sheet' ? (
            <>
              <div className="small muted">
                <span className="legend-dot" style={{ background: 'color-mix(in srgb, var(--new) 45%, transparent)' }} />
                Thông tin dự án
                <span className="legend-dot" style={{ background: 'color-mix(in srgb, var(--attention) 45%, transparent)', marginLeft: 12 }} />
                Nội dung yêu cầu
                <span className="legend-dot" style={{ background: 'color-mix(in srgb, var(--success) 45%, transparent)', marginLeft: 12 }} />
                Thiết bị (dòng đậm = header)
              </div>
              {getSheet(sheets, viewSheet) && <SheetGrid sheet={getSheet(sheets, viewSheet)!} config={config} />}
            </>
          ) : (
            <div style={{ overflow: 'auto', flex: 1, paddingRight: 4 }}>
              {!hasData ? (
                <div className="alert warn">
                  <AlertTriangle size={15} />
                  <div>Chưa có dữ liệu nào được map. Hãy chọn sheet, vùng dữ liệu và cột ở bên trái (xem tab “Dữ liệu sheet” để biết số dòng/cột).</div>
                </div>
              ) : (
                <ImportedContent info={built.info} requirements={built.requirements} items={built.items} compact />
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
