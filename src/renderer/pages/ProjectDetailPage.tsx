import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FolderInput,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { formatDate, formatDateTime } from '../../shared/dates';
import { describeRemaining } from '../../shared/status';
import { CATEGORY_LABEL, JOB_LABEL, type LinkedFile, type ProjectImport } from '../../shared/types';
import { api } from '../api';
import { Breadcrumbs, EmptyState, PriorityBadge, StatusBadge, shortenPath } from '../components/common';
import { FileStatusRow } from '../components/FileLink';
import { ProjectCalendarCard } from '../components/ProjectCalendarCard';
import { ProjectFolderRow } from '../components/ProjectFolderRow';
import { ProjectNotes } from '../components/ProjectNotes';
import { ProjectImports } from '../components/ProjectImports';
import { nodePath, salesLabel } from '../lib/projects';
import { useAppData } from '../state/AppData';
import { useProjectActions } from '../state/projectActions';
import { usePageTitle, useUi } from '../state/ui';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { projectById, refresh } = useAppData();
  const actions = useProjectActions();
  const { confirm, toast, toastError } = useUi();
  const p = projectById.get(id);
  usePageTitle(p ? p.label : 'Chi tiết dự án');

  const [imports, setImports] = useState<ProjectImport[] | undefined>(undefined);

  const loadImport = useCallback(() => {
    api
      .listProjectImports(id)
      .then(setImports)
      .catch((e: unknown) => {
        setImports([]);
        toastError(e);
      });
  }, [id, toastError]);
  const imp = imports?.length ? imports.reduce((a, b) => (b.importedAt > a.importedAt ? b : a)) : null;

  useEffect(() => {
    if (p) loadImport();
  }, [p?.id, p?.updatedAt, loadImport]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p)
    return (
      <EmptyState
        title="Không tìm thấy dự án"
        text="Dự án có thể đã bị xóa."
        action={
          <button className="btn" onClick={() => navigate('/all')}>
            <ArrowLeft size={15} /> Về Tất cả mục
          </button>
        }
      />
    );

  const saveFiles = async (files: LinkedFile[], msg: string) => {
    try {
      await api.setProjectFiles(p.id, files);
      await refresh('projects');
      toast('success', msg);
    } catch (e) {
      toastError(e);
    }
  };
  const addFiles = async () => {
    try {
      const picked = await api.pickLinkFiles();
      const seen = new Set(p.files.map((f) => f.path.toLowerCase()));
      const fresh = picked.filter((f) => !seen.has(f.path.toLowerCase()));
      if (picked.length && !fresh.length) toast('info', 'File đã chọn đều đã có trong danh sách.');
      if (fresh.length) await saveFiles([...p.files, ...fresh], `Đã thêm ${fresh.length} file liên kết.`);
    } catch (e) {
      toastError(e);
    }
  };
  const replaceFileAt = async (i: number) => {
    try {
      const f = await api.pickLinkFile();
      if (f) await saveFiles(p.files.map((x, j) => (j === i ? f : x)), 'Đã thay file liên kết.');
    } catch (e) {
      toastError(e);
    }
  };
  const removeFileAt = async (i: number) => {
    if (!(await confirm({ title: 'Gỡ liên kết file', message: `Gỡ liên kết "${p.files[i].name}" khỏi dự án? File gốc trên máy không bị xóa.`, confirmText: 'Gỡ liên kết' }))) return;
    await saveFiles(
      p.files.filter((_, j) => j !== i),
      'Đã gỡ liên kết file (file gốc không bị xóa).',
    );
  };

  const crumbs = [
    { label: JOB_LABEL[p.jobType] },
    { label: p.yearLabel },
    { label: CATEGORY_LABEL[p.workCategory], to: nodePath(p.jobType, p.jobYearId, p.workCategory) },
  ];

  return (
    <div>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Breadcrumbs items={crumbs} />
          <h1 style={{ wordBreak: 'break-word' }}>{p.label}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <StatusBadge status={p.status} />
            <PriorityBadge value={p.priorityPoint} />
            {p.status !== 'COMPLETED' && p.dueDate && <span className={`small st-${p.status}`} style={{ color: 'var(--st)', fontWeight: 600 }}>{describeRemaining(p.remaining)}</span>}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} /> Quay lại
          </button>
          <button className="btn" onClick={() => actions.openEdit(p)}>
            <Pencil size={15} /> Chỉnh sửa
          </button>
          <button className="btn" onClick={() => actions.openMove(p)}>
            <FolderInput size={15} /> Di chuyển
          </button>
          {p.isCompleted ? (
            <button className="btn" onClick={() => void actions.setCompleted(p, false)}>
              <RotateCcw size={15} /> Bỏ hoàn thành
            </button>
          ) : (
            <button className="btn primary" onClick={() => void actions.setCompleted(p, true)}>
              <CheckCircle2 size={15} /> Đánh dấu hoàn thành
            </button>
          )}
          <button
            className="btn danger"
            onClick={async () => {
              if (await actions.remove(p)) navigate(nodePath(p.jobType, p.jobYearId, p.workCategory), { replace: true });
            }}
          >
            <Trash2 size={15} /> Xóa
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <section className="card card-pad">
          <h2 className="card-title">Thông tin chung</h2>
          <div className="info-grid">
            <span className="k">STT</span>
            <span style={{ fontWeight: 600 }}>{p.stt}</span>
            <span className="k">Tên dự án</span>
            <span style={{ fontWeight: 600 }}>{p.projectName}</span>
            <span className="k">Tên SI</span>
            <span>{p.siName ?? <span className="faint">—</span>}</span>
            <span className="k">Hãng</span>
            <span>
              {p.brands.length ? (
                <span className="row wrap" style={{ gap: 4 }}>
                  {p.brands.map((b) => (
                    <span key={b.id} className="badge">
                      {b.name}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="faint">—</span>
              )}
            </span>
            <span className="k">Sale</span>
            <span>{salesLabel(p) ?? <span className="faint">—</span>}</span>
            <span className="k">EU</span>
            <span>{p.clientName ?? <span className="faint">—</span>}</span>
            <span className="k">Vị trí</span>
            <span>{p.location}</span>
          </div>
          <div className="small faint" style={{ marginTop: 14 }}>
            Tạo lúc {formatDateTime(p.createdAt)} · Cập nhật lúc {formatDateTime(p.updatedAt)}
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="card-title">Thời hạn &amp; ưu tiên</h2>
          <div className="info-grid">
            <span className="k">Ngày bắt đầu</span>
            <span>{p.receivedDate ? formatDate(p.receivedDate) : <span className="faint">—</span>}</span>
            <span className="k">Ngày tới hạn</span>
            <span>
              {p.dueDate ? (
                <>
                  {formatDate(p.dueDate)} {p.status !== 'COMPLETED' && <span className="muted">({describeRemaining(p.remaining)})</span>}
                </>
              ) : (
                <span className="faint">—</span>
              )}
            </span>
            <span className="k">Trạng thái</span>
            <span>
              <StatusBadge status={p.status} />
            </span>
            <span className="k">Priority Point</span>
            <span>
              <PriorityBadge value={p.priorityPoint} /> <span className="muted small">(1 cao nhất – 5 thấp nhất)</span>
            </span>
            {p.completedAt && (
              <>
                <span className="k">Hoàn thành lúc</span>
                <span>{formatDateTime(p.completedAt)}</span>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="detail-grid notes-row">
        <section className="card card-pad">
          <h2 className="card-title">File &amp; Attachments</h2>
          <div className="stack" style={{ gap: 10 }}>
            <ProjectFolderRow p={p} />
            {p.files.map((f, i) => (
              <FileStatusRow key={f.path} file={f} saved onReplace={() => void replaceFileAt(i)} onRemove={() => void removeFileAt(i)} />
            ))}
            <div className="row">
              <FileText size={16} className="faint" />
              <span className="muted small grow">{p.files.length ? `${p.files.length} file liên kết` : 'Chưa liên kết file (DWG, TXT, DOCX, PDF, XLSX).'}</span>
              <button className="btn sm" onClick={() => void addFiles()}>
                <Upload size={14} /> {p.files.length ? 'Thêm file' : 'Chọn file'}
              </button>
            </div>
            {imp && (
              <div className="file-row">
                <div className="file-ext">
                  <FileSpreadsheet size={18} />
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }} className="ellipsis">
                    Nguồn Excel: {imp.sourceFileName}
                    {imports && imports.length > 1 ? <span className="small muted"> (mới nhất · tổng {imports.length} bảng)</span> : null}
                  </div>
                  <div className="small faint ellipsis" title={imp.sourcePath ?? ''}>
                    {imp.sourcePath ? shortenPath(imp.sourcePath, 70) : '—'} · Sheet: {imp.sheetNames.join(', ')}
                  </div>
                  <div className="small muted">Import lúc {formatDateTime(imp.importedAt)} — dữ liệu đã lưu trong ứng dụng, không phụ thuộc file nguồn.</div>
                </div>
              </div>
            )}
          </div>
        </section>
        <ProjectNotes projectId={p.id} version={p.updatedAt} />
      </div>

      <ProjectCalendarCard projectId={p.id} dueDate={p.dueDate} version={p.updatedAt} />

      <ProjectImports
        key={p.id}
        projectId={p.id}
        imports={imports}
        onChanged={() => {
          void refresh('projects');
          loadImport();
        }}
      />
    </div>
  );
}
