import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Modal } from '../components/Modal';
import { errorMessage } from '../api';

type ToastKind = 'success' | 'error' | 'info' | 'warn';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  validate?: (v: string) => string | null;
}

interface UiApi {
  toast: (kind: ToastKind, text: string) => void;
  toastError: (err: unknown) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  setTitle: (t: string) => void;
  title: string;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('UiProvider missing');
  return ctx;
}

export function usePageTitle(title: string) {
  const { setTitle } = useUi();
  useEffect(() => {
    setTitle(title);
    document.title = `${title} · Personal Project Manager`;
  }, [title, setTitle]);
}

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warn: AlertTriangle };

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [title, setTitle] = useState('');
  const seq = useRef(0);

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const toastError = useCallback((err: unknown) => toast('error', errorMessage(err)), [toast]);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), []);
  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>((resolve) => setPromptState({ ...o, resolve })), []);

  const value = useMemo(() => ({ toast, toastError, confirm, prompt, setTitle, title }), [toast, toastError, confirm, prompt, title]);

  return (
    <UiContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon size={18} />
              <div className="pre">{t.text}</div>
              <button aria-label="Đóng" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {confirmState && (
        <Modal
          size="sm"
          title={confirmState.title}
          onClose={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
          footer={(close) => (
            <>
              <button className="btn" onClick={close}>
                {confirmState.cancelText ?? 'Hủy'}
              </button>
              <button
                autoFocus
                className={`btn ${confirmState.danger ? 'danger solid' : 'primary'}`}
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
              >
                {confirmState.confirmText ?? 'Xác nhận'}
              </button>
            </>
          )}
        >
          <div className="pre" style={{ whiteSpace: 'normal' }}>{confirmState.message}</div>
        </Modal>
      )}
      {promptState && (
        <PromptDialog
          {...promptState}
          onDone={(v) => {
            promptState.resolve(v);
            setPromptState(null);
          }}
        />
      )}
    </UiContext.Provider>
  );
}

function PromptDialog(p: PromptOptions & { onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(p.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const err = p.validate?.(value) ?? null;
    if (err) return setError(err);
    p.onDone(value);
  };
  return (
    <Modal
      size="sm"
      title={p.title}
      onClose={() => p.onDone(null)}
      footer={(close) => (
        <>
          <button className="btn" onClick={close}>
            Hủy
          </button>
          <button className="btn primary" onClick={submit}>
            {p.confirmText ?? 'Lưu'}
          </button>
        </>
      )}
    >
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="prompt-input">{p.label}</label>
        <input
          id="prompt-input"
          autoFocus
          className={`input ${error ? 'invalid' : ''}`}
          value={value}
          placeholder={p.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
        {error && <div className="field-error">{error}</div>}
      </form>
    </Modal>
  );
}
