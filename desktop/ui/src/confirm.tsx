import { useEffect, useRef, type ReactNode } from "react";

// Native modal semantics own the focus trap and make the page inert. The
// default action is always cancellation; pending writes cannot be dismissed.
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "取消",
  pending = false,
  disabled = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      dialog.current?.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, []);
  function close() {
    if (!pending) onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="install-dialog confirm-dialog"
      aria-labelledby="desktop-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
    >
      <h2 id="desktop-confirm-title">{title}</h2>
      {children}
      <div className="install-actions">
        <button ref={cancel} disabled={pending} onClick={close}>
          {cancelLabel}
        </button>
        <button
          className="primary"
          disabled={pending || disabled}
          onClick={onConfirm}
        >
          {pending ? "正在处理…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
