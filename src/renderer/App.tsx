import { useMemo, useRef, useState } from 'react';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AlertTriangle, Menu, Moon, Search, Settings, Sun } from 'lucide-react';
import { STATUS_LABEL } from '../shared/status';
import { matchesQuery, normalizeText } from '../shared/text';
import { useClickOutside } from './components/common';
import { Sidebar } from './components/Sidebar';
import { UpdateNotice } from './components/UpdateNotice';
import { readLocal, setSessionValue, useLocalState } from './lib/persist';
import { EMPTY_FILTER } from './lib/projects';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { AllProjectsPage } from './pages/AllProjectsPage';
import { CategoryPage } from './pages/CategoryPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExperienceBrandPage, ExperienceHomePage } from './pages/ExperiencePages';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { AppDataProvider, useAppData } from './state/AppData';
import { ProjectActionsProvider } from './state/projectActions';
import { UiProvider, useUi } from './state/ui';

function GlobalSearch() {
  const { projects } = useAppData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const results = useMemo(() => {
    const nq = normalizeText(q);
    if (!nq) return [];
    return projects.filter((p) => matchesQuery(nq, p.haystack)).slice(0, 8);
  }, [projects, q]);

  const showAll = () => {
    setSessionValue('filter:all', { ...EMPTY_FILTER, q });
    setOpen(false);
    navigate('/all', { state: { from: 'search', at: Date.now() } });
  };

  return (
    <div className="pop-anchor" ref={ref} style={{ width: 380 }}>
      <div className="search-box" style={{ width: '100%' }}>
        <Search size={16} />
        <input
          className="input"
          placeholder="Tìm dự án (gõ không dấu cũng được)…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) showAll();
            if (e.key === 'Escape') setOpen(false);
          }}
          aria-label="Tìm kiếm toàn cục"
        />
      </div>
      {open && q.trim() && (
        <div className="popover" style={{ minWidth: 380 }}>
          {results.length === 0 && <div className="opt-empty">Không tìm thấy dự án phù hợp</div>}
          {results.map((p) => (
            <button
              key={p.id}
              className={`opt st-${p.status}`}
              onClick={() => {
                setOpen(false);
                navigate(`/project/${p.id}`);
              }}
            >
              <span className="status-dot" />
              <span className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 600 }}>
                  {p.projectName}
                </div>
                <div className="small faint ellipsis">
                  {p.clientName} · {p.location}
                </div>
              </span>
              <span className="small faint nowrap">{STATUS_LABEL[p.status]}</span>
            </button>
          ))}
          {results.length > 0 && (
            <>
              <div className="menu-sep" />
              <button className="opt" onClick={showAll}>
                <Search size={14} /> Xem tất cả kết quả trong “Tất cả mục”
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { ready, loadError, settings, updateSettings } = useAppData();
  const { title, toastError } = useUi();
  const location = useLocation();
  const [collapsed, setCollapsed] = useLocalState('sidebar-collapsed', () => readLocal('sidebar-collapsed', window.innerWidth < 1200));

  if (loadError)
    return (
      <div className="coming-soon">
        <div className="alert error">
          <AlertTriangle size={18} />
          <div>
            <b>Không tải được dữ liệu.</b>
            <div>{loadError}</div>
          </div>
        </div>
      </div>
    );
  if (!ready) return <div className="empty">Đang tải dữ liệu…</div>;

  const fillPage = /^\/(all|job\/)/.test(location.pathname) || /\/experience\/.+/.test(location.pathname);

  return (
    <div className="app">
      <Sidebar collapsed={collapsed} onExpand={() => setCollapsed(false)} />
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon" aria-label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'} onClick={() => setCollapsed(!collapsed)}>
            <Menu size={19} />
          </button>
          <div className="topbar-title">{title}</div>
          <div className="topbar-spacer" />
          <UpdateNotice />
          <GlobalSearch />
          <button
            className="btn ghost icon"
            title={settings.theme === 'dark' ? 'Chuyển Light Mode' : 'Chuyển Dark Mode'}
            aria-label="Đổi giao diện sáng/tối"
            onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }).catch(toastError)}
          >
            {settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a className="btn ghost icon" href="#/settings" aria-label="Settings" title="Settings">
            <Settings size={18} />
          </a>
        </header>
        <main className={`content ${fillPage ? 'fill' : ''}`}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/all" element={<AllProjectsPage key={location.key} />} />
            <Route path="/job/:jobType/:yearId/:category" element={<CategoryPage />} />
            <Route path="/project/:id" element={<ProjectDetailPage />} />
            <Route path="/experience" element={<ExperienceHomePage />} />
            <Route path="/experience/:brandId" element={<ExperienceBrandPage />} />
            <Route path="/ai" element={<AiAssistantPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<div className="empty">Không tìm thấy trang.</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <UiProvider>
        <AppDataProvider>
          <ProjectActionsProvider>
            <Shell />
          </ProjectActionsProvider>
        </AppDataProvider>
      </UiProvider>
    </HashRouter>
  );
}
