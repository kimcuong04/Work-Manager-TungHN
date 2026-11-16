const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Release notes từ GitHub là HTML: chuyển thành text thuần để hiển thị an toàn (không render HTML). */
export function releaseNotesToText(notes: unknown): string {
  const raw = Array.isArray(notes)
    ? notes.map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note ?? '') : '')).join('\n')
    : typeof notes === 'string'
      ? notes
      : '';
  return raw
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|li|h[1-6]|div|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}(?=• )/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
