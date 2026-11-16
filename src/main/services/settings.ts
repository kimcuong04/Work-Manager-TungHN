import { validateThresholds } from '../../shared/status';
import type { AppSettings, SettingsPatch } from '../../shared/types';
import { AppError, now, type Ctx } from '../context';

const KEY_MAP: Record<keyof SettingsPatch, string> = {
  theme: 'theme',
  urgentThresholdDays: 'urgent_threshold_days',
  attentionThresholdDays: 'attention_threshold_days',
  imageQuotaMb: 'image_quota_mb',
  xlsxMaxMb: 'xlsx_max_mb',
  xlsxMaxRows: 'xlsx_max_rows',
  autoUpdate: 'auto_update',
  projectRootDir: 'project_root_dir',
};

export function getSettings({ db }: Ctx): AppSettings {
  const rows = db.all<{ key: string; value: string; updated_at: string }>('SELECT * FROM app_settings');
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(m.get(k));
    return Number.isFinite(v) ? v : d;
  };
  return {
    theme: m.get('theme') === 'dark' ? 'dark' : 'light',
    urgentThresholdDays: num('urgent_threshold_days', 2),
    attentionThresholdDays: num('attention_threshold_days', 5),
    imageQuotaMb: num('image_quota_mb', 2048),
    xlsxMaxMb: num('xlsx_max_mb', 20),
    xlsxMaxRows: num('xlsx_max_rows', 20000),
    autoUpdate: m.get('auto_update') !== 'false',
    projectRootDir: m.get('project_root_dir') || null,
    updatedAt: rows.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), ''),
  };
}

export function updateSettings(ctx: Ctx, patch: SettingsPatch): AppSettings {
  const next = { ...getSettings(ctx), ...patch };
  if (next.theme !== 'light' && next.theme !== 'dark') throw new AppError('Theme không hợp lệ.');
  if (typeof next.autoUpdate !== 'boolean') throw new AppError('Giá trị tự cập nhật không hợp lệ.');
  const thErr = validateThresholds(next.urgentThresholdDays, next.attentionThresholdDays);
  if (thErr) throw new AppError(thErr);
  const positiveInt = (v: number, label: string, max: number) => {
    if (!Number.isInteger(v) || v < 1 || v > max) throw new AppError(`${label} phải là số nguyên từ 1 đến ${max}.`);
  };
  positiveInt(next.imageQuotaMb, 'Ngưỡng dung lượng ảnh (MB)', 1_000_000);
  positiveInt(next.xlsxMaxMb, 'Giới hạn kích thước XLSX (MB)', 500);
  positiveInt(next.xlsxMaxRows, 'Giới hạn số dòng mỗi sheet', 1_000_000);
  const stamp = now();
  ctx.db.tx(() => {
    for (const [k, v] of Object.entries(patch) as [keyof SettingsPatch, unknown][]) {
      const key = KEY_MAP[k];
      if (!key) continue;
      ctx.db.run(
        'INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
        [key, String(v), stamp],
      );
    }
  });
  return getSettings(ctx);
}
