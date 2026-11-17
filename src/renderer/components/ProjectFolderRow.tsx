import { useState } from 'react';
import { AlertTriangle, FolderInput, FolderOpen, FolderPlus, FolderSync, Unlink } from 'lucide-react';
import { projectFolderName } from '../../shared/folderName';
import type { Project } from '../../shared/types';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { shortenPath } from './common';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Thư mục dự án trên máy (không bắt buộc): link mở thư mục, cảnh báo khi tên lệch (lần đổi tên trước bị chặn),
 * tạo thư mục mới hoặc liên kết thư mục có sẵn cho dự án chưa có, bỏ liên kết thư mục có sẵn.
 */
export function ProjectFolderRow({ p }: { p: Project }) {
  const { refresh } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [busy, setBusy] = useState(false);
  const expected = projectFolderName({ stt: p.stt, projectName: p.projectName, siName: p.siName, brandNames: p.brands.map((b) => b.name) });
  const mismatch = !!p.folderPath && p.folderAuto && baseName(p.folderPath) !== expected;

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

  const link = async () => {
    setBusy(true);
    try {
      const dir = await api.pickFolder('Chọn thư mục có sẵn của dự án');
      if (!dir) return;
      await api.setProjectFolderLink(p.id, dir);
      await refresh('projects');
      toast('success', 'Đã liên kết thư mục có sẵn (ứng dụng không tự đổi tên thư mục này).');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    const ok = await confirm({
      title: 'Bỏ liên kết thư mục',
      message: 'Bỏ liên kết thư mục khỏi dự án? Thư mục trên máy được giữ nguyên, không bị xóa.',
      confirmText: 'Bỏ liên kết',
    });
    if (!ok) return;
    try {
      await api.setProjectFolderLink(p.id, null);
      await refresh('projects');
      toast('success', 'Đã bỏ liên kết thư mục.');
    } catch (e) {
      toastError(e);
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
            Tạo mới: {expected} — hoặc liên kết thư mục có sẵn
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm" disabled={busy} onClick={() => void link()}>
            <FolderInput size={14} /> Liên kết thư mục có sẵn…
          </button>
          <button className="btn sm" disabled={busy} onClick={() => void sync(true)}>
            <FolderPlus size={14} /> Tạo thư mục…
          </button>
        </div>
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
          {!p.folderAuto && 'Thư mục có sẵn · '}
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
        {!p.folderAuto && (
          <button className="btn sm ghost" onClick={() => void unlink()} title="Bỏ liên kết (thư mục trên máy giữ nguyên)">
            <Unlink size={14} /> Bỏ liên kết
          </button>
        )}
        <button className="btn sm" onClick={() => void api.openProjectFolder(p.id).catch(toastError)}>
          <FolderOpen size={14} /> Mở
        </button>
      </div>
    </div>
  );
}
