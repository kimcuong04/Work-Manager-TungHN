import { File as FileIcon, FolderOpen, Globe, Search, X } from 'lucide-react';
import { resolveWebLink } from '../../shared/webLink';
import { api } from '../api';
import { useUi } from '../state/ui';
import { shortenPath } from './common';

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
const looksLikeFile = (p: string) => /\.[a-z0-9]{1,8}$/i.test(baseName(p));

/** "Hyperlink": chọn một file hoặc thư mục trên máy để mở nhanh. */
export function LocalLinkField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { toastError } = useUi();
  const pick = async (kind: 'file' | 'folder') => {
    try {
      const p = await api.pickLocalLink(kind);
      if (p) onChange(p);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="local-link">
      {value ? (
        <span className="local-link-value" title={value}>
          {looksLikeFile(value) ? <FileIcon size={14} /> : <FolderOpen size={14} />}
          <span className="ellipsis">{shortenPath(value, 52)}</span>
          <button type="button" aria-label="Bỏ liên kết" title="Bỏ liên kết" onClick={() => onChange('')}>
            <X size={13} />
          </button>
        </span>
      ) : (
        <span className="faint small">Chưa chọn</span>
      )}
      <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
        <button type="button" className="btn sm" onClick={() => void pick('file')}>
          <FileIcon size={13} /> Chọn file
        </button>
        <button type="button" className="btn sm" onClick={() => void pick('folder')}>
          <FolderOpen size={13} /> Chọn thư mục
        </button>
      </span>
    </div>
  );
}

export function LocalLinkButton({ path }: { path: string }) {
  const { toastError } = useUi();
  if (!path) return <span className="faint">—</span>;
  return (
    <button className="btn sm link-chip" title={`Mở ${path}`} onClick={() => void api.openLocalLink(path).catch(toastError)}>
      {looksLikeFile(path) ? <FileIcon size={13} /> : <FolderOpen size={13} />}
      <span className="ellipsis">{baseName(path)}</span>
    </button>
  );
}

/** Link website nhập tự do: là link thì mở, không phải link thì tìm trên trình duyệt mặc định. */
export function WebLinkButton({ text }: { text: string }) {
  const { toastError } = useUi();
  if (!text) return <span className="faint">—</span>;
  const target = resolveWebLink(text) ?? '';
  const isSearch = target.startsWith('https://www.google.com/search?');
  return (
    <button className="btn sm link-chip" title={isSearch ? `Tìm trên trình duyệt: ${text}` : `Mở ${target}`} onClick={() => void api.openExternalUrl(text).catch(toastError)}>
      {isSearch ? <Search size={13} /> : <Globe size={13} />}
      <span className="ellipsis">{text}</span>
    </button>
  );
}

export const WEB_LINK_HINT = 'Nhập tự do: link (vd axis.com/support) hoặc từ khóa. Bấm vào sẽ mở link, hoặc tìm kiếm trên trình duyệt mặc định.';
