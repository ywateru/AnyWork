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
    socket = useRef<WebSocket | null>(null),
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
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "input", data }));
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
    const ws = new WebSocket(
      api.url(`/ws/terminal/${id}`).replace(/^http/, "ws"),
    );
    socket.current = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(JSON.stringify({ token: api.connection.token }));
      setState("connected");
      ws.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    };
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer)
        term.write(new Uint8Array(event.data));
      else term.writeln(event.data);
    };
    ws.onclose = () => {
      setState("closed");
      term.writeln("\r\n[终端连接已关闭]");
    };
    ws.onerror = () => {
      setState("closed");
      term.writeln("\r\n[无法连接终端]");
    };
    const input = term.onData(keys.dispatch);
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
    });
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      input.dispose();
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
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
            socket.current?.send(
              JSON.stringify({ type: "input", data: "\x03" }),
            );
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
