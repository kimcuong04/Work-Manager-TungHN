import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useParams } from 'react-router';
import { CATEGORY_LABEL, JOB_LABEL, type JobType } from '../../shared/types';
import { BulkImportWizard } from '../components/BulkImportWizard';
import { Breadcrumbs, EmptyState } from '../components/common';
import { ProjectsView } from '../components/ProjectBoard';
import { CATEGORY_SLUG, nodePath } from '../lib/projects';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { usePageTitle } from '../state/ui';
import { WarrantyPage } from './WarrantyPage';

export function CategoryPage() {
  const { jobType, yearId, category } = useParams();
  const { yearById, projects, refresh } = useAppData();
  const [importing, setImporting] = useState(false);
  const usedStt = useMemo(() => new Set(projects.map((p) => p.stt)), [projects]);
  const { openCreate } = useProjectActions();
  const year = yearId ? yearById.get(yearId) : undefined;
  const cat = category ? CATEGORY_SLUG[category] : undefined;
  const title = year && cat ? `${CATEGORY_LABEL[cat]} ${year.yearLabel}` : 'Không tìm thấy';
  usePageTitle(title);

  const list = useMemo(() => projects.filter((p) => p.jobYearId === yearId && p.workCategory === cat), [projects, yearId, cat]);

  if (!year || !cat || year.jobType !== (jobType as JobType))
    return <EmptyState title="Không tìm thấy nhóm công việc" text="Năm có thể đã bị xóa hoặc đường dẫn không hợp lệ." />;

  const crumbs = [
    { label: JOB_LABEL[year.jobType] },
    { label: year.yearLabel },
    { label: CATEGORY_LABEL[cat], to: nodePath(year.jobType, year.id, cat) },
  ];

  if (cat === 'WARRANTY') return <WarrantyPage key={year.id} year={year} crumbs={crumbs} />;

  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={crumbs} />
          <h1>
            {CATEGORY_LABEL[cat]} · {year.yearLabel}
          </h1>
        </div>
      </div>
      <ProjectsView
        key={`${year.id}:${cat}`}
        scopeKey={`node:${year.id}:${cat}`}
        baseList={list}
        onAdd={() => openCreate({ jobType: year.jobType, jobYearId: year.id, workCategory: cat })}
        addLabel={`Thêm Project vào ${CATEGORY_LABEL[cat]}`}
        extraActions={
          <button className="btn" onClick={() => setImporting(true)}>
            <FileSpreadsheet size={15} /> Import xlsx
          </button>
        }
        viewKey="view-mode:category"
        defaultView="list"
      />
      {importing && (
        <BulkImportWizard
          target={cat}
          jobYearId={year.id}
          scopeLabel={`${CATEGORY_LABEL[cat]} ${year.yearLabel}`}
          usedStt={usedStt}
          onClose={() => setImporting(false)}
          onDone={() => refresh('projects', 'years')}
        />
      )}
    </>
  );
}
