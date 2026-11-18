import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, CalendarClock, ChevronDown, FolderCog, FolderOpen, FolderPlus, Info } from 'lucide-react';
import { formatDate } from '../../shared/dates';
import { projectFolderName } from '../../shared/folderName';
import { isNoteEmpty, sanitizeNoteHtml } from '../../shared/noteHtml';
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
  type ProjectSaved,
} from '../../shared/types';
import { LIMITS, hasErrors, validateProjectInput } from '../../shared/validation';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { DateInput, Field, MultiSearchSelect, PriorityPicker, SearchableSelect, StatusBadge, shortenPath } from './common';
import { FileLinkField } from './FileLink';
import { Modal } from './Modal';
import { RichNoteEditor } from './RichNoteEditor';

export interface ProjectDefaults {
  jobType?: JobType;
  jobYearId?: string;
  workCategory?: ProjectCategory;
}

function initialInput(project: Project | undefined, defaults: ProjectDefaults | undefined, today: string, fallbackYear: string, template?: Project): ProjectInput {
  if (template && !project)
    return {
      stt: null,
      jobYearId: template.jobYearId,
      workCategory: template.workCategory,
      receivedDate: template.receivedDate,
      dueDate: template.dueDate,
      projectName: `${template.projectName} (bản sao)`,
      clientId: template.clientId,
      siId: template.siId,
      brandIds: template.brands.map((b) => b.id),
      salespersonId: template.salespersonId,
      note: '',
      filePath: template.filePath,
      fileName: template.fileName,
      fileExtension: template.fileExtension,
      priorityPoint: template.priorityPoint,
      folderParent: null,
      folderLink: null,
    };
  if (project)
    return {
      stt: project.stt,
      jobYearId: project.jobYearId,
      workCategory: project.workCategory,
      receivedDate: project.receivedDate,
      dueDate: project.dueDate,
      projectName: project.projectName,
      clientId: project.clientId,
      siId: project.siId,
      brandIds: project.brands.map((b) => b.id),
      salespersonId: project.salespersonId,
      note: project.note,
      filePath: project.filePath,
      fileName: project.fileName,
      fileExtension: project.fileExtension,
      priorityPoint: project.priorityPoint,
      folderParent: undefined,
    };
  return {
    stt: null,
    jobYearId: defaults?.jobYearId ?? fallbackYear,
    workCategory: defaults?.workCategory ?? 'PRE_SALES',
    receivedDate: today,
    dueDate: null,
    projectName: '',
    clientId: null,
    siId: null,
    brandIds: [],
    salespersonId: null,
    note: '',
    filePath: null,
    fileName: null,
    fileExtension: null,
    priorityPoint: 3,
    folderParent: null,
  };
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}\\${name}`;

export function ProjectForm({
  project,
  template,
  defaults,
  onClose,
  onSaved,
}: {
  project?: Project;
  /** Duplicate: điền sẵn từ dự án này, lưu thành dự án mới. */
  template?: Project;
  defaults?: ProjectDefaults;
  onClose: () => void;
  onSaved?: (p: Project) => void;
}) {
  const { years, yearById, masters, today, thresholds, settings, refresh } = useAppData();
  const { toast, toastError, confirm } = useUi();
  const isEdit = !!project;

  const fallbackYear = useMemo(() => {
    const job = defaults?.jobType ?? 'MAIN';
    const list = years.filter((y) => y.jobType === job);
    return (list.find((y) => y.yearLabel === today.slice(0, 4)) ?? list[0])?.id ?? '';
  }, [years, defaults, today]);

  const [initial, setInitial] = useState(() => initialInput(project, defaults, today, fallbackYear, template));
  // Dự án mới: tick = tạo thư mục "STT.Tên dự án_Tên SI_Hãng"; bỏ tick = liên kết thư mục có sẵn hoặc để đặt sau.
  const [createFolder, setCreateFolder] = useState(true);
  const [form, setForm] = useState<ProjectInput>(initial);
  const [jobType, setJobType] = useState<JobType>(project?.jobType ?? defaults?.jobType ?? yearById.get(initial.jobYearId)?.jobType ?? 'MAIN');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState<false | 'save' | 'calendar'>(false);
  const [moreOpen, setMoreOpen] = useState(() => !!project?.filePath);

  // Dự án mới: nơi lưu thư mục dùng lần trước; STT gợi ý = STT lớn nhất của danh sách (năm × nhóm) đang chọn + 1,
  // đổi năm/nhóm thì gợi ý lại (trừ khi người dùng đã tự sửa STT).
  const sttEdited = useRef(false);
  useEffect(() => {
    if (isEdit) return;
    const parent = settings.projectRootDir;
    setInitial((i) => ({ ...i, folderParent: parent }));
    setForm((f) => ({ ...f, folderParent: f.folderParent ?? parent }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (isEdit || !form.jobYearId || sttEdited.current) return;
    let alive = true;
    api
      .nextProjectStt(form.jobYearId, form.workCategory)
      .then((stt) => {
        if (!alive || sttEdited.current) return;
        setInitial((i) => ({ ...i, stt }));
        setForm((f) => ({ ...f, stt }));
      })
      .catch(toastError);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.jobYearId, form.workCategory]);

  const errors = validateProjectInput(form);
  if (!isEdit && createFolder && !form.folderParent) errors.folderParent = 'Chọn nơi lưu, hoặc bỏ tick “Tạo thư mục mới” nếu chưa cần thư mục.';
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

  const pickLink = async () => {
    try {
      const dir = await api.pickFolder('Chọn thư mục có sẵn của dự án');
      if (dir) set('folderLink', dir);
    } catch (e) {
      toastError(e);
    }
  };

  const pickParent = async () => {
    try {
      const dir = await api.pickFolder('Chọn nơi lưu thư mục dự án');
      if (dir) set('folderParent', dir);
    } catch (e) {
      toastError(e);
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
      const saved: ProjectSaved = isEdit
        ? await api.updateProject(project!.id, form, { addToCalendar, noteHtml: noteChanged ? noteDraft : undefined })
        : await api.createProject(
            { ...form, folderParent: createFolder ? form.folderParent : null, folderLink: createFolder ? null : (form.folderLink ?? null) },
            { noteHtml: isNoteEmpty(noteDraft) ? undefined : noteDraft },
          );
      await refresh('projects', 'years', 'settings');
      const name = `${saved.stt}. ${saved.projectName}`;
      toast(
        'success',
        isEdit
          ? addToCalendar
            ? `Đã lưu "${name}" và thêm vào Calendar hôm nay.`
            : `Đã cập nhật "${name}".`
          : saved.isCompleted
            ? `Đã tạo dự án "${name}" ở trạng thái Đã hoàn thành (ngày tới hạn đã qua).`
            : `Đã tạo dự án "${name}"${saved.folderPath ? (saved.folderAuto ? ' và thư mục trên máy' : ' (đã liên kết thư mục có sẵn)') : ''}.`,
      );
      if (saved.notice) toast('warn', saved.notice);
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
  const overdue = dueValid && (remainingDays(form.dueDate, today) ?? 0) < 0;
  // Nhập mới với hạn đã qua = việc đã xong (nhập bù) → lưu ở trạng thái Đã hoàn thành.
  const previewStatus = computeStatus({ isCompleted: project ? project.isCompleted : overdue, dueDate: dueValid ? form.dueDate : null }, today, thresholds);
  const year = yearById.get(form.jobYearId);

  const nameOf = (kind: MasterKind, id: string | null | undefined) => (id ? masters[kind].find((m) => m.id === id)?.name ?? '' : '');
  const folderName = projectFolderName({
    stt: form.stt,
    projectName: form.projectName,
    siName: nameOf('siPartners', form.siId),
    brandNames: (form.brandIds ?? []).map((b) => nameOf('brands', b)),
  });
  const parent = form.folderParent ?? (project?.folderPath ? dirOf(project.folderPath) : null);
  const targetFolder = parent ? joinPath(parent, folderName) : null;
  const willRename = !!project?.folderPath && targetFolder !== null && targetFolder !== project.folderPath;

  return (
    <Modal
      size="lg"
      title={isEdit ? 'Chỉnh sửa dự án' : template ? 'Duplicate dự án' : 'Thêm Project mới'}
      onClose={close}
      footer={() => (
        <>
          <span className="left faint small">
            <span className="req" style={{ color: 'var(--danger)' }}>*</span> là trường bắt buộc
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
                  disabled={JOB_TYPES.length < 2}
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
          <h3>Thông tin dự án</h3>
          <div className="stack">
            <div className="stt-row">
              <Field label="STT" required error={show('stt')} htmlFor="pf-stt">
                <input
                  id="pf-stt"
                  className={`input ${show('stt') ? 'invalid' : ''}`}
                  type="number"
                  min={1}
                  value={form.stt ?? ''}
                  onChange={(e) => {
                    sttEdited.current = true;
                    set('stt', e.target.value === '' ? null : Number(e.target.value));
                  }}
                  onBlur={() => touch('stt')}
                />
              </Field>
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
            </div>
            <div className="grid-2">
              <Field label="Tên SI">
                <SearchableSelect options={opts('siPartners')} value={form.siId ?? null} onChange={(id) => set('siId', id)} onCreate={createMaster('siPartners')} createLabel="Thêm SI" placeholder="Không bắt buộc" />
              </Field>
              <Field label="Hãng" hint="Chọn được nhiều Hãng">
                <MultiSearchSelect options={opts('brands')} value={form.brandIds ?? []} onChange={(ids) => set('brandIds', ids)} onCreate={createMaster('brands')} createLabel="Thêm Hãng" placeholder="Không bắt buộc" />
              </Field>
              <Field label="Sale">
                <SearchableSelect
                  options={masters.salespersons.map((m) => ({ id: m.id, name: m.name, inactive: !m.isActive, hint: m.departmentName ?? undefined }))}
                  value={form.salespersonId}
                  onChange={(id) => set('salespersonId', id)}
                  onCreate={createMaster('salespersons')}
                  createLabel="Thêm Sale"
                  placeholder="Không bắt buộc"
                />
              </Field>
              <Field label="EU">
                <SearchableSelect options={opts('clients')} value={form.clientId} onChange={(id) => set('clientId', id)} onCreate={createMaster('clients')} createLabel="Thêm EU" placeholder="Không bắt buộc" />
              </Field>
            </div>
          </div>
        </section>

        <section className="form-section">
          <h3>Thời hạn &amp; ưu tiên</h3>
          <div className="grid-2">
            <Field label="Ngày bắt đầu" error={show('receivedDate')}>
              <DateInput value={form.receivedDate} onChange={(v) => set('receivedDate', v)} onBlur={() => touch('receivedDate')} invalid={!!show('receivedDate')} clearable />
            </Field>
            <Field
              label="Ngày tới hạn"
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
              <DateInput value={form.dueDate} onChange={(v) => set('dueDate', v)} onBlur={() => touch('dueDate')} invalid={!!show('dueDate')} clearable />
            </Field>
          </div>
          <div className="row wrap" style={{ marginTop: 14, alignItems: 'flex-start', gap: 28 }}>
            <Field label="Priority Point">
              <PriorityPicker value={form.priorityPoint} onChange={(v) => set('priorityPoint', v)} />
            </Field>
            <div className="field">
              <span className="field-label">Trạng thái sau khi lưu</span>
              <div className="row">
                <StatusBadge status={previewStatus} />
                <span className="small muted">
                  <CalendarClock size={13} style={{ verticalAlign: -2 }} /> {form.dueDate ? `Hạn ${formatDate(form.dueDate)}` : 'Chưa có ngày tới hạn'}
                  {dueValid && previewStatus !== 'COMPLETED' && ` · ${describeRemaining(remainingDays(form.dueDate, today))}`}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="form-section">
          <h3>Thư mục dự án trên máy</h3>
          {isEdit && project?.folderPath && !project.folderAuto ? (
            <div className="folder-pick">
              <FolderOpen size={16} className="faint" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small muted">Thư mục có sẵn đã liên kết (không tự đổi tên)</div>
                <div className="ellipsis" title={project.folderPath}>
                  {shortenPath(project.folderPath, 80)}
                </div>
              </div>
            </div>
          ) : isEdit ? (
            <div className="stack" style={{ gap: 8 }}>
            <div className="folder-pick">
              <FolderOpen size={16} className="faint" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small muted">Nơi lưu</div>
                <div className="ellipsis" title={parent ?? ''}>
                  {parent ? shortenPath(parent, 70) : <span className="faint">Chưa chọn</span>}
                </div>
              </div>
              <button type="button" className="btn sm" onClick={() => void pickParent()}>
                <FolderCog size={14} /> {parent ? 'Đổi nơi lưu…' : 'Chọn nơi lưu…'}
              </button>
            </div>
            {show('folderParent') && <div className="field-error">{show('folderParent')}</div>}
            <div className="folder-preview">
              <FolderPlus size={15} />
              <div style={{ minWidth: 0 }}>
                <div className="small muted">
                  {isEdit ? (project?.folderPath ? (willRename ? 'Thư mục sẽ được đổi thành' : 'Thư mục') : form.folderParent ? 'Sẽ tạo thư mục' : 'Chưa có thư mục — chọn nơi lưu để tạo') : 'Sẽ tạo thư mục'}
                  {' '}(STT.Tên dự án_Tên SI_Hãng)
                </div>
                <code className="folder-name">{folderName || '—'}</code>
                {targetFolder && (
                  <div className="small faint ellipsis" title={targetFolder}>
                    {shortenPath(targetFolder, 90)}
                  </div>
                )}
              </div>
            </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <label className="row small" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={createFolder} onChange={(e) => setCreateFolder(e.target.checked)} aria-label="Tạo thư mục mới cho dự án" />
                Tạo thư mục mới cho dự án (STT.Tên dự án_Tên SI_Hãng)
              </label>
              {createFolder ? (
                <>
              <div className="folder-pick">
                <FolderOpen size={16} className="faint" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small muted">Nơi lưu<span className="req" style={{ color: 'var(--danger)' }}> *</span></div>
                  <div className="ellipsis" title={parent ?? ''}>
                    {parent ? shortenPath(parent, 70) : <span className="faint">Chưa chọn</span>}
                  </div>
                </div>
                <button type="button" className="btn sm" onClick={() => void pickParent()}>
                  <FolderCog size={14} /> {parent ? 'Đổi nơi lưu…' : 'Chọn nơi lưu…'}
                </button>
              </div>
              {show('folderParent') && <div className="field-error">{show('folderParent')}</div>}
              <div className="folder-preview">
                <FolderPlus size={15} />
                <div style={{ minWidth: 0 }}>
                  <div className="small muted">
                    Sẽ tạo thư mục (STT.Tên dự án_Tên SI_Hãng)
                  </div>
                  <code className="folder-name">{folderName || '—'}</code>
                  {targetFolder && (
                    <div className="small faint ellipsis" title={targetFolder}>
                      {shortenPath(targetFolder, 90)}
                    </div>
                  )}
                </div>
              </div>
                </>
              ) : (
                <div className="folder-pick">
                  <FolderOpen size={16} className="faint" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small muted">Thư mục có sẵn (không bắt buộc)</div>
                    <div className="ellipsis" title={form.folderLink ?? ''}>
                      {form.folderLink ? shortenPath(form.folderLink, 70) : <span className="faint">Chưa chọn — có thể đặt sau ở trang chi tiết dự án</span>}
                    </div>
                  </div>
                  {form.folderLink && (
                    <button type="button" className="btn sm ghost" onClick={() => set('folderLink', null)}>
                      Bỏ chọn
                    </button>
                  )}
                  <button type="button" className="btn sm" onClick={() => void pickLink()}>
                    <FolderCog size={14} /> {form.folderLink ? 'Đổi thư mục…' : 'Chọn thư mục có sẵn…'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="form-section">
          <button type="button" className="section-toggle" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
            <ChevronDown size={15} className={moreOpen ? '' : 'rot-90'} /> File liên kết (DWG/TXT/DOCX/PDF)
          </button>
          {moreOpen && (
            <div className="stack" style={{ marginTop: 12 }}>
              <FileLinkField
                value={linked}
                onChange={(f) => setForm((x) => ({ ...x, filePath: f?.path ?? null, fileName: f?.name ?? null, fileExtension: f?.extension ?? null }))}
              />
              {errors.file && <div className="field-error">{errors.file}</div>}
            </div>
          )}
        </section>

        <section className="form-section">
          <h3>Ghi chú hôm nay · {formatDate(today)}</h3>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            {isEdit
              ? 'Lưu vào mục ghi chú của hôm nay. Ghi chú các ngày trước xem và sửa ở trang chi tiết dự án.'
              : 'Ghi chú đầu tiên của dự án, lưu theo ngày hôm nay.'}{' '}
            Định dạng tự do, dán hoặc kéo thả ảnh.
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
