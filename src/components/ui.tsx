import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-strong text-on-accent hover:brightness-110',
  secondary: 'bg-raised text-ink border border-line hover:border-muted',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-critical text-white hover:brightness-110',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', busy, icon, children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  busy?: boolean;
  tone?: 'default' | 'danger';
}

export function IconButton({ label, busy, tone = 'default', children, className = '', disabled, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 ${tone === 'danger' ? 'hover:text-critical-ink' : 'hover:text-ink'} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <IconButton label="Schließen" onClick={onClose}><X className="size-4" /></IconButton>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
    </dialog>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none';

export const selectClass =
  'h-9 rounded-lg border border-line bg-raised px-2.5 text-sm text-ink focus:border-accent focus:outline-none';

export function Chip({ children, title, className = '' }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-xs text-muted ${className}`}>
      {children}
    </span>
  );
}

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-in pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm shadow-xl ${
            toast.kind === 'error' ? 'border-critical' : toast.kind === 'success' ? 'border-good' : 'border-line'
          }`}
        >
          <span className="whitespace-pre-line">{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Meldung schließen" className="text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
