import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarClock, Info } from 'lucide-react';
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
import { isNoteEmpty, sanitizeNoteHtml } from '../../shared/noteHtml';
import { LIMITS, hasErrors, validateProjectInput } from '../../shared/validation';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { DateInput, Field, PriorityPicker, SearchableSelect, StatusBadge } from './common';
import { FileLinkField } from './FileLink';
import { Modal } from './Modal';
import { RichNoteEditor } from './RichNoteEditor';

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
      salespersonId: project.salespersonId,
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
    salespersonId: null,
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
  const [saving, setSaving] = useState<false | 'save' | 'calendar'>(false);

  const errors = validateProjectInput(form);
  const show = (k: string) => (submitted || touched[k] ? errors[k] : undefined);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const set = <K extends keyof ProjectInput>(k: K, v: ProjectInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Ghi chú lưu theo ngày: form chỉ soạn mục của hôm nay; các ngày trước xem/sửa ở trang chi tiết.
  const [noteInit, setNoteInit] = useState<string | null>(isEdit ? null : '');
  const [noteDraft, setNoteDraft] = useState('');
  useEffect(() => {
    if (!project) return;
    api
      .listProjectNotes(project.id)
      .then((list) => {
        const html = list.find((n) => n.noteDate === today)?.html ?? '';
        setNoteInit(html);
        setNoteDraft(html);
      })
      .catch(() => setNoteInit(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const noteChanged = noteInit !== null && sanitizeNoteHtml(noteDraft) !== sanitizeNoteHtml(noteInit);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || noteChanged;

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

  const save = async (addToCalendar = false) => {
    setSubmitted(true);
    if (hasErrors(errors)) {
      toast('error', 'Vui lòng kiểm tra các trường được đánh dấu.');
      return;
    }
    setSaving(addToCalendar ? 'calendar' : 'save');
    try {
      const saved = isEdit
        ? await api.updateProject(project!.id, form, { addToCalendar, noteHtml: noteChanged ? noteDraft : undefined })
        : await api.createProject(form, { noteHtml: isNoteEmpty(noteDraft) ? undefined : noteDraft });
      await refresh('projects', 'years');
      toast(
        'success',
        isEdit
          ? addToCalendar
            ? `Đã lưu "${saved.projectName}" và thêm vào Calendar hôm nay.`
            : `Đã cập nhật "${saved.projectName}".`
          : saved.isCompleted
            ? `Đã tạo dự án "${saved.projectName}" ở trạng thái Đã hoàn thành (ngày tới hạn đã qua).`
            : `Đã tạo dự án "${saved.projectName}" — ngày tiếp nhận đã có trên Calendar.`,
      );
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
  const overdue = dueValid && remainingDays(form.dueDate, today) < 0;
  // Nhập mới với hạn đã qua = việc đã xong (nhập bù) → lưu ở trạng thái Đã hoàn thành.
  const previewStatus = dueValid ? computeStatus({ isCompleted: project ? project.isCompleted : overdue, dueDate: form.dueDate }, today, thresholds) : null;
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
            {!isEdit && ' · Ngày tiếp nhận được tự thêm vào Calendar'}
          </span>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          {isEdit ? (
            <>
              <button className="btn primary" onClick={() => void save(false)} disabled={!!saving}>
                {saving === 'save' ? 'Đang lưu…' : 'Lưu'}
              </button>
              <button
                className="btn success"
                onClick={() => void save(true)}
                disabled={!!saving}
                title="Lưu và ghi một mục “Cập nhật dự án” (kèm tóm tắt thay đổi) vào Calendar ngày hôm nay"
              >
                <CalendarCheck size={15} /> {saving === 'calendar' ? 'Đang lưu…' : 'Lưu và thêm vào Calendar'}
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => void save(false)} disabled={!!saving}>
              {saving ? 'Đang lưu…' : 'Tạo dự án'}
            </button>
          )}
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
            <div className="grid-2">
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
              <Field label="Salesperson">
                <SearchableSelect
                  options={opts('salespersons')}
                  value={form.salespersonId}
                  onChange={(id) => set('salespersonId', id)}
                  onCreate={createMaster('salespersons')}
                  createLabel="Thêm Salesperson"
                  placeholder="Không bắt buộc"
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
              warn={
                overdue
                  ? isEdit
                    ? project?.isCompleted
                      ? undefined
                      : 'Ngày tới hạn đã qua — dự án sẽ ở trạng thái Khẩn cấp (quá hạn).'
                    : 'Ngày tới hạn đã qua — dự án mới sẽ được lưu ở trạng thái Đã hoàn thành.'
                  : undefined
              }
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
                    <CalendarClock size={13} style={{ verticalAlign: -2 }} /> Hạn {formatDate(form.dueDate)}
                    {previewStatus !== 'COMPLETED' && ` · ${describeRemaining(remainingDays(form.dueDate, today))}`}
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
          <h3>Ghi chú hôm nay · {formatDate(today)}</h3>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            {isEdit
              ? 'Lưu vào mục ghi chú của hôm nay. Ghi chú các ngày trước xem và sửa ở trang chi tiết dự án.'
              : 'Ghi chú đầu tiên của dự án, lưu theo ngày hôm nay.'}{' '}
            Định dạng tự do, dán ảnh bằng Ctrl+V.
          </div>
          {noteInit === null ? (
            <div className="faint small">Đang tải ghi chú…</div>
          ) : (
            <RichNoteEditor initialHtml={noteInit} onChange={setNoteDraft} minHeight={120} />
          )}
        </section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
