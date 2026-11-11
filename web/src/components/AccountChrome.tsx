import { createContext, useContext, type ReactNode } from "react";
import { CircleHelp, Globe, Monitor, Moon, Sun } from "lucide-react";
import { useAppearance } from "../appearance";
import { useFloatingMenus } from "../hooks/useFloatingMenus";

export function AccountBrand() {
  return (
    <a className="account-brand" href="/" aria-label="AnyWork">
      <img
        src={import.meta.env.BASE_URL + "icon.svg"}
        width="28"
        height="28"
        alt=""
      />
      <span>AnyWork</span>
    </a>
  );
}

const AppearanceContext = createContext<ReturnType<
  typeof useAppearance
> | null>(null);

/** Mounted only outside the connected App so one appearance owner is active. */
export function AccountSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  useFloatingMenus("account-entry");
  const appearance = useAppearance();
  return (
    <AppearanceContext.Provider value={appearance}>
      <div
        className={`account-root ${className}`}
        data-appearance={appearance.theme}
      >
        {children}
      </div>
    </AppearanceContext.Provider>
  );
}

export function AccountUtilities({
  locale = "zh-CN",
  onLocale,
}: {
  locale?: "zh-CN" | "en";
  onLocale?: () => void;
}) {
  const { theme, toggleTheme } = useContext(AppearanceContext)!;
  const zh = locale === "zh-CN";
  return (
    <div className="account-utilities">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={zh ? "切换主题" : "Switch appearance"}
      >
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        {zh ? "外观" : "Appearance"}
      </button>
      {onLocale && (
        <button type="button" onClick={onLocale}>
          <Globe size={15} />
          {zh ? "English" : "中文"}
        </button>
      )}
      <a href={zh ? "/zh/" : "/en/"}>
        <CircleHelp size={15} />
        {zh ? "使用指南" : "Getting started"}
      </a>
    </div>
  );
}

export function DeviceNavigation({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <aside className="account-nav" aria-label={label}>
      <AccountBrand />
      <nav aria-label={label}>
        <span aria-current="page">
          <Monitor size={16} />
          {label}
        </span>
      </nav>
      <div className="account-nav-bottom">{children}</div>
    </aside>
  );
}
