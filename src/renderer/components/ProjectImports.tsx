import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FilePlus2, FileSpreadsheet, RefreshCw, Trash2, Upload } from 'lucide-react';
import { formatDate, formatDateTime } from '../../shared/dates';
import type { ProjectImport } from '../../shared/types';
import { api } from '../api';
import { useUi } from '../state/ui';
import { EmptyState, shortenPath } from './common';
import { ImportedContent } from './ImportedContent';
import { ImportWizard } from './ImportWizard';

const localDay = (stamp: string) => {
  const d = new Date(stamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeOf = (stamp: string) => formatDateTime(stamp).split(' ').pop() ?? '';

/**
 * Các bảng thiết bị import của một dự án, xếp theo ngày import (mới nhất trước) dạng cây thu gọn:
 * Ngày › từng bảng (bấm mũi tên để ẩn/hiện). Mặc định chỉ mở bảng mới nhất; bảng vừa import thêm tự mở.
 */
export function ProjectImports({ projectId, imports, onChanged }: { projectId: string; imports: ProjectImport[] | undefined; onChanged: () => void }) {
  const { confirm, toast, toastError } = useUi();
  const [wizard, setWizard] = useState<{ replace?: ProjectImport } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!imports) return;
    const fresh = seen.current === null ? imports.slice(0, 1) : imports.filter((i) => !seen.current!.has(i.id));
    seen.current = new Set(imports.map((i) => i.id));
    if (fresh.length)
      setOpen((s) => {
        const next = new Set(s);
        for (const i of fresh) next.add(`d:${localDay(i.importedAt)}`).add(`i:${i.id}`);
        return next;
      });
  }, [imports]);

  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const remove = async (imp: ProjectImport) => {
    const ok = await confirm({
      title: 'Gỡ bảng import',
      message: (
        <>
          Gỡ bảng <b>{imp.sourceFileName}</b> (import {formatDateTime(imp.importedAt)}, {imp.items.length} thiết bị) khỏi Project?
          <br />
          <span className="muted small">Các bảng khác, Project và file XLSX gốc trên máy không bị ảnh hưởng.</span>
        </>
      ),
      confirmText: 'Gỡ bảng',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeImport(projectId, imp.id);
      toast('success', `Đã gỡ bảng ${imp.sourceFileName}.`);
      onChanged();
    } catch (e) {
      toastError(e);
    }
  };

  const groups: { day: string; items: ProjectImport[] }[] = [];
  for (const imp of imports ?? []) {
    const day = localDay(imp.importedAt);
    const g = groups.find((x) => x.day === day);
    if (g) g.items.push(imp);
    else groups.push({ day, items: [imp] });
  }
  const total = (imports ?? []).reduce((n, i) => n + i.items.length, 0);

  return (
    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <h2 className="card-title grow" style={{ margin: 0 }}>
          <FileSpreadsheet size={18} /> Thiết bị (import Excel)
          {imports && imports.length > 0 && (
            <span className="badge" style={{ marginLeft: 8 }}>
              {imports.length} bảng · {total} thiết bị
            </span>
          )}
        </h2>
        {imports && imports.length > 0 && (
          <>
            {open.size > 0 && (
              <button className="btn sm ghost" onClick={() => setOpen(new Set())}>
                Thu gọn tất cả
              </button>
            )}
            <button className="btn sm primary" onClick={() => setWizard({})}>
              <FilePlus2 size={14} /> Import thêm xlsx
            </button>
          </>
        )}
      </div>
      {imports === undefined ? (
        <div className="faint">Đang tải…</div>
      ) : imports.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet size={36} />}
          title="Chưa có dữ liệu Excel"
          text="Import workbook .xlsx để lấy bảng thông tin các thiết bị (Model / Hãng / Mô tả). Sau đó có thể Import thêm nhiều bảng khác, mỗi bảng ghi theo ngày import."
          action={
            <button className="btn primary" onClick={() => setWizard({})}>
              <Upload size={15} /> Import .xlsx
            </button>
          }
        />
      ) : (
        <div className="import-tree" role="tree" aria-label="Các bảng import theo ngày">
          {groups.map((g) => {
            const dayOpen = open.has(`d:${g.day}`);
            return (
              <div key={g.day} className="import-day" role="treeitem" aria-expanded={dayOpen}>
                <button className="tree-toggle" onClick={() => toggle(`d:${g.day}`)} aria-label={`Ngày import ${formatDate(g.day)}`}>
                  <ChevronRight size={16} className={`tree-chevron ${dayOpen ? 'open' : ''}`} />
                  <b>Ngày {formatDate(g.day)}</b>
                  <span className="small muted">
                    {g.items.length} bảng · {g.items.reduce((n, i) => n + i.items.length, 0)} thiết bị
                  </span>
                </button>
                {dayOpen && (
                  <div className="import-day-body" role="group">
                    {g.items.map((imp) => {
                      const itemOpen = open.has(`i:${imp.id}`);
                      return (
                        <div key={imp.id} className="import-entry" role="treeitem" aria-expanded={itemOpen}>
                          <div className="import-entry-head">
                            <button className="tree-toggle grow" onClick={() => toggle(`i:${imp.id}`)} aria-label={`Bảng ${imp.sourceFileName} import lúc ${timeOf(imp.importedAt)}`}>
                              <ChevronRight size={15} className={`tree-chevron ${itemOpen ? 'open' : ''}`} />
                              <FileSpreadsheet size={15} className="faint" />
                              <span className="ellipsis" style={{ fontWeight: 600 }}>
                                {imp.sourceFileName}
                              </span>
                              <span className="small muted nowrap">
                                {timeOf(imp.importedAt)} · {imp.items.length} thiết bị
                              </span>
                            </button>
                            <button className="btn sm" onClick={() => setWizard({ replace: imp })} aria-label={`Import lại bảng ${imp.sourceFileName} (${timeOf(imp.importedAt)})`}>
                              <RefreshCw size={13} /> Import lại
                            </button>
                            <button
                              className="btn sm icon ghost"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => void remove(imp)}
                              aria-label={`Gỡ bảng ${imp.sourceFileName} (${timeOf(imp.importedAt)})`}
                              title="Gỡ bảng này"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {itemOpen && (
                            <div className="import-entry-body">
                              <div className="small faint ellipsis" title={imp.sourcePath ?? ''} style={{ marginBottom: 8 }}>
                                Import lúc {formatDateTime(imp.importedAt)} · {imp.sourcePath ? shortenPath(imp.sourcePath, 80) : imp.sourceFileName} · Sheet:{' '}
                                {imp.sheetNames.join(', ')}
                              </div>
                              <ImportedContent items={imp.items} bare />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {wizard && (
        <ImportWizard
          projectId={projectId}
          hasExisting={(imports?.length ?? 0) > 0}
          replaceImport={wizard.replace ?? null}
          onClose={() => setWizard(null)}
          onDone={(saved) => {
            if (wizard.replace) seen.current?.delete(wizard.replace.id);
            seen.current?.delete(saved.id);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
