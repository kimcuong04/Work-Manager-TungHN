import { ProjectsView } from '../components/ProjectBoard';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { usePageTitle } from '../state/ui';

export function AllProjectsPage() {
  usePageTitle('Tất cả mục');
  const { projects } = useAppData();
  const { openCreate } = useProjectActions();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tất cả mục</h1>
          <div className="muted small">Mọi Project của Job Chính và Job Freelance — nguồn hiển thị dạng Job › Năm › Nhóm trên từng thẻ.</div>
        </div>
      </div>
      <ProjectsView scopeKey="all" baseList={projects} showLocationFilters onAdd={() => openCreate()} viewKey="view-mode:all" defaultView="board" />
    </>
  );
}
