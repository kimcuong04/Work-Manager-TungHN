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

/** Xóa dự án: Hủy / Xóa (giữ thư mục trên máy) / Xóa cả folder local (chuyển thư mục vào Thùng rác). */
function DeleteDialog({ project, onDone }: { project: Project; onDone: (deleted: boolean) => void }) {
  const { refresh } = useAppData();
  const { toast, toastError } = useUi();
  const [busy, setBusy] = useState<false | 'keep' | 'folder'>(false);
  const run = async (deleteFolder: boolean) => {
    setBusy(deleteFolder ? 'folder' : 'keep');
    try {
      await api.deleteProject(project.id, { deleteFolder });
      await refresh('projects', 'years');
      toast('success', deleteFolder ? `Đã xóa "${project.projectName}" và chuyển thư mục vào Thùng rác.` : `Đã xóa "${project.projectName}" (thư mục trên máy được giữ lại).`);
      onDone(true);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      size="sm"
      title="Xóa dự án"
      onClose={() => onDone(false)}
      footer={() => (
        <>
          <button className="btn" onClick={() => onDone(false)} disabled={!!busy}>
            Hủy
          </button>
          <button className="btn danger" onClick={() => void run(false)} disabled={!!busy}>
            {busy === 'keep' ? 'Đang xóa…' : 'Xóa'}
          </button>
          {project.folderPath && (
            <button className="btn danger solid" onClick={() => void run(true)} disabled={!!busy}>
              {busy === 'folder' ? 'Đang xóa…' : 'Xóa cả folder local'}
            </button>
          )}
        </>
      )}
    >
      <div className="stack" style={{ gap: 10 }}>
        <div>
          Xóa dự án <b>“{project.stt}. {project.projectName}”</b> khỏi ứng dụng?
        </div>
        <div className="muted small">Ghi chú, dữ liệu Excel đã import và lịch của dự án cũng bị xóa. File DWG/TXT liên kết không bị ảnh hưởng.</div>
        {project.folderPath ? (
          <div className="alert info small">
            <div>
              <b>Xóa</b>: giữ nguyên thư mục trên máy.
              <br />
              <b>Xóa cả folder local</b>: chuyển thư mục <span className="path-text">{project.folderPath}</span> vào Thùng rác (khôi phục được từ Thùng rác).
            </div>
          </div>
        ) : (
          <div className="muted small">Dự án chưa có thư mục trên máy.</div>
        )}
      </div>
    </Modal>
  );
}

export function ProjectActionsProvider({ children }: { children: ReactNode }) {
  const { refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [form, setForm] = useState<{ project?: Project; defaults?: ProjectDefaults } | null>(null);
  const [moving, setMoving] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<{ project: Project; resolve: (v: boolean) => void } | null>(null);

  const remove = useCallback((p: Project) => new Promise<boolean>((resolve) => setDeleting({ project: p, resolve })), []);

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
      {deleting && (
        <DeleteDialog
          project={deleting.project}
          onDone={(ok) => {
            deleting.resolve(ok);
            setDeleting(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}
