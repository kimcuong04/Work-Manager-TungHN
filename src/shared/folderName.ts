/** Tên thư mục dự án theo quy cách "STT.Tên dự án_Tên SI_Hãng" (bỏ phần trống, nhiều Hãng nối bằng "-"). */
export function projectFolderName(p: { stt: number | null | undefined; projectName: string; siName?: string | null; brandNames?: string[] }): string {
  const clean = (s: string) =>
    s
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const head = `${p.stt ?? ''}.${clean(p.projectName)}`;
  const parts = [head];
  const si = clean(p.siName ?? '');
  if (si) parts.push(si);
  const brands = (p.brandNames ?? []).map(clean).filter(Boolean).join('-');
  if (brands) parts.push(brands);
  let name = parts.join('_');
  if (name.length > 180) name = name.slice(0, 180);
  return name.replace(/[. ]+$/, '');
}
