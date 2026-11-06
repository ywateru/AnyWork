import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Nodes } from "mdast";
import { librarySourceProvider } from "./libraryFileLinks";
import {
  firstAuthoredLink,
  unescapeAuthoredLabel,
  unescapeAuthoredPath,
} from "./userMessageMarkdown";

export interface PromptMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PromptNode {
  type: string;
  attrs?: Record<string, any>;
  text?: string;
  marks?: PromptMark[];
  content?: PromptNode[];
}
export interface PromptDocument extends PromptNode {
  type: "doc";
  content: PromptNode[];
}
type AttributeSpec = { default?: unknown };
const mentionAttributes: Record<string, AttributeSpec> = {
  name: {},
  displayName: { default: "" },
  path: {},
  description: {},
  iconSmall: { default: "" },
  brandColor: { default: "" },
};

/** Native PZ inline leaf attrs; {} means required, not a null default. */
export const promptAtomAttributes: Record<
  string,
  Record<string, AttributeSpec>
> = {
  atMention: { label: {}, path: {}, fsPath: {} },
  agentMention: {
    name: {},
    displayName: { default: "" },
    conversationId: { default: null },
    path: {},
  },
  skillMention: {
    ...mentionAttributes,
    promptLinkLabel: { default: "" },
    skillIcon: { default: null },
  },
  browserSkillMention: { ...mentionAttributes, skillIcon: { default: null } },
  appMention: { ...mentionAttributes },
  pluginMention: {
    ...mentionAttributes,
    computerUseAppMentionPath: { default: "" },
  },
  chatGptSystemHint: { label: {}, systemHint: {} },
  richLink: {
    displayText: {},
    href: {},
    isLoading: { default: false },
    loadingDisplayText: { default: null },
    literalMarkdownOccurrenceId: { default: null },
    literalMarkdownSource: { default: null },
    markdownSourceEnd: { default: null },
    markdownSourceStart: { default: null },
    sourceAppId: {},
    serializeAsUrl: { default: false },
    libraryFileId: { default: null },
  },
  resourceMention: {
    connectorId: { default: "" },
    linkId: { default: "" },
    brandColor: { default: "" },
    iconSmall: { default: "" },
    resourceUri: {},
    server: {},
    title: {},
  },
  browserTabMention: { faviconUrl: { default: "" }, path: {} },
  chatGptConversationMention: { conversationId: {}, path: {}, title: {} },
  chatGptLibraryFileMention: {
    entrypoint: { default: null },
    fileId: { default: "" },
    libraryArtifactType: { default: "" },
    libraryFileId: {},
    mimeType: { default: "" },
    serializeAsUrl: { default: false },
    sourceUrl: { default: "" },
    title: {},
  },
  chatGptReferenceImageMention: {
    referenceImageId: {},
    title: {},
    assetPointer: { default: null },
    thumbnailAssetPointer: { default: null },
  },
  sitesProjectMention: { path: {}, title: {} },
  pageReferenceMention: {
    path: {},
    projectId: { default: "" },
    spaceId: { default: "" },
    title: {},
  },
  pageTaskMention: { path: {} },
};

export const promptLinkAttributes = {
  href: { default: null },
  title: { default: null },
  sourceAppId: { default: null },
  literalMarkdownOccurrenceId: { default: null },
  literalMarkdownSource: { default: null },
  disabled: { default: false },
  isAutolink: { default: false },
  isGeneratedAutolink: { default: false },
};

export interface ParsePromptOptions {
  restoreMarkdownLinksAsTextLinks?: boolean;
  restoreOnlyHttpMarkdownLinks?: boolean;
  restoreOnlySitesAndPluginMentions?: boolean;
  restorePathLinksAsFileMentions?: boolean;
  restoreRichLinks?: boolean;
  fileMentions?: ReadonlyMap<string, PromptNode>;
}
export interface SerializePromptOptions {
  /** KX clipboard text; selection/open-slice handling belongs to the caller. */
  forClipboard?: boolean;
  /** true is controller.getPlainText(); false is plain-controller getText(). */
  preserveTextLinkMarks?: boolean;
  preferFileMentionFsPath?: boolean;
  preserveUnresolvedSkillMentions?: boolean;
}

const sitesIcon =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
>
  <path
    d="M22 19.2727C22 20.779 20.779 22 19.2727 22H14.7273C13.221 22 12 20.779 12 19.2727V12H19.2727C20.779 12 22 13.221 22 14.7273V19.2727Z"
    fill="#68C4FF"
  />
  <path
    d="M20 2C21.1046 2 22 2.89543 22 4V7C22 8.10457 21.1046 9 20 9H17C15.8954 9 15 8.10457 15 7V4C15 2.89543 15.8954 2 17 2H20Z"
    fill="#0C79D8"
  />
  <path
    d="M7 15C8.10457 15 9 15.8954 9 17V20C9 21.1046 8.10457 22 7 22H4C2.89543 22 2 21.1046 2 20V17C2 15.8954 2.89543 15 4 15H7Z"
    fill="#0C79D8"
  />
  <path
    d="M12 12H4.72727C3.22104 12 2 10.779 2 9.27273V4.72727C2 3.22104 3.22104 2 4.72727 2H9.27273C10.779 2 12 3.22104 12 4.72727V12Z"
    fill="#2E9EFF"
  />
</svg>
`);
const sitesAppIds = new Set([
  "sites@openai-curated-remote",
  "connector_20205bf7d4e99a89d7154bb849718324",
  "connector_openai_sites",
  "connector_sites",
]);

const storagePrefix = "codex-text-link://";
const libraryPrefix = "chatgpt-library-file://";
const libraryEntrypoints = new Set([
  "composer_library_picker",
  "library_start_chat",
  "at_mention",
  "pasted_url",
]);
const systemHints = new Set([
  "search",
  "picture_v2",
  "cme",
  "tatertot",
  "tasks",
  "note",
]);

function node(type: string, attrs: Record<string, unknown>): PromptNode {
  const defaults = Object.fromEntries(
    Object.entries(promptAtomAttributes[type] || {})
      .filter(([, spec]) => "default" in spec)
      .map(([key, spec]) => [key, spec.default]),
  );
  return {
    type,
    attrs: {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(attrs).filter(([, value]) => value !== undefined),
      ),
    },
  };
}
function text(value: string, attrs?: Record<string, unknown>): PromptNode {
  return attrs
    ? {
        type: "text",
        text: value,
        marks: [
          {
            type: "link",
            attrs: {
              ...Object.fromEntries(
                Object.entries(promptLinkAttributes).map(([key, spec]) => [
                  key,
                  spec.default,
                ]),
              ),
              ...attrs,
            },
          },
        ],
      }
    : { type: "text", text: value };
}
function httpHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  try {
    return ["http:", "https:"].includes(new URL(trimmed).protocol)
      ? trimmed
      : null;
  } catch {
    return null;
  }
}
function decoded(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
function appName(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  );
}
function mentionLabel(label: string) {
  const trimmed = label.trim();
  return (trimmed.startsWith("$[") || trimmed.startsWith("@[")) &&
    trimmed.endsWith("]")
    ? trimmed.slice(2, -1)
    : /^[\$@]/.test(trimmed)
      ? trimmed.slice(1)
      : trimmed;
}

/** Native B4: intentionally not a generic Markdown escaping function. */
export function serializePromptLink(
  label: string,
  path: string,
  title?: string | null,
): string {
  if (title == null) {
    const escapedLabel = label
      .replaceAll("\\", "\\\\")
      .replaceAll("[", "\\[")
      .replaceAll("](", "]\\(")
      .replaceAll("]", "\\]");
    return `[${escapedLabel}](${path.replaceAll("\\", "\\\\").replaceAll(")", "\\)")})`;
  }
  return toMarkdown(
    {
      type: "link",
      url: path,
      title,
      children: [{ type: "text", value: label }],
    },
    {
      resourceLink: true,
      unsafe: [
        { character: ")", inConstruct: "titleQuote" },
        { character: "\n", inConstruct: "titleQuote" },
        { character: "\r", inConstruct: "titleQuote" },
      ],
    },
  ).trimEnd();
}

function libraryAttrs(path: string) {
  if (!path.startsWith(libraryPrefix)) return null;
  const remainder = path.slice(libraryPrefix.length),
    query = remainder.indexOf("?");
  const libraryFileId = decoded(
    query === -1 ? remainder : remainder.slice(0, query),
  )?.trim();
  if (!libraryFileId) return null;
  const params = new URLSearchParams(
    query === -1 ? "" : remainder.slice(query + 1),
  );
  const entrypoint = params.get("entrypoint");
  return {
    entrypoint:
      entrypoint != null && libraryEntrypoints.has(entrypoint)
        ? entrypoint
        : undefined,
    fileId: params.get("fileId") ?? "",
    libraryArtifactType: params.get("libraryArtifactType") ?? "",
    libraryFileId,
    mimeType: params.get("mimeType") ?? "",
    ...(params.get("asUrl") === "1" ? { serializeAsUrl: true } : {}),
    sourceUrl: params.get("sourceUrl") || undefined,
  };
}
export function serializeLibraryMention(attrs: Record<string, any>) {
  const params = new URLSearchParams();
  if (attrs.fileId?.length > 0) params.set("fileId", attrs.fileId);
  if (attrs.mimeType?.length > 0) params.set("mimeType", attrs.mimeType);
  if (attrs.libraryArtifactType?.length > 0)
    params.set("libraryArtifactType", attrs.libraryArtifactType);
  if (attrs.entrypoint != null) params.set("entrypoint", attrs.entrypoint);
  if (attrs.sourceUrl) params.set("sourceUrl", attrs.sourceUrl);
  if (attrs.serializeAsUrl) params.set("asUrl", "1");
  return `${libraryPrefix}${encodeURIComponent(attrs.libraryFileId)}${params.size ? `?${params}` : ""}`;
}

function referenceImage(path: string) {
  if (!path.startsWith("chatgpt-reference-image://")) return null;
  const [id, query] = path.slice(26).split("?"),
    referenceImageId = decoded(id)?.trim();
  if (!referenceImageId) return null;
  const params = new URLSearchParams(query);
  return {
    referenceImageId,
    assetPointer: params.get("assetPointer"),
    thumbnailAssetPointer: params.get("thumbnailAssetPointer"),
  };
}
function libraryFolder(path: string) {
  return path.startsWith("chatgpt-library-folder://") && path.endsWith("/")
    ? decoded(path.slice(25, -1).split("?")[0]) || null
    : null;
}
function resource(path: string): Record<string, string> | null {
  if (!path.startsWith("mcp-resource://")) return null;
  const remainder = path.slice(15),
    slash = remainder.indexOf("/");
  if (slash === -1) return null;
  const server = decoded(remainder.slice(0, slash)),
    rest = remainder.slice(slash + 1),
    query = rest.indexOf("?");
  const params = new URLSearchParams(query < 0 ? "" : rest.slice(query + 1)),
    hosted = params.has("connector_id") || params.has("link_id");
  const resourceUri = decoded(hosted ? rest.slice(0, query) : rest);
  if (!server || !resourceUri) return null;
  if (!hosted) return { resourceUri, server };
  const connectorId = params.get("connector_id"),
    linkId = params.get("link_id");
  return connectorId && linkId
    ? { resourceUri, server, connectorId, linkId }
    : null;
}
function conversation(path: string) {
  return path.startsWith("chatgpt-conversation://")
    ? decoded(path.slice(23))?.trim() || null
    : null;
}
function thread(path: string) {
  if (!path.startsWith("thread://")) return null;
  const match = /^([a-zA-Z0-9_-]+)(?:\?hostId=([^?#&/]+))?$/.exec(
    path.slice(9),
  );
  if (!match) return null;
  if (match[2] != null) {
    const host = decoded(match[2]);
    if (!host || !/^[a-zA-Z0-9._:-]+$/.test(host)) return null;
  }
  return match[1];
}
function sites(path: string) {
  const site = path.startsWith("plugin://")
    ? safeUrl(path)?.searchParams.get("site")
    : path;
  if (!site?.startsWith("sites-project://")) return null;
  return (
    (path.startsWith("plugin://")
      ? site.slice(16)
      : decoded(site.slice(16))
    )?.trim() || null
  );
}
function safeUrl(path: string) {
  try {
    return new URL(path);
  } catch {
    return null;
  }
}
function page(path: string) {
  const match =
    /^(page|space):\/\/([A-Za-z0-9][A-Za-z0-9._~-]{0,199})(?:#([A-Za-z0-9][A-Za-z0-9._~-]{0,199}))?$/u.exec(
      path,
    );
  if (match) return match[1] !== "space" || match[3] == null;
  const url = safeUrl(path),
    id = url?.pathname.replace(/^\/(?:codex\/app\/)?space\//, "");
  return (
    !!url &&
    url.origin === "https://chatgpt.com" &&
    !url.username &&
    !url.password &&
    !url.searchParams.has("thread") &&
    !url.searchParams.has("message") &&
    /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/u.test(id || "") &&
    (!url.hash ||
      /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/u.test(url.hash.slice(1)))
  );
}
const uuid =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
function task(path: string) {
  const value = path.replace(/\\+([:&])/gu, "$1");
  if (!value.startsWith("task:")) return null;
  const url = safeUrl(value);
  if (
    !url ||
    url.hostname ||
    url.hash ||
    url.username ||
    url.password ||
    url.port ||
    !uuid.test(url.pathname) ||
    !url.searchParams.get("owner")
  )
    return null;
  for (const key of ["source", "backend", "host"]) {
    const value = url.searchParams.get(key);
    if (
      value != null &&
      (key === "source"
        ? !["page", "comment"].includes(value)
        : key === "backend"
          ? value !== "chatgpt"
          : value.length === 0)
    )
      return null;
  }
  if (url.searchParams.has("orbit") && url.searchParams.get("orbit_id") === "")
    return null;
  for (const key of ["thread", "orbit"]) {
    const value = url.searchParams.get(key);
    if (value != null && !uuid.test(value)) return null;
  }
  return { orbit: url.searchParams.has("orbit") };
}
const browserIds = [
  "browser@openai-bundled",
  "browser@openai-curated-remote",
  "chrome@openai-bundled",
  "chrome-dev@openai-bundled",
  "chrome-internal@openai-bundled",
];
function browserTab(path: string) {
  if (path.length > 12 * (128 + 1024 + 4096 + 16384 + 128)) return null;
  const plugin = browserIds.find((id) => path.startsWith(`plugin://${id}?`));
  if (!plugin) return null;
  const params = new URLSearchParams(path.slice(`plugin://${plugin}?`.length));
  const source =
    plugin === browserIds[0] && params.get("source") !== "extension"
      ? "iab"
      : "extension";
  const keys =
    plugin === browserIds[0] && source === "extension"
      ? ["mention", "source", "browserId", "tabId", "title", "url"]
      : ["mention", "browserId", "tabId", "title", "url"];
  if (
    JSON.stringify([...params.keys()]) !== JSON.stringify(keys) ||
    params.get("mention") !== "tab-v1"
  )
    return null;
  const values = Object.fromEntries(params);
  for (const [key, max] of [
    ["browserId", 128],
    ["tabId", 1024],
    ["title", 4096],
    ["url", 16384],
  ] as const) {
    if (
      values[key] == null ||
      values[key].length > max ||
      !wellFormed(values[key]) ||
      (["browserId", "tabId"].includes(key) && !values[key].trim())
    )
      return null;
  }
  const title =
    values.title.replace(/[\r\n]+/g, " ").trim() ||
    values.url.replace(/[\r\n]+/g, " ").trim();
  if (!title) return null;
  const canonical = new URLSearchParams();
  for (const key of keys) canonical.set(key, values[key]);
  return `plugin://${plugin}?${canonical}` === path ? { title } : null;
}
function wellFormed(text: string) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

const appHosts: [string, string[]][] = [
  ["box", ["box.com"]],
  ["dropbox", ["dropbox.com"]],
  ["google-calendar", ["calendar.google.com"]],
  ["google-drive", ["docs.google.com", "drive.google.com"]],
  ["figma", ["figma.com"]],
  ["github", ["github.com"]],
  ["linear", ["linear.app"]],
  ["gmail", ["mail.google.com"]],
  ["notion", ["app.notion.com", "notion.so"]],
  [
    "recruiting-assistant",
    [
      "recruiting.apps.openai.org",
      "recruiting.extapps.openai.org",
      "recruiting.extapps-staging.openai.org",
      "recruiting.staging-apps.openai.org",
    ],
  ],
  ["salesforce", ["force.com", "salesforce.com"]],
  ["google-drive", ["sheets.google.com"]],
  ["sharepoint", ["sharepoint.com"]],
  ["slack", ["slack.com"]],
  ["google-drive", ["slides.google.com"]],
];
function sourceApp(href: string) {
  const url = safeUrl(href);
  if (!url || !["http:", "https:"].includes(url.protocol)) return null;
  for (const [app, hosts] of appHosts)
    if (
      hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return app;
  return (
    new Map([
      ["openai.com", "openai"],
      ["www.openai.com", "openai"],
      ["chatgpt.com", "openai"],
      ["www.chatgpt.com", "openai"],
      ["buildkite.com", "buildkite"],
      ["www.buildkite.com", "buildkite"],
      ["portal.azure.com", "azure"],
    ]).get(url.hostname) ?? null
  );
}
function codexThread(href: string) {
  const value = href.trim();
  if (!value.startsWith("codex://threads/") || /\s/.test(value)) return null;
  const url = safeUrl(value),
    id = url?.pathname.split("/").filter(Boolean)[0],
    hosts = url?.searchParams.getAll("hostId");
  if (
    !url ||
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    ) ||
    url.hash ||
    url.pathname !== `/${id}` ||
    [...url.searchParams.keys()].some((key) => key !== "hostId") ||
    hosts!.length > 1 ||
    (hosts!.length === 1 &&
      !/^(?:[a-zA-Z0-9._:~!*'()-]|%[a-fA-F0-9]{2})+$/.test(hosts![0]))
  )
    return null;
  return value;
}
function textLinkHref(href: string) {
  return (
    httpHref(href) ??
    codexThread(href) ??
    (safeUrl(href)?.protocol === "mailto:" ? href.trim() : null)
  );
}
function richLink(label: string, href: string) {
  if (label !== href && codexThread(href))
    return { displayText: label, href, sourceAppId: "" };
  if (label === href) {
    const valid = httpHref(href);
    return valid === href
      ? { displayText: href, href, sourceAppId: sourceApp(href) ?? "" }
      : null;
  }
  const app = sourceApp(href);
  return app == null ? null : { displayText: label, href, sourceAppId: app };
}

// BX / VX use the same canonical URL and provider rules as prompt restoration.
export {
  textLinkHref as editablePromptLinkHref,
  richLink as promptRichLinkAttrs,
  httpHref as httpPromptHref,
  codexThread as promptThreadHref,
};
function skillLabel(label: string) {
  const value = label.trim().replace(/^[$@]/, ""),
    query = value.indexOf("?");
  if (query === -1) return { name: value };
  const params = new URLSearchParams(value.slice(query + 1));
  if (!params.has("label") && !params.has("icon")) return { name: value };
  const candidate = params.get("icon"),
    icon =
      candidate === "pencil-sparkle" ||
      (candidate?.startsWith("artifact-template-") &&
        [
          "document",
          "presentation",
          "spreadsheet",
          "site",
          "google-docs",
          "google-slides",
          "google-sheets",
        ].includes(candidate.slice(18)))
        ? candidate
        : undefined;
  return {
    name: value.slice(0, query).trim(),
    displayLabel: params.get("label")?.trim() || undefined,
    icon,
  };
}
function titleCase(name: string) {
  const acronyms = new Set([
      "GH",
      "IA",
      "MCP",
      "API",
      "CI",
      "CLI",
      "LLM",
      "PDF",
      "PR",
      "RCS",
      "UI",
      "URL",
      "SQL",
      "TW",
      "GPU",
      "CPU",
    ]),
    lower = new Set(["and", "or", "to", "up", "with"]);
  const brands = new Map([
    ["openai", "OpenAI"],
    ["openaideveloperdocs", "OpenAI Developer Docs"],
    ["openapi", "OpenAPI"],
    ["github", "GitHub"],
    ["imessage", "iMessage"],
    ["pagerduty", "PagerDuty"],
    ["datadog", "DataDog"],
    ["sharepoint", "SharePoint"],
    ["sqlite", "SQLite"],
    ["fastapi", "FastAPI"],
  ]);
  return name
    .split(":")
    .map((part) =>
      part
        .replace(/[_-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((word, index) => {
          const upper = word.toUpperCase();
          if (acronyms.has(upper)) return upper;
          if (
            word.toLowerCase().endsWith("s") &&
            acronyms.has(word.slice(0, -1).toUpperCase())
          )
            return `${word.slice(0, -1).toUpperCase()}s`;
          const normalized = word.toLowerCase();
          return (
            brands.get(normalized) ??
            (index > 0 && lower.has(normalized)
              ? normalized
              : normalized[0].toUpperCase() + normalized.slice(1))
          );
        })
        .join(" "),
    )
    .join(": ");
}

function parsedStorageLink(label: string, href: string) {
  const paragraph = fromMarkdown(`[${label}](${href})`).children[0];
  if (paragraph?.type !== "paragraph") return null;
  const first = paragraph.children[0];
  if (first?.type !== "link") return null;
  const plain = (entry: Nodes): string =>
    "value" in entry
      ? String(entry.value)
      : "children" in entry
        ? entry.children.map((child) => plain(child as Nodes)).join("")
        : "alt" in entry
          ? entry.alt || ""
          : "";
  return { href: first.url, title: first.title, text: plain(paragraph) };
}
function hintLiteralRanges(value: string) {
  const ranges: [number, number][] = [];
  if (!value.includes("chatgpt-system-hint://")) return ranges;
  const visit = (entry: Nodes) => {
    if (entry.type === "code" || entry.type === "inlineCode") {
      if (
        entry.position?.start.offset != null &&
        entry.position?.end.offset != null
      )
        ranges.push([entry.position.start.offset, entry.position.end.offset]);
    } else if ("children" in entry)
      entry.children.forEach((child) => visit(child as Nodes));
  };
  visit(fromMarkdown(value));
  return ranges;
}

/** ZX/iua for ordinary historical editing with plain paragraphs.
 * Main composer rich/code-block parsing is a separate caller mode.
 */
export function parsePromptText(
  value: string,
  options: ParsePromptOptions = {},
): PromptDocument {
  const literalHints = hintLiteralRanges(value);
  let offset = 0;
  const content = value.split("\n").map((line) => {
    const inlines: PromptNode[] = [];
    let consumed = 0,
      search = 0;
    for (
      let found = firstAuthoredLink(line, search);
      found;
      found = firstAuthoredLink(line, search)
    ) {
      search = found.end;
      const storage = found.path.startsWith(storagePrefix),
        originalPath = storage
          ? found.path.slice(storagePrefix.length)
          : found.path;
      const parsed = storage
        ? parsedStorageLink(found.label, originalPath)
        : null;
      const label =
        parsed?.title == null
          ? unescapeAuthoredLabel(found.label)
          : parsed.text;
      const path =
        parsed?.title == null
          ? unescapeAuthoredPath(originalPath)
          : parsed.href;
      let category = path.startsWith("browser-skill:")
        ? "browser-skill"
        : path.startsWith("agent://") ||
            path.startsWith("subagent://") ||
            thread(path)
          ? "agent"
          : browserTab(path)
            ? "browser-tab"
            : path.startsWith("plugin://")
              ? "plugin"
              : conversation(path)
                ? "conversation"
                : resource(path)
                  ? "resource"
                  : sites(path)
                    ? "sites"
                    : page(path)
                      ? "page"
                      : path.startsWith("app://")
                        ? "app"
                        : label.trim().startsWith("$") && !httpHref(path)
                          ? "skill"
                          : "text";
      if (
        options.restoreOnlySitesAndPluginMentions &&
        !["sites", "plugin"].includes(category)
      )
        continue;
      if (found.start > consumed)
        inlines.push(text(line.slice(consumed, found.start)));
      const href = storage
        ? textLinkHref(path)
        : options.restoreMarkdownLinksAsTextLinks ||
            options.restoreOnlyHttpMarkdownLinks
          ? httpHref(path)
          : null;
      if (options.restoreOnlyHttpMarkdownLinks) category = "text";
      const rich = richLink(label, path),
        plainRichUrl =
          href != null &&
          rich != null &&
          rich.displayText === rich.href &&
          rich.sourceAppId === "";
      const image = referenceImage(path),
        library = libraryAttrs(path),
        system =
          path.startsWith("chatgpt-system-hint://") &&
          systemHints.has(path.slice(22)) &&
          !literalHints.some(
            ([start, end]) =>
              offset + found!.start >= start && offset + found!.start < end,
          )
            ? path.slice(22)
            : null;
      const literal = () => text(`[${found!.label}](${found!.path})`);
      let inline: PromptNode;
      if (image && !options.restoreOnlyHttpMarkdownLinks)
        inline = node("chatGptReferenceImageMention", {
          ...image,
          title: label,
        });
      else if (library)
        inline = node("chatGptLibraryFileMention", {
          ...library,
          title: label,
        });
      else if (libraryFolder(path))
        inline = node("atMention", { label, path, fsPath: path });
      else if (options.restoreOnlyHttpMarkdownLinks && href == null)
        inline = literal();
      else if (category === "browser-skill") {
        const id = safeUrl(path)?.pathname.slice(1),
          parsed = skillLabel(label),
          useParsed = parsed.name === (id != null ? decoded(id) : undefined),
          name = useParsed ? parsed.name : label.trim().replace(/^@/, "");
        inline = node("browserSkillMention", {
          name,
          displayName: useParsed ? (parsed.displayLabel ?? parsed.name) : name,
          skillIcon: useParsed ? (parsed.icon ?? null) : null,
          path,
          description: "",
          iconSmall: "",
        });
      } else if (system)
        inline = node("chatGptSystemHint", { label, systemHint: system });
      else if (category === "plugin")
        inline = node("pluginMention", {
          name: mentionLabel(label),
          displayName: mentionLabel(label),
          path,
          description: "",
          iconSmall:
            path === "plugin://sites@openai-curated-remote" ? sitesIcon : "",
        });
      else if (category === "app") {
        const name = label.startsWith("$") ? mentionLabel(label) : label;
        inline = node("appMention", {
          name: appName(name),
          displayName: name,
          path,
          description: "",
          iconSmall: sitesAppIds.has(path.slice(6)) ? sitesIcon : "",
        });
      } else if (category === "skill") {
        const parsed = skillLabel(label);
        inline = node("skillMention", {
          name: parsed.name,
          skillIcon: parsed.icon ?? null,
          promptLinkLabel: label,
          displayName: parsed.displayLabel ?? titleCase(parsed.name),
          path,
          description: "",
          iconSmall: "",
        });
      } else if (category === "agent") {
        const conversationId = path.startsWith("agent://")
          ? path.slice(8).trim() || null
          : null;
        const valid =
            conversationId ||
            (path.startsWith("subagent://") && path.slice(11).trim()) ||
            thread(path),
          name = label.startsWith("@") ? label.slice(1) : label;
        inline = valid
          ? node("agentMention", {
              name,
              displayName: name,
              conversationId,
              path,
            })
          : literal();
      } else if (category === "resource")
        inline = node("resourceMention", { ...resource(path), title: label });
      else if (category === "browser-tab")
        inline = node("browserTabMention", { faviconUrl: "", path });
      else if (category === "conversation")
        inline = node("chatGptConversationMention", {
          conversationId: conversation(path),
          path,
          title: label,
        });
      else if (task(path)) inline = node("pageTaskMention", { path });
      else if (category === "page")
        inline = node("pageReferenceMention", { path, title: label });
      else if (category === "sites")
        inline = node("sitesProjectMention", { path, title: label });
      else if (options.fileMentions?.has(line.slice(found.start, found.end)))
        inline = options.fileMentions.get(line.slice(found.start, found.end))!;
      else if (options.restoreRichLinks === false && category === "text")
        inline = text(`[${found.label}](${originalPath})`);
      else if (storage && href != null)
        inline = text(label, { href, title: parsed?.title ?? null });
      else if (rich && !plainRichUrl)
        inline =
          rich.displayText === rich.href
            ? text(rich.href, { href: null, sourceAppId: rich.sourceAppId })
            : node("richLink", rich);
      else if (href != null) inline = text(label, { href });
      else if (
        !/^[A-Za-z]:[\\/]/.test(path) &&
        /^(?:[A-Za-z][A-Za-z0-9+.-]*:|www\.)/.test(path)
      )
        inline = literal();
      else if (options.restorePathLinksAsFileMentions !== false)
        inline = node("atMention", { label, path, fsPath: path });
      else inline = literal();
      if (inline.type !== "text" || inline.text) inlines.push(inline);
      consumed = found.end;
    }
    if (line.length > consumed) inlines.push(text(line.slice(consumed)));
    offset += line.length + 1;
    return {
      type: "paragraph",
      ...(inlines.length ? { content: mergeTextNodes(inlines) } : {}),
    };
  });
  return { type: "doc", content };
}

function mentionLink(
  entry: PromptNode,
  preferFsPath: boolean,
): { text: string; href: string } | null {
  const attrs = entry.attrs || {},
    path = attrs.path;
  switch (entry.type) {
    case "chatGptSystemHint":
      return {
        text: attrs.label,
        href: `chatgpt-system-hint://${attrs.systemHint}`,
      };
    case "atMention": {
      const fs = attrs.fsPath?.length ? attrs.fsPath : path;
      return {
        text: attrs.label,
        href: preferFsPath
          ? /[\\/]$/.test(path) && !/[\\/]$/.test(fs)
            ? `${fs}/`
            : fs
          : path,
      };
    }
    case "pageTaskMention":
      return { text: task(path)?.orbit ? "@dot" : "@ChatGPT", href: path };
    case "agentMention":
    case "browserSkillMention":
      return {
        text: `@${typeof attrs.displayName === "string" && attrs.displayName.length ? attrs.displayName : attrs.name}`,
        href: path,
      };
    case "resourceMention": {
      let href = `mcp-resource://${encodeURIComponent(attrs.server)}/${encodeURIComponent(attrs.resourceUri)}`;
      if (attrs.connectorId || attrs.linkId) {
        if (!attrs.connectorId || !attrs.linkId)
          throw new Error(
            "Hosted resource mentions require an app and account",
          );
        href += `?${new URLSearchParams({ connector_id: attrs.connectorId, link_id: attrs.linkId })}`;
      }
      return { text: attrs.title, href };
    }
    case "chatGptReferenceImageMention": {
      const params = new URLSearchParams();
      if (attrs.assetPointer) params.set("assetPointer", attrs.assetPointer);
      if (attrs.thumbnailAssetPointer)
        params.set("thumbnailAssetPointer", attrs.thumbnailAssetPointer);
      return {
        text: attrs.title,
        href: `chatgpt-reference-image://${encodeURIComponent(attrs.referenceImageId)}${params.size ? `?${params}` : ""}`,
      };
    }
    case "chatGptLibraryFileMention":
      return { text: attrs.title, href: serializeLibraryMention(attrs) };
    case "browserTabMention": {
      const snapshot = browserTab(typeof path === "string" ? path : "");
      if (!snapshot) throw new TypeError("Invalid browser tab mention path");
      return { text: snapshot.title, href: path };
    }
    case "chatGptConversationMention":
    case "sitesProjectMention":
    case "pageReferenceMention":
      return { text: attrs.title, href: path };
    case "skillMention":
      return path === ""
        ? null
        : {
            text:
              typeof attrs.promptLinkLabel === "string" &&
              attrs.promptLinkLabel.length
                ? attrs.promptLinkLabel
                : `$${typeof attrs.name === "string" ? attrs.name : "skill"}`,
            href: path,
          };
    case "appMention":
      return {
        text: `$${typeof attrs.name === "string" ? attrs.name : "app"}`,
        href: path,
      };
    case "pluginMention":
      return {
        text: `@${typeof attrs.displayName === "string" && attrs.displayName.length ? attrs.displayName : typeof attrs.name === "string" ? attrs.name : "plugin"}`,
        href: path,
      };
    case "richLink":
      return { text: attrs.displayText, href: attrs.href };
    default:
      return null;
  }
}

/** KX for the plain prompt schema; callers apply AA and clipboard slice unwrapping separately. */
export function serializePromptText(
  doc: PromptDocument,
  options: SerializePromptOptions = {},
): string {
  const preserve = options.preserveTextLinkMarks === true;
  function clipboardLeafText(entry: PromptNode): string | undefined {
    const attrs = entry.attrs || {};
    if (
      [
        "skillMention",
        "browserSkillMention",
        "appMention",
        "pluginMention",
      ].includes(entry.type)
    ) {
      const promptLabel =
        entry.type === "skillMention" &&
        typeof attrs.promptLinkLabel === "string" &&
        attrs.promptLinkLabel.length > 0
          ? attrs.promptLinkLabel
          : `$${attrs.name}`;
      return (
        (entry.type === "skillMention"
          ? skillLabel(promptLabel).displayLabel
          : undefined) ??
        (attrs.displayName || attrs.name)
      );
    }
    if (entry.type === "resourceMention")
      return typeof attrs.title === "string" ? attrs.title : "";
    if (entry.type === "pageTaskMention")
      return task(attrs.path)?.orbit ? "@dot" : "@ChatGPT";
    return undefined;
  }
  function inline(entry: PromptNode): string {
    if (entry.type === "hard_break") return "\n";
    if (
      entry.type === "richLink" &&
      entry.attrs?.serializeAsUrl === true &&
      httpHref(entry.attrs.href) === entry.attrs.href &&
      librarySourceProvider(entry.attrs.href) != null
    )
      return entry.attrs.href;
    if (options.forClipboard) {
      const leaf = clipboardLeafText(entry);
      if (leaf != null) return leaf;
      const link = mentionLink(entry, false);
      if (link != null) return link.text;
    }
    if (entry.type === "skillMention" && entry.attrs?.path === "")
      return options.preserveUnresolvedSkillMentions
        ? entry.attrs.promptLinkLabel ||
            `$${entry.attrs.displayName || entry.attrs.name}`
        : "";
    const link = mentionLink(entry, options.preferFileMentionFsPath === true);
    if (link) return serializePromptLink(link.text, link.href);
    return children(entry.content || []);
  }
  function children(entries: PromptNode[]): string {
    let output = "",
      run = "",
      mark: PromptMark | undefined;
    function flush() {
      if (!run) return;
      if (
        options.forClipboard &&
        mark &&
        (mark.attrs?.href == null ||
          (mark.attrs?.href === run && mark.attrs.title == null))
      )
        output += run;
      else if (!mark) output += run;
      else if (mark.attrs?.href == null)
        output += httpHref(run) == null ? run : serializePromptLink(run, run);
      else
        output +=
          preserve && run === mark.attrs.href && mark.attrs.title == null
            ? run
            : serializePromptLink(
                run,
                `${preserve ? storagePrefix : ""}${mark.attrs.href}`,
                typeof mark.attrs.title === "string" ? mark.attrs.title : null,
              );
      run = "";
      mark = undefined;
    }
    for (const entry of entries) {
      if (entry.type === "text" && entry.text != null) {
        const next = entry.marks?.find((mark) => mark.type === "link");
        if (run && !equalAttrs(next?.attrs, mark?.attrs)) flush();
        run += entry.text;
        mark = next;
      } else {
        flush();
        output += inline(entry);
      }
    }
    flush();
    return output;
  }
  let output = "";
  function codeBlock(entry: PromptNode, indent = ""): string {
    // PZ code_block is text*, so textContent is the concatenated child text.
    const code = (entry.content || [])
      .map((child) => child.text || "")
      .join("");
    const longestBacktickRun = Math.max(
      0,
      ...Array.from(code.matchAll(/`+/g), (match) => match[0].length),
    );
    const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
    const rawLanguage = entry.attrs?.language;
    const validLanguage =
      typeof rawLanguage === "string" && /^[^`\s]+$/u.test(rawLanguage)
        ? rawLanguage
        : null;
    const language =
      entry.attrs?.autoDetectLanguage !== false && validLanguage === "plaintext"
        ? null
        : validLanguage;
    return `${indent}${fence}${language ?? ""}\n${code
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n")}\n${indent}${fence}\n`;
  }
  function list(entry: PromptNode, indent: string) {
    const ordered = entry.type === "ordered_list";
    const start = ordered ? (entry.attrs?.startingNumber ?? 1) : 1;
    (entry.content || []).forEach((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const continuation = indent + " ".repeat(marker.length);
      let hasParagraph = false;
      for (const child of item.content || []) {
        if (child.type === "paragraph") {
          output += `${hasParagraph ? continuation : indent + marker}${inline(child)}\n`;
          hasParagraph = true;
        } else if (child.type === "list" || child.type === "ordered_list")
          list(child, continuation);
        else if (child.type === "code_block")
          output += codeBlock(child, continuation);
      }
    });
  }
  function block(entry: PromptNode) {
    if (entry.type === "paragraph") output += `${inline(entry)}\n`;
    else if (entry.type === "code_block") output += codeBlock(entry);
    else if (entry.type === "list" || entry.type === "ordered_list")
      list(entry, "");
    else entry.content?.forEach(block);
  }
  doc.content.forEach(block);
  return output.endsWith("\n") ? output.slice(0, -1) : output;
}

function mergeTextNodes(entries: PromptNode[]) {
  const merged: PromptNode[] = [];
  for (const entry of entries) {
    const previous = merged.at(-1);
    if (
      entry.type === "text" &&
      previous?.type === "text" &&
      JSON.stringify(entry.marks || []) === JSON.stringify(previous.marks || [])
    ) {
      previous.text = (previous.text || "") + (entry.text || "");
    } else merged.push(entry);
  }
  return merged;
}

function equalAttrs(
  left?: Record<string, unknown>,
  right?: Record<string, unknown>,
) {
  if (!left || !right) return left === right;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}
