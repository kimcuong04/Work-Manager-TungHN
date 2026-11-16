import { useState } from 'react';
import { AlertTriangle, FolderOpen, FolderPlus, FolderSync } from 'lucide-react';
import { projectFolderName } from '../../shared/folderName';
import type { Project } from '../../shared/types';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { shortenPath } from './common';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Thư mục dự án trên máy: link mở thư mục, cảnh báo khi tên lệch (lần đổi tên trước bị chặn), tạo thư mục cho dự án cũ. */
export function ProjectFolderRow({ p }: { p: Project }) {
  const { refresh } = useAppData();
  const { toast, toastError } = useUi();
  const [busy, setBusy] = useState(false);
  const expected = projectFolderName({ stt: p.stt, projectName: p.projectName, siName: p.siName, brandNames: p.brands.map((b) => b.name) });
  const mismatch = !!p.folderPath && baseName(p.folderPath) !== expected;

  const sync = async (pickParent: boolean) => {
    setBusy(true);
    try {
      let parent: string | null = null;
      if (pickParent) {
        parent = await api.pickFolder('Chọn nơi lưu thư mục dự án');
        if (!parent) return;
      }
      const saved = await api.syncProjectFolder(p.id, parent);
      await refresh('projects', 'settings');
      toast('success', p.folderPath && !pickParent ? 'Đã đồng bộ tên thư mục.' : 'Đã tạo thư mục dự án.');
      if (saved.notice) toast('warn', saved.notice);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!p.folderPath)
    return (
      <div className="file-row">
        <div className="file-ext">
          <FolderPlus size={18} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Chưa có thư mục dự án</div>
          <div className="small faint ellipsis" title={expected}>
            Sẽ tạo: {expected}
          </div>
        </div>
        <button className="btn sm" disabled={busy} onClick={() => void sync(true)}>
          <FolderPlus size={14} /> Tạo thư mục…
        </button>
      </div>
    );

  return (
    <div className={`file-row ${mismatch ? 'warn' : ''}`}>
      <div className="file-ext">
        <FolderOpen size={18} />
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <button className="link-btn strong ellipsis" title={`Mở ${p.folderPath}`} onClick={() => void api.openProjectFolder(p.id).catch(toastError)}>
          {baseName(p.folderPath)}
        </button>
        <div className="small faint ellipsis" title={p.folderPath}>
          {shortenPath(p.folderPath, 60)}
        </div>
        {mismatch && (
          <div className="small field-warn row" style={{ gap: 4 }}>
            <AlertTriangle size={12} /> Tên thư mục chưa khớp: {expected}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        {mismatch && (
          <button className="btn sm" disabled={busy} onClick={() => void sync(false)} title="Đổi tên thư mục cho khớp STT/Tên/SI/Hãng">
            <FolderSync size={14} /> Đồng bộ
          </button>
        )}
        <button className="btn sm" onClick={() => void api.openProjectFolder(p.id).catch(toastError)}>
          <FolderOpen size={14} /> Mở
        </button>
      </div>
    </div>
  );
}
