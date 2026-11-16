import { useMemo, useState } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { computeStatus, describeRemaining, remainingDays } from '../../shared/status';
import {
  CATEGORY_LABEL,
  JOB_LABEL,
  JOB_TYPES,
  PROJECT_CATEGORIES,
  type JobType,
  type LinkedFile,
  type MasterKind,
  type Project,
  type ProjectCategory,
  type ProjectInput,
} from '../../shared/types';
import { LIMITS, hasErrors, validateProjectInput } from '../../shared/validation';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { DateInput, Field, PriorityPicker, SearchableSelect, StatusBadge } from './common';
import { FileLinkField } from './FileLink';
import { Modal } from './Modal';

export interface ProjectDefaults {
  jobType?: JobType;
  jobYearId?: string;
  workCategory?: ProjectCategory;
}

function initialInput(project: Project | undefined, defaults: ProjectDefaults | undefined, today: string, fallbackYear: string): ProjectInput {
  if (project)
    return {
      jobYearId: project.jobYearId,
      workCategory: project.workCategory,
      receivedDate: project.receivedDate,
      dueDate: project.dueDate,
      projectName: project.projectName,
      clientId: project.clientId,
      designUnitId: project.designUnitId,
      stageId: project.stageId,
      note: project.note,
      filePath: project.filePath,
      fileName: project.fileName,
      fileExtension: project.fileExtension,
      priorityPoint: project.priorityPoint,
    };
  return {
    jobYearId: defaults?.jobYearId ?? fallbackYear,
    workCategory: defaults?.workCategory ?? 'PRE_SALES',
    receivedDate: today,
    dueDate: '',
    projectName: '',
    clientId: '',
    designUnitId: null,
    stageId: null,
    note: '',
    filePath: null,
    fileName: null,
    fileExtension: null,
    priorityPoint: 3,
  };
}

export function ProjectForm({
  project,
  defaults,
  onClose,
  onSaved,
}: {
  project?: Project;
  defaults?: ProjectDefaults;
  onClose: () => void;
  onSaved?: (p: Project) => void;
}) {
  const { years, yearById, masters, today, thresholds, refresh } = useAppData();
  const { toast, toastError, confirm } = useUi();
  const isEdit = !!project;

  const fallbackYear = useMemo(() => {
    const job = defaults?.jobType ?? 'MAIN';
    const list = years.filter((y) => y.jobType === job);
    return (list.find((y) => y.yearLabel === today.slice(0, 4)) ?? list[0])?.id ?? '';
  }, [years, defaults, today]);

  const [initial] = useState(() => initialInput(project, defaults, today, fallbackYear));
  const [form, setForm] = useState<ProjectInput>(initial);
  const [jobType, setJobType] = useState<JobType>(project?.jobType ?? defaults?.jobType ?? yearById.get(initial.jobYearId)?.jobType ?? 'MAIN');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const errors = validateProjectInput(form);
  const show = (k: string) => (submitted || touched[k] ? errors[k] : undefined);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Bỏ thay đổi?', message: 'Form có thay đổi chưa lưu. Bạn có chắc muốn đóng và bỏ các thay đổi này?', confirmText: 'Bỏ thay đổi', danger: true })))
      return;
    onClose();
  };

  const createMaster = (kind: MasterKind) => async (name: string) => {
    try {
      const item = await api.createMaster(kind, name);
      await refresh('masters');
      toast('success', `Đã thêm "${item.name}" vào danh mục.`);
      return item.id;
    } catch (e) {
      toastError(e);
      return null;
    }
  };

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) {
      toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
      return;
    }
    setSaving(true);
    try {
      const saved = isEdit ? await api.updateProject(project!.id, form) : await api.createProject(form);
      await refresh('projects', 'years');
      toast('success', isEdit ? `Đã cập nhật "${saved.projectName}".` : `Đã tạo dự án "${saved.projectName}".`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const opts = (kind: MasterKind) => masters[kind].map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive }));
  const jobYears = years.filter((y) => y.jobType === jobType);
  const linked: LinkedFile | null = form.filePath ? { path: form.filePath, name: form.fileName ?? '', extension: form.fileExtension ?? '' } : null;
  const dueValid = !!form.dueDate && !errors.dueDate;
  const previewStatus = dueValid ? computeStatus({ isCompleted: project?.isCompleted ?? false, dueDate: form.dueDate }, today, thresholds) : null;
  const overdue = dueValid && remainingDays(form.dueDate, today) < 0;
  const year = yearById.get(form.jobYearId);

  return (
    <Modal
      size="lg"
      title={isEdit ? 'Chỉnh sửa dự án' : 'Thêm Project mới'}
      onClose={close}
      footer={() => (
        <>
          <span className="left faint small">
            <span className="req" style={{ color: 'var(--danger)' }}>*</span> là trường bắt buộc
          </span>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Tạo dự án'}
          </button>
        </>
      )}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="form-section">
          <h3>Vị trí</h3>
          {isEdit ? (
            <div className="row small muted">
              <Info size={14} />
              {JOB_LABEL[jobType]} › {year?.yearLabel} › {CATEGORY_LABEL[form.workCategory]} — dùng thao tác “Di chuyển” để đổi vị trí.
            </div>
          ) : (
            <div className="grid-3">
              <Field label="Job" required>
                <select
                  className="select"
                  value={jobType}
                  onChange={(e) => {
                    const jt = e.target.value as JobType;
                    setJobType(jt);
                    const list = years.filter((y) => y.jobType === jt);
                    set('jobYearId', (list.find((y) => y.yearLabel === year?.yearLabel) ?? list[0])?.id ?? '');
                  }}
                >
                  {JOB_TYPES.map((j) => (
                    <option key={j} value={j}>
                      {JOB_LABEL[j]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Năm" required error={show('jobYearId')}>
                <select className="select" value={form.jobYearId} onChange={(e) => set('jobYearId', e.target.value)}>
                  {jobYears.length === 0 && <option value="">— Chưa có năm —</option>}
                  {jobYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.yearLabel}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nhóm" required>
                <select className="select" value={form.workCategory} onChange={(e) => set('workCategory', e.target.value as ProjectCategory)}>
                  {PROJECT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </section>

        <section className="form-section">
          <h3>Thông tin chung</h3>
          <div className="stack">
            <Field label="Tên dự án" required error={show('projectName')} htmlFor="pf-name" hint={`${form.projectName.trim().length}/${LIMITS.projectName}`}>
              <input
                id="pf-name"
                autoFocus
                className={`input ${show('projectName') ? 'invalid' : ''}`}
                value={form.projectName}
                maxLength={LIMITS.projectName + 50}
                onChange={(e) => set('projectName', e.target.value)}
                onBlur={() => touch('projectName')}
                placeholder="Ví dụ: Nhà máy ABC – hệ thống camera"
              />
            </Field>
            <div className="grid-3">
              <Field label="CĐT" required error={show('clientId')}>
                <SearchableSelect
                  options={opts('clients')}
                  value={form.clientId || null}
                  onChange={(id) => {
                    set('clientId', id ?? '');
                    touch('clientId');
                  }}
                  onBlur={() => touch('clientId')}
                  onCreate={createMaster('clients')}
                  invalid={!!show('clientId')}
                  placeholder="Chọn hoặc thêm CĐT"
                  clearable={false}
                />
              </Field>
              <Field label="Đơn vị thiết kế">
                <SearchableSelect
                  options={opts('designUnits')}
                  value={form.designUnitId}
                  onChange={(id) => set('designUnitId', id)}
                  onCreate={createMaster('designUnits')}
                  placeholder="Không bắt buộc"
                />
              </Field>
              <Field label="Giai đoạn">
                <SearchableSelect options={opts('stages')} value={form.stageId} onChange={(id) => set('stageId', id)} onCreate={createMaster('stages')} placeholder="Không bắt buộc" />
              </Field>
            </div>
          </div>
        </section>

        <section className="form-section">
          <h3>Thời hạn &amp; ưu tiên</h3>
          <div className="grid-2">
            <Field label="Ngày tiếp nhận" required error={show('receivedDate')}>
              <DateInput value={form.receivedDate || null} onChange={(v) => set('receivedDate', v ?? '')} onBlur={() => touch('receivedDate')} invalid={!!show('receivedDate')} />
            </Field>
            <Field
              label="Ngày tới hạn"
              required
              error={show('dueDate')}
              warn={overdue ? 'Ngày tới hạn đã qua — dự án sẽ được xếp Khẩn cấp.' : undefined}
            >
              <DateInput value={form.dueDate || null} onChange={(v) => set('dueDate', v ?? '')} onBlur={() => touch('dueDate')} invalid={!!show('dueDate')} />
            </Field>
          </div>
          <div className="row wrap" style={{ marginTop: 14, alignItems: 'flex-start', gap: 28 }}>
            <Field label="Priority Point" required error={show('priorityPoint')}>
              <PriorityPicker value={form.priorityPoint} onChange={(v) => set('priorityPoint', v)} />
            </Field>
            {previewStatus && (
              <div className="field">
                <span className="field-label">Trạng thái sau khi lưu</span>
                <div className="row">
                  <StatusBadge status={previewStatus} />
                  <span className="small muted">
                    <CalendarClock size={13} style={{ verticalAlign: -2 }} /> Hạn {formatDate(form.dueDate)} · {describeRemaining(remainingDays(form.dueDate, today))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="form-section">
          <h3>File liên kết</h3>
          <FileLinkField
            value={linked}
            onChange={(f) => setForm((x) => ({ ...x, filePath: f?.path ?? null, fileName: f?.name ?? null, fileExtension: f?.extension ?? null }))}
          />
          {errors.file && <div className="field-error">{errors.file}</div>}
        </section>

        <section className="form-section">
          <h3>Ghi chú</h3>
          <Field label="Note" error={show('note')} hint={`${form.note.length}/${LIMITS.note}`}>
            <textarea
              className={`textarea ${show('note') ? 'invalid' : ''}`}
              rows={4}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              onBlur={() => touch('note')}
            />
          </Field>
        </section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
