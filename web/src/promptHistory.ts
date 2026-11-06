import { parsePromptText, type PromptDocument } from "./promptText";

export type PromptHistoryEntry =
  | string
  | { markdown: string; document?: PromptDocument }
  | { plain: string; document?: PromptDocument };
export type PromptHistory =
  PromptHistoryEntry[] | Record<string, PromptHistoryEntry[]>;

export function historyText(entry: PromptHistoryEntry) {
  return typeof entry === "string"
    ? entry
    : "markdown" in entry
      ? entry.markdown
      : entry.plain;
}

export function historyEntries(history: PromptHistory, scope: string) {
  return Array.isArray(history)
    ? scope === "global"
      ? history
      : []
    : Object.hasOwn(history, scope)
      ? history[scope]
      : [];
}

/** Native Chr retains duplicates and insertion order, with 20 entries/100 chats. */
export function appendHistory(
  history: PromptHistory,
  scope: string,
  entry: PromptHistoryEntry,
): PromptHistory {
  if (!historyText(entry).trim()) return history;
  const entries = [...historyEntries(history, scope), entry].slice(-20);
  const result = {
    ...(Array.isArray(history) ? { global: history } : history),
  };
  delete result[scope];
  Object.defineProperty(result, scope, {
    value: entries,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const chats = Object.keys(result).filter(
    (key) => key !== "global" && key !== "chatgpt-global",
  );
  for (const key of chats.slice(0, -100)) delete result[key];
  return result;
}

/** Undefined means normal cursor movement; null index/entry clears the prompt. */
export function moveHistory(
  entries: PromptHistoryEntry[],
  index: number | null,
  direction: "up" | "down",
  current: string,
): { index: number | null; entry: PromptHistoryEntry | null } | undefined {
  if (!entries.length) return;
  if (index === null) {
    if (current.trim() || direction === "down") return;
    index = entries.length - 1;
  } else {
    if (entries[index] == null || historyText(entries[index]) !== current)
      return;
    if (direction === "down" && index === entries.length - 1)
      return { index: null, entry: null };
    index =
      (index + (direction === "up" ? -1 : 1) + entries.length) % entries.length;
  }
  return { index, entry: entries[index] };
}

export function historyStringHasReferences(source: string) {
  return parsePromptText(source).content.some((paragraph) =>
    paragraph.content?.some(
      (node) => node.type !== "text" || (node.marks?.length ?? 0) > 0,
    ),
  );
}

const memory = new Map<string, PromptHistory>();
const unsaved = new Set<string>();
const storageKey = (server: string) =>
  `anywork.prompt-history.${server.replace(/\/$/, "")}`;

function validEntry(value: unknown): value is PromptHistoryEntry {
  return (
    typeof value === "string" ||
    (!!value &&
      typeof value === "object" &&
      (typeof (value as { markdown?: unknown }).markdown === "string" ||
        typeof (value as { plain?: unknown }).plain === "string"))
  );
}
export function readPromptHistory(server: string): PromptHistory {
  const key = storageKey(server);
  if (unsaved.has(key)) return memory.get(key) ?? {};
  try {
    let value: unknown;
    try {
      value = JSON.parse(localStorage.getItem(key) ?? "null");
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
    if (Array.isArray(value)) return value.filter(validEntry);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entries]) => Array.isArray(entries))
          .map(([scope, entries]) => [scope, entries.filter(validEntry)]),
      );
    return {};
  } catch {
    /* Browser storage can be unavailable or contain an invalid old record. */
  }
  return memory.get(key) ?? {};
}

export function appendPromptHistory(
  server: string,
  scope: string,
  entry: PromptHistoryEntry,
) {
  const key = storageKey(server);
  const result = appendHistory(readPromptHistory(server), scope, entry);
  memory.set(key, result);
  try {
    localStorage.setItem(key, JSON.stringify(result));
    unsaved.delete(key);
  } catch {
    unsaved.add(key);
  }
}
