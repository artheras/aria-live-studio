import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../lib/api";

export interface Toast {
  id: number;
  kind: "error" | "success" | "info";
  text: string;
}

interface ActionsValue {
  /** Run an action under `key`; ignored if that key is already in flight. Resolves true on success. */
  run: (key: string, fn: () => Promise<unknown>, opts?: { success?: string }) => Promise<boolean>;
  isPending: (key: string) => boolean;
  toast: (kind: Toast["kind"], text: string) => void;
}

const ActionsCtx = createContext<ActionsValue | null>(null);

export function useActions(): ActionsValue {
  const v = useContext(ActionsCtx);
  if (!v) throw new Error("useActions outside ActionsProvider");
  return v;
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const inflight = useRef(new Set<string>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3500);
    },
    [dismiss],
  );

  const run = useCallback<ActionsValue["run"]>(
    async (key, fn, opts) => {
      if (inflight.current.has(key)) return false; // never double-submit
      inflight.current.add(key);
      setPending(new Set(inflight.current));
      try {
        await fn();
        if (opts?.success) toast("success", opts.success);
        return true;
      } catch (err) {
        toast("error", errorMessage(err));
        return false;
      } finally {
        inflight.current.delete(key);
        setPending(new Set(inflight.current));
      }
    },
    [toast],
  );

  const value = useMemo<ActionsValue>(
    () => ({ run, toast, isPending: (key) => pending.has(key) }),
    [run, toast, pending],
  );

  return (
    <ActionsCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <span className="toast__text">{t.text}</span>
            <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ActionsCtx.Provider>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? "spinner spinner--sm" : "spinner"} aria-hidden="true" />;
}

interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  disabled?: boolean;
  pending?: boolean;
  title?: string;
  type?: "button" | "submit";
  size?: "lg" | "md" | "sm";
  className?: string;
}

export function Btn({
  children,
  onClick,
  variant = "secondary",
  disabled,
  pending,
  title,
  type = "button",
  size = "md",
  className = "",
}: BtnProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} btn--${size} ${pending ? "is-pending" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      title={title}
    >
      {pending && <Spinner small />}
      <span className="btn__label">{children}</span>
    </button>
  );
}
