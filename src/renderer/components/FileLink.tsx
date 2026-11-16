import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FolderOpen, Link2Off, RefreshCw, Upload } from 'lucide-react';
import type { FileCheck, LinkedFile } from '../../shared/types';
import { api } from '../api';
import { useUi } from '../state/ui';
import { shortenPath } from './common';

export function useFileCheck(path: string | null): [FileCheck | null, () => void] {
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setCheck(null);
      return;
    }
    api.checkFile(path).then((c) => alive && setCheck(c)).catch(() => alive && setCheck({ exists: false, accessible: false, message: 'Không kiểm tra được file.' }));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  return [check, () => setTick((t) => t + 1)];
}

/** Mở file liên kết bằng ứng dụng mặc định của Windows (DWG → AutoCAD nếu đã liên kết). */
export function useOpenFile() {
  const { toast, toastError } = useUi();
  return async (path: string) => {
    try {
      await api.openFile(path);
      toast('info', 'Đã yêu cầu Windows mở file.');
    } catch (e) {
      toastError(e);
    }
  };
}

export function FileStatusRow({
  file,
  onReplace,
  onRemove,
  saved,
}: {
  file: LinkedFile;
  onReplace?: () => void;
  onRemove?: () => void;
  saved: boolean;
}) {
  const [check, recheck] = useFileCheck(file.path);
  const openFile = useOpenFile();
  const { toastError } = useUi();
  const bad = check !== null && !check.accessible;
  return (
    <div className={`file-row ${bad ? 'bad' : ''}`}>
      <div className="file-ext">{file.extension}</div>
      <div className="grow">
        <div className="ellipsis" style={{ fontWeight: 600 }} title={file.name}>
          {file.name}
        </div>
        <div className="small faint ellipsis" title={file.path}>
          {shortenPath(file.path, 70)}
        </div>
        {bad ? (
          <div className="small" style={{ color: 'var(--danger)', display: 'flex', gap: 5, alignItems: 'center', marginTop: 2 }}>
            <AlertTriangle size={13} /> {check?.message} Hãy chọn lại file.
          </div>
        ) : check?.accessible ? (
          <div className="small" style={{ color: 'var(--success)', marginTop: 2 }}>
            Truy cập được
          </div>
        ) : null}
      </div>
      <div className="row">
        {saved && !bad && (
          <>
            <button type="button" className="btn sm primary" onClick={() => openFile(file.path)}>
              <ExternalLink size={14} /> Mở file
            </button>
            <button type="button" className="btn sm icon" title="Hiện trong thư mục" aria-label="Hiện trong thư mục" onClick={() => api.showFileInFolder(file.path).catch(toastError)}>
              <FolderOpen size={14} />
            </button>
          </>
        )}
        {bad && (
          <button type="button" className="btn sm icon" title="Kiểm tra lại" aria-label="Kiểm tra lại" onClick={recheck}>
            <RefreshCw size={14} />
          </button>
        )}
        {onReplace && (
          <button type="button" className="btn sm" onClick={onReplace}>
            <Upload size={14} /> {bad ? 'Chọn lại' : 'Thay file'}
          </button>
        )}
        {onRemove && (
          <button type="button" className="btn sm icon danger" title="Gỡ liên kết (không xóa file gốc)" aria-label="Gỡ liên kết" onClick={onRemove}>
            <Link2Off size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function FileLinkField({ value, onChange }: { value: LinkedFile | null; onChange: (f: LinkedFile | null) => void }) {
  const { toastError } = useUi();
  const pick = async () => {
    try {
      const f = await api.pickLinkFile();
      if (f) onChange(f);
    } catch (e) {
      toastError(e);
    }
  };
  if (!value)
    return (
      <div className="row">
        <button type="button" className="btn" onClick={pick}>
          <Upload size={15} /> Chọn file .dwg / .txt
        </button>
        <span className="field-hint">Chỉ lưu đường dẫn, không copy hay upload file.</span>
      </div>
    );
  return <FileStatusRow file={value} saved={false} onReplace={pick} onRemove={() => onChange(null)} />;
}
