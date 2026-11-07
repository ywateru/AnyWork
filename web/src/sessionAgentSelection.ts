import type { Plugin } from "./types";

/** A late catalog can initialize an empty chooser, but never replace a user's
 * nonempty choice, including an Agent which has since become unavailable. */
export function sessionAgentSelection(current: string, plugins: Plugin[]) {
  return (
    current ||
    plugins.find((plugin) => plugin.id === "codex")?.id ||
    plugins[0]?.id ||
    ""
  );
}

/** Older catalogs contained only usable integrations and omitted this field. */
export function sessionAgentAvailable(agent: string, plugins: Plugin[]) {
  const plugin = plugins.find((entry) => entry.id === agent);
  return !!plugin && plugin.available !== false;
}
