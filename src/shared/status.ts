import { diffDays } from './dates';
import type { ActiveStatus, DeadlineStatus } from './types';

export interface Thresholds {
  urgent: number;
  attention: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { urgent: 2, attention: 5 };

export const STATUS_ORDER: DeadlineStatus[] = ['URGENT', 'ATTENTION', 'NEW', 'COMPLETED'];
export const ACTIVE_STATUSES: ActiveStatus[] = ['URGENT', 'ATTENTION', 'NEW'];

export const STATUS_LABEL: Record<DeadlineStatus, string> = {
  URGENT: 'Khẩn cấp',
  ATTENTION: 'Cần chú ý',
  NEW: 'Mới tiếp nhận',
  COMPLETED: 'Đã hoàn thành',
};

export function remainingDays(dueDate: string, today: string): number {
  return diffDays(dueDate, today);
}

/** Công thức Phụ lục A của SRS. */
export function computeStatus(
  p: { isCompleted: boolean; dueDate: string },
  today: string,
  th: Thresholds,
): DeadlineStatus {
  if (p.isCompleted) return 'COMPLETED';
  const r = remainingDays(p.dueDate, today);
  if (r < th.urgent) return 'URGENT';
  if (r <= th.attention) return 'ATTENTION';
  return 'NEW';
}

export function describeRemaining(days: number): string {
  if (days < 0) return `Quá hạn ${-days} ngày`;
  if (days === 0) return 'Đến hạn hôm nay';
  return `Còn ${days} ngày`;
}

export function validateThresholds(urgent: number, attention: number): string | null {
  if (!Number.isInteger(urgent) || !Number.isInteger(attention)) return 'Ngưỡng phải là số nguyên.';
  if (urgent < 0 || attention < 0) return 'Ngưỡng không được âm.';
  if (urgent >= attention) return 'Ngưỡng Khẩn cấp phải nhỏ hơn ngưỡng Cần chú ý.';
  if (attention > 365) return 'Ngưỡng Cần chú ý tối đa 365 ngày.';
  return null;
}

/** Mô tả quy tắc bằng lời cho màn preview trong Settings. */
export function describeRules(th: Thresholds): Record<ActiveStatus, string> {
  const urgentText =
    th.urgent === 0 ? 'Đã quá hạn' : th.urgent === 1 ? 'Còn 0 ngày (hôm nay) hoặc quá hạn' : `Còn dưới ${th.urgent} ngày (gồm hôm nay và quá hạn)`;
  return {
    URGENT: urgentText,
    ATTENTION: th.urgent === th.attention ? `Còn đúng ${th.urgent} ngày` : `Còn từ ${th.urgent} đến ${th.attention} ngày`,
    NEW: `Còn trên ${th.attention} ngày`,
  };
}
