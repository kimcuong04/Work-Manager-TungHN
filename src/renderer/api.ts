import type { Api, ApiResult } from '../shared/api';
import type { AppEvent } from '../shared/types';

declare global {
  interface Window {
    ppm?: {
      call(method: string, args: unknown[]): Promise<ApiResult>;
      onEvent(cb: (e: AppEvent) => void): () => void;
      pathForFile?(file: File): string | null;
    };
  }
}

export function onAppEvent(cb: (e: AppEvent) => void): () => void {
  return window.ppm?.onEvent(cb) ?? (() => {});
}

/** Proxy gọi IPC: api.listProjects() -> main process; lỗi nghiệp vụ được ném lại dưới dạng Error tiếng Việt. */
export const api = new Proxy({} as Api, {
  get(_target, method: string) {
    return async (...args: unknown[]) => {
      if (!window.ppm) throw new Error('Ứng dụng cần chạy trong cửa sổ desktop (Electron).');
      const res = await window.ppm.call(method, args);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    };
  },
});

/** Đường dẫn các file được kéo thả từ máy vào cửa sổ app. */
export function droppedPaths(dt: DataTransfer): string[] {
  return [...dt.files].map((f) => window.ppm?.pathForFile?.(f) ?? null).filter((p): p is string => !!p);
}

export function imgUrl(storageKey: string, thumb = false): string {
  return `ppm-img://${thumb ? 'thumb' : 'full'}/${encodeURIComponent(storageKey)}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
