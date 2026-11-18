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
import { CATEGORY_LABEL, JOB_LABEL, type Project, type ProjectImport, type ProjectInput } from '../../shared/types';
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

function toInput(p: Project): ProjectInput {
  return {
    stt: p.stt,
    siId: p.siId,
    brandIds: p.brands.map((b) => b.id),
    jobYearId: p.jobYearId,
    workCategory: p.workCategory,
    receivedDate: p.receivedDate,
    dueDate: p.dueDate,
    projectName: p.projectName,
    clientId: p.clientId,
    salespersonId: p.salespersonId,
    note: p.note,
    filePath: p.filePath,
    fileName: p.fileName,
    fileExtension: p.fileExtension,
    priorityPoint: p.priorityPoint,
  };
}

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
  const imp = imports?.[0] ?? null;

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

  const updateFile = async (file: { path: string; name: string; extension: string } | null) => {
    try {
      await api.updateProject(p.id, { ...toInput(p), filePath: file?.path ?? null, fileName: file?.name ?? null, fileExtension: file?.extension ?? null });
      await refresh('projects');
      toast('success', file ? 'Đã cập nhật file liên kết.' : 'Đã gỡ liên kết file (file gốc không bị xóa).');
    } catch (e) {
      toastError(e);
    }
  };

  const replaceFile = async () => {
    try {
      const f = await api.pickLinkFile();
      if (f) await updateFile(f);
    } catch (e) {
      toastError(e);
    }
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
            {p.filePath ? (
              <FileStatusRow
                file={{ path: p.filePath, name: p.fileName ?? '', extension: p.fileExtension ?? '' }}
                saved
                onReplace={replaceFile}
                onRemove={async () => {
                  if (await confirm({ title: 'Gỡ liên kết file', message: 'Gỡ liên kết file khỏi dự án? File gốc trên máy không bị xóa.', confirmText: 'Gỡ liên kết' }))
                    await updateFile(null);
                }}
              />
            ) : (
              <div className="row">
                <FileText size={16} className="faint" />
                <span className="muted small grow">Chưa liên kết file (DWG, TXT, DOCX, PDF, XLSX).</span>
                <button className="btn sm" onClick={replaceFile}>
                  <Upload size={14} /> Chọn file
                </button>
              </div>
            )}
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
