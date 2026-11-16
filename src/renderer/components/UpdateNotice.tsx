import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Bell, BellOff, Download, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../shared/dates';
import type { UpdateStatus } from '../../shared/types';
import { api, onAppEvent } from '../api';
import { useUi } from '../state/ui';
import { useClickOutside } from './common';
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

/**
 * Chuông thông báo ở góc phải topbar: có bản mới đã tải xong thì hiện chấm đỏ; bấm vào mới xem và cập nhật
 * (không tự bật hộp thoại khi mở app).
 */
export function UpdateNotice() {
  const status = useUpdateStatus();
  const { toastError } = useUi();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ready = status?.state === 'downloaded';
  const downloading = status?.state === 'downloading';
  const install = async () => {
    setBusy(true);
    try {
      await api.installUpdate();
    } catch (e) {
      setBusy(false);
      toastError(e);
    }
  };
  const notes = (status?.releaseNotes ?? '').trim();

  return (
    <div className="pop-anchor notif" ref={ref}>
      <button
        className="btn ghost icon notif-btn"
        aria-label={ready ? `Thông báo: có bản cập nhật ${status?.version ?? ''}` : 'Thông báo'}
        title={ready ? `Có bản cập nhật ${status?.version ?? ''}` : 'Thông báo'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={18} />
        {ready && <span className="notif-dot" aria-hidden />}
      </button>
      {open && (
        <div className="popover right notif-pop" role="dialog" aria-label="Thông báo">
          <div className="notif-head">Thông báo</div>
          {ready ? (
            <div className="notif-item">
              <div className="row" style={{ gap: 8 }}>
                <ArrowUpCircle size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>Có phiên bản mới {status?.version}</div>
                  <div className="small muted">
                    Bạn đang dùng bản {status?.currentVersion}
                    {status?.releaseDate ? ` · phát hành ${formatDateTime(status.releaseDate)}` : ''}
                  </div>
                </div>
              </div>
              {notes && <div className="pre small notif-notes">{notes}</div>}
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <button
                  className="btn sm"
                  onClick={() => {
                    setOpen(false);
                    setDialog(true);
                  }}
                >
                  Xem chi tiết
                </button>
                <button className="btn sm primary" disabled={busy} onClick={() => void install()}>
                  <ArrowUpCircle size={14} /> {busy ? 'Đang khởi động lại…' : 'Cập nhật & khởi động lại'}
                </button>
              </div>
              <div className="small faint">Chưa cập nhật ngay thì bản mới sẽ tự cài khi bạn đóng ứng dụng.</div>
            </div>
          ) : downloading ? (
            <div className="notif-item">
              <div className="row small" style={{ gap: 6 }}>
                <Download size={15} /> Đang tải bản {status?.version}… {status?.percent ?? 0}%
              </div>
              <div className="notif-progress">
                <span style={{ width: `${status?.percent ?? 0}%` }} />
              </div>
            </div>
          ) : (
            <div className="notif-empty">
              <BellOff size={22} />
              <div>Không có thông báo mới</div>
              {status?.currentVersion && <div className="small faint">Bạn đang dùng bản {status.currentVersion}</div>}
            </div>
          )}
        </div>
      )}
      {dialog && status && <UpdateDialog status={status} onClose={() => setDialog(false)} />}
    </div>
  );
}
