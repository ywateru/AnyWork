import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export const appearancePresets = [
  { id: "chatgpt", name: "ChatGPT", accent: "#0169cc" },
  { id: "codex", name: "Codex", accent: "#0d0d0d" },
  { id: "violet", name: "鸢尾紫", accent: "#7950c7" },
  { id: "blue", name: "海湾蓝", accent: "#2874d0" },
  { id: "teal", name: "青瓷", accent: "#008579" },
  { id: "green", name: "松林绿", accent: "#32804e" },
  { id: "amber", name: "琥珀", accent: "#a86c09" },
  { id: "rose", name: "蔷薇", accent: "#c14b74" },
] as const;
export type Appearance = {
  mode: "system" | "light" | "dark";
  preset: (typeof appearancePresets)[number]["id"];
  accent: string;
  background: string | null;
  foreground: string | null;
  font: "system" | "sans" | "serif" | "mono";
  fontSize: number;
  codeFontSize: number;
  lineHeight: number;
};
export const defaultAppearance: Appearance = {
  mode: "system",
  preset: "codex",
  accent: "#0d0d0d",
  background: null,
  foreground: null,
  font: "system",
  fontSize: 14,
  codeFontSize: 12,
  lineHeight: 1.625,
};
const storageKey = "ra.appearance-v1";
export const validColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export function normalizeAppearance(value: unknown): Appearance {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const numeric = (key: string, fallback: number, min: number, max: number) =>
    typeof input[key] === "number" && Number.isFinite(input[key])
      ? Math.min(max, Math.max(min, input[key] as number))
      : fallback;
  return {
    mode:
      input.mode === "light" || input.mode === "dark" ? input.mode : "system",
    preset: appearancePresets.some((p) => p.id === input.preset)
      ? (input.preset as Appearance["preset"])
      : defaultAppearance.preset,
    accent: validColor(input.accent) ? input.accent : defaultAppearance.accent,
    background: validColor(input.background) ? input.background : null,
    foreground: validColor(input.foreground) ? input.foreground : null,
    font: ["system", "sans", "serif", "mono"].includes(String(input.font))
      ? (input.font as Appearance["font"])
      : "system",
    fontSize: numeric("fontSize", defaultAppearance.fontSize, 12, 22),
    codeFontSize: numeric(
      "codeFontSize",
      defaultAppearance.codeFontSize,
      11,
      20,
    ),
    lineHeight: numeric("lineHeight", defaultAppearance.lineHeight, 1.3, 2.2),
  };
}
function loadAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return normalizeAppearance(JSON.parse(saved));
    const legacy = localStorage.getItem("ra.theme");
    const preset = appearancePresets.find(
      (p) => p.id === localStorage.getItem("ra.palette-v3"),
    );
    return {
      ...defaultAppearance,
      ...(preset ? { preset: preset.id, accent: preset.accent } : {}),
      mode: legacy === "dark" || legacy === "light" ? legacy : "system",
    };
  } catch {
    return { ...defaultAppearance };
  }
}
const fontFamilies = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  sans: 'Arial, "Noto Sans", sans-serif',
  serif: 'Georgia, "Noto Serif", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
};
export function useAppearance(): {
  appearance: Appearance;
  setAppearance: Dispatch<SetStateAction<Appearance>>;
  theme: "light" | "dark";
  toggleTheme: () => void;
} {
  const [appearance, setAppearance] = useState(loadAppearance);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const theme =
    appearance.mode === "system"
      ? systemDark
        ? "dark"
        : "light"
      : appearance.mode;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.palette = appearance.preset;
    root.style.colorScheme = theme;
    const background =
      appearance.background || (theme === "dark" ? "#212121" : "#ffffff");
    const foreground =
      appearance.foreground || (theme === "dark" ? "#ececec" : "#0d0d0d");
    const accent =
      appearance.preset === "codex" &&
      appearance.accent === "#0d0d0d" &&
      theme === "dark"
        ? "#ececec"
        : appearance.accent;
    const rgb = [1, 3, 5].map(
      (n) => parseInt(accent.slice(n, n + 2), 16) / 255,
    );
    const luminance = rgb
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const vars: Record<string, string> = {
      "--accent": accent,
      "--accent-text": luminance > 0.4 ? "#0d0d0d" : "#ffffff",
      "--accent-soft": `color-mix(in srgb, ${accent} 10%, ${background})`,
      "--accent-ring": `color-mix(in srgb, ${accent} 32%, transparent)`,
      "--surface": background,
      "--panel": `color-mix(in srgb, ${foreground} ${theme === "dark" ? 4 : 5}%, ${background})`,
      "--raised": `color-mix(in srgb, ${foreground} 7%, ${background})`,
      "--line": `color-mix(in srgb, ${foreground} 10%, ${background})`,
      "--app-code-bg": `color-mix(in srgb, ${foreground} 3%, ${background})`,
      "--text": foreground,
      "--bg": background,
      "--muted": `color-mix(in srgb, ${foreground} 55%, ${background})`,
      "--app-bg": background,
      "--app-fg": foreground,
      "--app-dialog-bg": background,
      "--app-hint": `color-mix(in srgb, ${foreground} 55%, ${background})`,
      "--app-link":
        appearance.preset === "codex"
          ? theme === "dark"
            ? "#8bb7f7"
            : "#0169cc"
          : accent,
      "--app-chat-user-bg": `color-mix(in srgb, ${foreground} ${theme === "dark" ? 7 : 5}%, ${background})`,
      "--app-chat-user-fg": foreground,
      "--font-ui-family": fontFamilies[appearance.font],
      "--font-ui-size": `${appearance.fontSize}px`,
      "--font-code-size": `${appearance.codeFontSize}px`,
      "--chat-line-height": String(appearance.lineHeight),
      "--app-chat-font-size": `${appearance.fontSize}px`,
      "--app-chat-line-height": String(appearance.lineHeight),
    };
    for (const [name, value] of Object.entries(vars))
      root.style.setProperty(name, value);
    try {
      localStorage.setItem(storageKey, JSON.stringify(appearance));
      localStorage.setItem("ra.theme", appearance.mode);
    } catch {
      /* Keep the current appearance when browser storage is unavailable. */
    }
  }, [appearance, theme]);
  return {
    appearance,
    setAppearance,
    theme,
    toggleTheme: () =>
      setAppearance((a) => ({
        ...a,
        mode: theme === "dark" ? "light" : "dark",
      })),
  };
}
