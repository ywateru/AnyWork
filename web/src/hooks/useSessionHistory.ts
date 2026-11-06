import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Api } from "../api";
import type { AgentEvent, Session } from "../types";
import { emptyHistory, SessionHistoryCache } from "../sessionHistory";

const subscribeNothing = () => () => {};
export function useSessionHistory(
  api: Api | null,
  sessions: Session[],
  selected: string,
  onEvent: (event: AgentEvent) => void,
) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  const cache = useMemo(
    () =>
      api
        ? new SessionHistoryCache(api, (event) => callback.current(event))
        : null,
    [api],
  );
  useLayoutEffect(() => {
    cache?.start();
    return () => cache?.dispose();
  }, [cache]);
  useLayoutEffect(() => {
    cache?.reconcile(sessions, selected);
  }, [cache, sessions, selected]);
  const snapshot = useSyncExternalStore(
    cache?.subscribe || subscribeNothing,
    () => cache?.get(selected) || emptyHistory,
  );
  return { cache, snapshot };
}
