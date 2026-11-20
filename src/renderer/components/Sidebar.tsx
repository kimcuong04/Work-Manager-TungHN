import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import {
  BookMarked,
  AppWindow,
  BookOpen,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  FolderOpen,
  Globe,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  Package,
  Laptop,
  Lightbulb,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Wrench,
  LayoutList,
} from 'lucide-react';
import { nameKey } from '../../shared/text';
import { CATEGORY_LABEL, JOB_LABEL, JOB_TYPES, PROJECT_CATEGORIES, type JobType, type JobYear, type ProjectCategory } from '../../shared/types';
import { validateYearLabel } from '../../shared/validation';
import { api } from '../api';
import { useLocalState } from '../lib/persist';
import { nodePath, type ProjectView } from '../lib/projects';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { useUi } from '../state/ui';

const JOB_ICON = { MAIN: Briefcase, FREELANCE: Laptop };

/** Job Freelance là một bảng chung (không chia năm / Pre-sales / Post-sales / Warranty). */
function FreelanceNode() {
  const { freelance } = useAppData();
  return (
    <NavLink to="/freelance" className={({ isActive }) => `nav-row lvl-strong ${isActive ? 'active' : ''}`}>
      <Laptop size={16} />
      <span className="nav-label">Job Freelance</span>
      <span className="nav-count">{freelance.length || ''}</span>
    </NavLink>
  );
}

function ToolsNode({ openMap, toggle }: { openMap: OpenMap; toggle: (k: string, def?: boolean) => void }) {
  const open = openMap.tools ?? true;
  return (
    <>
      <button className="nav-row lvl-strong" onClick={() => toggle('tools', true)} aria-expanded={open}>
        <Wrench size={16} />
        <span className="nav-label">Tools</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="nav-children">
          <NavLink to="/tools/app" className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''}`}>
            <AppWindow size={14} />
            <span className="nav-label">Tool app</span>
          </NavLink>
          <NavLink to="/tools/online" className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''}`}>
            <Globe size={14} />
            <span className="nav-label">Tool online</span>
          </NavLink>
        </div>
      )}
    </>
  );
}

type OpenMap = Record<string, boolean>;

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight size={14} className={`nav-chevron ${open ? 'open' : ''}`} />;
}

/** Pre-sales / Post-sales chỉ là link tới danh sách (không xổ danh sách dự án trong sidebar nữa). */
function CategoryNode({ year, category, count }: { year: JobYear; category: ProjectCategory; count: number }) {
  const { openCreate } = useProjectActions();
  return (
    <NavLink to={nodePath(year.jobType, year.id, category)} className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''}`}>
      <span style={{ width: 14 }} />
      <FolderOpen size={14} />
      <span className="nav-label">{CATEGORY_LABEL[category]}</span>
      <span className="nav-tools">
        <button
          title="Thêm Project vào nhóm này"
          aria-label={`Thêm Project vào ${CATEGORY_LABEL[category]} ${year.yearLabel}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openCreate({ jobType: year.jobType, jobYearId: year.id, workCategory: category });
          }}
        >
          <Plus size={13} />
        </button>
      </span>
      <span className="nav-count">{count || ''}</span>
    </NavLink>
  );
}

function YearNode({ year, openMap, toggle }: { year: JobYear; openMap: OpenMap; toggle: (k: string, def?: boolean) => void }) {
  const { projects, years, refresh, today } = useAppData();
  const { prompt, confirm, toast, toastError } = useUi();
  const key = `year:${year.id}`;
  const defaultOpen = year.yearLabel === today.slice(0, 4);
  const open = openMap[key] ?? defaultOpen;
  const byCat = useMemo(() => {
    const m: Record<ProjectCategory, ProjectView[]> = { PRE_SALES: [], POST_SALES: [] };
    for (const p of projects) if (p.jobYearId === year.id) m[p.workCategory].push(p);
    return m;
  }, [projects, year.id]);
  const location = useLocation();
  const containsActive = location.pathname.includes(year.id);

  const rename = async () => {
    const label = await prompt({
      title: `Đổi tên năm — ${JOB_LABEL[year.jobType]}`,
      label: 'Tên / nhãn năm',
      initial: year.yearLabel,
      validate: (v) =>
        validateYearLabel(v) ??
        (years.some((y) => y.jobType === year.jobType && y.id !== year.id && nameKey(y.yearLabel) === nameKey(v)) ? 'Năm này đã tồn tại trong Job.' : null),
    });
    if (label === null) return;
    try {
      await api.renameYear(year.id, label);
      await refresh('years', 'projects');
      toast('success', 'Đã đổi tên năm.');
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    if (year.projectCount + year.warrantyCount > 0) {
      toast('warn', `Năm "${year.yearLabel}" còn ${year.projectCount} Project và ${year.warrantyCount} Warranty Record — hãy di chuyển hoặc xóa trước.`);
      return;
    }
    if (!(await confirm({ title: 'Xóa năm', message: `Xóa năm "${year.yearLabel}" khỏi ${JOB_LABEL[year.jobType]}?`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await api.deleteYear(year.id);
      await refresh('years');
      toast('success', 'Đã xóa năm.');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={`nav-row lvl-strong ${containsActive && !open ? 'active' : ''}`}
        onClick={() => toggle(key, defaultOpen)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggle(key, defaultOpen);
          }
        }}
        aria-expanded={open}
      >
        <CalendarDays size={15} style={{ color: 'var(--accent)' }} />
        <span className="nav-label">{year.yearLabel}</span>
        <span className="nav-tools">
          <button
            title="Đổi tên năm"
            aria-label={`Đổi tên năm ${year.yearLabel}`}
            onClick={(e) => {
              e.stopPropagation();
              void rename();
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            title="Xóa năm"
            aria-label={`Xóa năm ${year.yearLabel}`}
            onClick={(e) => {
              e.stopPropagation();
              void remove();
            }}
          >
            <Trash2 size={13} />
          </button>
        </span>
        <Chevron open={open} />
      </div>
      {open && (
        <div className="nav-children">
          {PROJECT_CATEGORIES.map((c) => (
            <CategoryNode key={c} year={year} category={c} count={byCat[c].length} />
          ))}
          <NavLink to={nodePath(year.jobType, year.id, 'WARRANTY')} className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''}`}>
            <span style={{ width: 14 }} />
            <ShieldCheck size={14} />
            <span className="nav-label">Warranty</span>
            <span className="nav-count">{year.warrantyCount || ''}</span>
          </NavLink>
        </div>
      )}
    </>
  );
}

function JobNode({ jobType, openMap, toggle }: { jobType: JobType; openMap: OpenMap; toggle: (k: string, def?: boolean) => void }) {
  const { years, refresh, today } = useAppData();
  const { prompt, toast, toastError } = useUi();
  const key = `job:${jobType}`;
  const open = openMap[key] ?? true;
  const Icon = JOB_ICON[jobType];
  const list = years.filter((y) => y.jobType === jobType);

  const addYear = async () => {
    const current = today.slice(0, 4);
    const exists = (v: string) => list.some((y) => nameKey(y.yearLabel) === nameKey(v));
    const suggestion = exists(current) ? String(Math.max(...list.map((y) => Number(y.yearLabel) || 0), Number(current)) + 1) : current;
    const label = await prompt({
      title: `Thêm năm — ${JOB_LABEL[jobType]}`,
      label: 'Năm',
      initial: suggestion,
      confirmText: 'Thêm năm',
      validate: (v) => validateYearLabel(v) ?? (exists(v) ? 'Năm này đã tồn tại trong Job.' : null),
    });
    if (label === null) return;
    try {
      const y = await api.createYear(jobType, label);
      await refresh('years');
      toggle(`year:${y.id}`, false);
      toast('success', `Đã thêm năm ${y.yearLabel} (Pre-sales, Post-sales, Warranty).`);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <button className="nav-row lvl-strong" onClick={() => toggle(key, true)} aria-expanded={open}>
        <Icon size={16} />
        <span className="nav-label">{JOB_LABEL[jobType]}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="nav-children">
          {list.map((y) => (
            <YearNode key={y.id} year={y} openMap={openMap} toggle={toggle} />
          ))}
          <button className="nav-row add" onClick={addYear}>
            <Plus size={13} /> Thêm năm
          </button>
        </div>
      )}
    </>
  );
}

function ExperienceNode({ openMap, toggle }: { openMap: OpenMap; toggle: (k: string, def?: boolean) => void }) {
  const { masters } = useAppData();
  const open = openMap.experience ?? false;
  const brands = masters.brands.filter((b) => (b.isActive && !b.knowledgeHidden) || (b.knowledgeCount ?? 0) > 0);
  return (
    <>
      <div className="row" style={{ gap: 0 }}>
        <NavLink to="/experience" end className={({ isActive }) => `nav-row lvl-strong ${isActive ? 'active' : ''}`}>
          <Lightbulb size={16} />
          <span className="nav-label">Experience</span>
          <span
            role="button"
            tabIndex={-1}
            aria-label={open ? 'Thu gọn' : 'Mở rộng'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle('experience', false);
            }}
            style={{ display: 'inline-flex' }}
          >
            <Chevron open={open} />
          </span>
        </NavLink>
      </div>
      {open && (
        <div className="nav-children">
          {brands.length === 0 && <div className="nav-row add">Chưa có Hãng</div>}
          {brands.map((b) => (
            <NavLink key={b.id} to={`/experience/${b.id}`} className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''} ${b.isActive ? '' : 'muted'}`}>
              <Tag size={13} />
              <span className="nav-label">{b.name}</span>
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}

function KnowledgeNode({ openMap, toggle }: { openMap: OpenMap; toggle: (k: string, def?: boolean) => void }) {
  const { masters } = useAppData();
  const open = openMap.knowledge ?? false;
  const brands = masters.brands.filter((b) => b.isActive || b.usageCount > 0);
  return (
    <>
      <NavLink to="/knowledge" end className={({ isActive }) => `nav-row lvl-strong ${isActive ? 'active' : ''}`}>
        <GraduationCap size={16} />
        <span className="nav-label">Kiến thức</span>
        <span
          role="button"
          tabIndex={-1}
          aria-label={open ? 'Thu gọn' : 'Mở rộng'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle('knowledge', false);
          }}
          style={{ display: 'inline-flex' }}
        >
          <Chevron open={open} />
        </span>
      </NavLink>
      {open && (
        <div className="nav-children">
          <NavLink to="/knowledge/general" className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''}`}>
            <BookMarked size={13} />
            <span className="nav-label">Kiến thức chung</span>
          </NavLink>
          <NavLink to="/knowledge/places" className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''}`}>
            <LayoutList size={13} />
            <span className="nav-label">Website - App - Địa điểm</span>
          </NavLink>
          {brands.map((b) => (
            <NavLink key={b.id} to={`/knowledge/${b.id}`} className={({ isActive }) => `nav-row small ${isActive ? 'active' : ''} ${b.isActive ? '' : 'muted'}`}>
              <Tag size={13} />
              <span className="nav-label">{b.name}</span>
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}

/** Tên workspace ở đầu sidebar: bấm đúp hoặc bút chì để đổi tên, Enter lưu, Esc hủy. */
function WorkspaceHead() {
  const { settings, updateSettings } = useAppData();
  const { toastError } = useUi();
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [settings.workspaceName]);
  const save = async () => {
    if (draft === null) return;
    try {
      await updateSettings({ workspaceName: draft });
    } catch (e) {
      toastError(e);
    }
    setDraft(null);
  };
  return (
    <div className="sidebar-head">
      <LayoutGrid size={22} />
      {draft === null ? (
        <>
          <span className="ws-name" title={`${settings.workspaceName} — bấm đúp để đổi tên`} onDoubleClick={() => setDraft(settings.workspaceName)}>
            {settings.workspaceName}
          </span>
          <button className="btn sm icon ghost ws-edit" aria-label="Đổi tên workspace" title="Đổi tên workspace" onClick={() => setDraft(settings.workspaceName)}>
            <Pencil size={13} />
          </button>
        </>
      ) : (
        <input
          className="input ws-input"
          autoFocus
          maxLength={40}
          aria-label="Tên workspace"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const [openMap, setOpenMap] = useLocalState<OpenMap>('nav-open', {});
  const toggle = (k: string, def = false) => setOpenMap((m) => ({ ...m, [k]: !(m[k] ?? def) }));

  if (collapsed)
    return (
      <aside className="sidebar collapsed" aria-label="Điều hướng">
        <div className="sidebar-head" style={{ padding: '0 18px' }}>
          <LayoutGrid size={22} />
        </div>
        <div className="sidebar-scroll">
          <NavLink to="/" end className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Dashboard">
            <LayoutDashboard size={18} />
          </NavLink>
          <NavLink to="/all" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Tất cả mục">
            <BookOpen size={18} />
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Calendar">
            <CalendarClock size={18} />
          </NavLink>
          <NavLink to="/todo" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="To-do list">
            <ListTodo size={18} />
          </NavLink>
          {JOB_TYPES.map((j) => {
            const Icon = JOB_ICON[j];
            return (
              <button key={j} className="nav-row" title={JOB_LABEL[j]} onClick={onExpand}>
                <Icon size={18} />
              </button>
            );
          })}
          <NavLink to="/freelance" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Job Freelance">
            <Laptop size={18} />
          </NavLink>
          <NavLink to="/equipment" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Kho thiết bị">
            <Package size={18} />
          </NavLink>
          <NavLink to="/events" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Sự kiện tạm thời">
            <CalendarRange size={18} />
          </NavLink>
          <NavLink to="/experience" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Experience">
            <Lightbulb size={18} />
          </NavLink>
          <NavLink to="/knowledge" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Kiến thức">
            <GraduationCap size={18} />
          </NavLink>
          <NavLink to="/passwords" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Password">
            <KeyRound size={18} />
          </NavLink>
          <NavLink to="/tools/online" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Tools">
            <Wrench size={18} />
          </NavLink>
          <NavLink to="/ai" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="AI Assistant (Coming Soon)">
            <Sparkles size={18} />
          </NavLink>
        </div>
        <div className="sidebar-foot">
          <NavLink to="/settings" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`} title="Settings">
            <Settings size={18} />
          </NavLink>
        </div>
      </aside>
    );

  return (
    <aside className="sidebar" aria-label="Điều hướng">
      <WorkspaceHead />
      <nav className="sidebar-scroll">
        <NavLink to="/" end className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={17} />
          <span className="nav-label">Dashboard</span>
        </NavLink>
        <NavLink to="/all" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`}>
          <BookOpen size={17} />
          <span className="nav-label">Tất cả mục</span>
        </NavLink>
        <NavLink to="/calendar" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`}>
          <CalendarClock size={17} />
          <span className="nav-label">Calendar</span>
        </NavLink>
        <NavLink to="/todo" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`}>
          <ListTodo size={17} />
          <span className="nav-label">To-do list</span>
        </NavLink>

        <div className="sidebar-section">KHÔNG GIAN</div>
        {JOB_TYPES.map((j) => (
          <JobNode key={j} jobType={j} openMap={openMap} toggle={toggle} />
        ))}
        <FreelanceNode />
        <NavLink to="/equipment" className={({ isActive }) => `nav-row lvl-strong ${isActive ? 'active' : ''}`}>
          <Package size={16} />
          <span className="nav-label">Kho thiết bị</span>
        </NavLink>
        <NavLink to="/events" className={({ isActive }) => `nav-row lvl-strong ${isActive ? 'active' : ''}`}>
          <CalendarRange size={16} />
          <span className="nav-label">Sự kiện tạm thời</span>
        </NavLink>

        <div className="sidebar-section">KINH NGHIỆM &amp; KIẾN THỨC</div>
        <ExperienceNode openMap={openMap} toggle={toggle} />
        <KnowledgeNode openMap={openMap} toggle={toggle} />

        <div className="sidebar-section">TIỆN ÍCH</div>
        <NavLink to="/passwords" className={({ isActive }) => `nav-row lvl-strong ${isActive ? 'active' : ''}`}>
          <KeyRound size={16} />
          <span className="nav-label">Password</span>
        </NavLink>
        <ToolsNode openMap={openMap} toggle={toggle} />

        <div className="sidebar-section">TRỢ LÝ AI</div>
        <NavLink to="/ai" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`}>
          <Sparkles size={17} />
          <span className="nav-label">AI Assistant</span>
          <span className="soon-badge">Soon</span>
        </NavLink>
      </nav>
      <div className="sidebar-foot">
        <NavLink to="/settings" className={({ isActive }) => `nav-row ${isActive ? 'active' : ''}`}>
          <Settings size={17} />
          <span className="nav-label">Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
