import type { Api } from "./api";
import type { AgentEvent, Session } from "./types";
import { prependHistory, refreshHistory, type HistoryPage } from "./history";

export interface SessionHistory {
  events: AgentEvent[];
  controls: AgentEvent[];
  loaded: boolean;
  loading: boolean;
  streaming: boolean;
  error: string;
  notice: string;
  cursor: string | null;
  olderLoading: boolean;
  olderError: string;
  attached: boolean;
  controlNotice: string;
  settingsVersion: number;
}
export const emptyHistory: SessionHistory = {
  events: [],
  controls: [],
  loaded: false,
  loading: true,
  streaming: false,
  error: "",
  notice: "",
  cursor: null,
  olderLoading: false,
  olderError: "",
  attached: false,
  controlNotice: "",
  settingsVersion: 0,
};
type Transport = Pick<Api, "request" | "post" | "stream" | "streamAll">;
type Entry = {
  session: Session;
  snapshot: SessionHistory;
  controller: AbortController;
  source: string;
  liveCursor: number;
  snapshotCoverage?: { source: string; generation: number; seq: number };
  controlCursor: number;
  generation: number;
  lastUsed: number;
  lastRead: number;
  nextAttach: number;
  attaching?: Promise<void>;
  reading?: Promise<void>;
  readAgain: boolean;
  timer?: ReturnType<typeof setTimeout>;
  legacy: boolean;
  controlsLoaded: boolean;
  controlsReading: boolean;
};
const active = (session: Session) =>
  !session.archived &&
  ["running", "waiting", "starting"].includes(session.status);
const controlEvent = (event: AgentEvent) =>
  event.request_id != null ||
  [
    "serverRequest/resolved",
    "turn/started",
    "turn/completed",
    "thread/status/changed",
    "plugin/exited",
  ].includes(event.method);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

/** One authenticated server owns the cache and transport, never the selected pane. */
export class SessionHistoryCache {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private selected = "";
  private sessions: Session[] = [];
  private watched = new Map<string, number>();
  private controller = new AbortController();
  private started = false;
  private multiplex: boolean | undefined;
  private online = false;
  private cursor = 0;
  private clock = 0;
  private maintenance?: ReturnType<typeof setInterval>;
  constructor(
    private api: Transport,
    private onEvent: (event: AgentEvent) => void = () => {},
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (id: string): SessionHistory =>
    this.entries.get(id)?.snapshot || emptyHistory;
  private patch(entry: Entry, patch: Partial<SessionHistory>) {
    if (entry.controller.signal.aborted) return;
    entry.snapshot = { ...entry.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  reconcile(sessions: Session[], selected: string) {
    if (this.controller.signal.aborted) return;
    this.sessions = sessions;
    this.selected = selected;
    const known = new Set(sessions.map((session) => session.id));
    for (const session of sessions) {
      let entry = this.entries.get(session.id);
      if (
        !entry &&
        (session.id === selected ||
          active(session) ||
          this.watched.has(session.id))
      ) {
        entry = {
          session,
          snapshot: { ...emptyHistory },
          controller: new AbortController(),
          source: "catalog",
          liveCursor: 0,
          controlCursor: 0,
          generation: 0,
          lastUsed: ++this.clock,
          lastRead: 0,
          nextAttach: 0,
          readAgain: false,
          legacy: false,
          controlsLoaded: false,
          controlsReading: false,
        };
        this.entries.set(session.id, entry);
      }
      if (!entry) continue;
      entry.session = session;
      if (session.id === selected) entry.lastUsed = ++this.clock;
      if (this.multiplex !== undefined) this.observe(entry);
    }
    for (const [id, entry] of this.entries) {
      if (!known.has(id)) {
        this.remove(entry);
        this.entries.delete(id);
      }
    }
    // Keep every active chat; only least-recently-used idle caches are evicted.
    const idle = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.session.id !== selected &&
          !active(entry.session) &&
          !this.watched.has(entry.session.id),
      )
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const entry of idle.slice(24)) {
      this.remove(entry);
      this.entries.delete(entry.session.id);
    }
    for (const listener of this.listeners) listener();
  }
  watch(id: string) {
    this.watched.set(id, (this.watched.get(id) || 0) + 1);
    this.reconcile(this.sessions, this.selected);
    return () => {
      const count = (this.watched.get(id) || 1) - 1;
      if (count) this.watched.set(id, count);
      else this.watched.delete(id);
    };
  }
  start() {
    if (this.controller.signal.aborted) {
      this.controller = new AbortController();
      this.started = false;
      this.multiplex = undefined;
      this.online = false;
      this.cursor = 0;
    }
    if (this.started) return;
    this.started = true;
    void this.connect();
    this.maintenance = setInterval(() => {
      for (const entry of this.entries.values()) {
        if (
          !entry.session.external ||
          (!active(entry.session) && entry.session.id !== this.selected)
        )
          continue;
        void this.attach(entry);
        if (this.multiplex && Date.now() - entry.lastRead > 15000)
          this.schedule(entry);
      }
    }, 5000);
  }
  private async connect() {
    const signal = this.controller.signal;
    try {
      const initial = await this.api.request<{
        events: AgentEvent[];
        cursor: number;
      }>("/events/poll", { signal });
      if (
        !Array.isArray(initial.events) ||
        !Number.isSafeInteger(initial.cursor)
      )
        throw new Error("Legacy event transport");
      this.cursor = initial.cursor;
      this.multiplex = true;
    } catch (error) {
      if (signal.aborted) return;
      if (
        !(
          error instanceof Error && error.message === "Legacy event transport"
        ) &&
        ![404, 405].includes((error as { status?: number })?.status || 0)
      ) {
        await pause(1500, signal);
        if (!signal.aborted) void this.connect();
        return;
      }
      this.multiplex = false;
    }
    if (signal.aborted) return;
    for (const entry of this.entries.values()) this.observe(entry);
    if (!this.multiplex) return;
    while (!signal.aborted) {
      try {
        this.online = true;
        for (const entry of this.entries.values())
          this.patch(entry, { streaming: true });
        await this.api.streamAll(
          this.cursor,
          (event) => {
            if (signal.aborted || event.seq <= this.cursor) return;
            this.cursor = event.seq;
            const entry = this.entries.get(event.session_id);
            if (entry) this.receive(entry, event);
            this.onEvent(event);
          },
          signal,
        );
      } catch {
        /* Reconnect from the same global sequence, retaining every cached page. */
      }
      if (signal.aborted) return;
      this.online = false;
      for (const entry of this.entries.values())
        this.patch(entry, { streaming: false });
      await pause(1500, signal);
    }
  }
  private observe(entry: Entry) {
    if (!entry.snapshot.loaded && !entry.reading) void this.read(entry);
    if (
      entry.session.external &&
      this.multiplex &&
      !entry.controlsLoaded &&
      !entry.controlsReading
    )
      void this.seedControls(entry);
    if (
      entry.session.external &&
      (entry.session.id === this.selected || active(entry.session))
    )
      void this.attach(entry);
    if (this.multiplex === false && !entry.legacy) {
      entry.legacy = true;
      void this.legacy(entry);
    }
  }
  private async seedControls(entry: Entry) {
    entry.controlsReading = true;
    const generation = entry.generation;
    try {
      let after = 0;
      const controls: AgentEvent[] = [];
      while (!entry.controller.signal.aborted) {
        const page = await this.api.request<{ events: AgentEvent[] }>(
          `/sessions/${entry.session.id}/events/poll?after=${after}&controls=true`,
          { signal: entry.controller.signal },
        );
        if (generation !== entry.generation) return;
        controls.push(...page.events.filter(controlEvent));
        const next = page.events.at(-1)?.seq || after;
        if (page.events.length < 500) break;
        if (next <= after) throw new Error("待确认请求的同步位置未更新");
        after = next;
      }
      if (generation !== entry.generation || entry.controller.signal.aborted)
        return;
      this.patch(entry, {
        controls: [
          ...new Map(
            [...controls, ...entry.snapshot.controls].map((event) => [
              event.seq,
              event,
            ]),
          ).values(),
        ].sort((a, b) => a.seq - b.seq),
      });
      entry.controlsLoaded = true;
    } catch {
      // A transient failure is retried by reconcile, keeping live controls.
    } finally {
      entry.controlsReading = false;
    }
  }
  private async attach(entry: Entry) {
    if (
      !entry.session.external ||
      entry.session.archived ||
      entry.snapshot.attached ||
      entry.attaching ||
      Date.now() < entry.nextAttach
    )
      return;
    entry.nextAttach = Date.now() + 30000;
    entry.attaching = (async () => {
      try {
        const result = await this.api.request<{
          connected?: boolean;
          reason?: string;
        }>(`/sessions/${entry.session.id}/connect`, {
          method: "POST",
          body: "{}",
          signal: entry.controller.signal,
        });
        this.patch(entry, {
          attached: result.connected !== false,
          controlNotice:
            result.connected === false
              ? result.reason || "已加载历史，当前执行进程暂不可控制。"
              : "",
          settingsVersion: entry.snapshot.settingsVersion + 1,
        });
        if (result.connected !== false) this.schedule(entry);
      } catch (error) {
        this.patch(entry, { controlNotice: message(error) });
      }
    })();
    await entry.attaching;
    entry.attaching = undefined;
  }
  setAttached(id: string, attached: boolean, controlNotice = "") {
    const entry = this.entries.get(id);
    if (entry)
      this.patch(entry, {
        attached,
        controlNotice,
        settingsVersion: entry.snapshot.settingsVersion + 1,
      });
  }
  private receive(entry: Entry, event: AgentEvent) {
    if (entry.controller.signal.aborted) return;
    entry.liveCursor = Math.max(entry.liveCursor, event.seq);
    if (["history/reset", "thread/reverted"].includes(event.method)) {
      const coverage = entry.snapshotCoverage;
      // A delayed reset may already be reflected by an authoritative history
      // read. Ordinary live/control events never establish snapshot coverage.
      if (
        entry.snapshot.loaded &&
        coverage?.source === entry.source &&
        coverage.generation === entry.generation &&
        event.seq <= coverage.seq
      )
        return;
      this.refresh(entry.session.id, true);
      return;
    }
    const patch: Partial<SessionHistory> = {};
    if (
      [
        "thread/settings/updated",
        "thread/goal/updated",
        "thread/goal/cleared",
      ].includes(event.method)
    )
      patch.settingsVersion = entry.snapshot.settingsVersion + 1;
    if (event.method === "plugin/exited") {
      patch.attached = false;
      entry.nextAttach = 0;
    }
    if (entry.session.external) {
      if (
        controlEvent(event) &&
        !entry.snapshot.controls.some((old) => old.seq === event.seq)
      )
        patch.controls = [...entry.snapshot.controls, event];
      if (!event.method.startsWith("queue/")) this.schedule(entry);
    } else if (!entry.snapshot.events.some((old) => old.seq === event.seq)) {
      const events = entry.snapshot.events;
      if (!events.length || events.at(-1)!.seq < event.seq)
        patch.events = [...events, event];
      else {
        // Compacted history can arrive before its older started/delta events.
        // Preserve canonical sequence so its completed text remains authoritative;
        // a watermark/content filter would discard valid concurrent item updates.
        const index = events.findIndex((old) => old.seq > event.seq);
        patch.events = [
          ...events.slice(0, index),
          event,
          ...events.slice(index),
        ];
      }
    }
    this.patch(entry, patch);
  }
  private schedule(entry: Entry) {
    if (entry.timer || entry.controller.signal.aborted) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.read(entry);
    }, 150);
  }
  refresh(id: string, reset = false) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (reset) {
      entry.generation++;
      entry.snapshotCoverage = undefined;
      entry.controlsLoaded = false;
      this.patch(entry, {
        events: [],
        controls: [],
        loaded: false,
        loading: true,
        cursor: null,
        error: "",
        olderError: "",
        olderLoading: false,
      });
    }
    void this.read(entry);
  }
  retry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.nextAttach = 0;
    void this.attach(entry);
    void this.read(entry);
  }
  private async read(entry: Entry) {
    if (entry.controller.signal.aborted) return;
    if (entry.reading) {
      entry.readAgain = true;
      return entry.reading;
    }
    const generation = entry.generation;
    entry.reading = (async () => {
      try {
        const page = await this.api.request<HistoryPage>(
          `/sessions/${entry.session.id}/history?paged=true&limit=5`,
          { signal: entry.controller.signal },
        );
        if (entry.controller.signal.aborted || generation !== entry.generation)
          return;
        const first = !entry.snapshot.loaded;
        const events = !entry.session.external
          ? [
              ...new Map(
                [...page.events, ...entry.snapshot.events].map((event) => [
                  event.seq,
                  event,
                ]),
              ).values(),
            ].sort((a, b) => a.seq - b.seq)
          : first
            ? page.events
            : refreshHistory(entry.snapshot.events, page);
        const source = page.source || "catalog";
        // Only a fresh generation starts from an authoritative snapshot.
        // Routine reads merge existing rows, so their newer watermark cannot
        // prove that a reset has been applied to the cache's older pages.
        if (first && entry.snapshot.events.length === 0)
          entry.snapshotCoverage =
            Number.isSafeInteger(page.latest_seq) && page.latest_seq! >= 0
              ? { source, generation, seq: page.latest_seq! }
              : undefined;
        else if (source !== entry.source) entry.snapshotCoverage = undefined;
        entry.liveCursor = Math.max(
          entry.liveCursor,
          page.latest_seq ?? page.events.at(-1)?.seq ?? 0,
        );
        entry.lastRead = Date.now();
        this.patch(entry, {
          events,
          loaded: true,
          loading: false,
          error: "",
          notice: page.history_notice || "",
          cursor:
            first || source !== entry.source
              ? page.next_cursor
              : entry.snapshot.cursor,
          streaming: this.multiplex ? this.online : entry.snapshot.streaming,
        });
        entry.source = source;
      } catch (error) {
        if (generation === entry.generation)
          this.patch(entry, { loading: false, error: message(error) });
      }
    })();
    await entry.reading;
    entry.reading = undefined;
    if (entry.readAgain) {
      entry.readAgain = false;
      this.schedule(entry);
    }
  }
  async loadOlder(id: string, beforeApply: () => void = () => {}) {
    const entry = this.entries.get(id);
    if (
      !entry?.snapshot.cursor ||
      entry.snapshot.olderLoading ||
      entry.snapshot.loading
    )
      return;
    const cursor = entry.snapshot.cursor,
      generation = entry.generation;
    this.patch(entry, { olderLoading: true, olderError: "" });
    try {
      const page = await this.api.request<HistoryPage>(
        `/sessions/${id}/history?paged=true&limit=5&cursor=${encodeURIComponent(cursor)}`,
        { signal: entry.controller.signal },
      );
      if (entry.controller.signal.aborted || generation !== entry.generation)
        return;
      // A source transition invalidates the outstanding pagination cursor.
      if (entry.snapshot.cursor !== cursor) return;
      if (page.next_cursor === cursor)
        throw new Error("加载位置未更新，请重试");
      beforeApply();
      this.patch(entry, {
        events: prependHistory(entry.snapshot.events, page.events),
        cursor: page.next_cursor,
      });
    } catch (error) {
      if (generation === entry.generation)
        this.patch(entry, { olderError: message(error) });
    } finally {
      if (generation === entry.generation)
        this.patch(entry, { olderLoading: false });
    }
  }
  private async legacy(entry: Entry) {
    const signal = entry.controller.signal,
      id = entry.session.id;
    while (!signal.aborted) {
      if (!entry.snapshot.loaded) {
        if (entry.reading) await entry.reading;
        else await pause(1500, signal);
        continue;
      }
      try {
        this.patch(entry, { streaming: true });
        if (entry.session.external) {
          if (entry.snapshot.attached) {
            const data = await this.api.request<{ events: AgentEvent[] }>(
              `/sessions/${id}/events/poll?after=${entry.controlCursor}`,
              { signal },
            );
            for (const event of data.events) {
              if (signal.aborted) return;
              entry.controlCursor = event.seq;
              this.receive(entry, event);
              this.onEvent(event);
            }
          }
          if (active(entry.session) || id === this.selected)
            await this.read(entry);
          await pause(1000, signal);
          continue;
        }
        await this.api.stream(
          id,
          entry.liveCursor,
          (event) => {
            if (!signal.aborted) {
              this.receive(entry, event);
              this.onEvent(event);
            }
          },
          signal,
        );
      } catch {
        if (!signal.aborted) this.patch(entry, { streaming: false });
      }
      await pause(1500, signal);
    }
  }
  private remove(entry: Entry) {
    entry.controller.abort();
    clearTimeout(entry.timer);
  }
  dispose() {
    this.controller.abort();
    clearInterval(this.maintenance);
    for (const entry of this.entries.values()) this.remove(entry);
    this.entries.clear();
    this.watched.clear();
    this.listeners.clear();
  }
}
