import {
  Globe2,
  Laptop,
  LockKeyhole,
  Monitor,
  Smartphone,
  Check,
  ArrowRight,
} from "lucide-react";
import type { AccountController } from "./accounts";

export function Stepper({ stage }: { stage: "intro" | "account" | "prepare" }) {
  const steps = [
    ["intro", "功能介绍"],
    ["account", "登录账号"],
    ["prepare", "准备工作区"],
  ] as const;
  const at = steps.findIndex(([id]) => id === stage);
  return (
    <ol className="onboarding-steps" aria-label="开始使用步骤">
      {steps.map(([id, label], i) => (
        <li
          key={id}
          aria-current={id === stage ? "step" : undefined}
          className={i < at ? "complete" : ""}
        >
          <span className="step-index" aria-hidden="true">
            {i < at ? <Check size={13} /> : i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}
export function Introduction({ next }: { next: () => void }) {
  return (
    <section className="intro-layout" aria-label="AnyWork 功能介绍">
      <div className="intro-copy">
        <h1>
          把这台电脑的工作区
          <br />
          带到你的每一台设备
        </h1>
        <p className="intro-description">
          会话、文件与终端由这台电脑处理。本地在浏览器工作；在外登录同一账号，选择这台电脑继续。
        </p>
        <div className="intro-capabilities">
          <p>
            <Monitor size={18} aria-hidden="true" />
            本机浏览器里的完整工作区
          </p>
          <p>
            <Smartphone size={18} aria-hidden="true" />
            手机或网页继续同一份工作
          </p>
          <p>
            <LockKeyhole size={18} aria-hidden="true" />
            远程连接端到端加密
          </p>
        </div>
        <button className="primary intro-start" onClick={next}>
          开始使用
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <p className="hint">接下来登录账号，再准备这台电脑的工作区。</p>
      </div>
      <figure
        className="device-diagram"
        aria-label="设备关系示意，不表示当前在线设备"
      >
        <div className="diagram-computer">
          <div className="computer-screen">
            <Laptop size={54} strokeWidth={1.3} aria-hidden="true" />
          </div>
          <strong>这台电脑</strong>
          <p>运行 Agent，保存工作内容</p>
        </div>
        <div className="diagram-branches" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="diagram-endpoints">
          <div>
            <Monitor size={26} strokeWidth={1.5} aria-hidden="true" />
            <strong>本机浏览器</strong>
            <p>本地地址访问</p>
          </div>
          <div>
            <div className="endpoint-icons">
              <Smartphone size={25} strokeWidth={1.5} aria-hidden="true" />
              <Globe2 size={24} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <strong>手机 / 网页</strong>
            <p>同账号，加密连接</p>
          </div>
        </div>
        <figcaption>
          关系示意。云端处理账号与必要连接元数据，工作内容留在设备。
        </figcaption>
      </figure>
    </section>
  );
}
const kinds = {
  ios: "iPhone / iPad 浏览器",
  android: "Android 浏览器",
  desktop: "网页客户端",
  unknown: "网页客户端",
};
export function RemoteClients({
  controller,
}: {
  controller: AccountController;
}) {
  const { state, available } = controller;
  const list = state?.remoteClients;
  const valid =
    Array.isArray(list) &&
    list.length <= 4 &&
    list.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        Object.hasOwn(kinds, item.kind) &&
        Number.isFinite(item.connectedAt) &&
        item.connectedAt > 0 &&
        item.connectedAt <= 8640000000000,
    );
  return (
    <section className="connected-section" aria-label="正在连接这台电脑的设备">
      <div className="section-heading">
        <h2>正在连接这台电脑的设备</h2>
        {available && state?.enabled && valid && (
          <span className="connection-count">{list.length} 个活动连接</span>
        )}
      </div>
      {!available || !state || !valid ? (
        <p className="connection-empty" role="status">
          连接状态暂不可用
        </p>
      ) : !state.enabled ? (
        <p className="connection-empty" role="status">
          远程访问已关闭。开启后，可在这里看到活动连接。
        </p>
      ) : list.length === 0 ? (
        <p className="connection-empty" role="status">
          还没有远程设备连接
        </p>
      ) : (
        <ul className="connected-list">
          {list.map((client) => (
            <li key={client.id}>
              {client.kind === "ios" || client.kind === "android" ? (
                <Smartphone size={21} aria-hidden="true" />
              ) : (
                <Monitor size={21} aria-hidden="true" />
              )}
              <div>
                <strong>{kinds[client.kind]}</strong>
                <p>
                  开始于{" "}
                  <time
                    dateTime={new Date(client.connectedAt * 1000).toISOString()}
                  >
                    {new Date(client.connectedAt * 1000).toLocaleTimeString(
                      [],
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </time>
                </p>
              </div>
              <span className="connected-state">
                <span className="status-dot ready" />
                已连接
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        每行代表一个活动加密连接。设备类型由客户端提示，仅用于显示，同一设备可以建立多个连接。
      </p>
    </section>
  );
}
