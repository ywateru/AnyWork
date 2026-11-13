import { openPlatformLink } from "../platform";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { Api } from "../api";
import type { Session } from "../types";
import {
  linkedSession,
  messageThreadLinkTarget,
  localThreadTarget,
  routeThreadTarget,
  sessionReviewRoute,
  threadLinkNewTab,
  threadLinkRoute,
  threadLinkTarget,
  type ThreadLinkTarget,
} from "../threadLinks";

type LinkEvent = {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};
const ThreadLinkContext = createContext<
  | ((href: string, event: LinkEvent, source?: "composer" | "markdown") => void)
  | null
>(null);
export const useThreadLinkNavigation = () => useContext(ThreadLinkContext);

export default function ThreadLinkNavigation(props: {
  api: Api;
  sessions: Session[];
  selected: string;
  onSelect: (id: string, review?: ThreadLinkTarget["review"]) => void;
  onSessions: (sessions: Session[]) => void;
  onError: (error: unknown) => void;
  children: ReactNode;
}) {
  const latest = useRef(props);
  latest.current = props;
  const pending = useRef<AbortController | null>(null);

  async function resolve(target: ThreadLinkTarget) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const origin = latest.current;
    const current = () =>
      !controller.signal.aborted &&
      pending.current === controller &&
      latest.current.api === origin.api &&
      latest.current.selected === origin.selected;
    try {
      let session = linkedSession(origin.sessions, target);
      if (!session) {
        const data = await origin.api.request<{ sessions: Session[] }>(
          "/sessions",
          { signal: controller.signal },
        );
        if (!current()) return;
        session = linkedSession(data.sessions, target);
        if (!session)
          throw new Error("当前服务器的工作区内未找到此会话，原草稿已保留。");
        origin.onSessions(data.sessions);
      }
      if (current()) {
        if (routeThreadTarget(origin.selected)) {
          const url = new URL(location.href);
          url.hash = sessionReviewRoute(session.id, target.review);
          window.history.replaceState(null, "", url);
        }
        origin.onSelect(session.id, target.review);
      }
    } catch (error) {
      if (current()) origin.onError(error);
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  useEffect(() => {
    const target = routeThreadTarget(props.selected);
    if (target) void resolve(target);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [props.api, props.selected]);

  function open(href: string, event: LinkEvent, source = "composer") {
    const target =
      source === "markdown"
        ? messageThreadLinkTarget(href)
        : threadLinkTarget(href);
    if (!target) return;
    pending.current?.abort();
    pending.current = null;
    if (!localThreadTarget(target)) {
      props.onError(
        new Error("此会话链接属于其他设备，请连接对应设备后打开。"),
      );
      return;
    }
    if (event.shiftKey || threadLinkNewTab(event, navigator.platform)) {
      const url = new URL(location.href);
      url.hash = threadLinkRoute(target);
      openPlatformLink(url.href);
      return;
    }
    void resolve(target);
  }

  return (
    <ThreadLinkContext.Provider value={open}>
      {props.children}
    </ThreadLinkContext.Provider>
  );
}
