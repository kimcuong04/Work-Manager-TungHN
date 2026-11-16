import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CATEGORY_LABEL, JOB_LABEL, JOB_TYPES, PROJECT_CATEGORIES, type JobType, type Project, type ProjectCategory } from '../../shared/types';
import { api } from '../api';
import { Field } from '../components/common';
import { Modal } from '../components/Modal';
import { ProjectForm, type ProjectDefaults } from '../components/ProjectForm';
import { useAppData } from './AppData';
import { useUi } from './ui';

interface ProjectActions {
  openCreate: (defaults?: ProjectDefaults) => void;
  openEdit: (p: Project) => void;
  openMove: (p: Project) => void;
  remove: (p: Project) => Promise<boolean>;
  setCompleted: (p: Project, completed: boolean) => Promise<boolean>;
}

const Ctx = createContext<ProjectActions | null>(null);

export function useProjectActions(): ProjectActions {
  const v = useContext(Ctx);
  if (!v) throw new Error('ProjectActionsProvider missing');
  return v;
}

function MoveDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { years, refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [jobType, setJobType] = useState<JobType>(project.jobType);
  const [yearId, setYearId] = useState(project.jobYearId);
  const [category, setCategory] = useState<ProjectCategory>(project.workCategory);
  const jobYears = years.filter((y) => y.jobType === jobType);
  const target = years.find((y) => y.id === yearId);
  const unchanged = yearId === project.jobYearId && category === project.workCategory;

  const submit = async () => {
    if (!target || unchanged) return;
    const from = `${JOB_LABEL[project.jobType]} › ${project.yearLabel} › ${CATEGORY_LABEL[project.workCategory]}`;
    const to = `${JOB_LABEL[target.jobType]} › ${target.yearLabel} › ${CATEGORY_LABEL[category]}`;
    const ok = await confirm({
      title: 'Xác nhận di chuyển',
      message: (
        <>
          Di chuyển <b>{project.projectName}</b>
          <br />
          từ <b>{from}</b>
          <br />
          sang <b>{to}</b>?
          <br />
          <span className="muted small">Thông tin dự án và dữ liệu Excel đã import được giữ nguyên.</span>
        </>
      ),
      confirmText: 'Di chuyển',
    });
    if (!ok) return;
    try {
      await api.moveProject(project.id, yearId, category);
      await refresh('projects', 'years');
      toast('success', `Đã di chuyển sang ${to}.`);
      onClose();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal
      size="sm"
      title="Di chuyển Project"
      onClose={onClose}
      footer={(close) => (
        <>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" disabled={!target || unchanged} onClick={submit}>
            Di chuyển…
          </button>
        </>
      )}
    >
      <div className="stack">
        <div className="muted small">{project.projectName}</div>
        <Field label="Job">
          <select
            className="select"
            value={jobType}
            onChange={(e) => {
              const jt = e.target.value as JobType;
              setJobType(jt);
              const list = years.filter((y) => y.jobType === jt);
              setYearId((list.find((y) => y.yearLabel === project.yearLabel) ?? list[0])?.id ?? '');
            }}
          >
            {JOB_TYPES.map((j) => (
              <option key={j} value={j}>
                {JOB_LABEL[j]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Năm">
          <select className="select" value={yearId} onChange={(e) => setYearId(e.target.value)}>
            {jobYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.yearLabel}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nhóm">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as ProjectCategory)}>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        {unchanged && <div className="field-hint">Chọn vị trí khác vị trí hiện tại.</div>}
      </div>
    </Modal>
  );
}

export function ProjectActionsProvider({ children }: { children: ReactNode }) {
  const { refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [form, setForm] = useState<{ project?: Project; defaults?: ProjectDefaults } | null>(null);
  const [moving, setMoving] = useState<Project | null>(null);

  const remove = useCallback(
    async (p: Project) => {
      const ok = await confirm({
        title: 'Xóa dự án',
        message: (
          <>
            Xóa vĩnh viễn dự án <b>“{p.projectName}”</b>?
            <br />
            <span className="muted small">Dữ liệu Excel đã import của dự án cũng bị xóa. File gốc trên máy không bị ảnh hưởng.</span>
          </>
        ),
        confirmText: 'Xóa dự án',
        danger: true,
      });
      if (!ok) return false;
      try {
        await api.deleteProject(p.id);
        await refresh('projects', 'years');
        toast('success', `Đã xóa "${p.projectName}".`);
        return true;
      } catch (e) {
        toastError(e);
        return false;
      }
    },
    [confirm, refresh, toast, toastError],
  );

  const setCompleted = useCallback(
    async (p: Project, completed: boolean) => {
      const ok = await confirm({
        title: completed ? 'Đánh dấu hoàn thành' : 'Bỏ hoàn thành',
        message: completed ? (
          <>
            Đánh dấu <b>“{p.projectName}”</b> là đã hoàn thành?
          </>
        ) : (
          <>
            Đưa <b>“{p.projectName}”</b> trở lại trạng thái hoạt động? Trạng thái sẽ được tính lại theo ngày tới hạn.
          </>
        ),
        confirmText: completed ? 'Hoàn thành' : 'Bỏ hoàn thành',
      });
      if (!ok) return false;
      try {
        await api.setProjectCompleted(p.id, completed);
        await refresh('projects');
        toast('success', completed ? 'Đã đánh dấu hoàn thành.' : 'Đã đưa dự án về trạng thái hoạt động.');
        return true;
      } catch (e) {
        toastError(e);
        return false;
      }
    },
    [confirm, refresh, toast, toastError],
  );

  const value = useMemo<ProjectActions>(
    () => ({
      openCreate: (defaults) => setForm({ defaults }),
      openEdit: (project) => setForm({ project }),
      openMove: (p) => setMoving(p),
      remove,
      setCompleted,
    }),
    [remove, setCompleted],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {form && <ProjectForm project={form.project} defaults={form.defaults} onClose={() => setForm(null)} />}
      {moving && <MoveDialog project={moving} onClose={() => setMoving(null)} />}
    </Ctx.Provider>
  );
}
