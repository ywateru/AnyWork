import { UserScope } from "@logto/browser";
import { AccountLogtoClient } from "./accountAuth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Check,
  Laptop,
  LogOut,
  MoreHorizontal,
  ChevronsUpDown,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import App from "./App";
import LocalApp from "./LocalApp";
import { isLocalEntry } from "./localBootstrap";
import type { Connection } from "./types";
import {
  AccountError,
  resolveAccountConfig,
  accountStorageNamespace,
  type AccountConfig,
} from "./accountConfig";
import {
  AccountStore,
  type AccountProfile,
  type DeviceRecord,
} from "./accountData";
import { CyberGridClient, type Device } from "./vendor/cybergrid";
import { RemoteTransport } from "./remoteTransport";
import "./account.css";
import {
  AccountBrand as Brand,
  AccountSurface,
  AccountUtilities,
  DeviceNavigation,
} from "./components/AccountChrome";

const LogtoContext = createContext<{
  logtoClient: AccountLogtoClient;
  isAuthenticated: boolean;
  isLoading: boolean;
  setIsAuthenticated: (value: boolean) => void;
} | null>(null);
function AccountProvider({
  config,
  children,
}: {
  config: AccountConfig;
  children: React.ReactNode;
}) {
  const client = useMemo(
    () =>
      new AccountLogtoClient(
        {
          endpoint: config.endpoint,
          appId: config.appId,
          resources: [config.resource],
          scopes: [UserScope.CustomData, "connect"],
          requestTimeoutMs: 15000,
        },
        config,
      ),
    [config.endpoint, config.appId, config.resource],
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false),
    [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void client
      .isAuthenticated()
      .then((value) => {
        if (active) setIsAuthenticated(value);
      })
      .catch(() => {
        if (active) setIsAuthenticated(false);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  return (
    <LogtoContext.Provider
      value={{
        logtoClient: client,
        isAuthenticated,
        isLoading,
        setIsAuthenticated,
      }}
    >
      {children}
    </LogtoContext.Provider>
  );
}
const initialLocale = () => {
  try {
    const saved = localStorage.getItem("anywork.account.locale");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* storage optional */
  }
  return navigator.language.startsWith("zh") ? "zh-CN" : "en";
};
const zh = {
  devices: "我的设备",
  guide: "使用指南",
  title: "登录账号",
  intro: "登录同一账号，连接自己的工作电脑。",
  signIn: "登录",
  signUp: "注册账号",
  accountHint: "登录后即可查看你的设备。密码只在安全账号页面输入。",
  localHint: "需要在这台电脑上开启远程访问？",
  download: "下载桌面端",
  loading: "正在加载…",
  signingIn: "正在完成登录…",
  signOut: "退出账号",
  refresh: "刷新",
  add: "添加设备",
  subtitle: "选择一台电脑，继续上次的工作。",
  emptyTitle: "把你的第一台电脑添加进来",
  emptyText:
    "安装 Mac 桌面端并登录同一账号。工作区就绪后默认尝试开启远程访问，可在电脑上随时关闭。",
  online: "在线",
  offline: "离线",
  unknown: "状态暂时未知",
  newDevice: "新发现的设备",
  unverified: "尚未同步设备身份，请在电脑上检查账号配置。",
  unavailable: "安全连接尚未就绪",
  open: "打开工作区",
  connecting: "正在建立加密连接…",
  cancel: "取消",
  retry: "重试",
  rename: "修改名称",
  remove: "移除显示",
  removeHint:
    "这只会移除账号中的设备记录，不会关闭该电脑的远程访问。要撤销访问，请在目标电脑上关闭远程访问。",
  removeConfirm: "移除设备显示",
  name: "设备名称",
  save: "保存",
  close: "关闭",
  addTitle: "添加一台电脑",
  step1: "在 Mac 上安装并打开 AnyWork 桌面端。账号远程访问当前支持 macOS。",
  step2: "登录与当前页面相同的账号。",
  step3:
    "工作区就绪后将默认尝试开启远程访问；如果已手动关闭，请在电脑上重新开启。",
  addFoot: "完成后，设备会出现在这里。电脑需要保持开机联网。",
  security: "业务内容只在你的设备间解密",
  securityText:
    "账号服务保存必要的账号与设备配置，连接服务交换必要连接信息。对话、文件和终端内容在设备间加密，设备私钥留在本机。",
  back: "返回我的设备",
  firstKey: "确认这台电脑的身份",
  changedKey: "这台电脑的公钥已改变",
  keyHint:
    "请核对工作电脑上显示的安全公钥。首次连接依赖账号目录的完整性；公钥变化可能来自客户端重启、重新安装或设备更换。",
  keyConfirm: "确认并连接",
  keyChecked: "我已在电脑端核对身份与公钥",
  more: "设备的更多操作",
  account: "账号选项",
  offlineHint: "请确认电脑开机联网，并在桌面端开启远程访问。",
  error: "暂时无法完成操作。请刷新或稍后重试。",
  directoryError: "暂时无法确认设备状态，请刷新重试。",
  accountError: "无法读取账号配置，请重新登录或稍后重试。",
  conflict: "配置已被其他设备更改，请刷新后重试。",
  invalidConfig: "账号服务配置不完整，请联系应用维护者。",
  loginError: "登录未完成，请重新登录。",
  connectError: "无法建立安全连接。请确认电脑在线、远程访问已开启，然后重试。",
  sessionExpired: "连接授权已过期，请返回设备页重新连接。",
};
const en: typeof zh = {
  devices: "My devices",
  guide: "Getting started",
  title: "Sign in",
  intro: "Sign in with the same account to connect to your work computer.",
  signIn: "Sign in",
  signUp: "Create account",
  accountHint:
    "Sign in to see your devices. Enter your password only on the secure account page.",
  localHint: "Want to access this computer remotely?",
  download: "Download desktop app",
  loading: "Loading…",
  signingIn: "Completing sign-in…",
  signOut: "Sign out",
  refresh: "Refresh",
  add: "Add device",
  subtitle: "Choose a computer and pick up where you left off.",
  emptyTitle: "Add your first computer",
  emptyText:
    "Install AnyWork on your Mac and sign in with this account. Remote access is attempted once your workspace is ready; you can turn it off on that computer.",
  online: "Online",
  offline: "Offline",
  unknown: "Status unavailable",
  newDevice: "Newly discovered device",
  unverified:
    "Device identity has not synced. Check the account settings on your computer.",
  unavailable: "Secure connection is not ready",
  open: "Open workspace",
  connecting: "Establishing encrypted connection…",
  cancel: "Cancel",
  retry: "Retry",
  rename: "Rename",
  remove: "Remove from list",
  removeHint:
    "This only removes the account's device record. It does not disable remote access on the computer. Disable remote access on that computer to revoke it.",
  removeConfirm: "Remove from device list",
  name: "Device name",
  save: "Save",
  close: "Close",
  addTitle: "Add a computer",
  step1:
    "Install and open AnyWork on your Mac. Account remote access currently supports macOS.",
  step2: "Sign in with the same account you use here.",
  step3:
    "Remote access is attempted once your workspace is ready. If you turned it off, enable it again on that computer.",
  addFoot:
    "Your device will appear here. Keep the computer powered on and connected.",
  security: "Your devices decrypt your work",
  securityText:
    "Account services store essential account and device settings; connection services exchange necessary connection information. Conversations, files and terminals are encrypted between your devices. Private device keys stay on the computer.",
  back: "Back to devices",
  firstKey: "Confirm this computer's identity",
  changedKey: "This computer's public key has changed",
  keyHint:
    "Compare this public key with the one shown on your work computer. First connection trusts your account directory; a changed key may mean a client restart, reinstall, or device replacement.",
  keyConfirm: "Confirm and connect",
  keyChecked: "I checked the identity and public key on this computer",
  more: "More device actions",
  account: "Account options",
  offlineHint:
    "Check that the computer is powered on and online with remote access enabled.",
  error: "The operation could not be completed. Refresh or try again later.",
  directoryError:
    "Device status is temporarily unavailable. Refresh to try again.",
  accountError: "Account settings are unavailable. Sign in again or try later.",
  conflict:
    "Another device changed these settings. Refresh before trying again.",
  invalidConfig:
    "Account service configuration is incomplete. Contact the application maintainer.",
  loginError: "Sign-in was not completed. Sign in again.",
  connectError:
    "A secure connection could not be established. Check that the computer is online with remote access enabled, then try again.",
  sessionExpired:
    "Connection authorization has expired. Return to devices to reconnect.",
};
export default function AccountApp() {
  if (isLocalEntry()) return <LocalApp />;
  let config: AccountConfig | null;
  try {
    config = resolveAccountConfig(import.meta.env);
  } catch {
    return (
      <div className="account-config-error" role="alert">
        账号服务配置无效 / Invalid account service configuration
      </div>
    );
  }
  if (!config) return <div role="alert">账号服务配置无效</div>;
  return (
    <AccountProvider config={config}>
      {location.pathname.replace(/\/$/, "").endsWith("/callback") ? (
        <Callback />
      ) : (
        <AccountHome config={config} />
      )}
    </AccountProvider>
  );
}
function useAccountAuth() {
  const context = useContext(LogtoContext)!;
  const client = context.logtoClient!;
  const methods = useMemo(
    () => ({
      getAccessToken: (resource?: string) =>
        client.getAccountAccessToken(resource),
      getFreshAccessToken: (resource?: string) =>
        client.getAccountAccessToken(resource, true),
      getIdTokenClaims: client.getIdTokenClaims.bind(client),
      signIn: client.startAccountSignIn.bind(client),
      signOut: client.endAccountSession.bind(client),
    }),
    [client],
  );
  return {
    ...methods,
    isAuthenticated: context.isAuthenticated,
    isLoading: context.isLoading,
  };
}
function Callback() {
  const { logtoClient, setIsAuthenticated } = useContext(LogtoContext)!;
  const [error, setError] = useState(false),
    started = useRef(false);
  useEffect(() => {
    if (!logtoClient || started.current) return;
    started.current = true;
    const callbackUrl = location.href;
    history.replaceState(null, "", "/app/callback");
    void (async () => {
      if (!(await logtoClient.isSignInRedirected(callbackUrl)))
        throw new AccountError("LOGIN_REQUIRED");
      await logtoClient.handleSignInCallback(callbackUrl);
      setIsAuthenticated(true);
      location.replace("/app/");
    })().catch(() => setError(true));
  }, [logtoClient, setIsAuthenticated]);
  return (
    <AccountSurface className="account-auth">
      <main className="account-auth-main">
        <Brand />
        <div className="account-loading" role="status">
          {error ? (
            <>
              登录未完成 / Sign-in incomplete.{" "}
              <a href="/app/">重新登录 / Try again</a>
            </>
          ) : (
            "正在完成登录 / Completing sign-in…"
          )}
        </div>
      </main>
    </AccountSurface>
  );
}
function AccountHome({ config }: { config: AccountConfig }) {
  const {
    isAuthenticated,
    isLoading,
    signIn,
    signOut,
    getAccessToken,
    getFreshAccessToken,
    getIdTokenClaims,
  } = useAccountAuth();
  const [locale, setLocale] = useState<"zh-CN" | "en">(initialLocale),
    t = locale === "zh-CN" ? zh : en;
  const [accountLabel, setAccountLabel] = useState(""),
    [deviceLabel, setDeviceLabel] = useState(""),
    [subject, setSubject] = useState<string>(),
    [profile, setProfile] = useState<AccountProfile>(),
    [devices, setDevices] = useState<Device[]>([]),
    [directoryState, setDirectoryState] = useState<
      "loading" | "ready" | "error"
    >("loading"),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [connection, setConnection] = useState<Connection | null>(null),
    [connecting, setConnecting] = useState<string>(),
    [dialog, setDialog] = useState<
      | { type: "add" }
      | {
          type: "rename" | "remove" | "key";
          id: string;
          device: DeviceRecord;
          changed?: boolean;
        }
    >(),
    [label, setLabel] = useState(""),
    [saving, setSaving] = useState(false),
    [keyChecked, setKeyChecked] = useState(false);
  const life = useRef(new AbortController()),
    connectController = useRef<AbortController | undefined>(undefined),
    transport = useRef<RemoteTransport | undefined>(undefined),
    gridRef = useRef<CyberGridClient | undefined>(undefined),
    trigger = useRef<HTMLElement | null>(null),
    dialogRef = useRef<HTMLDialogElement>(null),
    getToken = useRef(getAccessToken),
    getFreshToken = useRef(getFreshAccessToken);
  getToken.current = getAccessToken;
  getFreshToken.current = getFreshAccessToken;
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const checkedToken = useCallback(
    async (resource?: string, fresh = false) => {
      const before = await getIdTokenClaims();
      const expected = subjectRef.current;
      if (!expected || before?.sub !== expected)
        throw new AccountError("IDENTITY_CHANGED");
      const token = await (fresh
        ? getFreshToken.current(resource)
        : getToken.current(resource));
      const after = await getIdTokenClaims();
      if (subjectRef.current !== expected || after?.sub !== expected)
        throw new AccountError("IDENTITY_CHANGED");
      return token;
    },
    [getIdTokenClaims],
  );
  const store = useMemo(
    () => new AccountStore(config.endpoint, () => checkedToken()),
    [config.endpoint, checkedToken],
  );
  const identity = subject
    ? JSON.stringify([config.issuer, subject])
    : undefined;
  const friendly = (code: string) =>
    code === "CONFIGURATION_CONFLICT"
      ? t.conflict
      : code === "LOGIN_REQUIRED"
        ? t.loginError
        : code === "INVALID_ACCOUNT_DATA"
          ? t.accountError
          : t.error;
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem("anywork.account.locale", locale);
    } catch {
      /* optional */
    }
  }, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    setSubject(undefined);
    setProfile(undefined);
    setDevices([]);
    setConnection(null);
    transport.current?.close();
    if (isAuthenticated)
      void getIdTokenClaims()
        .then((claims) => {
          if (!controller.signal.aborted && claims?.sub) {
            setSubject(claims.sub);
            setAccountLabel(
              String(
                claims.name ||
                  claims.email ||
                  (locale === "zh-CN" ? "当前账号" : "Current account"),
              ),
            );
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(t.loginError);
        });
    return () => {
      controller.abort();
      connectController.current?.abort();
      transport.current?.close();
      void gridRef.current?.disconnect();
    };
  }, [isAuthenticated, config.issuer, getIdTokenClaims]);
  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController();
    setDirectoryState("loading");
    setError("");
    const grid = new CyberGridClient({
      baseUrl: config.gridUrl,
      issuer: config.issuer,
      clientId: config.appId,
      resource: config.resource,
      getAccessToken: ({ resource }) => checkedToken(resource),
    });
    gridRef.current = grid;
    void store
      .read(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setProfile(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t.accountError);
      });
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const settings = await store.read(controller.signal);
        if (!controller.signal.aborted) setProfile(settings);
        await grid.connect({ signal: controller.signal });
        const result = await grid.devices(config.nativeAppId, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setDevices(result);
          setDirectoryState("ready");
        }
      } catch {
        if (!controller.signal.aborted) setDirectoryState("error");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 20000);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      void grid.disconnect();
    };
  }, [
    identity,
    revision,
    config.gridUrl,
    config.issuer,
    config.appId,
    config.resource,
    config.nativeAppId,
    store,
    checkedToken,
  ]);
  useEffect(() => {
    const node = dialogRef.current;
    if (dialog) {
      setKeyChecked(false);
      trigger.current = document.activeElement as HTMLElement;
      node?.showModal();
      if (dialog.type === "key")
        node
          ?.querySelector<HTMLElement>(".account-dialog-actions button")
          ?.focus();
      else if (dialog.type === "rename")
        node?.querySelector<HTMLInputElement>("input")?.focus();
    } else {
      node?.close();
      trigger.current?.focus();
    }
  }, [dialog]);
  const closeConnection = useCallback(() => {
    connectController.current?.abort();
    const previous = transport.current;
    transport.current = undefined;
    previous?.close();
    setConnection(null);
    setConnecting(undefined);
  }, []);
  const login = async (signup = false) => {
    setError("");
    try {
      await signIn({
        redirectUri: location.origin + "/app/callback",
        ...(signup ? { interactionMode: "signUp" as const } : {}),
      });
    } catch {
      setError(t.loginError);
    }
  };
  const logout = async () => {
    life.current.abort();
    closeConnection();
    void gridRef.current?.disconnect();
    setProfile(undefined);
    setDevices([]);
    setSubject(undefined);
    try {
      await signOut(location.origin + "/app/");
    } catch {
      setError(t.loginError);
    }
  };
  useEffect(() => {
    const changed = () => {
      void getIdTokenClaims()
        .then((claims) => {
          if (claims?.sub !== subjectRef.current) {
            life.current.abort();
            closeConnection();
            setSubject(undefined);
            setProfile(undefined);
            setDevices([]);
            location.replace("/app/");
          }
        })
        .catch(() => {
          life.current.abort();
          closeConnection();
          location.replace("/app/");
        });
    };
    const listener = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key.startsWith("logto:" + accountStorageNamespace(config) + ":")
      )
        changed();
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [config.appId, config.issuer, getIdTokenClaims, closeConnection]);
  const signupStarted = useRef(false);
  useEffect(() => {
    if (
      !isLoading &&
      !isAuthenticated &&
      !signupStarted.current &&
      new URLSearchParams(location.search).get("signup") === "1"
    ) {
      signupStarted.current = true;
      void login(true);
    }
  }, [isLoading, isAuthenticated]);
  const pinKey = (id: string) =>
    "anywork.device-key." + JSON.stringify([config.issuer, subject, id]);
  const connect = async (
    id: string,
    device: DeviceRecord,
    confirmed = false,
  ) => {
    if (!identity || !subject) return;
    let pinned: string | null = null;
    try {
      pinned = localStorage.getItem(pinKey(id));
    } catch {
      /* verification still required */
    }
    if (!confirmed && pinned !== device.publicKey) {
      setDialog({ type: "key", id, device, changed: !!pinned });
      return;
    }
    connectController.current?.abort();
    const controller = new AbortController();
    const ownerSignal = life.current.signal;
    connectController.current = controller;
    setConnecting(id);
    setError("");
    try {
      const grid = gridRef.current;
      if (!grid || !device.gridDeviceId)
        throw new AccountError("DEVICE_NOT_READY");
      const url = await grid.getPortTunnelUrl(
        config.nativeAppId,
        device.gridDeviceId,
        "anywork-remote",
        { signal: controller.signal },
      );
      if (!url) throw new AccountError("DEVICE_NOT_READY");
      const accessToken = await checkedToken(config.resource, true);
      controller.signal.throwIfAborted();
      if (!accessToken) throw new AccountError("LOGIN_REQUIRED");
      const remote = await RemoteTransport.connect({
        url,
        installationId: id,
        publicKey: device.publicKey,
        accessToken,
        getFreshAccessToken: async () => {
          controller.signal.throwIfAborted();
          ownerSignal.throwIfAborted();
          const token = await checkedToken(config.resource, true);
          controller.signal.throwIfAborted();
          ownerSignal.throwIfAborted();
          return token;
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted || ownerSignal.aborted) {
        remote.close();
        return;
      }
      const c: Connection = {
        url,
        token: "",
        scope: JSON.stringify([config.issuer, subject, id]),
        transport: remote,
      };
      transport.current = remote;
      void remote.ended.then((reason) => {
        if (
          transport.current !== remote ||
          ownerSignal.aborted ||
          life.current.signal !== ownerSignal
        )
          return;
        transport.current = undefined;
        setConnection(null);
        setError(
          reason === "AUTHORIZATION_EXPIRED"
            ? t.sessionExpired
            : t.connectError,
        );
      });
      try {
        localStorage.setItem(pinKey(id), device.publicKey);
      } catch {
        /* keep in-memory trust for current session */
      }
      setDeviceLabel(device.label);
      setConnection(c);
    } catch {
      if (!controller.signal.aborted) setError(t.connectError);
    } finally {
      if (connectController.current === controller) setConnecting(undefined);
    }
  };
  const mutate = async () => {
    if (!dialog || dialog.type === "add" || dialog.type === "key") return;
    const active = dialog;
    const signal = life.current.signal;
    setSaving(true);
    setError("");
    try {
      const result = await store.update((data) => {
        if (active.type === "remove") delete data.devices[active.id];
        else {
          const device = data.devices[active.id];
          if (!device) throw new AccountError("CONFIGURATION_CONFLICT");
          device.label = label.trim();
        }
        return data;
      }, signal);
      if (!signal.aborted && life.current.signal === signal) {
        setProfile(result);
        setDialog(undefined);
      }
    } catch (e) {
      if (!signal.aborted && life.current.signal === signal)
        setError(friendly(e instanceof AccountError ? e.code : ""));
    } finally {
      setSaving(false);
    }
  };
  if (connection)
    return (
      <App
        key={connection.scope}
        initial={connection}
        deviceLabel={deviceLabel}
        accountLabel={accountLabel}
        onDisconnect={closeConnection}
        onDevices={closeConnection}
        onSignOut={() => void logout()}
        contextLabel={`${deviceLabel} · ${accountLabel}`}
        disconnectLabel="返回我的设备"
      />
    );
  const records = profile?.anywork.devices ?? {};
  const matched = new Set(
    Object.values(records)
      .map((device) => device.gridDeviceId)
      .filter(Boolean),
  );
  const unknown = devices.filter((device) => !matched.has(device.id));
  const empty = Boolean(
    profile &&
    directoryState === "ready" &&
    Object.keys(records).length === 0 &&
    unknown.length === 0,
  );
  const utilities = (
    <AccountUtilities
      locale={locale}
      onLocale={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
    />
  );
  return (
    <AccountSurface
      className={
        isAuthenticated && !isLoading ? "account-devices" : "account-auth"
      }
    >
      {isLoading ? (
        <main className="account-auth-main">
          <Brand />
          <p className="account-loading" role="status">
            {t.loading}
          </p>
        </main>
      ) : !isAuthenticated ? (
        <main className="account-auth-main account-welcome">
          <Brand />
          <h1>{t.title}</h1>
          <p className="account-auth-description">{t.intro}</p>
          <div className="account-login-actions">
            <button className="account-primary" onClick={() => void login()}>
              {t.signIn}
              <ArrowUpRight size={16} />
            </button>
            <button onClick={() => void login(true)}>{t.signUp}</button>
          </div>
          <p className="account-small">{t.accountHint}</p>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <a
            className="account-download"
            href={locale === "zh-CN" ? "/zh/#download" : "/en/#download"}
          >
            {t.download}
            <ArrowUpRight size={15} />
          </a>
          {utilities}
          <div className="account-source-links">
            <a href="/source">{locale === "zh-CN" ? "对应源码" : "Source"}</a>
            <a href="https://github.com/ywateru/AnyWork">GitHub</a>
          </div>
        </main>
      ) : (
        <div className="account-shell">
          <DeviceNavigation label={t.devices}>
            {utilities}
            <details className="account-user-menu" data-floating-menu>
              <summary aria-label={t.account}>
                <span className="account-avatar">
                  {(accountLabel || "A").slice(0, 1)}
                </span>
                <span>{accountLabel}</span>
                <ChevronsUpDown size={15} />
              </summary>
              <div className="account-user-options">
                <p>{accountLabel}</p>
                <button onClick={() => void logout()}>
                  <LogOut size={15} />
                  {t.signOut}
                </button>
              </div>
            </details>
            <div className="account-source-links">
              <a href="/source">{locale === "zh-CN" ? "对应源码" : "Source"}</a>
              <a href="https://github.com/ywateru/AnyWork">GitHub</a>
            </div>
          </DeviceNavigation>
          <div className="account-page">
            <header className="account-page-heading">
              <h1>{t.devices}</h1>
              <div className="account-page-actions">
                <button
                  disabled={directoryState === "loading" || !!connecting}
                  onClick={() => setRevision((value) => value + 1)}
                >
                  <RefreshCw size={15} />
                  {t.refresh}
                </button>
                {profile && !empty && (
                  <button
                    className="account-primary"
                    disabled={!!connecting}
                    onClick={() => setDialog({ type: "add" })}
                  >
                    <Plus size={16} />
                    {t.add}
                  </button>
                )}
              </div>
            </header>
            <main className="account-main">
              {!empty && (
                <p className="account-page-description">{t.subtitle}</p>
              )}
              {error && (
                <p role="alert" className="account-error">
                  {error}
                </p>
              )}
              {directoryState === "error" && (
                <p role="status" className="account-warning">
                  {t.directoryError}
                </p>
              )}
              {!profile && (error || directoryState === "error") ? (
                <div className="account-empty">
                  <p>{t.accountError}</p>
                  <button onClick={() => setRevision((value) => value + 1)}>
                    {t.retry}
                  </button>
                </div>
              ) : !profile || directoryState === "loading" ? (
                <p role="status" className="account-loading">
                  {t.loading}
                </p>
              ) : empty ? (
                <div className="account-empty">
                  <h2>{t.emptyTitle}</h2>
                  <p>{t.emptyText}</p>
                  <button
                    className="account-primary"
                    onClick={() => setDialog({ type: "add" })}
                  >
                    <Plus size={16} />
                    {t.add}
                  </button>
                </div>
              ) : (
                <ul className="account-device-list">
                  {Object.entries(records).map(([id, device]) => {
                    const live = devices.find(
                        (item) => item.id === device.gridDeviceId,
                      ),
                      online = directoryState === "ready" && live?.online,
                      ready =
                        online &&
                        live.ports.some(
                          (port) =>
                            port.id === "anywork-remote" &&
                            port.type === "anywork-noise-v1" &&
                            port.tunnelUrl,
                        );
                    return (
                      <li className="account-device" key={id}>
                        <Laptop
                          className="account-device-icon"
                          size={23}
                          strokeWidth={1.5}
                        />
                        <div className="account-device-info">
                          <h2>{device.label}</h2>
                          <p>
                            {device.platform}
                            <span
                              className={
                                online
                                  ? "account-state online"
                                  : "account-state"
                              }
                            >
                              <i />
                              {directoryState === "error"
                                ? t.unknown
                                : online
                                  ? t.online
                                  : t.offline}
                            </span>
                          </p>
                          {!online && directoryState !== "error" && (
                            <small>{t.offlineHint}</small>
                          )}
                        </div>
                        <div className="account-device-open">
                          {connecting === id ? (
                            <>
                              <span role="status">{t.connecting}</span>
                              <button
                                onClick={() => {
                                  connectController.current?.abort();
                                  setConnecting(undefined);
                                }}
                              >
                                {t.cancel}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="account-primary"
                                disabled={!ready || !!connecting}
                                onClick={() => void connect(id, device)}
                              >
                                {t.open}
                                <ArrowUpRight size={15} />
                              </button>
                              {online && !ready && (
                                <small>{t.unavailable}</small>
                              )}
                            </>
                          )}
                        </div>
                        <details
                          className="account-device-menu"
                          data-floating-menu
                        >
                          <summary
                            aria-label={`${device.label} — ${t.more}`}
                            aria-disabled={!!connecting}
                            onClick={(event) => {
                              if (connecting) event.preventDefault();
                            }}
                          >
                            <MoreHorizontal size={18} />
                          </summary>
                          <div className="account-device-settings">
                            <button
                              disabled={!!connecting}
                              onClick={() => {
                                setLabel(device.label);
                                setDialog({ type: "rename", id, device });
                              }}
                            >
                              {t.rename}
                            </button>
                            <button
                              disabled={!!connecting}
                              onClick={() =>
                                setDialog({ type: "remove", id, device })
                              }
                            >
                              {t.remove}
                            </button>
                          </div>
                        </details>
                      </li>
                    );
                  })}
                  {unknown.map((device) => (
                    <li className="account-device" key={device.id}>
                      <Laptop className="account-device-icon" size={23} />
                      <div className="account-device-info">
                        <h2>{device.name}</h2>
                        <p>{t.newDevice}</p>
                        <small>{t.unverified}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <details className="account-privacy">
                <summary>
                  <ShieldCheck size={16} />
                  {t.security}
                </summary>
                <p>{t.securityText}</p>
              </details>
            </main>
          </div>
        </div>
      )}
      <dialog
        className="account-dialog"
        ref={dialogRef}
        onCancel={(event) => {
          if (saving) event.preventDefault();
          else setDialog(undefined);
        }}
        onClick={(event) => {
          if (!saving && event.target === event.currentTarget)
            setDialog(undefined);
        }}
      >
        <div className="account-dialog-heading">
          <h2>
            {dialog?.type === "add"
              ? t.addTitle
              : dialog?.type === "rename"
                ? t.rename
                : dialog?.type === "remove"
                  ? t.removeConfirm
                  : dialog?.type === "key"
                    ? dialog.changed
                      ? t.changedKey
                      : t.firstKey
                    : ""}
          </h2>
          <button
            disabled={saving}
            aria-label={t.close}
            onClick={() => setDialog(undefined)}
          >
            <X size={19} />
          </button>
        </div>
        {dialog?.type === "add" ? (
          <>
            <ol>
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3}</li>
            </ol>
            <p>{t.addFoot}</p>
            <a
              className="account-primary"
              href={locale === "zh-CN" ? "/zh/#download" : "/en/#download"}
            >
              {t.download}
            </a>
          </>
        ) : dialog?.type === "key" ? (
          <>
            <p>{t.keyHint}</p>
            <code className="account-device-key">
              {dialog.device.publicKey}
            </code>
            <label className="account-key-check">
              <input
                type="checkbox"
                checked={keyChecked}
                onChange={(event) => setKeyChecked(event.target.checked)}
              />
              {t.keyChecked}
            </label>
            <div className="account-dialog-actions">
              <button autoFocus onClick={() => setDialog(undefined)}>
                {t.cancel}
              </button>
              <button
                className="account-primary"
                disabled={!keyChecked}
                onClick={() => {
                  if (!keyChecked) return;
                  const active = dialog;
                  setDialog(undefined);
                  void connect(active.id, active.device, true);
                }}
              >
                <Check size={16} />
                {t.keyConfirm}
              </button>
            </div>
          </>
        ) : (
          dialog && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate();
              }}
            >
              {dialog.type === "rename" ? (
                <label>
                  {t.name}
                  <input
                    autoFocus
                    value={label}
                    maxLength={80}
                    required
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
              ) : (
                <p>{t.removeHint}</p>
              )}
              {error && (
                <p className="account-error" role="alert">
                  {error}
                </p>
              )}
              <div className="account-dialog-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setDialog(undefined)}
                >
                  {t.cancel}
                </button>
                <button
                  className="account-primary"
                  disabled={
                    saving || (dialog.type === "rename" && !label.trim())
                  }
                >
                  {dialog.type === "rename" ? t.save : t.removeConfirm}
                </button>
              </div>
            </form>
          )
        )}
      </dialog>
    </AccountSurface>
  );
}
