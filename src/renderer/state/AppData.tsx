import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { todayISO } from '../../shared/dates';
import type { Thresholds } from '../../shared/status';
import { MASTER_KINDS, type AppSettings, type FreelanceJob, type JobYear, type MasterItem, type MasterKind, type Project, type SettingsPatch } from '../../shared/types';
import { api, errorMessage } from '../api';
import { buildViews, type ProjectView } from '../lib/projects';

type Part = 'settings' | 'masters' | 'years' | 'projects' | 'freelance';
const ALL_PARTS: Part[] = ['settings', 'masters', 'years', 'projects', 'freelance'];

interface AppDataValue {
  ready: boolean;
  loadError: string | null;
  settings: AppSettings;
  thresholds: Thresholds;
  today: string;
  masters: Record<MasterKind, MasterItem[]>;
  years: JobYear[];
  yearById: Map<string, JobYear>;
  projects: ProjectView[];
  projectById: Map<string, ProjectView>;
  freelance: FreelanceJob[];
  refresh: (...parts: Part[]) => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  urgentThresholdDays: 2,
  attentionThresholdDays: 5,
  imageQuotaMb: 2048,
  xlsxMaxMb: 20,
  xlsxMaxRows: 20000,
  autoUpdate: true,
  projectRootDir: null,
  workspaceName: 'My Workspace',
  updatedAt: '',
};

const Ctx = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppDataProvider missing');
  return v;
}

/** Ngày hệ thống thay đổi (qua nửa đêm, máy thức dậy) thì tính lại trạng thái. */
function useToday(): string {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const check = () => setToday((t) => (t === todayISO() ? t : todayISO()));
    const timer = setInterval(check, 30_000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [masters, setMasters] = useState<Record<MasterKind, MasterItem[]>>(() => Object.fromEntries(MASTER_KINDS.map((k) => [k, []])) as unknown as Record<MasterKind, MasterItem[]>);
  const [years, setYears] = useState<JobYear[]>([]);
  const [rawProjects, setRawProjects] = useState<Project[]>([]);
  const [freelance, setFreelance] = useState<FreelanceJob[]>([]);
  const today = useToday();

  const refresh = useCallback(async (...parts: Part[]) => {
    const want = new Set(parts.length ? parts : ALL_PARTS);
    const jobs: Promise<void>[] = [];
    if (want.has('settings')) jobs.push(api.getSettings().then(setSettings));
    if (want.has('masters'))
      jobs.push(
        Promise.all(MASTER_KINDS.map((k) => api.listMaster(k))).then((lists) =>
          setMasters(Object.fromEntries(MASTER_KINDS.map((k, i) => [k, lists[i]])) as Record<MasterKind, MasterItem[]>),
        ),
      );
    if (want.has('years')) jobs.push(api.listYears().then(setYears));
    if (want.has('projects')) jobs.push(api.listProjects().then(setRawProjects));
    if (want.has('freelance')) jobs.push(api.listFreelance().then(setFreelance));
    await Promise.all(jobs);
  }, []);

  useEffect(() => {
    refresh()
      .then(() => setReady(true))
      .catch((e) => setLoadError(errorMessage(e)));
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    const next = await api.updateSettings(patch);
    setSettings(next);
    return next;
  }, []);

  const thresholds = useMemo(
    () => ({ urgent: settings.urgentThresholdDays, attention: settings.attentionThresholdDays }),
    [settings.urgentThresholdDays, settings.attentionThresholdDays],
  );
  const projects = useMemo(() => buildViews(rawProjects, today, thresholds), [rawProjects, today, thresholds]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const yearById = useMemo(() => new Map(years.map((y) => [y.id, y])), [years]);

  const value = useMemo<AppDataValue>(
    () => ({ ready, loadError, settings, thresholds, today, masters, years, yearById, projects, projectById, freelance, refresh, updateSettings }),
    [ready, loadError, settings, thresholds, today, masters, years, yearById, projects, projectById, freelance, refresh, updateSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
