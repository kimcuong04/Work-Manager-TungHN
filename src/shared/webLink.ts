const DOMAIN_LINK = /^(www\.)?[\p{L}\d-]+(\.[\p{L}\d-]+)+(:\d+)?([/?#].*)?$/u;

/** Có phải link (http/https đầy đủ hoặc dạng tên miền như example.com/tool) chứ không phải từ khóa. */
export function isWebLink(text: string): boolean {
  const s = (text ?? '').trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) {
    try {
      return !!new URL(s).hostname;
    } catch {
      return false;
    }
  }
  return DOMAIN_LINK.test(s);
}

/**
 * "Link website" nhập tự do: link đầy đủ thì mở thẳng, dạng tên miền (vd: axis.com/support) thì thêm https://,
 * còn lại (từ khóa, scheme lạ như javascript:/file:) thì tìm kiếm trên trình duyệt. Chỉ trả về URL http/https.
 */
export function resolveWebLink(text: string): string | null {
  const s = (text ?? '').trim();
  if (!s) return null;
  const search = () => `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  if (/^https?:\/\//i.test(s)) {
    try {
      return new URL(s).toString();
    } catch {
      return search();
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[\w-]+(\.[\w-]+)+:\d+/i.test(s)) return search();
  if (!/\s/.test(s) && /^(www\.)?[\p{L}\d-]+(\.[\p{L}\d-]+)+(:\d+)?([/?#].*)?$/u.test(s)) {
    try {
      return new URL(`https://${s}`).toString();
    } catch {
      return search();
    }
  }
  return search();
}
