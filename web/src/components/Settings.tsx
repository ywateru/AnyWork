import { saveBlob, platformError } from "../platform";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Palette,
  Plug,
  Search,
  Settings2,
  Sun,
  Upload,
  X,
} from "lucide-react";
import {
  appearancePresets,
  defaultAppearance,
  normalizeAppearance,
  validColor,
  type Appearance,
} from "../appearance";
import "../settings.css";

type Props = {
  appearance: Appearance;
  onChange: Dispatch<SetStateAction<Appearance>>;
  onClose: () => void;
  children?: ReactNode;
};
function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => setDraft(value.toUpperCase()), [value]);
  return (
    <label className="appearance-color">
      <input
        type="color"
        aria-label={`${label}颜色选择器`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        aria-label={`${label}十六进制颜色`}
        value={draft}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          if (validColor(e.target.value)) onChange(e.target.value);
        }}
        onBlur={() => setDraft(value.toUpperCase())}
      />
    </label>
  );
}
function ModePreview({ mode }: { mode: Appearance["mode"] }) {
  return (
    <span className={`appearance-mode-preview mode-${mode}`} aria-hidden="true">
      <span className="preview-sidebar">
        <span>◎</span>
      </span>
      <span className="preview-chat">
        <i />
        <i />
        <i />
        <b />
        <i />
        <b />
        <span className="preview-input">
          <em />
        </span>
      </span>
    </span>
  );
}
export function Settings({ appearance, onChange, onClose, children }: Props) {
  const [page, setPage] = useState<"general" | "appearance" | "connection">(
    "appearance",
  );
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const update = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
    onChange((a) => ({ ...a, [key]: value }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panelRef.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  const exportTheme = () => {
    const blob = new Blob(
      [JSON.stringify({ version: 1, appearance }, null, 2)],
      { type: "application/json" },
    );
    void saveBlob(blob, "anywork-theme.json").catch(platformError);
  };
  const entries = [
    { id: "general", label: "常规", icon: Settings2 },
    { id: "appearance", label: "外观", icon: Sun },
    { id: "connection", label: "Agent 与连接", icon: Plug },
  ] as const;
  const dark =
    appearance.mode === "dark" ||
    (appearance.mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const background = appearance.background || (dark ? "#212121" : "#ffffff");
  const foreground = appearance.foreground || (dark ? "#ececec" : "#0d0d0d");
  return (
    <div className="codex-settings-backdrop">
      <div
        ref={panelRef}
        tabIndex={-1}
        className="codex-settings"
        role="dialog"
        aria-modal="true"
        aria-label="设置与插件"
      >
        <aside className="settings-navigation">
          <header>
            <h1>设置</h1>
            <button
              type="button"
              className="settings-icon-button"
              aria-label="返回聊天"
              onClick={onClose}
            >
              <ArrowLeft size={19} />
            </button>
          </header>
          <label className="settings-search">
            <Search size={18} />
            <input
              aria-label="搜索设置"
              placeholder="搜索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="settings-nav-label">个人</div>
          <nav>
            {entries
              .filter(
                (entry) =>
                  !search ||
                  entry.label.includes(search) ||
                  (entry.id === "appearance" &&
                    /颜色|主题|字体|模式/.test(search)),
              )
              .map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  aria-current={page === entry.id ? "page" : undefined}
                  onClick={() => setPage(entry.id)}
                >
                  <entry.icon size={20} />
                  <span>{entry.label}</span>
                </button>
              ))}
          </nav>
          <footer>AnyWork</footer>
        </aside>
        <section className="settings-body">
          <button
            type="button"
            className="settings-close settings-icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={21} />
          </button>
          <div className="settings-content">
            <h2>{entries.find((entry) => entry.id === page)?.label}</h2>
            {page === "appearance" ? (
              <>
                <h3>视觉风格</h3>
                <div className="appearance-group appearance-mode-row">
                  <span className="appearance-row-label">模式</span>
                  <div className="appearance-modes">
                    {(
                      [
                        ["system", "跟随系统"],
                        ["light", "浅色"],
                        ["dark", "深色"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        type="button"
                        key={mode}
                        title={label}
                        aria-label={label}
                        aria-pressed={appearance.mode === mode}
                        onClick={() => update("mode", mode)}
                      >
                        <ModePreview mode={mode} />
                        <span className="appearance-mode-label">{label}</span>
                        {appearance.mode === mode && (
                          <Check className="appearance-mode-check" size={13} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="appearance-group">
                  <div className="appearance-row">
                    <label htmlFor="appearance-preset">主题</label>
                    <div className="appearance-controls">
                      <button
                        type="button"
                        className="settings-icon-button"
                        title="导出主题"
                        aria-label="导出主题"
                        onClick={exportTheme}
                      >
                        <Download size={20} />
                      </button>
                      <button
                        type="button"
                        className="settings-icon-button"
                        title="复制主题"
                        aria-label="复制主题"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(
                              JSON.stringify(
                                { version: 1, appearance },
                                null,
                                2,
                              ),
                            )
                            .then(() => setNotice("主题配置已复制"))
                            .catch(() => setNotice("无法复制，请使用导出主题"));
                          if (!navigator.clipboard)
                            setNotice("浏览器不支持剪贴板，请使用导出主题");
                        }}
                      >
                        <Copy size={20} />
                      </button>
                      <label className="appearance-select appearance-theme-select">
                        <span
                          className="appearance-theme-icon"
                          aria-hidden="true"
                        >
                          Aa
                        </span>
                        <select
                          id="appearance-preset"
                          value={appearance.preset}
                          onChange={(e) => {
                            const preset = appearancePresets.find(
                              (p) => p.id === e.target.value,
                            )!;
                            onChange((a) => ({
                              ...a,
                              preset: preset.id,
                              accent: preset.accent,
                              background: null,
                              foreground: null,
                            }));
                          }}
                        >
                          {appearancePresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} />
                      </label>
                    </div>
                  </div>
                  <div className="appearance-row">
                    <span>强调色</span>
                    <div className="appearance-controls">
                      <label className="appearance-select">
                        <select
                          aria-label="强调色预设"
                          value={
                            appearancePresets.find(
                              (p) =>
                                p.accent.toLowerCase() ===
                                appearance.accent.toLowerCase(),
                            )?.id || "custom"
                          }
                          onChange={(e) => {
                            const preset = appearancePresets.find(
                              (p) => p.id === e.target.value,
                            );
                            if (preset) update("accent", preset.accent);
                          }}
                        >
                          <option value="custom">自定义</option>
                          {appearancePresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} />
                      </label>
                      <ColorControl
                        label="强调色"
                        value={appearance.accent}
                        onChange={(color) => update("accent", color)}
                      />
                    </div>
                  </div>
                  <div className="appearance-row">
                    <span>背景</span>
                    <ColorControl
                      label="背景"
                      value={background}
                      onChange={(color) => update("background", color)}
                    />
                  </div>
                  <div className="appearance-row">
                    <span>前景</span>
                    <ColorControl
                      label="前景"
                      value={foreground}
                      onChange={(color) => update("foreground", color)}
                    />
                  </div>
                  <div className="appearance-row">
                    <label htmlFor="appearance-font">字体</label>
                    <label className="appearance-select">
                      <select
                        id="appearance-font"
                        value={appearance.font}
                        onChange={(e) =>
                          update("font", e.target.value as Appearance["font"])
                        }
                      >
                        <option value="system">系统</option>
                        <option value="sans">无衬线</option>
                        <option value="serif">衬线</option>
                        <option value="mono">等宽</option>
                      </select>
                      <ChevronDown size={14} />
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  className="appearance-advanced-toggle"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  高级
                  {advanced ? (
                    <ChevronDown size={17} />
                  ) : (
                    <ChevronRight size={17} />
                  )}
                </button>
                {advanced && (
                  <div className="appearance-group appearance-advanced">
                    {(
                      [
                        {
                          key: "fontSize",
                          label: "界面字号",
                          min: 12,
                          max: 22,
                          step: 1,
                          unit: "px",
                        },
                        {
                          key: "codeFontSize",
                          label: "代码字号",
                          min: 11,
                          max: 20,
                          step: 1,
                          unit: "px",
                        },
                        {
                          key: "lineHeight",
                          label: "行距",
                          min: 1.3,
                          max: 2.2,
                          step: 0.1,
                          unit: "",
                        },
                      ] as const
                    ).map((item) => (
                      <label key={item.key} className="appearance-row">
                        <span>{item.label}</span>
                        <span className="appearance-range">
                          <input
                            type="range"
                            aria-label={item.label}
                            min={item.min}
                            max={item.max}
                            step={item.step}
                            value={appearance[item.key]}
                            onChange={(e) =>
                              update(item.key, Number(e.target.value))
                            }
                          />
                          <output>
                            {appearance[item.key]}
                            {item.unit}
                          </output>
                        </span>
                      </label>
                    ))}
                    <div className="appearance-row">
                      <span>主题配置</span>
                      <button
                        type="button"
                        className="appearance-action"
                        onClick={() => importRef.current?.click()}
                      >
                        <Upload size={16} />
                        导入主题
                      </button>
                    </div>
                    <div className="appearance-row">
                      <span>恢复默认外观</span>
                      <button
                        type="button"
                        className="appearance-action"
                        onClick={() => {
                          onChange({ ...defaultAppearance });
                          setNotice("已恢复默认外观");
                        }}
                      >
                        恢复默认
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={importRef}
                  type="file"
                  hidden
                  accept="application/json,.json"
                  aria-label="选择主题文件"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (file.size > 65536) {
                      setNotice("主题文件过大，请选择有效的主题配置");
                      return;
                    }
                    try {
                      const config = JSON.parse(await file.text());
                      const data = config.appearance || config;
                      if (
                        !data ||
                        typeof data !== "object" ||
                        !["mode", "accent", "preset"].some((k) => k in data)
                      )
                        throw new Error();
                      onChange(normalizeAppearance(data));
                      setNotice("主题已导入");
                    } catch {
                      setNotice("无法导入：请选择有效的 JSON 主题配置");
                    }
                  }}
                />
                {notice && (
                  <p className="appearance-notice" role="status">
                    {notice}
                  </p>
                )}
              </>
            ) : page === "general" ? (
              <div className="settings-existing-content">
                {children || (
                  <p className="settings-description">
                    会话与工作目录随当前连接同步。
                  </p>
                )}
              </div>
            ) : (
              <div className="appearance-group">
                <div className="appearance-row">
                  <span>Agent</span>
                  <strong>由当前服务提供</strong>
                </div>
                <div className="appearance-row">
                  <span>连接方式</span>
                  <span>当前服务</span>
                </div>
                <p className="settings-description">
                  可用 Agent 与连接状态由当前服务提供，可在常规中查看 Agent
                  清单和设置提示。
                </p>
                <p className="settings-description">
                  Claude Code 使用宿主上的 CLI 原生登录。Claude Desktop Code
                  使用桌面端登录，实时操作还需组织政策允许的有效原生桥接入口；仅有历史记录时保持只读。
                </p>
                <button
                  type="button"
                  className="appearance-action settings-connection-link"
                  onClick={() => setPage("general")}
                >
                  <Palette size={16} />
                  管理连接与插件
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
export default Settings;
