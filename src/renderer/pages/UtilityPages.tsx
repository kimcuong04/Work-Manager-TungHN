import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppWindow, ArrowLeft, Copy, Eye, EyeOff, Globe, KeyRound, Pencil, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { buildHaystack, matchesQuery, normalizeText } from '../../shared/text';
import type { OnlineTool, OnlineToolInput, PasswordEntry, PasswordInput } from '../../shared/types';
import { hasErrors, validateOnlineToolInput, validatePasswordInput } from '../../shared/validation';
import { api } from '../api';
import { Breadcrumbs, EmptyState, Field, SearchInput } from '../components/common';
import { WebLinkButton } from '../components/LinkFields';
import { LinkedText, LinkNoteField } from '../components/LinkNote';
import { Modal } from '../components/Modal';
import { useSessionState } from '../lib/persist';
import { usePageTitle, useUi } from '../state/ui';
import { APP_TOOLS } from '../tools/registry';
import { useTableResize } from '../lib/tableResize';

const dash = <span className="faint">—</span>;

/** Danh sách đánh STT theo thứ tự thêm vào, lọc theo tên (gõ không dấu cũng được). */
function useNumbered<T extends { id: string }>(items: T[] | null, q: string, name: (x: T) => string) {
  return useMemo(() => {
    const nq = normalizeText(q);
    return (items ?? []).map((x, i) => ({ x, stt: i + 1 })).filter(({ x }) => matchesQuery(nq, buildHaystack([name(x)])));
  }, [items, q, name]);
}

/* ---------------- Password ---------------- */

function PasswordForm({ entry, onClose, onSaved }: { entry?: PasswordEntry; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useUi();
  const isEdit = !!entry;
  const [form, setForm] = useState<PasswordInput>({ siteName: entry?.siteName ?? '', username: entry?.username ?? '', password: isEdit ? undefined : '', url: entry?.url ?? '', note: entry?.note ?? '' });
  const [showPwd, setShowPwd] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validatePasswordInput(form, !isEdit);
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof PasswordInput>(k: K, v: PasswordInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setSaving(true);
    try {
      if (isEdit) await api.updatePassword(entry!.id, form);
      else await api.createPassword(form);
      toast('success', isEdit ? `Đã cập nhật "${form.siteName.trim()}".` : `Đã thêm "${form.siteName.trim()}".`);
      onSaved();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="md"
      title={isEdit ? 'Sửa mục Password' : 'Thêm mục Password'}
      onClose={onClose}
      footer={() => (
        <>
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      )}
    >
      <form
        className="stack"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Tên website" required error={err('siteName')} htmlFor="pw-site">
          <input id="pw-site" autoFocus className="input" value={form.siteName} onChange={(e) => set('siteName', e.target.value)} />
        </Field>
        <Field label="Username" required error={err('username')} htmlFor="pw-user">
          <input id="pw-user" className="input" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="Password" required error={err('password')} hint="Được mã hóa theo tài khoản Windows khi lưu." htmlFor="pw-pass">
          {form.password === undefined ? (
            <div className="row">
              <span className="faint">•••••••• (giữ nguyên)</span>
              <button type="button" className="btn sm" onClick={() => set('password', '')}>
                Đổi mật khẩu
              </button>
            </div>
          ) : (
            <div className="combo-input">
              <input
                id="pw-pass"
                className="input"
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
              <div className="combo-icons">
                <button type="button" aria-label={showPwd ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShowPwd((s) => !s)}>
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          )}
        </Field>
        <Field label="Link website" error={err('url')} hint="Không bắt buộc. Vd: mail.google.com" htmlFor="pw-url">
          <input id="pw-url" className="input" value={form.url} onChange={(e) => set('url', e.target.value)} />
        </Field>
        <Field label="Ghi chú" error={err('note')} hint="Không bắt buộc, chèn được link. Ghi chú không được mã hóa — đừng ghi mật khẩu ở đây." htmlFor="pw-note">
          <LinkNoteField id="pw-note" value={form.note ?? ''} onChange={(v) => set('note', v)} rows={3} placeholder="Vd: đăng nhập bằng SSO công ty, hướng dẫn ở [Wiki nội bộ](https://wiki.example.com)" />
        </Field>
      </form>
    </Modal>
  );
}

/** Mật khẩu chỉ được giải mã khi bấm xem/sao chép, tự ẩn lại sau 20 giây. */
function SecretCell({ entry }: { entry: PasswordEntry }) {
  const { toast, toastError } = useUi();
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setValue(null), 20_000);
    return () => clearTimeout(t);
  }, [value]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value ?? (await api.revealPassword(entry.id)));
      toast('info', `Đã sao chép mật khẩu ${entry.siteName}.`);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <span className="row nowrap" style={{ gap: 4 }}>
      <code className="secret">{value ?? '••••••••'}</code>
      <button
        className="btn sm icon ghost"
        aria-label={value === null ? `Hiện mật khẩu ${entry.siteName}` : `Ẩn mật khẩu ${entry.siteName}`}
        title={value === null ? 'Hiện mật khẩu (tự ẩn sau 20 giây)' : 'Ẩn'}
        onClick={async () => {
          if (value !== null) return setValue(null);
          try {
            setValue(await api.revealPassword(entry.id));
          } catch (e) {
            toastError(e);
          }
        }}
      >
        {value === null ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button className="btn sm icon ghost" aria-label={`Sao chép mật khẩu ${entry.siteName}`} title="Sao chép mật khẩu" onClick={() => void copy()}>
        <Copy size={14} />
      </button>
    </span>
  );
}

export function PasswordPage() {
  const tableRef = useTableResize('passwords');
  usePageTitle('Password');
  const { confirm, toast, toastError } = useUi();
  const [items, setItems] = useState<PasswordEntry[] | null>(null);
  const [q, setQ] = useSessionState('filter:passwords', '');
  const [form, setForm] = useState<{ entry?: PasswordEntry } | null>(null);
  const load = () => {
    api.listPasswords().then(setItems).catch(toastError);
  };
  useEffect(load, [toastError]);
  const shown = useNumbered(items, q, (x) => x.siteName);

  const remove = async (p: PasswordEntry) => {
    if (!(await confirm({ title: 'Xóa mục Password', message: `Xóa thông tin đăng nhập "${p.siteName}" (${p.username})? Không hoàn tác được.`, confirmText: 'Xóa', danger: true })))
      return;
    try {
      await api.deletePassword(p.id);
      toast('success', 'Đã xóa.');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const add = (
    <button className="btn primary" onClick={() => setForm({})}>
      <Plus size={16} /> Thêm
    </button>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row">
            <KeyRound size={22} style={{ color: 'var(--accent)' }} /> Password
          </h1>
          <div className="muted small row" style={{ gap: 4 }}>
            <ShieldCheck size={13} /> Mật khẩu được mã hóa theo tài khoản Windows, chỉ hiện khi bấm xem và tự ẩn sau 20 giây.
          </div>
        </div>
        <div className="actions">{add}</div>
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm theo Tên website…" width={320} />
        <span className="small muted">
          {shown.length}/{items?.length ?? 0} mục
        </span>
      </div>
      {items === null ? (
        <div className="faint">Đang tải…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon={<KeyRound size={36} />} title="Chưa có thông tin đăng nhập nào" text="Lưu username/password của các website để tra cứu nhanh." action={add} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl" ref={tableRef}>
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Tên website</th>
                <th>Username</th>
                <th>Password</th>
                <th>Link website</th>
                <th>Ghi chú</th>
                <th style={{ width: 1 }} data-col="__actions" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="faint" style={{ textAlign: 'center' }}>
                    Không có mục khớp “{q}”.
                  </td>
                </tr>
              )}
              {shown.map(({ x: p, stt }) => (
                <tr key={p.id} data-row={p.id}>
                  <td className="num">{stt}</td>
                  <td style={{ fontWeight: 600 }}>{p.siteName}</td>
                  <td>
                    <span className="row nowrap" style={{ gap: 4 }}>
                      {p.username}
                      <button
                        className="btn sm icon ghost"
                        aria-label={`Sao chép username ${p.siteName}`}
                        title="Sao chép username"
                        onClick={() => navigator.clipboard.writeText(p.username).then(() => toast('info', 'Đã sao chép username.'), toastError)}
                      >
                        <Copy size={13} />
                      </button>
                    </span>
                  </td>
                  <td>
                    <SecretCell entry={p} />
                  </td>
                  <td style={{ maxWidth: 260 }}>{p.url ? <WebLinkButton text={p.url} /> : dash}</td>
                  <td className="note-cell">
                    <LinkedText text={p.note} />
                  </td>
                  <td>
                    <div className="row nowrap" style={{ gap: 2 }}>
                      <button className="btn sm icon ghost" aria-label={`Sửa ${p.siteName}`} title="Sửa" onClick={() => setForm({ entry: p })}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn sm icon ghost" aria-label={`Xóa ${p.siteName}`} title="Xóa" style={{ color: 'var(--danger)' }} onClick={() => void remove(p)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <PasswordForm entry={form.entry} onClose={() => setForm(null)} onSaved={load} />}
    </>
  );
}

/* ---------------- Tools ---------------- */

export function ToolAppPage() {
  usePageTitle('Tool app');
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Tools' }, { label: 'Tool app', to: '/tools/app' }]} />
          <h1 className="row">
            <AppWindow size={22} style={{ color: 'var(--accent)' }} /> Tool app
          </h1>
          <div className="muted small">Các tool nhỏ chạy ngay trong ứng dụng.</div>
        </div>
      </div>
      {APP_TOOLS.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Wrench size={36} />} title="Chưa có tool nào" text="Các tool nhỏ sẽ được bổ sung vào đây ở những bản cập nhật sau." />
        </div>
      ) : (
        <div className="tool-grid">
          {APP_TOOLS.map((t) => (
            <button key={t.id} className="card card-pad tool-card" onClick={() => navigate(`/tools/app/${t.id}`)}>
              <t.icon size={24} />
              <b>{t.name}</b>
              <span className="small muted">{t.description}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function ToolAppRunPage() {
  const { toolId } = useParams();
  const navigate = useNavigate();
  const tool = APP_TOOLS.find((t) => t.id === toolId);
  usePageTitle(tool?.name ?? 'Tool app');
  if (!tool)
    return (
      <EmptyState
        title="Không tìm thấy tool"
        action={
          <button className="btn" onClick={() => navigate('/tools/app')}>
            <ArrowLeft size={15} /> Về Tool app
          </button>
        }
      />
    );
  const Tool = tool.component;
  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Tools' }, { label: 'Tool app', to: '/tools/app' }, { label: tool.name }]} />
          <h1 className="row">
            <tool.icon size={22} style={{ color: 'var(--accent)' }} /> {tool.name}
          </h1>
        </div>
      </div>
      <Tool />
    </>
  );
}

function OnlineToolForm({ tool, onClose, onSaved }: { tool?: OnlineTool; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useUi();
  const [form, setForm] = useState<OnlineToolInput>({ name: tool?.name ?? '', purpose: tool?.purpose ?? '', url: tool?.url ?? '' });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateOnlineToolInput(form);
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof OnlineToolInput>(k: K, v: OnlineToolInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setSaving(true);
    try {
      if (tool) await api.updateOnlineTool(tool.id, form);
      else await api.createOnlineTool(form);
      toast('success', tool ? `Đã cập nhật "${form.name.trim()}".` : `Đã thêm "${form.name.trim()}".`);
      onSaved();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={tool ? 'Sửa Tool online' : 'Thêm Tool online'}
      onClose={onClose}
      footer={() => (
        <>
          <button className="btn" onClick={onClose}>
            Hủy
          </button>
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      )}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Tên tool" required error={err('name')} htmlFor="tool-name">
          <input id="tool-name" autoFocus className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Mục đích" error={err('purpose')} htmlFor="tool-purpose">
          <textarea id="tool-purpose" className="textarea" rows={3} value={form.purpose} onChange={(e) => set('purpose', e.target.value)} />
        </Field>
        <Field label="Link" required error={err('url')} hint="Vd: https://tinypng.com hoặc tinypng.com" htmlFor="tool-url">
          <input id="tool-url" className="input" value={form.url} onChange={(e) => set('url', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

export function OnlineToolsPage() {
  const tableRef1 = useTableResize('tools');
  usePageTitle('Tool online');
  const { confirm, toast, toastError } = useUi();
  const [items, setItems] = useState<OnlineTool[] | null>(null);
  const [q, setQ] = useSessionState('filter:online-tools', '');
  const [form, setForm] = useState<{ tool?: OnlineTool } | null>(null);
  const load = () => {
    api.listOnlineTools().then(setItems).catch(toastError);
  };
  useEffect(load, [toastError]);
  const shown = useNumbered(items, q, (x) => x.name);

  const remove = async (t: OnlineTool) => {
    if (!(await confirm({ title: 'Xóa Tool online', message: `Xóa "${t.name}" khỏi danh sách?`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await api.deleteOnlineTool(t.id);
      toast('success', 'Đã xóa.');
      load();
    } catch (e) {
      toastError(e);
    }
  };

  const add = (
    <button className="btn primary" onClick={() => setForm({})}>
      <Plus size={16} /> Thêm tool
    </button>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <Breadcrumbs items={[{ label: 'Tools' }, { label: 'Tool online', to: '/tools/online' }]} />
          <h1 className="row">
            <Globe size={22} style={{ color: 'var(--accent)' }} /> Tool online
          </h1>
          <div className="muted small">Link tới các tool trên internet — bấm Link để mở bằng trình duyệt mặc định.</div>
        </div>
        <div className="actions">{add}</div>
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm theo tên tool…" width={320} />
        <span className="small muted">
          {shown.length}/{items?.length ?? 0} tool
        </span>
      </div>
      {items === null ? (
        <div className="faint">Đang tải…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Globe size={36} />} title="Chưa có tool online nào" text="Lưu link các tool hay dùng trên internet kèm mục đích để tra cứu nhanh." action={add} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl" ref={tableRef1}>
            <thead>
              <tr>
                <th className="num">STT</th>
                <th>Tên tool</th>
                <th>Mục đích</th>
                <th>Link</th>
                <th style={{ width: 1 }} data-col="__actions" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="faint" style={{ textAlign: 'center' }}>
                    Không có tool khớp “{q}”.
                  </td>
                </tr>
              )}
              {shown.map(({ x: t, stt }) => (
                <tr key={t.id} data-row={t.id}>
                  <td className="num">{stt}</td>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="clamp">
                    <div>{t.purpose || dash}</div>
                  </td>
                  <td style={{ maxWidth: 280 }}>
                    <WebLinkButton text={t.url} />
                  </td>
                  <td>
                    <div className="row nowrap" style={{ gap: 2 }}>
                      <button className="btn sm icon ghost" aria-label={`Sửa ${t.name}`} title="Sửa" onClick={() => setForm({ tool: t })}>
                        <Pencil size={14} />
                      </button>
                      <button className="btn sm icon ghost" aria-label={`Xóa ${t.name}`} title="Xóa" style={{ color: 'var(--danger)' }} onClick={() => void remove(t)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && <OnlineToolForm tool={form.tool} onClose={() => setForm(null)} onSaved={load} />}
    </>
  );
}
