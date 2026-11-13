import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronsUpDown, Laptop, Monitor, X } from "lucide-react";
import AccountEntry from "./AccountEntry";
import { AccountIdentityDetails } from "./AccountIdentityDetails";

type Props = {
  deviceLabel: string;
  accountLabel?: string;
  contextLabel?: string;
  onDevices?: () => void;
  onSignOut?: () => void;
  onDisconnect?: () => void;
  onHome?: () => void;
};

export function WorkspaceDevice({
  deviceLabel,
  onDevices,
}: Pick<Props, "deviceLabel" | "onDevices">) {
  return (
    <details className="workspace-device-menu" data-floating-menu>
      <summary
        className="workspace-device-trigger"
        aria-label={`${deviceLabel}，设备选项`}
        title={deviceLabel}
      >
        {onDevices ? <Laptop size={16} /> : <Monitor size={16} />}
        <span>{deviceLabel}</span>
        <ChevronDown size={16} />
      </summary>
      <div className="workspace-context-options">
        <WorkspaceLeave onDevices={onDevices} />
      </div>
    </details>
  );
}

/** Confirmation belongs to the page connection; it never stops the remote Agent. */
function WorkspaceLeave({ onDevices }: { onDevices?: () => void }) {
  if (!onDevices) return <AccountEntry label="账号与设备" />;
  return (
    <ConfirmConnectionAction
      label="我的设备 / 切换电脑"
      title="返回我的设备？"
      onConfirm={onDevices}
    />
  );
}

function ConfirmConnectionAction({
  label,
  title,
  onConfirm,
  local = false,
}: {
  label: string;
  title: string;
  onConfirm: () => void;
  local?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      dialog.current
        ?.querySelector<HTMLElement>(".workspace-leave-actions button")
        ?.focus();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  function restoreFocus() {
    const menu = trigger.current?.closest("details");
    (menu && !menu.open
      ? menu.querySelector<HTMLElement>("summary")
      : trigger.current
    )?.focus();
  }
  function close() {
    setOpen(false);
    restoreFocus();
  }
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="workspace-leave-dialog"
          aria-label={title}
          onCancel={() => setOpen(false)}
          onClose={restoreFocus}
        >
          <div className="workspace-leave-heading">
            <h2>{title}</h2>
            <button type="button" onClick={close} aria-label="关闭">
              <X size={17} />
            </button>
          </div>
          <p>
            {local
              ? "将结束当前浏览器的本机会话及其终端。电脑上的工作和账号远程访问继续保留。"
              : "将断开当前网页到这台电脑的连接及终端。电脑上的 Agent 任务会继续执行。"}
          </p>
          <div className="workspace-leave-actions">
            <button autoFocus type="button" onClick={close}>
              取消
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => {
                close();
                onConfirm();
              }}
            >
              {label}
            </button>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}

export function WorkspaceAccount({
  accountLabel,
  contextLabel,
  onDevices,
  onSignOut,
  onDisconnect,
  onHome,
}: Omit<Props, "deviceLabel">) {
  return (
    <details className="workspace-account-menu" data-floating-menu>
      <summary title={accountLabel}>
        <span className="workspace-account-avatar">
          {onDevices ? (accountLabel || "账号").slice(0, 1) : "本"}
        </span>
        <span>{onDevices ? accountLabel || "当前账号" : "本机网页会话"}</span>
        <ChevronsUpDown size={15} />
      </summary>
      <div className="workspace-context-options">
        {onDevices ? (
          <AccountIdentityDetails
            fallback={<p className="workspace-context">{contextLabel}</p>}
          />
        ) : (
          <p className="workspace-context">{contextLabel}</p>
        )}
        {!onDevices && (
          <p className="workspace-source-hint">
            来源是打开时的快照，不表示此网页已登录该账号，也不表示当前桌面账号或远程状态。
          </p>
        )}
        {onHome && (
          <button
            className="workspace-compact-home"
            type="button"
            onClick={onHome}
          >
            工作区首页
          </button>
        )}
        {onSignOut ? (
          <ConfirmConnectionAction
            label="退出账号"
            title="退出 Web 账号？"
            onConfirm={onSignOut}
          />
        ) : (
          onDisconnect && (
            <ConfirmConnectionAction
              label="退出本机网页会话"
              title="退出本机网页会话？"
              local
              onConfirm={onDisconnect}
            />
          )
        )}
        {!onDevices && <AccountEntry label="账号与设备" />}
      </div>
    </details>
  );
}
