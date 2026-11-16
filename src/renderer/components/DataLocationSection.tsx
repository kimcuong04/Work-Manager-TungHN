import { useCallback, useEffect, useState } from 'react';
import { FolderInput, FolderOpen, HardDrive, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { DataLocationInfo } from '../../shared/types';
import { api } from '../api';
import { useUi } from '../state/ui';
import { formatBytes } from './common';

/** Settings › Dữ liệu & Backup: đổi nơi lưu dữ liệu sang ổ khác (chép → kiểm tra → khởi động lại), dọn bản cũ. */
export function DataLocationSection() {
  const { confirm, toast, toastError } = useUi();
  const [info, setInfo] = useState<DataLocationInfo | null>(null);
  const [busy, setBusy] = useState<null | 'copy' | 'restart'>(null);
  const [newDir, setNewDir] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getDataLocation().then(setInfo).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);

  const move = async (to: 'pick' | 'default') => {
    const ok = await confirm({
      title: to === 'pick' ? 'Đổi thư mục dữ liệu' : 'Về thư mục mặc định',
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            {to === 'pick' ? (
              <>Chọn thư mục mới (ví dụ trên ổ D:). Toàn bộ database, ảnh, backup và log sẽ được <b>chép</b> sang đó và kiểm tra lại, sau đó ứng dụng tự khởi động lại và dùng thư mục mới.</>
            ) : (
              <>
                Dữ liệu sẽ được chép về thư mục mặc định <b className="path-text">{info?.defaultDir}</b>, kiểm tra lại, rồi ứng dụng tự khởi động lại.
              </>
            )}
          </div>
          <div className="muted small">Bản dữ liệu ở vị trí hiện tại được giữ nguyên cho tới khi bạn tự dọn. Nên đóng các thư mục/ảnh của ứng dụng đang mở trước khi chuyển.</div>
        </div>
      ),
      confirmText: to === 'pick' ? 'Chọn thư mục…' : 'Chuyển về mặc định',
    });
    if (!ok) return;
    setBusy('copy');
    try {
      const res = await api.changeDataDir(to);
      if (!res) {
        setBusy(null);
        return;
      }
      setNewDir(res.dataDir);
      setBusy('restart');
    } catch (e) {
      setBusy(null);
      toastError(e);
    }
  };

  const trashOld = async () => {
    if (!info?.previousDir) return;
    const ok = await confirm({
      title: 'Dọn dữ liệu ở vị trí cũ',
      message: (
        <>
          Chuyển bản dữ liệu cũ ở <b className="path-text">{info.previousDir}</b> vào Thùng rác? Chỉ làm khi bạn đã kiểm tra dữ liệu ở vị trí mới đầy đủ. Vẫn khôi phục được từ Thùng rác.
        </>
      ),
      confirmText: 'Chuyển vào Thùng rác',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.trashPreviousData();
      toast('success', 'Đã chuyển dữ liệu ở vị trí cũ vào Thùng rác.');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <section className="card card-pad">
      <h2 className="card-title">
        <HardDrive size={17} /> Thư mục dữ liệu
      </h2>
      {info && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="info-grid" style={{ gridTemplateColumns: '150px minmax(0, 1fr)' }}>
            <span className="k">Đang lưu tại</span>
            <span className="row wrap" style={{ gap: 8 }}>
              <span className="path-text">{info.dataDir}</span>
              <span className={`badge ${info.isDefault ? '' : 'accent'}`}>{info.isDefault ? 'Mặc định' : 'Tùy chỉnh'}</span>
              <button className="btn sm" onClick={() => api.openDataFolder().catch(toastError)}>
                <FolderOpen size={13} /> Mở
              </button>
            </span>
            <span className="k">Dung lượng</span>
            <span>{formatBytes(info.sizeBytes)}</span>
          </div>
          <div className="muted small">
            Chuyển dữ liệu (database, ảnh, backup) sang ổ khác để không chiếm ổ C. Ứng dụng chép sang thư mục mới, kiểm tra đủ dữ liệu rồi mới dùng thư mục đó. Nếu lần sau mở app không
            thấy thư mục (ví dụ ổ ngoài chưa cắm), ứng dụng sẽ hỏi bạn thay vì tạo dữ liệu trống.
          </div>
          <div className="row wrap">
            <button className="btn primary" disabled={!!busy} onClick={() => void move('pick')}>
              <FolderInput size={15} /> Đổi thư mục dữ liệu…
            </button>
            {!info.isDefault && (
              <button className="btn" disabled={!!busy} onClick={() => void move('default')}>
                <RotateCcw size={15} /> Về thư mục mặc định
              </button>
            )}
          </div>
          {info.previousDir && (
            <div className="alert info">
              <HardDrive size={16} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div>
                  Dữ liệu ở vị trí cũ vẫn còn: <span className="path-text">{info.previousDir}</span>
                </div>
                <div className="small muted">Sau khi kiểm tra dữ liệu ở vị trí mới đầy đủ, có thể dọn bản cũ để giải phóng dung lượng.</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn sm" onClick={() => api.openPreviousDataFolder().catch(toastError)}>
                    <FolderOpen size={13} /> Mở
                  </button>
                  <button className="btn sm danger" onClick={() => void trashOld()}>
                    <Trash2 size={13} /> Chuyển vào Thùng rác
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="alertdialog" aria-live="assertive">
          <div className="busy-card">
            <Loader2 size={26} className="spin" />
            {busy === 'copy' ? (
              <>
                <b>Đang chép dữ liệu…</b>
                <span className="small muted">Không tắt ứng dụng trong lúc này.</span>
              </>
            ) : (
              <>
                <b>Đã chuyển dữ liệu</b>
                <span className="small muted path-text">{newDir}</span>
                <span className="small muted">Ứng dụng đang khởi động lại…</span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
