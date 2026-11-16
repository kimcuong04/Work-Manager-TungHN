import { useCallback, useEffect, useState } from 'react';

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`ppm:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`ppm:${key}`, JSON.stringify(value));
  } catch {
    /* localStorage không khả dụng: chỉ mất tùy chọn giao diện */
  }
}

/** Tùy chọn giao diện lưu lâu dài (sidebar mở/đóng, kiểu sắp xếp, cột ẩn...). */
export function useLocalState<T>(key: string, initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readLocal(key, typeof initial === 'function' ? (initial as () => T)() : initial));
  useEffect(() => writeLocal(key, value), [key, value]);
  return [value, setValue];
}

const sessionStore = new Map<string, unknown>();

/**
 * Trạng thái giữ trong phiên làm việc (FR-SEARCH-008): mở chi tiết rồi quay lại vẫn giữ từ khóa và bộ lọc.
 * Component dùng hook này nên được mount với `key` theo phạm vi để đổi phạm vi thì đọc lại state.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (sessionStore.has(key) ? (sessionStore.get(key) as T) : initial));
  const set = useCallback(
    (v: T | ((p: T) => T)) =>
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        sessionStore.set(key, next);
        return next;
      }),
    [key],
  );
  return [value, set];
}

export function setSessionValue(key: string, value: unknown): void {
  sessionStore.set(key, value);
}
