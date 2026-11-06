import { RunningStatus } from "./components/harness/RunningStatus";
import { version as appVersion } from "../package.json";
import NotificationCenter from "./components/NotificationCenter";
import { useSessionNotifications } from "./hooks/useSessionNotifications";
import type { ComposerAttachment } from "./imageAnnotations";
import SubagentsPanel from "./components/SubagentsPanel";
import SubagentConversation from "./components/SubagentConversation";
import { projectSubagents, type SubagentEntry } from "./subagents";
import { ActivityNavigationContext } from "./components/ActivityList";
import type {
  ComposerDocument,
  ComposerSubmission,
} from "./composerSubmission";
import type { PromptEditorHandle } from "./components/conversation/PromptEditor";
import { GoalEditor } from "./components/conversation/GoalBanner";
import SplitPane from "./components/conversation/SplitPane";
import { useConversationPanels } from "./hooks/useConversationPanels";
import { useFloatingMenus } from "./hooks/useFloatingMenus";
import { useSidebarAgent } from "./hooks/useSidebarAgent";
import SidebarAgentFilter from "./components/SidebarAgentFilter";
import AgentIcon from "./components/AgentIcon";
import { agentName } from "./sidebarAgents";
import { sessionAgentSelection } from "./sessionAgentSelection";
import { useSessionDraft } from "./hooks/useSessionDraft";
import { useGoalComposerMode } from "./hooks/useGoalComposerMode";
import { useMessageEditing } from "./hooks/useMessageEditing";
import { appendPromptHistory } from "./promptHistory";
import Composer from "./components/conversation/Composer";
import ComposerAccess from "./components/ComposerAccess";
import ThreadLinkNavigation from "./components/ThreadLinkNavigation";
import ReviewPanel from "./components/ReviewPanel";
import type { ReviewRequest } from "./reviewDiff";
import {
  routeThreadTarget,
  sessionReviewRoute,
  sessionReviewTarget,
} from "./threadLinks";
import MessageQueue, {
  type QueuedMessage,
} from "./components/conversation/MessageQueue";
import MessageView from "./components/conversation/ConversationMessage";
import ConversationHistory from "./components/conversation/ConversationHistory";
import { useSessionHistory } from "./hooks/useSessionHistory";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  TerminalSquare,
  Settings,
  Plus,
  FolderOpen,
  GitBranch,
  Flag,
  Menu,
  ArrowUpRight,
  Sun,
  Moon,
  Archive,
  Download,
  Trash2,
  X,
  LogOut,
  Check,
  RefreshCw,
  Bell,
  ShieldCheck,
  PanelLeft,
  PanelRightClose,
} from "lucide-react";
import { Api } from "./api";
import type {
  Session,
  Plugin,
  Connection,
  AgentEvent,
  WorkspaceInfo,
} from "./types";
import { projectEvents } from "./events";
import { workingActivity } from "./toolPresentation";
import { conversationTimestampSeparators } from "./messageTime";
import TurnView from "./components/TurnView";
import type { FileTarget } from "./fileLinks";
import { Button } from "./components/ui/button";
import RequestCard from "./components/RequestCard";
import Workspace from "./components/Workspace";
import SessionSidebar from "./components/SessionSidebar";
import SessionTabs from "./components/SessionTabs";
import NavigationHeader, {
  type GroupMode,
} from "./components/NavigationHeader";
import Overview from "./components/Overview";
import ImagePreview from "./components/ImagePreview";
import { useAppearance } from "./appearance";
import { Settings as SettingsPanel } from "./components/Settings";
const Terminal = lazy(() => import("./components/Terminal"));
const statusNames: Record<string, string> = {
  idle: "待命",
  running: "执行中",
  waiting: "等待回应",
  starting: "连接中",
  error: "异常",
  disconnected: "待恢复",
  external: "运行状态未知",
};
const initialConnection = () => {
  try {
    const native = (window as any).RemoteAgentAndroid?.getConnection?.();
    if (native) return JSON.parse(native) as Connection | null;
    return JSON.parse(
      localStorage.getItem("ra.connection") || "null",
    ) as Connection | null;
  } catch {
    return null;
  }
};

function queueAttachmentName(path: string, sessionId: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  const name = parts.at(-1) || path;
  // files::upload stores this session's uploads as <UUID v4>-<original name>.
  // Ordinary workspace files retain their complete basename.
  return parts.at(-3) === "uploads" && parts.at(-2) === sessionId
    ? name.replace(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-(?=.)/i,
        "",
      )
    : name;
}

function chatLocation() {
  const route = location.hash.slice(1);
  return sessionReviewTarget(route) ?? { id: route, review: undefined };
}
export default function App() {
  const [connection, setConnection] = useState<Connection | null>(
      initialConnection,
    ),
    [sessions, setSessions] = useState<Session[]>([]),
    [sessionsLoadedFor, setSessionsLoadedFor] = useState<Api | null>(null),
    [sessionsErrorFor, setSessionsErrorFor] = useState<Api | null>(null),
    [plugins, setPlugins] = useState<Plugin[]>([]),
    [pluginsLoadedFor, setPluginsLoadedFor] = useState<Api | null>(null),
    [pluginsErrorFor, setPluginsErrorFor] = useState<Api | null>(null),
    [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]),
    [createCwd, setCreateCwd] = useState(""),
    [models, setModels] = useState<
      { model: string; displayName?: string; isDefault?: boolean }[]
    >([]),
    [info, setInfo] = useState({
      workspace: "",
      hostname: "",
      client_presence: false,
    }),
    [selected, setSelected] = useState(chatLocation().id),
    [controlsRevision, setControlsRevision] = useState(0),
    [error, setError] = useState(""),
    [modal, setModal] = useState<"create" | "settings" | null>(null),
    [sidebar, setSidebar] = useState(false),
    [goalRevision, setGoalRevision] = useState(0),
    [filter, setFilter] = useState(""),
    [projectFilter, setProjectFilter] = useState(""),
    [groupMode, setGroupMode] = useState<GroupMode>(() =>
      localStorage.getItem("ra.group-mode-v2") === "status"
        ? "status"
        : "directory",
    ),
    [sidebarPinned, setSidebarPinned] = useState(
      () => localStorage.getItem("ra.sidebar-pinned") !== "false",
    ),
    [archived, setArchived] = useState(false),
    [attachments, setAttachments] = useState<ComposerAttachment[]>([]),
    [sending, setSending] = useState(false),
    [uploading, setUploading] = useState(0);
  const { appearance, setAppearance, theme, toggleTheme } = useAppearance();
  const serverKey = connection?.url || "";
  const [sidebarAgent, setSidebarAgent] = useSidebarAgent(serverKey);
  const panels = useConversationPanels(serverKey, selected);
  const { tab, setTab, fileTarget } = panels;
  const api = useMemo(
    () => (connection ? new Api(connection) : null),
    [connection],
  );
  const session = sessions.find((s) => s.id === selected);
  const notifications = useSessionNotifications(
    serverKey,
    sessions,
    selected,
    (id) => {
      select(id);
      setModal(null);
      panels.setTab("chat");
    },
  );
  const { cache: historyCache, snapshot: cachedHistory } = useSessionHistory(
    api,
    sessions,
    selected,
    (event) => {
      if (
        event.method === "thread/settings/updated" ||
        event.request_id != null ||
        [
          "turn/started",
          "turn/completed",
          "serverRequest/resolved",
          "thread/status/changed",
          "plugin/exited",
        ].includes(event.method)
      ) {
        void reload().catch(() => {});
      }
      notifications.receive(event);
    },
  );
  const events = cachedHistory.events,
    controlEvents = cachedHistory.controls,
    historySession = selected,
    historyLoading = cachedHistory.loading,
    historyError = cachedHistory.loaded ? "" : cachedHistory.error,
    historyNotice =
      cachedHistory.notice ||
      (cachedHistory.loaded && cachedHistory.error
        ? "暂时无法同步最新消息，正在显示缓存。"
        : ""),
    historyCursor = cachedHistory.cursor,
    olderLoading = cachedHistory.olderLoading,
    olderError = cachedHistory.olderError,
    streaming = cachedHistory.streaming,
    controlNotice = cachedHistory.controlNotice;
  const [subagentSelection, setSubagentSelection] = useState<{
    scope: string;
    threadId: string;
    name: string;
  } | null>(null);
  const subagentScope = JSON.stringify([serverKey, selected]);
  const subagents = useMemo(
    () => projectSubagents([...events, ...controlEvents], sessions, selected),
    [events, controlEvents, sessions, selected],
  );
  const openSubagent = (threadId: string, name: string) => {
    setSubagentSelection({ scope: subagentScope, threadId, name });
    panels.setTab("subagents");
  };
  const selectedSubagent: SubagentEntry | null =
    subagentSelection?.scope === subagentScope
      ? subagents.find(
          (agent) => agent.threadId === subagentSelection.threadId,
        ) || {
          threadId: subagentSelection.threadId,
          sessionId:
            sessions.find((s) => s.thread_id === subagentSelection.threadId)
              ?.id || null,
          name: subagentSelection.name,
          status: "unknown",
          preview: null,
          objective: null,
          startedAtMs: null,
          updatedAtMs: null,
          model: null,
          reasoningEffort: null,
          canInteract: false,
        }
      : null;

  useFloatingMenus(JSON.stringify([serverKey, selected]));
  const [draft, setDraft] = useSessionDraft(serverKey, selected);
  const [reviewRequest, setReviewRequest] = useState<{
    sessionId: string;
    request: ReviewRequest;
  } | null>(() => {
    const route = chatLocation();
    return route.review ? { sessionId: route.id, request: route.review } : null;
  });
  const openFile = useCallback(
    (target: FileTarget) => {
      const cwd = sessions.find((item) => item.id === selected)?.cwd || "";
      const absolute = target.path.startsWith("/")
        ? target.path
        : `${cwd}/${target.path}`;
      const parts: string[] = [];
      for (const part of absolute.split("/")) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
      }
      const next = { ...target, path: "/" + parts.join("/") };
      if (chatLocation().id === selected && chatLocation().review) {
        location.hash = sessionReviewRoute(selected);
        setReviewRequest(null);
      }
      panels.openFile(next);
    },
    [sessions, selected, panels.openFile],
  );
  const view = useMemo(
      () => projectEvents([...events, ...controlEvents]),
      [events, controlEvents],
    ),
    turnTimestamps = useMemo(
      () => conversationTimestampSeparators(view.turns),
      [view.turns],
    ),
    bottom = useRef<HTMLDivElement>(null),
    chatScroll = useRef<HTMLDivElement>(null),
    previousScroll = useRef(0),
    preserveScroll = useRef<{
      top: number;
      height: number;
      anchorId?: string;
      anchorTop?: number;
    } | null>(null),
    attachmentUrls = useRef(new Set<string>()),
    activeUploads = useRef(new Set<AbortController>()),
    restoredHistory = useRef(false),
    stick = useRef(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const uploads = activeUploads.current;
    return () => {
      for (const controller of uploads) controller.abort();
    };
  }, [api, selected]);
  useEffect(() => {
    const retained = new Set(attachments.map((a) => a.preview).filter(Boolean));
    for (const url of attachmentUrls.current)
      if (!retained.has(url)) {
        URL.revokeObjectURL(url);
        attachmentUrls.current.delete(url);
      }
  }, [attachments]);
  useEffect(() => {
    const urls = attachmentUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  useEffect(() => {
    const hash = (event: HashChangeEvent) => {
        const route = chatLocation();
        setSelected(route.id);
        setReviewRequest(
          route.review ? { sessionId: route.id, request: route.review } : null,
        );
        if (route.review) setTab("git", route.id);
        else {
          const previous = new URL(event.oldURL).hash.slice(1);
          const previousReview = sessionReviewTarget(previous);
          if (
            previousReview?.id === route.id ||
            routeThreadTarget(previous)?.review
          )
            setTab(
              (current) => (current === "git" ? "chat" : current),
              route.id,
            );
        }
      },
      share = (e: Event) => {
        setDraft((e as CustomEvent<string>).detail);
        setTab("chat");
      };
    window.addEventListener("hashchange", hash);
    window.addEventListener("remote-agent-share", share);
    return () => {
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("remote-agent-share", share);
    };
  }, [setDraft, setTab]);
  useEffect(() => {
    const route = chatLocation();
    if (route.id === selected && route.review) setTab("git", selected);
  }, [serverKey, selected, setTab]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const reloading = useRef<Api | null>(null);
  const currentApi = useRef(api);
  currentApi.current = api;
  const [statusFresh, setStatusFresh] = useState(false);
  const reload = useCallback(async () => {
    if (!api || reloading.current === api) return;
    reloading.current = api;
    try {
      const data = await api.request("/sessions");
      if (currentApi.current !== api) return;
      const target = selectedRef.current;
      if (target && data.sessions.some((s: Session) => s.id === target)) {
        const result = await api
          .request(`/sessions/${target}`)
          .catch(() => null);
        if (currentApi.current !== api) return;
        if (selectedRef.current === target) {
          setStatusFresh(!!result);
          if (result)
            data.sessions = data.sessions.map((s: Session) =>
              s.id === target ? result.session : s,
            );
        }
      }
      setSessions(data.sessions);
      setSessionsLoadedFor(api);
      setSessionsErrorFor(null);
      if (data.discovery_error) fail(new Error(data.discovery_error));
      const directories = await api.request("/workspaces");
      if (currentApi.current !== api) return;
      setWorkspaces(directories.workspaces);
    } catch (e) {
      if (currentApi.current !== api) return;
      setSessionsErrorFor(api);
      setStatusFresh(false);
      throw e;
    } finally {
      if (reloading.current === api) reloading.current = null;
    }
  }, [api, fail]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .request("/info")
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(fail);
    api
      .request("/plugins")
      .then((data) => {
        if (!cancelled) {
          setPlugins(data.plugins);
          setPluginsLoadedFor(api);
          setPluginsErrorFor(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPluginsErrorFor(api);
          fail(error);
        }
      });
    reload().catch(fail);
    const timer = setInterval(() => reload().catch(() => {}), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, reload, fail]);
  useEffect(() => {
    if (!api || !info.client_presence) return;
    const heartbeat = () => {
      if (document.visibilityState === "visible")
        api.post("/clients/heartbeat").catch(() => {});
    };
    heartbeat();
    const timer = setInterval(heartbeat, 25000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [api, info.client_presence]);
  useEffect(() => {
    setModels([]);
    if (
      !api ||
      !selected ||
      !session ||
      routeThreadTarget(selected) ||
      session.external
    )
      return;
    let cancelled = false;
    api
      .request(`/sessions/${selected}/models`)
      .then((data) => {
        if (!cancelled) setModels(data.data || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, selected, session?.external]);
  useLayoutEffect(() => {
    setAttachments([]);
    preserveScroll.current = null;
    restoredHistory.current = false;
    stick.current = true;
  }, [api, selected]);
  useEffect(() => {
    if (refresh && selected) historyCache?.retry(selected);
  }, [refresh, historyCache]);
  useEffect(() => {
    void reload().catch(fail);
  }, [selected, api, reload, fail]);
  async function loadOlder() {
    const id = selected;
    await historyCache?.loadOlder(id, () => {
      if (selectedRef.current !== id) return;
      const el = chatScroll.current;
      if (el) {
        const viewportTop = el.getBoundingClientRect().top;
        const anchor = Array.from(
          el.querySelectorAll<HTMLElement>("[data-message-id]"),
        ).find((node) => node.getBoundingClientRect().bottom > viewportTop);
        preserveScroll.current = {
          top: el.scrollTop,
          height: el.scrollHeight,
          anchorId: anchor?.dataset.messageId,
          anchorTop: anchor?.getBoundingClientRect().top,
        };
      }
      stick.current = false;
    });
  }
  useLayoutEffect(() => {
    const el = chatScroll.current,
      position = preserveScroll.current;
    if (el && position) {
      const restore = () => {
        const anchor = Array.from(
          el.querySelectorAll<HTMLElement>("[data-message-id]"),
        ).find((node) => node.dataset.messageId === position.anchorId);
        el.scrollTop =
          anchor && position.anchorTop !== undefined
            ? el.scrollTop +
              anchor.getBoundingClientRect().top -
              position.anchorTop
            : position.top + el.scrollHeight - position.height;
        previousScroll.current = el.scrollTop;
      };
      restore();
      preserveScroll.current = null;
      restoredHistory.current = true;
      // Newly mounted user messages measure and collapse in a layout effect.
      // Restore once more after those nested commits, before the next paint.
      const frame = requestAnimationFrame(restore);
      return () => cancelAnimationFrame(frame);
    }
  }, [events]);
  useEffect(() => {
    // Restoring a history anchor can leave the reader close to the bottom.
    // Do not let the normal live-message effect override that position.
    if (restoredHistory.current) {
      restoredHistory.current = false;
      return;
    }
    if (stick.current && !historyLoading)
      bottom.current?.scrollIntoView({ behavior: "instant" });
  }, [events, tab, historyLoading]);
  function select(id: string, review?: ReviewRequest) {
    location.hash = sessionReviewRoute(id, review);
    setSelected(id);
    setSidebar(false);
    if (review) setTab("git", id);
    setReviewRequest(review ? { sessionId: id, request: review } : null);
    setError("");
  }
  async function patch(data: object) {
    if (!api || !session) return;
    try {
      await api.request(`/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await reload();
    } catch (e) {
      fail(e);
    }
  }
  const [queue, setQueue] = useState<{
    items: QueuedMessage[];
    paused: boolean;
    editing?: QueuedMessage | null;
  }>({ items: [], paused: false });
  type QueueDraft = {
    item: QueuedMessage;
    previousDraft: string;
    previousComposer?: ComposerDocument;
    previousGoalMode?: boolean;
    goalMode?: boolean;
    previousAttachments: { name: string; path: string }[];
    attachments: { name: string; path: string }[];
  };
  const [queueDraft, setQueueDraft] = useState<QueueDraft | null>(null);
  const [goalMode, setGoalMode] = useGoalComposerMode(
    serverKey,
    selected || "",
  );
  const queueDraftRef = useRef(queueDraft);
  queueDraftRef.current = queueDraft;
  const composerSnapshot = useRef({ draft, attachments, goalMode });
  composerSnapshot.current = { draft, attachments, goalMode };
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const composerEditor = useRef<PromptEditorHandle>(null);
  const [restoredComposer, setRestoredComposer] = useState<{
    sessionId: string;
    composer?: ComposerDocument;
  } | null>(null);
  const queueDraftKey = `anywork.queue-edit.${JSON.stringify([serverKey, selected])}`;
  const [queueingEnabled, setQueueingEnabled] = useState(() => {
    try {
      return localStorage.getItem("anywork.follow-up-mode") !== "steer";
    } catch {
      return true;
    }
  });
  function toggleQueueing() {
    const enabled = !queueingEnabled;
    setQueueingEnabled(enabled);
    try {
      localStorage.setItem(
        "anywork.follow-up-mode",
        enabled ? "queue" : "steer",
      );
    } catch {
      /* Browser storage can be unavailable. */
    }
  }
  function saveQueueDraft(value: QueueDraft | null) {
    queueDraftRef.current = value;
    setQueueDraft(value);
    try {
      if (value) sessionStorage.setItem(queueDraftKey, JSON.stringify(value));
      else sessionStorage.removeItem(queueDraftKey);
    } catch {
      /* In-memory editing still works. */
    }
  }
  function acceptQueue(data: typeof queue) {
    setQueue(data);
    if (data.editing && queueDraftRef.current?.item.id !== data.editing.id) {
      let saved: QueueDraft | null = null;
      try {
        const value = JSON.parse(
          sessionStorage.getItem(queueDraftKey) || "null",
        );
        if (
          value?.item?.id === data.editing.id &&
          typeof value.previousDraft === "string" &&
          Array.isArray(value.attachments) &&
          value.attachments.every(
            (file: { name?: unknown; path?: unknown } | null) =>
              file &&
              typeof file.name === "string" &&
              typeof file.path === "string",
          ) &&
          Array.isArray(value.previousAttachments) &&
          value.previousAttachments.every(
            (file: { name?: unknown; path?: unknown } | null) =>
              file &&
              typeof file.name === "string" &&
              typeof file.path === "string",
          )
        )
          saved = value;
      } catch {
        /* Restore from the server's saved item if browser storage is gone. */
      }
      // A recovered server edit must never replace a newer, unrelated draft.
      if (
        !saved &&
        (composerSnapshot.current.draft ||
          composerSnapshot.current.goalMode ||
          composerSnapshot.current.attachments.length)
      ) {
        if (!queueInFlight.current && !sendInFlight.current)
          void queueAction({ action: "restore", id: data.editing.id });
        return;
      }
      const restored = saved || {
        item: data.editing,
        previousDraft: composerSnapshot.current.draft,
        previousGoalMode: composerSnapshot.current.goalMode,
        previousAttachments: composerSnapshot.current.attachments.map(
          ({ name, path }) => ({ name, path }),
        ),
        attachments: data.editing.attachments.map((path) => ({
          path,
          name: queueAttachmentName(path, selected || ""),
        })),
      };
      saveQueueDraft(restored);
      if (!saved)
        setDraft(data.editing.composer?.markdown ?? data.editing.text);
      setAttachments(restored.attachments);
      setGoalMode(
        saved ? (saved.goalMode ?? !!saved.item.goal) : !!data.editing.goal,
      );
    } else if (!data.editing && queueDraftRef.current) saveQueueDraft(null);
  }
  const [queueWorking, setQueueWorking] = useState(false);
  const queueScope = useRef(0),
    queueRevision = useRef(0),
    queueInFlight = useRef(false),
    sendInFlight = useRef(false);
  useEffect(() => {
    const scope = ++queueScope.current;
    queueRevision.current++;
    queueInFlight.current = false;
    sendInFlight.current = false;
    queueDraftRef.current = null;
    setQueueDraft(null);
    setQueueWorking(false);
    setSending(false);
    setQueue({ items: [], paused: false });
    if (!api || !selected || routeThreadTarget(selected)) return;
    const controller = new AbortController();
    let request = 0;
    const load = () => {
      const revision = queueRevision.current,
        sequence = ++request;
      return api
        .request(`/sessions/${selected}/queue`, { signal: controller.signal })
        .then((data) => {
          if (
            !controller.signal.aborted &&
            queueScope.current === scope &&
            sequence === request &&
            revision === queueRevision.current &&
            !queueInFlight.current
          )
            acceptQueue(data);
        })
        .catch(() => {});
    };
    void load();
    const timer = setInterval(load, 1500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, selected]);
  useEffect(() => {
    if (!queueDraft || queueDraftRef.current !== queueDraft) return;
    try {
      sessionStorage.setItem(
        queueDraftKey,
        JSON.stringify({
          ...queueDraft,
          goalMode,
          attachments: attachments.map(({ name, path }) => ({ name, path })),
        }),
      );
    } catch {
      /* In-memory editing remains available. */
    }
  }, [queueDraft, attachments, goalMode, queueDraftKey]);
  function canEditQueuedMessage(item: QueuedMessage | undefined) {
    return (
      !!api &&
      !!session &&
      !session.archived &&
      !queueInFlight.current &&
      !sendInFlight.current &&
      !messageEditing.submitting &&
      uploading === 0 &&
      !queueDraftRef.current &&
      item?.status === "pending"
    );
  }
  function recallQueuedMessage() {
    const item = queue.items.at(-1);
    if (
      !item ||
      !canEditQueuedMessage(item) ||
      composerEditor.current?.hasContent() ||
      attachments.length > 0
    )
      return false;
    void editQueuedMessage(item);
    return true;
  }
  async function editQueuedMessage(item: QueuedMessage) {
    if (!api || !session || !canEditQueuedMessage(item)) return;
    const current = composerSnapshot.current,
      sessionId = session.id,
      scope = queueScope.current;
    queueInFlight.current = true;
    queueRevision.current++;
    setQueueWorking(true);
    try {
      const removed = await api.post<typeof queue>(
        `/sessions/${sessionId}/queue`,
        { action: "take", id: item.id },
      );
      const fresh = composerSnapshot.current;
      if (
        queueScope.current !== scope ||
        selectedRef.current !== sessionId ||
        fresh.draft !== current.draft ||
        fresh.goalMode !== current.goalMode ||
        fresh.attachments !== current.attachments
      ) {
        const restored = await api.post<typeof queue>(
          `/sessions/${sessionId}/queue`,
          { action: "restore", id: item.id },
        );
        if (queueScope.current === scope && selectedRef.current === sessionId)
          setQueue(restored);
        return;
      }
      if (!removed.editing || removed.editing.id !== item.id)
        throw new Error("排队消息未能移入编辑器，请重试。");
      const editable = removed.editing;
      setQueue(removed);
      const restoredAttachments = editable.attachments.map((path) => ({
        path,
        name: queueAttachmentName(path, sessionId),
      }));
      saveQueueDraft({
        item: editable,
        previousDraft: current.draft,
        previousComposer: composerEditor.current?.getSubmission().composer,
        previousGoalMode: current.goalMode,
        goalMode: !!editable.goal,
        previousAttachments: current.attachments.map(({ name, path }) => ({
          name,
          path,
        })),
        attachments: restoredAttachments,
      });
      setDraft(editable.composer?.markdown ?? editable.text);
      setAttachments(restoredAttachments);
      setGoalMode(!!editable.goal);
      setComposerFocusRequest((n) => n + 1);
    } catch (error) {
      if (queueScope.current === scope && selectedRef.current === sessionId)
        fail(error);
    } finally {
      if (queueScope.current === scope && selectedRef.current === sessionId) {
        queueInFlight.current = false;
        setQueueWorking(false);
      }
    }
  }
  async function undoQueueEdit() {
    const editing = queueDraftRef.current;
    if (!editing) return;
    if (await queueAction({ action: "restore", id: editing.item.id })) {
      setRestoredComposer({
        sessionId: session!.id,
        composer: editing.previousComposer,
      });
      setDraft(editing.previousDraft);
      setAttachments(editing.previousAttachments);
      setGoalMode(!!editing.previousGoalMode);
      saveQueueDraft(null);
      setComposerFocusRequest((n) => n + 1);
    }
  }
  async function queueAction(data: object): Promise<boolean> {
    if (!api || !session || queueInFlight.current) return false;
    const scope = queueScope.current,
      sessionId = session.id;
    queueRevision.current++;
    queueInFlight.current = true;
    setQueueWorking(true);
    try {
      const result = await api.post(`/sessions/${sessionId}/queue`, data);
      if (queueScope.current !== scope || selectedRef.current !== sessionId)
        return false;
      acceptQueue(result);
      await reload();
      return true;
    } catch (e) {
      if (queueScope.current === scope && selectedRef.current === sessionId)
        fail(e);
      return false;
    } finally {
      if (queueScope.current === scope && selectedRef.current === sessionId) {
        queueInFlight.current = false;
        setQueueWorking(false);
      }
    }
  }
  async function send(
    mode?: "steer" | "queue",
    submission?: ComposerSubmission,
  ) {
    if (
      !api ||
      !session ||
      session.archived ||
      sending ||
      sendInFlight.current ||
      messageEditing.submitting ||
      uploading > 0 ||
      attachments.some((a) => a.pending) ||
      queueInFlight.current
    )
      return;
    if (!(submission?.text ?? draft).trim() && !attachments.length) {
      const first = queue.items[0];
      if (
        !goalMode &&
        !queueDraftRef.current &&
        !composerEditor.current?.hasContent() &&
        ["running", "waiting"].includes(session.status) &&
        (mode ?? (queueingEnabled ? "queue" : "steer")) === "steer" &&
        first?.status === "pending"
      ) {
        const scope = queueScope.current,
          sessionId = session.id;
        sendInFlight.current = true;
        setQueueWorking(true);
        try {
          const latest = await api.request(`/sessions/${sessionId}`);
          if (queueScope.current !== scope || selectedRef.current !== sessionId)
            return;
          setSessions((old) =>
            old.map((item) => (item.id === sessionId ? latest.session : item)),
          );
          setStatusFresh(true);
          if (
            !latest.session.archived &&
            ["running", "waiting"].includes(latest.session.status) &&
            !queueDraftRef.current &&
            !composerEditor.current?.hasContent() &&
            !composerSnapshot.current.attachments.length
          )
            await queueAction({ action: "steer", id: first.id });
        } catch (error) {
          if (queueScope.current === scope && selectedRef.current === sessionId)
            fail(error);
        } finally {
          if (
            queueScope.current === scope &&
            selectedRef.current === sessionId
          ) {
            sendInFlight.current = false;
            setQueueWorking(false);
          }
        }
      }
      return;
    }
    const scope = queueScope.current,
      sessionId = session.id;
    sendInFlight.current = true;
    setSending(true);
    try {
      if (session.external && !historyCache?.get(sessionId).attached) {
        const connection = await api.post(`/sessions/${sessionId}/connect`);
        if (queueScope.current !== scope || selectedRef.current !== sessionId)
          return;
        if (connection.connected === false) {
          historyCache?.setAttached(
            sessionId,
            false,
            connection.reason ||
              "原执行入口暂不可用，输入内容已保留，请重试连接。",
          );
          setError("");
          return;
        }
        historyCache?.setAttached(sessionId, true);
        setControlsRevision((value) => value + 1);
      }
      const delivery =
        mode ??
        (["running", "waiting", "starting"].includes(session.status) &&
        queueingEnabled
          ? "queue"
          : "steer");
      appendPromptHistory(
        api.connection.url,
        sessionId,
        submission?.composer ?? { plain: draft },
      );
      composerEditor.current?.resetHistorySelection();
      if (queueDraftRef.current) {
        const result = await api.post<typeof queue>(
          `/sessions/${sessionId}/queue`,
          {
            action: "replace",
            id: queueDraftRef.current.item.id,
            text: submission?.text ?? draft,
            composer: submission?.composer,
            attachments: attachments.map((file) => file.path),
            goal: submission?.goal ?? goalMode,
          },
        );
        if (queueScope.current !== scope || selectedRef.current !== sessionId)
          return;
        setQueue(result);
        saveQueueDraft(null);
      } else {
        const result = await api.post(`/sessions/${sessionId}/messages`, {
          mode: delivery,
          queue_if_busy: mode == null && queueingEnabled,
          text: submission?.text ?? draft,
          composer: submission?.composer,
          attachments: attachments.map((f) => f.path),
          goal: (submission?.goal ?? goalMode) || undefined,
        });
        if (
          queueScope.current === scope &&
          selectedRef.current === sessionId &&
          Array.isArray(result.items)
        ) {
          queueRevision.current++;
          setQueue(result);
        }
        if (
          queueScope.current === scope &&
          selectedRef.current === sessionId &&
          result.goal_error
        )
          fail(new Error(result.goal_error));
      }
      if (queueScope.current !== scope || selectedRef.current !== sessionId)
        return;
      setDraft("");
      setAttachments([]);
      setGoalMode(false);
      if (submission?.goal) setGoalRevision((value) => value + 1);
      const revision = ++queueRevision.current;
      api
        .request(`/sessions/${sessionId}/queue`)
        .then((data) => {
          if (
            queueScope.current === scope &&
            selectedRef.current === sessionId &&
            queueRevision.current === revision &&
            !queueInFlight.current
          )
            setQueue(data);
        })
        .catch((e) => {
          if (queueScope.current === scope) fail(e);
        });
      stick.current = true;
      historyCache?.refresh(sessionId);
      void reload().catch(() => {});
    } catch (e) {
      if (queueScope.current === scope && selectedRef.current === sessionId)
        fail(e);
    } finally {
      if (queueScope.current === scope && selectedRef.current === sessionId) {
        sendInFlight.current = false;
        setSending(false);
      }
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!api || !session || !files?.length || session.archived) return;
    const controller = new AbortController();
    const entries = Array.from(files).map((file) => {
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      if (preview) attachmentUrls.current.add(preview);
      const uploadKey = crypto.randomUUID();
      return {
        name: file.name,
        path: uploadKey,
        preview,
        pending: true,
        uploadKey,
      };
    });
    setAttachments((old) => [...old, ...entries]);
    activeUploads.current.add(controller);
    setUploading((count) => count + 1);
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("files", file);
      const data = await api.request(`/sessions/${session.id}/uploads`, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        setAttachments((old) =>
          old.map((a) => {
            const index = entries.findIndex(
              (entry) => entry.uploadKey === a.uploadKey,
            );
            return index < 0
              ? a
              : { ...a, ...data.files[index], pending: false };
          }),
        );
    } catch (e) {
      if (!controller.signal.aborted) {
        setAttachments((old) =>
          old.filter(
            (a) => !entries.some((entry) => entry.uploadKey === a.uploadKey),
          ),
        );
        fail(e);
      }
    } finally {
      activeUploads.current.delete(controller);
      setUploading((count) => count - 1);
    }
  }
  async function download() {
    if (!api || !session) return;
    try {
      const data = await api.request(
          `/sessions/${session.id}/${session.external ? "history" : "export"}`,
        ),
        text = JSON.stringify(data, null, 2),
        name = `anywork-${session.id}.json`;
      if (window.RemoteAgentAndroid) {
        window.RemoteAgentAndroid.saveFile(name, text);
        return;
      }
      const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      fail(e);
    }
  }
  const resetEditedHistory = useCallback(
    () => setRefresh((value) => value + 1),
    [],
  );
  const messageEditing = useMessageEditing({
    api,
    session,
    turns: view.turns,
    enabled:
      !!session &&
      plugins.some(
        (plugin) =>
          plugin.id === session.agent &&
          plugin.capabilities.includes("message-edit"),
      ),
    busy:
      sending ||
      !statusFresh ||
      ["running", "waiting", "starting"].includes(session?.status || ""),
    resetHistory: resetEditedHistory,
  });
  const busy = ["running", "waiting", "starting"].includes(
    session?.status || "",
  );
  const working =
    session?.status === "running" &&
    statusFresh &&
    streaming &&
    !historyLoading;
  const waiting =
    session?.status === "waiting" && statusFresh && !historyLoading;
  const pendingRequests = session?.status === "waiting" ? view.pending : [];
  useEffect(() => {
    if (cachedHistory.loaded && session?.status === "waiting") {
      for (const event of view.pending) notifications.receive(event, true);
    }
  }, [
    view.pending,
    cachedHistory.loaded,
    session?.status,
    notifications.receive,
  ]);
  if (!connection || !api)
    return (
      <Login
        onConnect={(c) => {
          localStorage.setItem("ra.connection", JSON.stringify(c));
          setConnection(c);
        }}
      />
    );

  const leaveReviewRoute = () => {
    if (chatLocation().id === selected && chatLocation().review) {
      location.hash = sessionReviewRoute(selected);
      setReviewRequest(null);
    }
  };
  const openTool = (kind: string) => {
    if (kind !== "git") leaveReviewRoute();
    setTab(kind);
  };
  const panelLauncher = (
    <details className="panel-launcher header-tools-menu" data-floating-menu>
      <summary
        className="icon-button"
        aria-label="打开子窗口"
        title="打开子窗口"
      >
        <Plus size={17} />
      </summary>
      <div className="panel-launcher-menu header-tools-options">
        {[
          { id: "files", icon: FolderOpen, label: "文件" },
          { id: "git", icon: GitBranch, label: "变更" },
          { id: "goal", icon: Flag, label: "目标" },
          { id: "terminal", icon: TerminalSquare, label: "终端" },
        ].map((tool) => (
          <button
            key={tool.id}
            onClick={(event) => {
              openTool(tool.id);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <tool.icon size={16} />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
  const sessionTabs = session ? (
    <SessionTabs
      inPanel={tab !== "chat"}
      title={session.title}
      tabs={panels.tabs}
      selected={panels.active}
      onSelect={(id) => {
        if (id !== "git") leaveReviewRoute();
        panels.activate(id);
      }}
      onClose={(id) => {
        if (id === "git") leaveReviewRoute();
        panels.close(id);
      }}
    />
  ) : null;
  return (
    <ActivityNavigationContext.Provider value={{ openSubagent }}>
      <ThreadLinkNavigation
        api={api}
        sessions={sessions}
        selected={selected}
        onSelect={select}
        onSessions={setSessions}
        onError={fail}
      >
        <div
          className={`app-shell codex-shell${sidebarPinned ? "" : " sidebar-collapsed"}`}
        >
          {sidebar && (
            <div className="sidebar-shade" onClick={() => setSidebar(false)} />
          )}
          <aside className={sidebar ? "sidebar open" : "sidebar"}>
            <NavigationHeader
              agentFilter={
                <SidebarAgentFilter
                  key={serverKey}
                  plugins={pluginsLoadedFor === api ? plugins : []}
                  sessions={sessionsLoadedFor === api ? sessions : []}
                  value={sidebarAgent}
                  onChange={setSidebarAgent}
                />
              }
              sessions={sessions}
              filter={filter}
              project={projectFilter}
              group={groupMode}
              archived={archived}
              onFilter={setFilter}
              onProject={setProjectFilter}
              onGroup={(value) => {
                setGroupMode(value);
                localStorage.setItem("ra.group-mode-v2", value);
              }}
              onArchive={() => {
                setArchived(!archived);
                setProjectFilter("");
              }}
              onCreate={() => {
                setCreateCwd(projectFilter || session?.cwd || info.workspace);
                setModal("create");
              }}
              onCollapse={() => {
                setSidebarPinned(false);
                localStorage.setItem("ra.sidebar-pinned", "false");
              }}
              onClose={() => setSidebar(false)}
            />
            <SessionSidebar
              sessions={sessionsLoadedFor === api ? sessions : []}
              loading={sessionsLoadedFor !== api && sessionsErrorFor !== api}
              loadError={sessionsLoadedFor !== api && sessionsErrorFor === api}
              onRetry={() => {
                setSessionsErrorFor(null);
                reload().catch(fail);
              }}
              selected={selected}
              archived={archived}
              filter={filter}
              project={projectFilter}
              group={groupMode}
              agent={sidebarAgent}
              agentLabel={
                sidebarAgent
                  ? agentName(
                      sidebarAgent,
                      pluginsLoadedFor === api ? plugins : [],
                    )
                  : undefined
              }
              onClearAgent={() => setSidebarAgent("")}
              onSelect={select}
              onCreate={(path) => {
                setCreateCwd(path);
                setModal("create");
              }}
            />
            <div className="sidebar-bottom">
              <button
                className="settings-button"
                onClick={() => setModal("settings")}
              >
                <Settings size={16} /> 设置与插件 <span>⌘</span>
              </button>
              <button
                className="sidebar-identity"
                title="工作空间总览"
                onClick={() => select("")}
              >
                <img src="/icon.svg" width="18" height="18" alt="" />
                <span>AnyWork</span>
                <span className="sidebar-version">v0.1</span>
              </button>
            </div>
          </aside>
          <main className={`main${session ? " has-session" : ""}`}>
            <div className="window-tabbar">
              <button
                className="desktop-sidebar-toggle icon-button"
                title="会话列表"
                aria-label="会话列表"
                aria-pressed={sidebarPinned}
                onClick={() => {
                  setSidebarPinned(!sidebarPinned);
                  localStorage.setItem(
                    "ra.sidebar-pinned",
                    String(!sidebarPinned),
                  );
                }}
              >
                <PanelLeft size={17} />
              </button>
              <button
                className="mobile-menu icon-button"
                title="会话列表"
                onClick={() => setSidebar(!sidebar)}
              >
                <Menu size={19} />
              </button>
              {!session && sessionTabs}
              {!session && <NotificationCenter center={notifications} />}
            </div>
            {!session && (
              <header className="topbar">
                <span className="overview-title">
                  <img src="/icon.svg" width="20" height="20" alt="" /> AnyWork
                </span>
                <button
                  className="icon-button"
                  title="设置"
                  onClick={() => setModal("settings")}
                >
                  <Settings size={17} />
                </button>
                <button
                  className="icon-button"
                  title="切换主题"
                  onClick={toggleTheme}
                >
                  {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              </header>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button title="关闭错误" onClick={() => setError("")}>
                  <X size={15} />
                </button>
              </div>
            )}
            {session ? (
              <SplitPane
                storageKey={JSON.stringify([serverKey, selected])}
                header={
                  <header className="topbar conversation-header">
                    <button
                      className="icon-button conversation-sidebar-toggle"
                      aria-label="会话列表"
                      title="会话列表"
                      onClick={() => {
                        if (window.matchMedia("(max-width: 720px)").matches)
                          setSidebar(true);
                        else {
                          setSidebarPinned(!sidebarPinned);
                          localStorage.setItem(
                            "ra.sidebar-pinned",
                            String(!sidebarPinned),
                          );
                        }
                      }}
                    >
                      <PanelLeft size={17} />
                    </button>
                    <div
                      className="session-header"
                      title={`${session.cwd} · ${statusNames[session.status] || session.status} · ${session.agent}`}
                    >
                      {tab === "chat" ? (
                        sessionTabs
                      ) : (
                        <button
                          className="conversation-title"
                          onClick={() => setTab("chat")}
                          title={session.title}
                        >
                          <FolderOpen size={16} />
                          <span>{session.title}</span>
                        </button>
                      )}
                      <details className="session-menu" data-floating-menu>
                        <summary aria-label="会话操作">•••</summary>
                        <div>
                          <button
                            disabled={session.external}
                            onClick={() => {
                              const title = prompt("重命名会话", session.title);
                              if (title?.trim()) patch({ title });
                            }}
                          >
                            重命名
                          </button>
                          <button
                            disabled={session.external}
                            onClick={() =>
                              patch({ archived: !session.archived })
                            }
                          >
                            <Archive size={14} />
                            {session.archived ? "取消归档" : "归档会话"}
                          </button>
                          <button onClick={download}>
                            <Download size={14} />
                            导出会话
                          </button>
                          <button
                            className="danger"
                            disabled={session.external}
                            onClick={async () => {
                              if (confirm("永久删除这个会话及其历史记录？")) {
                                try {
                                  await api.request(`/sessions/${session.id}`, {
                                    method: "DELETE",
                                  });
                                  select("");
                                  await reload();
                                } catch (e) {
                                  fail(e);
                                }
                              }
                            }}
                          >
                            <Trash2 size={14} />
                            删除会话
                          </button>
                          <button
                            title="设置"
                            onClick={(event) => {
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                              setModal("settings");
                            }}
                          >
                            <Settings size={15} />
                            设置
                          </button>
                          <button
                            title="切换主题"
                            onClick={(event) => {
                              toggleTheme();
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                            }}
                          >
                            {theme === "dark" ? (
                              <Sun size={15} />
                            ) : (
                              <Moon size={15} />
                            )}
                            切换主题
                          </button>
                          <button
                            onClick={(event) => {
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                              setCreateCwd(session.cwd);
                              setModal("create");
                            }}
                          >
                            <Plus size={15} />
                            新建会话…
                          </button>
                        </div>
                      </details>
                    </div>
                    <NotificationCenter center={notifications} />
                    {tab === "chat" && panelLauncher}
                  </header>
                }
                panelHeader={
                  <div className="panel-tabs" aria-label="当前子窗口">
                    {sessionTabs}

                    <button
                      className="icon-button panel-close"
                      aria-label="关闭预览面板"
                      onClick={() => setTab("chat")}
                    >
                      <PanelRightClose size={17} />
                    </button>
                    {panelLauncher}
                  </div>
                }
                label={
                  tab === "subagents"
                    ? "Subagents 面板"
                    : tab === "goal"
                      ? "目标面板"
                      : tab === "git"
                        ? "变更面板"
                        : tab === "terminal"
                          ? "终端面板"
                          : "文件面板"
                }
                panel={
                  tab === "subagents" ? (
                    selectedSubagent ? (
                      <SubagentConversation
                        key={JSON.stringify([
                          serverKey,
                          selected,
                          selectedSubagent.threadId,
                        ])}
                        api={api}
                        agent={selectedSubagent}
                        cache={historyCache!}
                        sessions={sessions}
                        onBack={() => setSubagentSelection(null)}
                        onOpenSession={select}
                        onOpenFile={(id, target) => {
                          panels.openFile(target, selected, id);
                        }}
                      />
                    ) : (
                      <SubagentsPanel
                        key={subagentScope}
                        agents={subagents}
                        loading={historyLoading}
                        onOpenAgent={(agent) =>
                          openSubagent(agent.threadId, agent.name)
                        }
                        onOpenSession={select}
                      />
                    )
                  ) : tab === "goal" ? (
                    <GoalEditor
                      key={session.id}
                      api={api}
                      sessionId={session.id}
                      disabled={session.archived}
                      onError={fail}
                      onGoalChange={() => setGoalRevision((value) => value + 1)}
                    />
                  ) : tab === "terminal" ? (
                    <Suspense
                      fallback={<div className="loading">加载终端…</div>}
                    >
                      <div className="terminal-split-panel">
                        <div className="split-panel-heading">
                          <span>
                            <TerminalSquare size={14} /> 终端
                          </span>
                          <button
                            className="icon-button"
                            aria-label="关闭侧面板"
                            onClick={() => setTab("chat")}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <Terminal api={api} id={session.id} cwd={session.cwd} />
                      </div>
                    </Suspense>
                  ) : tab === "git" ? (
                    <ReviewPanel
                      key={session.id}
                      api={api}
                      id={session.id}
                      request={
                        reviewRequest?.sessionId === session.id
                          ? reviewRequest.request
                          : null
                      }
                      revision={
                        [...events]
                          .reverse()
                          .find(
                            (event) =>
                              [
                                "turn/diff/updated",
                                "turn/started",
                                "turn/completed",
                                "history/reset",
                              ].includes(event.method) ||
                              (event.method === "item/completed" &&
                                event.params.item?.type === "fileChange"),
                          )?.seq ?? 0
                      }
                      onOpenFile={openFile}
                      onClose={() => {
                        if (reviewRequest?.sessionId === session.id)
                          select(session.id);
                        setTab("chat");
                      }}
                    />
                  ) : tab === "files" ? (
                    <Workspace
                      key={session.id}
                      api={api}
                      id={panels.sourceSessionId || session.id}
                      tab={tab}
                      cwd={
                        sessions.find((s) => s.id === panels.sourceSessionId)
                          ?.cwd || session.cwd
                      }
                      target={fileTarget}
                      onSelectFile={(target) =>
                        panels.sourceSessionId
                          ? panels.openFile(
                              target,
                              session.id,
                              panels.sourceSessionId,
                            )
                          : openFile(target)
                      }
                      onError={fail}
                      onClose={() => setTab("chat")}
                    />
                  ) : null
                }
              >
                <section
                  id="session-content"
                  role="tabpanel"
                  className="session-pane"
                  aria-label="会话内容"
                >
                  <>
                    <div className="chat-history-surface">
                      {!historyLoading &&
                        !historyError &&
                        historySession === selected && (
                          <ConversationHistory
                            key={`${api.connection.url}:${session.id}`}
                            turns={view.turns}
                            scrollRef={chatScroll}
                            hasOlder={!!historyCursor}
                            loadingOlder={olderLoading}
                            onLoadOlder={() => void loadOlder()}
                            onNavigate={() => {
                              stick.current = false;
                            }}
                          />
                        )}
                      <div
                        className="chat-scroll"
                        ref={chatScroll}
                        aria-busy={historyLoading || olderLoading}
                        onWheel={(e) => {
                          if (e.deltaY < 0 && e.currentTarget.scrollTop < 100)
                            void loadOlder();
                        }}
                        onScroll={(e) => {
                          const t = e.currentTarget;
                          const upward = t.scrollTop < previousScroll.current;
                          previousScroll.current = t.scrollTop;
                          stick.current =
                            t.scrollHeight - t.scrollTop - t.clientHeight < 100;
                          if (upward && t.scrollTop < 100) void loadOlder();
                        }}
                      >
                        <div className="transcript">
                          {historyLoading || historySession !== selected ? (
                            <div className="history-loading" role="status">
                              <span className="loading-spinner" />{" "}
                              正在加载最近消息…
                              <div className="message-skeleton" />
                              <div className="message-skeleton short" />
                              <div className="message-skeleton" />
                            </div>
                          ) : historyError ? (
                            <div className="history-error" role="alert">
                              {historyError}
                              <button onClick={() => setRefresh((n) => n + 1)}>
                                重新加载
                              </button>
                            </div>
                          ) : (
                            <>
                              {historyNotice && (
                                <div className="older-history" role="status">
                                  {historyNotice}
                                </div>
                              )}
                              {historyCursor && (
                                <div className="older-history">
                                  <button
                                    onClick={loadOlder}
                                    disabled={olderLoading}
                                  >
                                    {olderLoading
                                      ? "正在加载更早消息…"
                                      : olderError
                                        ? "加载失败，点击重试"
                                        : "加载更早消息"}
                                  </button>
                                  {olderError && (
                                    <span role="alert">{olderError}</span>
                                  )}
                                </div>
                              )}
                              {!view.messages.length && (
                                <div className="chat-empty">
                                  <div className="empty-glyph">
                                    <TerminalSquare size={30} />
                                  </div>
                                  <h2>准备好了。开始构建吧。</h2>
                                  <p>
                                    描述你的目标，Agent 会在工作目录中协助完成。
                                  </p>
                                  <div className="suggestion-grid">
                                    {[
                                      "分析这个项目的结构",
                                      "运行测试并修复失败项",
                                      "检查当前代码变更",
                                      "为这个项目完善 README",
                                    ].map((text) => (
                                      <button
                                        key={text}
                                        onClick={() => setDraft(text)}
                                      >
                                        {text}
                                        <ArrowUpRight size={14} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {view.turns.map((turn, index) => (
                                <TurnView
                                  key={turn.id}
                                  turn={turn}
                                  showReasoning={
                                    session.agent === "deepseek-harness"
                                  }
                                  timestamp={turnTimestamps[index]}
                                  storageKey={`${api.connection.url}:${session.id}:${turn.id}`}
                                  latestWorking={
                                    index === view.turns.length - 1 && busy
                                  }
                                  render={(message) => (
                                    <MessageView
                                      key={message.id}
                                      message={message}
                                      showReasoning={
                                        session.agent === "deepseek-harness"
                                      }
                                      api={api}
                                      sessionId={session.id}
                                      cwd={session.cwd}
                                      imageGallery={turn.messages
                                        .filter(
                                          (m) =>
                                            m.item?.type === "imageView" &&
                                            m.item.path,
                                        )
                                        .map((m) => m.item!.path)}
                                      onOpenFile={openFile}
                                      {...messageEditing.props(message)}
                                    />
                                  )}
                                />
                              ))}
                              {messageEditing.detached && (
                                <MessageView
                                  key={`edit-recovery/${session.id}/${messageEditing.detached.id}`}
                                  message={messageEditing.detached}
                                  api={api}
                                  sessionId={session.id}
                                  cwd={session.cwd}
                                  onOpenFile={openFile}
                                  {...messageEditing.props(
                                    messageEditing.detached,
                                  )}
                                />
                              )}
                              {working && !pendingRequests.length && (
                                <RunningStatus
                                  startTime={view.turns.at(-1)?.startedAt}
                                  activity={workingActivity(view.turns)}
                                />
                              )}
                            </>
                          )}
                          {waiting && !pendingRequests.length && (
                            <div className="agent-waiting" role="status">
                              等待你的回应，请查看原客户端中的审批或问题。
                            </div>
                          )}
                          {controlNotice && (
                            <div className="agent-waiting" role="status">
                              <span>{controlNotice}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setError("");
                                  setRefresh((value) => value + 1);
                                }}
                              >
                                重试连接
                              </button>
                            </div>
                          )}
                          {session?.status === "starting" && (
                            <div className="agent-waiting" role="status">
                              正在连接 Agent…
                            </div>
                          )}
                          {!streaming && !historyLoading && busy && (
                            <div className="agent-waiting" role="status">
                              连接恢复中，正在确认执行状态…
                            </div>
                          )}
                          <div ref={bottom} />
                        </div>
                      </div>
                    </div>
                    <ComposerAccess session={session}>
                      <div
                        className="composer-requests"
                        aria-label="待处理请求"
                      >
                        {pendingRequests.map((event) => (
                          <RequestCard
                            key={String(event.request_id)}
                            event={event}
                            relatedEvents={events}
                            api={api}
                            onError={fail}
                          />
                        ))}
                      </div>
                      <Composer
                        api={api}
                        session={session}
                        goalRevision={goalRevision}
                        controlsRevision={
                          controlsRevision + cachedHistory.settingsVersion
                        }
                        onEditGoal={() =>
                          openTool(tab === "goal" ? "chat" : "goal")
                        }
                        models={models}
                        onModelChange={() => void reload()}
                        busy={busy}
                        queueingEnabled={queueingEnabled}
                        focusRequest={composerFocusRequest}
                        editingQueue={!!queueDraft}
                        undoQueueEdit={() => void undoQueueEdit()}
                        recallQueuedMessage={recallQueuedMessage}
                        queueWorking={queueWorking}
                        goalMode={goalMode}
                        setGoalMode={setGoalMode}
                        sending={sending || messageEditing.submitting}
                        uploading={uploading}
                        draft={draft}
                        inputRef={composerEditor}
                        initialDocument={
                          queueDraft?.item.composer?.document ??
                          (restoredComposer?.sessionId === session.id
                            ? restoredComposer.composer?.document
                            : undefined)
                        }
                        setDraft={setDraft}
                        attachments={attachments}
                        setAttachments={setAttachments}
                        queuedMessages={
                          queue.items.length > 0 ? (
                            <MessageQueue
                              key={session.id}
                              api={api}
                              sessionId={session.id}
                              items={queue.items}
                              paused={queue.paused}
                              working={queueWorking || sending || uploading > 0}
                              onAction={queueAction}
                              canEdit={!queueDraft}
                              onEdit={(item) => void editQueuedMessage(item)}
                              queueingEnabled={queueingEnabled}
                              onToggleQueueing={toggleQueueing}
                            />
                          ) : null
                        }
                        send={send}
                        upload={upload}
                        patch={patch}
                        fail={fail}
                        interrupt={() => {
                          void api
                            .post(`/sessions/${session.id}/interrupt`)
                            .then(() => reload())
                            .catch(fail);
                        }}
                      />
                    </ComposerAccess>
                  </>
                </section>
              </SplitPane>
            ) : (
              <Overview
                loading={sessionsLoadedFor !== api && sessionsErrorFor !== api}
                loadError={
                  sessionsLoadedFor !== api && sessionsErrorFor === api
                }
                onRetry={() => {
                  setSessionsErrorFor(null);
                  reload().catch(fail);
                }}
                sessions={sessionsLoadedFor === api ? sessions : []}
                onSelect={select}
                onCreate={(cwd) => {
                  setCreateCwd(cwd || projectFilter || info.workspace);
                  setModal("create");
                }}
              />
            )}
          </main>
          {modal === "settings" && (
            <SettingsPanel
              appearance={appearance}
              onChange={setAppearance}
              onClose={() => setModal(null)}
            >
              <p className="muted">{info.workspace}</p>
              <h3>已安装 Agent</h3>
              {plugins.map((p) => (
                <div className="plugin-card" key={p.id}>
                  <div className="plugin-logo">
                    <AgentIcon agent={p.id} />
                  </div>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      协议 v{p.protocol_version} · {p.capabilities.join(" · ")}
                    </small>
                  </div>
                  <span className="plugin-installed">
                    <Check size={12} />
                    已安装
                  </span>
                </div>
              ))}
              <p className="hint">
                DeepSeek Harness 通过本机共享入口连接原有会话。连接设置及其他
                Agent 的适配规范见项目文档。
              </p>
              <div className="settings-row">
                <span>完成、权限与确认通知</span>
                <button onClick={() => void notifications.enable()}>
                  <Bell size={14} />{" "}
                  {notifications.permission === "granted" &&
                  notifications.enabled
                    ? "已开启"
                    : "开启系统通知"}
                </button>
                {notifications.feedback && (
                  <small role="status">{notifications.feedback}</small>
                )}
              </div>
              <div className="settings-row">
                <span>事件连接</span>
                <button
                  onClick={() => {
                    setRefresh((x) => x + 1);
                    setModal(null);
                  }}
                >
                  <RefreshCw size={14} />
                  重新连接
                </button>
              </div>
              <button
                className="logout"
                onClick={() => {
                  (window as any).RemoteAgentAndroid?.openConnections?.();
                  localStorage.removeItem("ra.connection");
                  setConnection(null);
                  setSessions([]);
                  setModal(null);
                }}
              >
                <LogOut size={15} />
                断开服务器连接
              </button>
              <p className="license">
                AnyWork v{appVersion} · AGPL-3.0-only
                <br />
                部分界面代码来自 tiann/hapi。
                <a href={api.url("/source")} target="_blank" rel="noreferrer">
                  下载对应源码（AGPL）
                </a>
              </p>
            </SettingsPanel>
          )}
          {modal === "create" && (
            <div className="modal-shade" onClick={() => setModal(null)}>
              <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label="新建会话"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="modal-close icon-button"
                  title="关闭"
                  onClick={() => setModal(null)}
                >
                  <X size={18} />
                </button>
                <CreateSession
                  api={api}
                  plugins={pluginsLoadedFor === api ? plugins : []}
                  pluginsState={
                    pluginsLoadedFor === api
                      ? "ready"
                      : pluginsErrorFor === api
                        ? "error"
                        : "loading"
                  }
                  workspace={createCwd || info.workspace}
                  workspaces={workspaces}
                  onCreated={async (s) => {
                    await reload();
                    select(s.id);
                    setModal(null);
                  }}
                  onError={fail}
                />
              </section>
            </div>
          )}
        </div>
      </ThreadLinkNavigation>
    </ActivityNavigationContext.Provider>
  );
}

function Login({ onConnect }: { onConnect: (connection: Connection) => void }) {
  const [url, setUrl] = useState(
      location.hostname === "appassets.androidplatform.net"
        ? ""
        : location.origin,
    ),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand">
          <div className="brand-icon">
            <img src="/icon.svg" width="40" height="40" alt="" />
          </div>
          <span>
            Any<span className="brand-light">Work</span>
          </span>
        </div>
        <span className="pill">YOUR AGENTS, CONNECTED</span>
        <h1>
          从任何地方，
          <br />
          继续你的构建。
        </h1>
        <p>
          你的工具。你的机器。
          <br />
          一个始终在线的开发工作空间。
        </p>
        <div className="login-art-bottom">
          <i className="dot" /> Powered by Rust · Extensible by design
        </div>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const normalized = new URL(url);
            if (!["http:", "https:"].includes(normalized.protocol))
              throw new Error("请输入 HTTP 或 HTTPS 地址");
            if (
              normalized.username ||
              normalized.password ||
              normalized.search ||
              normalized.hash
            )
              throw new Error("服务器地址不能包含账号、查询参数或片段");
            const connection = { url: normalized.origin, token: token.trim() };
            await new Api(connection).request("/info");
            onConnect(connection);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">AnyWork</div>
        <h2>连接你的工作空间</h2>
        <p>输入服务器地址与访问令牌，开始远程工作。</p>
        <label>
          服务器地址
          <input
            type="url"
            required
            placeholder="https://agent.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          访问令牌
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="粘贴服务端生成的访问令牌"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        <Button disabled={busy}>
          {busy ? "正在连接…" : "连接工作空间"}
          <ArrowUpRight size={17} />
        </Button>
        <p className="hint">
          <ShieldCheck size={14} /> 访问令牌保存在当前设备中。
        </p>
      </form>
    </div>
  );
}
function CreateSession({
  api,
  plugins,
  pluginsState,
  workspace,
  workspaces,
  onCreated,
  onError,
}: {
  api: Api;
  plugins: Plugin[];
  pluginsState: "loading" | "ready" | "error";
  workspace: string;
  workspaces: WorkspaceInfo[];
  onCreated: (s: Session) => void;
  onError: (e: unknown) => void;
}) {
  const [cwd, setCwd] = useState(workspace),
    [agent, setAgent] = useState(() => sessionAgentSelection("", plugins)),
    [model, setModel] = useState(""),
    [policy, setPolicy] = useState("manual"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (pluginsState === "ready")
      setAgent((current) => sessionAgentSelection(current, plugins));
  }, [plugins, pluginsState]);
  const available =
    pluginsState === "ready" && plugins.some((plugin) => plugin.id === agent);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!available) return;
        setBusy(true);
        try {
          const data = await api.post("/sessions", {
            cwd,
            agent,
            model: model || null,
            policy,
          });
          onCreated(data.session);
        } catch (e) {
          onError(e);
          setBusy(false);
        }
      }}
    >
      <div className="eyebrow">NEW SESSION</div>
      <h2>新建会话</h2>
      <p className="muted">选择 Agent 和工作目录，开始新的构建。</p>
      <label>
        Agent
        <span className="agent-select-field">
          <AgentIcon agent={agent} />
          <select
            aria-label="Agent"
            value={agent}
            disabled={pluginsState === "loading"}
            aria-busy={pluginsState === "loading"}
            onChange={(e) => setAgent(e.target.value)}
          >
            {!available && (
              <option value={agent} disabled>
                {agent
                  ? `${agentName(agent)}（暂不可用）`
                  : pluginsState === "loading"
                    ? "正在加载 Agent…"
                    : pluginsState === "error"
                      ? "无法加载 Agent"
                      : "暂无可连接的 Agent"}
              </option>
            )}
            {plugins.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label>
        工作目录
        <input
          required
          aria-label="工作目录"
          list="workspace-options"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={workspace}
        />
      </label>
      <datalist id="workspace-options">
        {workspaces.map((w) => (
          <option value={w.path} key={w.path}>
            {w.name}
          </option>
        ))}
      </datalist>
      <label>
        模型 <small>可选，留空使用 Agent 默认模型</small>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="默认模型"
        />
      </label>
      <label>
        审批模式
        <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
          <option value="manual">逐次审批 — 远程确认操作</option>
          <option value="auto">自动批准 — 在工作区内自动执行</option>
        </select>
      </label>
      <Button disabled={busy || !available} className="full-width">
        {busy ? "正在启动 Agent…" : "创建会话"}
        <ArrowUpRight size={16} />
      </Button>
    </form>
  );
}
