import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Một tool chạy ngay trong app, hiện ở Tools › Tool app. */
export interface AppTool {
  /** Dùng trong đường dẫn #/tools/app/<id>, không đổi sau khi phát hành. */
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  component: ComponentType;
}

/**
 * Danh sách Tool app. Thêm tool mới: tạo component trong `src/renderer/tools/` rồi thêm một mục vào mảng này
 * (xem hướng dẫn trong README, mục "Thêm Tool app").
 */
export const APP_TOOLS: AppTool[] = [];
