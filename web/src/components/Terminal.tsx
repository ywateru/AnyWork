import { useEffect, useRef, useState } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Keyboard,
  RefreshCw,
  Eraser,
  Square,
  TerminalSquare,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { Api } from "../api";
import type { TerminalChannel } from "../remoteTransport";
import { QuickKeyRows, useQuickKeyInput } from "./QuickKeys";

export default function Terminal({
  api,
  id,
  cwd,
}: {
  api: Api;
  id: string;
  cwd?: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    socket = useRef<TerminalChannel | null>(null),
    terminal = useRef<XTerminal | null>(null);
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState<"connecting" | "connected" | "closed">(
      "connecting",
    ),
    [showKeys, setShowKeys] = useState(
      () => matchMedia("(max-width:720px), (pointer:coarse)").matches,
    );
  const connected = state === "connected";
  const keys = useQuickKeyInput({
    onSend(data) {
      socket.current?.input(data);
    },
  });
  useEffect(() => {
    setState("connecting");
    keys.resetModifiers();
    const term = new XTerminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        lineHeight: 1.25,
        scrollback: 5000,
        fontFamily: '"SFMono-Regular",Consolas,monospace',
        theme: {
          background: "#171717",
          foreground: "#e5e5e5",
          cursor: "#e5e5e5",
          selectionBackground: "#52525280",
        },
      }),
      fit = new FitAddon();
    terminal.current = term;
    term.loadAddon(fit);
    term.open(container.current!);
    fit.fit();
    const ws = api.terminal(id, {
      ready() {
        setState("connected");
        socket.current?.resize(term.cols, term.rows);
      },
      data(bytes) {
        term.write(bytes);
      },
      closed() {
        setState("closed");
        term.writeln("\r\n[终端连接已关闭]");
      },
    });
    socket.current = ws;
    const input = term.onData(keys.dispatch);
    const observer = new ResizeObserver(() => {
      fit.fit();
      ws.resize(term.cols, term.rows);
    });
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
      socket.current = null;
      terminal.current = null;
    };
  }, [api, id, attempt, keys.dispatch, keys.resetModifiers]);
  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="terminal-caption">
          <TerminalSquare size={15} />
          <span>终端</span>
          <span className={`terminal-status ${state}`}>
            <i />
            {connected
              ? "已连接"
              : state === "connecting"
                ? "连接中…"
                : "已断开"}
          </span>
          <span className="terminal-cwd" title={cwd}>
            {cwd}
          </span>
        </div>
        <div className="terminal-actions">
          <button
            aria-label="快捷键"
            title="显示或隐藏快捷键"
            aria-pressed={showKeys}
            onClick={() => setShowKeys((value) => !value)}
          >
            <Keyboard size={15} />
          </button>
          <button
            aria-label="清空终端"
            title="清空终端显示"
            onClick={() => {
              terminal.current?.clear();
              terminal.current?.focus();
            }}
          >
            <Eraser size={15} />
          </button>
          <button
            aria-label="重新连接"
            title="重新连接终端"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      <div className="terminal-view" ref={container} />
      <div className={`terminal-footer${showKeys ? " keys-visible" : ""}`}>
        {showKeys && (
          <div className="quick-keys" aria-label="终端快捷键">
            <QuickKeyRows
              ctrlActive={keys.ctrlActive}
              altActive={keys.altActive}
              disabled={!connected}
              onPress={keys.dispatch}
              onToggleModifier={keys.toggleModifier}
            />
          </div>
        )}
        <button
          className="terminal-interrupt"
          title="中断终端命令"
          disabled={!connected}
          onClick={() => {
            keys.resetModifiers();
            socket.current?.input("\x03");
          }}
        >
          <Square size={11} />
          Ctrl+C
        </button>
        {!showKeys && (
          <span className="terminal-hint">
            {connected ? "点击终端开始输入" : "点击右上角重新连接"}
          </span>
        )}
      </div>
    </div>
  );
}
