import { HashRouter, Route, Routes, useLocation } from 'react-router';
import { AlertTriangle, Menu, Moon, Settings, Sun } from 'lucide-react';
import { GlobalSearch } from './components/GlobalSearch';
import { Sidebar } from './components/Sidebar';
import { UpdateNotice } from './components/UpdateNotice';
import { readLocal, useLocalState } from './lib/persist';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { AllProjectsPage } from './pages/AllProjectsPage';
import { CalendarPage } from './pages/CalendarPage';
import { TodoPage } from './pages/TodoPage';
import { useSearchHighlight } from './lib/highlight';
import { CategoryPage } from './pages/CategoryPage';
import { DashboardPage } from './pages/DashboardPage';
import { EquipmentPage } from './pages/EquipmentPage';
import { ExperienceBrandPage, ExperienceHomePage } from './pages/ExperiencePages';
import { FreelanceDetailPage, FreelanceListPage } from './pages/FreelancePages';
import { KnowledgeBrandPage, KnowledgeHomePage } from './pages/KnowledgePages';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { OnlineToolsPage, PasswordPage, ToolAppPage, ToolAppRunPage } from './pages/UtilityPages';
import { AppDataProvider, useAppData } from './state/AppData';
import { ProjectActionsProvider } from './state/projectActions';
import { UiProvider, useUi } from './state/ui';

function Shell() {
  const { ready, loadError, settings, updateSettings } = useAppData();
  const { title, toastError } = useUi();
  const location = useLocation();
  const [collapsed, setCollapsed] = useLocalState('sidebar-collapsed', () => readLocal('sidebar-collapsed', window.innerWidth < 1200));
  useSearchHighlight();

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

  const fillPage = /^\/(all|job\/|calendar|equipment)/.test(location.pathname) || /\/(experience|knowledge)\/.+/.test(location.pathname);

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
          <GlobalSearch />
          <button
            className="btn ghost icon"
            title={settings.theme === 'dark' ? 'Chuyển Light Mode' : 'Chuyển Dark Mode'}
            aria-label="Đổi giao diện sáng/tối"
            onClick={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }).catch(toastError)}
          >
            {settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a className="btn ghost icon" href="#/settings" aria-label="Settings" title="Settings">
            <Settings size={18} />
          </a>
          <UpdateNotice />
        </header>
        <main className={`content ${fillPage ? 'fill' : ''}`}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/all" element={<AllProjectsPage key={location.key} />} />
            <Route path="/job/:jobType/:yearId/:category" element={<CategoryPage />} />
            <Route path="/project/:id" element={<ProjectDetailPage />} />
            <Route path="/freelance" element={<FreelanceListPage />} />
            <Route path="/freelance/:id" element={<FreelanceDetailPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/passwords" element={<PasswordPage />} />
            <Route path="/tools/app" element={<ToolAppPage />} />
            <Route path="/tools/app/:toolId" element={<ToolAppRunPage />} />
            <Route path="/tools/online" element={<OnlineToolsPage />} />
            <Route path="/experience" element={<ExperienceHomePage />} />
            <Route path="/experience/:brandId" element={<ExperienceBrandPage />} />
            <Route path="/knowledge" element={<KnowledgeHomePage />} />
            <Route path="/knowledge/:brandId" element={<KnowledgeBrandPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/todo" element={<TodoPage />} />
            <Route path="/search" element={<SearchPage key={location.key} />} />
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
