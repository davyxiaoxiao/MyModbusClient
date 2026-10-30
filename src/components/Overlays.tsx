import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import type { ToastMessage } from "../types";

export function Toasts({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.tone}`} key={toast.id}>
          <Icon
            name={
              toast.tone === "success"
                ? "check"
                : toast.tone === "error"
                  ? "alert"
                  : "info"
            }
            size={14}
          />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className={`dialog-icon ${tone === "primary" ? "neutral" : ""}`}>
          <Icon name="alert" size={19} />
        </div>
        <h3 id="confirm-title">{title}</h3>
        <p>{description}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            ref={cancelRef}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className={tone === "primary" ? "btn-primary" : "btn-danger"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
