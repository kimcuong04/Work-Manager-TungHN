import { useEffect, useState } from 'react';
import { ArrowUpCircle, Download, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../shared/dates';
import type { UpdateStatus } from '../../shared/types';
import { api, onAppEvent } from '../api';
import { readLocal, writeLocal } from '../lib/persist';
import { useUi } from '../state/ui';
import { Modal } from './Modal';

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api.getUpdateStatus().then((s) => alive && setStatus(s)).catch(() => {});
    const off = onAppEvent((e) => {
      if (e.type === 'update') setStatus(e.status);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return status;
}

export function UpdateDialog({ status, onClose }: { status: UpdateStatus; onClose: () => void }) {
  const { toastError } = useUi();
  const [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    try {
      await api.installUpdate();
    } catch (e) {
      setBusy(false);
      toastError(e);
    }
  };
  return (
    <Modal
      title={`Có phiên bản mới ${status.version ?? ''}`}
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="left small faint">Để sau: bản mới sẽ tự cài khi bạn đóng ứng dụng.</span>
          <button className="btn" onClick={close} disabled={busy}>
            Để sau
          </button>
          <button className="btn primary" onClick={install} disabled={busy} autoFocus>
            <ArrowUpCircle size={16} /> {busy ? 'Đang khởi động lại…' : 'Cập nhật & khởi động lại'}
          </button>
        </>
      )}
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="small muted">
          Bạn đang dùng bản {status.currentVersion}
          {status.releaseDate ? ` · bản mới phát hành ${formatDateTime(status.releaseDate)}` : ''}
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>
            Có gì mới
          </div>
          <div className="card card-pad pre" style={{ boxShadow: 'none', maxHeight: 320, overflow: 'auto' }}>
            {status.releaseNotes?.trim() || 'Cải thiện và sửa lỗi.'}
          </div>
        </div>
        <div className="alert info">
          <ShieldCheck size={16} />
          <div>Dữ liệu của bạn được giữ nguyên. Ứng dụng tự sao lưu database trước khi nâng cấp.</div>
        </div>
      </div>
    </Modal>
  );
}

/** Nút trên topbar + tự mở hộp thoại một lần cho mỗi phiên bản đã tải xong. */
export function UpdateNotice() {
  const status = useUpdateStatus();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status?.state !== 'downloaded' || !status.version) return;
    if (readLocal<string | null>('update-prompted', null) === status.version) return;
    writeLocal('update-prompted', status.version);
    setOpen(true);
  }, [status?.state, status?.version]);

  if (!status) return null;
  if (status.state === 'downloading')
    return (
      <span className="badge accent" title={`Đang tải bản ${status.version}`}>
        <Download size={13} /> Đang tải bản {status.version}… {status.percent ?? 0}%
      </span>
    );
  if (status.state !== 'downloaded') return null;
  return (
    <>
      <button className="btn sm primary" onClick={() => setOpen(true)} title="Có bản cập nhật mới">
        <ArrowUpCircle size={15} /> Cập nhật {status.version}
      </button>
      {open && <UpdateDialog status={status} onClose={() => setOpen(false)} />}
    </>
  );
}
