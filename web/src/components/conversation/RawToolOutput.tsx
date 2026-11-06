import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CodeXml, Copy, X } from "lucide-react";
import { toolInvocation } from "../../toolPresentation";

export default function RawToolOutput({ item }: { item: Record<string, any> }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="tool-raw-trigger"
        aria-label="查看原始工具输出"
        title="查看原始工具输出"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <CodeXml size={14} />
      </button>
      {open &&
        createPortal(
          <RawOutputDialog
            item={item}
            close={() => setOpen(false)}
            returnFocus={() => {
              if (trigger.current?.isConnected)
                trigger.current.focus({ preventScroll: true });
            }}
          />,
          document.body,
        )}
    </>
  );
}

function RawOutputDialog({
  item,
  close,
  returnFocus,
}: {
  item: Record<string, any>;
  close: () => void;
  returnFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const output = useRef<HTMLPreElement>(null);
  const heading = useId();
  const backdropDown = useRef(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const invocation = toolInvocation(item);
  const name = [invocation.provider, invocation.tool].filter(Boolean).join(".");
  // Mounted only after opening: large raw results are never serialized on every
  // collapsed activity render or copied into the ordinary transcript DOM.
  const raw = useMemo(
    () =>
      JSON.stringify(
        {
          callId: item.callId ?? item.id,
          invocation: item.invocation ?? {
            server: item.server ?? item.namespace,
            tool: item.tool ?? item.functionName,
            arguments: toolInvocation(item).arguments,
          },
          durationMs: item.durationMs,
          result:
            item.result ??
            (item.error != null
              ? { error: item.error }
              : (item.contentItems ?? null)),
        },
        null,
        2,
      ),
    [item],
  );
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  useLayoutEffect(() => {
    const node = dialog.current!;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = previous;
      returnFocusRef.current();
    };
  }, []);
  useLayoutEffect(() => {
    setCopied(false);
    setError("");
  }, [raw]);
  function outside(event: {
    currentTarget: HTMLDialogElement;
    target: EventTarget;
    clientX: number;
    clientY: number;
  }) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
    } catch {
      setError("无法访问剪贴板，请选择下方内容复制。");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="tool-raw-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        if (event.shiftKey && document.activeElement === closeButton.current) {
          event.preventDefault();
          output.current?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === output.current
        ) {
          event.preventDefault();
          closeButton.current?.focus();
        }
      }}
      onPointerDown={(event) => {
        backdropDown.current = outside(event);
      }}
      onPointerCancel={() => {
        backdropDown.current = false;
      }}
      onPointerUp={(event) => {
        if (backdropDown.current && outside(event)) close();
        backdropDown.current = false;
      }}
    >
      <button
        ref={closeButton}
        type="button"
        className="tool-raw-close"
        autoFocus
        aria-label="关闭原始工具输出"
        onClick={close}
      >
        <X size={16} />
      </button>
      <h2 id={heading}>原始{name ? ` ${name} ` : ""}工具输出</h2>
      <div className="tool-raw-code">
        <div className="tool-raw-code-header">
          <span>JSON</span>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "已复制原始输出" : "复制原始输出"}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <pre ref={output} tabIndex={0} aria-label="原始工具调用 JSON">
          <code>{raw}</code>
        </pre>
      </div>
      {error && (
        <p className="tool-raw-copy-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
