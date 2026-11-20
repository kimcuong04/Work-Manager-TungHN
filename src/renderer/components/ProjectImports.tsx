import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FilePlus2, FileSpreadsheet, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { formatDateTime } from '../../shared/dates';
import { cleanName, normalizeText } from '../../shared/text';
import type { ImportPayload, ProjectImport } from '../../shared/types';
import { IMPORT_TAB_NAME_MAX, validateImportTabName } from '../../shared/validation';
import { api } from '../api';
import { HIGHLIGHT_EVENT, pendingHighlight } from '../lib/highlight';
import { useUi } from '../state/ui';
import { EmptyState, shortenPath } from './common';
import { ImportedContent } from './ImportedContent';
import { ImportWizard } from './ImportWizard';

const storeKey = (projectId: string) => `ppm:import-tab:${projectId}`;
const readStored = (projectId: string) => {
  try {
    return localStorage.getItem(storeKey(projectId));
  } catch {
    return null;
  }
};
const writeStored = (projectId: string, id: string) => {
  try {
    localStorage.setItem(storeKey(projectId), id);
  } catch {
    /* bộ nhớ trình duyệt đầy / bị chặn: chỉ mất phần nhớ tab đang mở */
  }
};

const hasText = (imp: ProjectImport | undefined, query: string | null) => {
  const q = normalizeText(query);
  return !!imp && !!q && imp.items.some((it) => [it.model, it.brand, it.description].some((v) => normalizeText(v).includes(q)));
};

type Menu = { id: string; x: number; y: number; up: boolean };

/** Thao tác trên các bảng import của một chủ sở hữu (dự án Pre/Post-sales hoặc Sự kiện tạm thời). */
export interface ImportOps {
  commit(payload: ImportPayload, replaceImportId: string | null): Promise<ProjectImport>;
  remove(importId: string): Promise<void>;
  rename(importId: string, name: string): Promise<ProjectImport>;
  reorder(ids: string[]): Promise<ProjectImport[]>;
}

const projectOps = (projectId: string): ImportOps => ({
  commit: (payload, replaceImportId) => api.commitImport(projectId, payload, replaceImportId),
  remove: (importId) => api.removeImport(projectId, importId),
  rename: (importId, name) => api.renameImport(projectId, importId, name),
  reorder: (ids) => api.reorderImports(projectId, ids),
});

/**
 * Các bảng thiết bị import của một dự án, xem như workbook Excel: mỗi bảng là một tab sheet ở thanh tab phía trên bảng.
 * Bấm tab để xem; bấm đúp / F2 để đổi tên; kéo tab (hoặc Alt + ←/→, menu chuột phải) để đổi thứ tự.
 * Tab đang mở được nhớ theo dự án; bảng vừa import / import lại tự mở; mở từ kết quả tìm Model thì mở bảng có Model đó.
 */
export function ProjectImports({
  projectId,
  imports,
  onChanged,
  ops: opsProp,
  ownerLabel = 'Project',
  ownerKind = 'project',
}: {
  /** Id của chủ sở hữu (dự án hoặc sự kiện). */
  projectId: string;
  imports: ProjectImport[] | undefined;
  onChanged: () => void;
  ops?: ImportOps;
  ownerLabel?: string;
  /** Loại chủ sở hữu để hộp thoại chọn file mở sẵn đúng thư mục. */
  ownerKind?: 'project' | 'event';
}) {
  const { confirm, toast, toastError } = useUi();
  const ops = useMemo(() => opsProp ?? projectOps(projectId), [opsProp, projectId]);
  // Trang chi tiết vẫn giữ danh sách của dự án trước cho tới khi tải xong dự án mới.
  const own = imports && imports.length > 0 && imports[0].projectId !== projectId ? undefined : imports;

  const [wizard, setWizard] = useState<{ replace?: ProjectImport } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const editRef = useRef(editing);
  editRef.current = editing;
  const focusNext = useRef<string | null>(null);
  const wanted = useRef<string | null>(pendingHighlight());
  const lastIndex = useRef(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const sheets = useMemo(() => {
    const list = (own ?? []).map((i) => (renamed[i.id] ? { ...i, name: renamed[i.id] } : i));
    if (!order) return list;
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }, [own, order, renamed]);
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const active = sheets.find((s) => s.id === activeId) ?? sheets[0];
  const activeIndex = active ? sheets.indexOf(active) : -1;

  useLayoutEffect(() => {
    setOrder(null);
    setRenamed({});
    if (!own?.length) return;
    const ids = own.map((i) => i.id);
    const next = focusNext.current;
    const query = wanted.current;
    focusNext.current = null;
    wanted.current = null;
    let pick: string;
    if (next && ids.includes(next)) pick = next;
    else if (query && !hasText(own.find((i) => i.id === activeId), query) && own.some((i) => hasText(i, query))) pick = own.find((i) => hasText(i, query))!.id;
    else if (activeId && ids.includes(activeId)) pick = activeId;
    else if (activeId === null) {
      const stored = readStored(projectId);
      pick = stored && ids.includes(stored) ? stored : ids[0];
    } else pick = ids[Math.min(lastIndex.current, ids.length - 1)];
    if (pick !== activeId) setActiveId(pick);
  }, [own]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đang ở sẵn trang dự án mà mở kết quả tìm Model của chính dự án này: chuyển sang bảng có Model đó.
  useEffect(() => {
    let timer = 0;
    const onSearch = () => {
      const query = pendingHighlight();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const list = sheetsRef.current;
        if (!list.length) {
          wanted.current = query;
          return;
        }
        setActiveId((cur) => {
          if (hasText(list.find((s) => s.id === cur), query)) return cur;
          return list.find((s) => hasText(s, query))?.id ?? cur;
        });
      }, 0);
    };
    window.addEventListener(HIGHLIGHT_EVENT, onSearch);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(HIGHLIGHT_EVENT, onSearch);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    writeStored(projectId, active.id);
    lastIndex.current = activeIndex;
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(`[data-tab="${active.id}"]`);
    if (!strip || !el) return;
    if (el.offsetLeft < strip.scrollLeft) strip.scrollLeft = el.offsetLeft - 8;
    else if (el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = el.offsetLeft + el.offsetWidth - strip.clientWidth + 8;
  }, [active?.id, activeIndex, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const tabEl = (id: string) => stripRef.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`) ?? null;
  const focusTab = (id: string) => requestAnimationFrame(() => tabEl(id)?.focus());
  const select = (id: string, focus = false) => {
    setActiveId(id);
    setMenu(null);
    if (focus) focusTab(id);
  };

  const reorder = (ids: string[]) => {
    if (ids.join() === sheets.map((s) => s.id).join()) return;
    setOrder(ids);
    ops
      .reorder(ids)
      .then(() => onChanged())
      .catch((e: unknown) => {
        setOrder(null);
        toastError(e);
        onChanged();
      });
  };
  const moveTo = (id: string, index: number) => {
    const ids = sheets.map((s) => s.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    setMenu(null);
    reorder(ids);
    focusTab(id);
  };
  const shift = (id: string, delta: number) => {
    const i = sheets.findIndex((s) => s.id === id);
    if (i < 0 || i + delta < 0 || i + delta >= sheets.length) return;
    moveTo(id, i + delta);
  };
  const onDrop = () => {
    const from = dragId;
    const target = drop;
    setDragId(null);
    setDrop(null);
    if (!from || !target || from === target.id) return;
    const ids = sheets.map((s) => s.id).filter((x) => x !== from);
    ids.splice(ids.indexOf(target.id) + (target.after ? 1 : 0), 0, from);
    reorder(ids);
  };

  const startRename = (id: string) => {
    const s = sheets.find((x) => x.id === id);
    if (!s) return;
    setMenu(null);
    setActiveId(id);
    setEditing({ id, name: s.name });
  };
  const finishRename = async (commit: boolean, fromBlur = false) => {
    const e = editRef.current;
    if (!e) return;
    const sheet = sheets.find((s) => s.id === e.id);
    const name = cleanName(e.name);
    const stop = () => {
      editRef.current = null;
      setEditing(null);
    };
    if (!commit || !sheet || name === sheet.name) {
      stop();
      if (!fromBlur) focusTab(e.id);
      return;
    }
    const err = validateImportTabName(name, sheets.filter((s) => s.id !== e.id).map((s) => s.name));
    if (err) {
      toast('error', err);
      if (fromBlur) stop();
      return;
    }
    stop();
    setRenamed((r) => ({ ...r, [e.id]: name }));
    if (!fromBlur) focusTab(e.id);
    try {
      await ops.rename(e.id, name);
      toast('success', `Đã đổi tên bảng thành "${name}".`);
      onChanged();
    } catch (x) {
      setRenamed((r) => {
        const n = { ...r };
        delete n[e.id];
        return n;
      });
      toastError(x);
    }
  };

  const remove = async (imp: ProjectImport) => {
    setMenu(null);
    const ok = await confirm({
      title: 'Gỡ bảng import',
      message: (
        <>
          Gỡ bảng <b>{imp.name}</b> (file {imp.sourceFileName}, import {formatDateTime(imp.importedAt)}, {imp.items.length} thiết bị) khỏi {ownerLabel}?
          <br />
          <span className="muted small">Các bảng khác, {ownerLabel} và file XLSX gốc trên máy không bị ảnh hưởng.</span>
        </>
      ),
      confirmText: 'Gỡ bảng',
      danger: true,
    });
    if (!ok) return;
    try {
      await ops.remove(imp.id);
      toast('success', `Đã gỡ bảng ${imp.name}.`);
      onChanged();
    } catch (e) {
      toastError(e);
    }
  };

  const openMenu = (id: string, x: number, y: number) => {
    setActiveId(id);
    setMenu({ id, x: Math.min(x, window.innerWidth - 240), y, up: y > window.innerHeight / 2 });
  };
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const i = sheets.findIndex((s) => s.id === id);
    if (e.key === 'F2') {
      e.preventDefault();
      startRename(id);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      shift(id, e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? sheets.length - 1 : i + (e.key === 'ArrowLeft' ? -1 : 1);
      if (sheets[j]) select(sheets[j].id, true);
    }
  };

  const total = sheets.reduce((n, i) => n + i.items.length, 0);
  const menuSheet = menu ? sheets.find((s) => s.id === menu.id) : undefined;
  const menuIndex = menuSheet ? sheets.indexOf(menuSheet) : -1;

  return (
    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <h2 className="card-title grow" style={{ margin: 0 }}>
          <FileSpreadsheet size={18} /> Thiết bị (import Excel)
          {sheets.length > 0 && (
            <span className="badge" style={{ marginLeft: 8 }}>
              {sheets.length} bảng · {total} thiết bị
            </span>
          )}
        </h2>
        {sheets.length > 0 && (
          <button className="btn sm primary" onClick={() => setWizard({})}>
            <FilePlus2 size={14} /> Import thêm xlsx
          </button>
        )}
      </div>
      {own === undefined ? (
        <div className="faint">Đang tải…</div>
      ) : !active ? (
        <EmptyState
          icon={<FileSpreadsheet size={36} />}
          title="Chưa có dữ liệu Excel"
          text="Import workbook .xlsx để lấy bảng thông tin các thiết bị (Model / Hãng / Mô tả). Mỗi lần Import thêm là một bảng mới, hiện như một tab sheet trên thanh tab phía trên bảng — đổi tên và kéo đổi thứ tự được."
          action={
            <button className="btn primary" onClick={() => setWizard({})}>
              <Upload size={15} /> Import .xlsx
            </button>
          }
        />
      ) : (
        <div className="xl-book">
          <div className="xl-tabbar">
            <button type="button" className="xl-nav" aria-label="Bảng trước" title="Bảng trước" disabled={activeIndex <= 0} onClick={() => select(sheets[activeIndex - 1].id)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="xl-nav" aria-label="Bảng sau" title="Bảng sau" disabled={activeIndex >= sheets.length - 1} onClick={() => select(sheets[activeIndex + 1].id)}>
              <ChevronRight size={16} />
            </button>
            <div className="xl-tabs" role="tablist" aria-label="Các bảng import" ref={stripRef} onDragOver={(e) => dragId && e.preventDefault()} onDrop={onDrop}>
              {sheets.map((s) =>
                editing?.id === s.id ? (
                  <input
                    key={s.id}
                    className="xl-tab-edit"
                    data-tab={s.id}
                    autoFocus
                    aria-label="Tên bảng"
                    value={editing.name}
                    maxLength={IMPORT_TAB_NAME_MAX}
                    size={Math.max(8, Math.min(40, editing.name.length + 2))}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                    onBlur={() => void finishRename(true, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void finishRename(true);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        void finishRename(false);
                      }
                    }}
                  />
                ) : (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    id={`xl-tab-${s.id}`}
                    data-tab={s.id}
                    aria-selected={s.id === active.id}
                    aria-controls="xl-sheet-panel"
                    tabIndex={s.id === active.id ? 0 : -1}
                    className={`xl-tab ${dragId === s.id ? 'dragging' : ''} ${drop?.id === s.id && dragId !== s.id ? (drop.after ? 'drop-after' : 'drop-before') : ''}`}
                    title={`${s.name}\nImport ${formatDateTime(s.importedAt)} · ${s.items.length} thiết bị\nBấm đúp để đổi tên · kéo để đổi chỗ · chuột phải để xem thêm`}
                    draggable
                    onClick={() => select(s.id)}
                    onDoubleClick={() => startRename(s.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      const fromKeyboard = e.clientX === 0 && e.clientY === 0;
                      openMenu(s.id, fromKeyboard ? r.left : e.clientX, fromKeyboard ? r.top : e.clientY);
                    }}
                    onKeyDown={(e) => onTabKey(e, s.id)}
                    onDragStart={(e) => {
                      setDragId(s.id);
                      setActiveId(s.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', s.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDrop(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      const after = e.clientX > r.left + r.width / 2;
                      if (drop?.id !== s.id || drop.after !== after) setDrop({ id: s.id, after });
                    }}
                  >
                    <span className="ellipsis">{s.name}</span>
                  </button>
                ),
              )}
            </div>
            <button type="button" className="xl-add" aria-label="Thêm bảng mới (import xlsx)" title="Thêm bảng mới — import xlsx" onClick={() => setWizard({})}>
              <Plus size={15} />
            </button>
            <span className="xl-hint small faint">Bấm đúp tab để đổi tên · kéo tab để đổi thứ tự</span>
          </div>
          <div className="xl-info">
            <FileSpreadsheet size={16} className="faint" style={{ flexShrink: 0 }} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 600 }}>
                {active.name}
              </div>
              <div className="small muted ellipsis" title={active.sourcePath ?? active.sourceFileName}>
                Import lúc {formatDateTime(active.importedAt)} · {active.sourcePath ? shortenPath(active.sourcePath, 80) : active.sourceFileName} · Sheet gốc:{' '}
                {active.sheetNames.join(', ') || '—'} · {active.items.length} thiết bị
              </div>
            </div>
            <button className="btn sm" onClick={() => startRename(active.id)} aria-label={`Đổi tên bảng ${active.name}`} title="Đổi tên bảng (F2)">
              <Pencil size={13} /> Đổi tên
            </button>
            <button className="btn sm" onClick={() => setWizard({ replace: active })} aria-label={`Import lại bảng ${active.name}`}>
              <RefreshCw size={13} /> Import lại
            </button>
            <button className="btn sm icon ghost" style={{ color: 'var(--danger)' }} onClick={() => void remove(active)} aria-label={`Gỡ bảng ${active.name}`} title="Gỡ bảng này">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="xl-sheet" role="tabpanel" id="xl-sheet-panel" aria-labelledby={`xl-tab-${active.id}`}>
            <ImportedContent key={active.id} items={active.items} bare />
          </div>
        </div>
      )}
      {menu &&
        menuSheet &&
        createPortal(
          <div
            ref={menuRef}
            className="popover xl-menu"
            role="menu"
            aria-label={`Bảng ${menuSheet.name}`}
            style={{ position: 'fixed', left: menu.x, top: menu.y, transform: menu.up ? 'translateY(-100%)' : undefined }}
          >
            <button role="menuitem" className="opt" onClick={() => startRename(menuSheet.id)}>
              <Pencil size={14} /> Đổi tên
              <span className="faint small" style={{ marginLeft: 'auto' }}>
                F2
              </span>
            </button>
            <div className="menu-sep" />
            <button role="menuitem" className="opt" disabled={menuIndex <= 0} onClick={() => shift(menuSheet.id, -1)}>
              <ChevronLeft size={14} /> Di chuyển sang trái
            </button>
            <button role="menuitem" className="opt" disabled={menuIndex >= sheets.length - 1} onClick={() => shift(menuSheet.id, 1)}>
              <ChevronRight size={14} /> Di chuyển sang phải
            </button>
            <button role="menuitem" className="opt" disabled={menuIndex <= 0} onClick={() => moveTo(menuSheet.id, 0)}>
              <ChevronsLeft size={14} /> Đưa về đầu
            </button>
            <button role="menuitem" className="opt" disabled={menuIndex >= sheets.length - 1} onClick={() => moveTo(menuSheet.id, sheets.length - 1)}>
              <ChevronsRight size={14} /> Đưa về cuối
            </button>
            <div className="menu-sep" />
            <button
              role="menuitem"
              className="opt"
              onClick={() => {
                setMenu(null);
                setWizard({ replace: menuSheet });
              }}
            >
              <RefreshCw size={14} /> Import lại bảng này…
            </button>
            <button role="menuitem" className="opt danger" onClick={() => void remove(menuSheet)}>
              <Trash2 size={14} /> Gỡ bảng…
            </button>
          </div>,
          document.body,
        )}
      {wizard && (
        <ImportWizard
          projectId={projectId}
          hasExisting={sheets.length > 0}
          replaceImport={wizard.replace ?? null}
          existing={own ?? []}
          owner={{ kind: ownerKind, id: projectId }}
          commitTo={opsProp ? (payload, replaceImportId) => ops.commit(payload, replaceImportId) : undefined}
          onClose={() => setWizard(null)}
          onDone={(saved) => {
            focusNext.current = saved.id;
            onChanged();
          }}
        />
      )}
    </section>
  );
}
