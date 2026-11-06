import type { AgentEvent } from "./types";
export interface HistoryPage {
  events: AgentEvent[];
  next_cursor: string | null;
  latest_seq?: number;
  turn_ids?: string[];
  replace_turn_ids?: string[];
  history_notice?: string | null;
  source?: string;
}
const key = (e: AgentEvent) => e.params.history_id || String(e.seq);
export function newestHistoryReset(events: AgentEvent[], after: number) {
  return events.reduce(
    (latest, event) =>
      ["history/reset", "thread/reverted"].includes(event.method) &&
      event.seq > latest
        ? event.seq
        : latest,
    after,
  );
}
export function prependHistory(current: AgentEvent[], older: AgentEvent[]) {
  const known = new Set(current.map(key));
  return [...older.filter((e) => !known.has(key(e))), ...current];
}
export function refreshHistory(current: AgentEvent[], page: HistoryPage) {
  const incoming = new Set(page.events.map(key));
  const replaced = new Set(page.replace_turn_ids || []);
  const updated = [
    ...current.filter(
      (e) => !incoming.has(key(e)) && !replaced.has(e.params.history_turn_id),
    ),
    ...page.events,
  ];
  return JSON.stringify(updated) === JSON.stringify(current)
    ? current
    : updated;
}
