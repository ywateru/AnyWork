import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import type { Api } from "../api";
import { localFileTarget, type FileTarget } from "../fileLinks";
import {
  normalizeUserMessageMarkdown,
  remarkUserMessageLinks,
  firstAuthoredLink,
  unescapeAuthoredLabel,
} from "../userMessageMarkdown";
import { libraryFileLink } from "../libraryFileLinks";
import ImagePreview from "./ImagePreview";
import LibraryFileLink from "./LibraryFileLink";
import { messageThreadLinkTarget } from "../threadLinks";
import { useThreadLinkNavigation } from "./ThreadLinkNavigation";

// Component types stay stable while polling or streaming changes the message.
// Inline ReactMarkdown renderer functions otherwise unmount the image viewer.
interface MarkdownRenderingValue {
  api: Api;
  sessionId: string;
  cwd: string;
  basePath?: string;
  variant: "assistant" | "user";
  markdownText: string;
  link: (
    href: string | undefined,
    children: ReactNode,
    title?: string,
    rawLabel?: string,
  ) => ReactNode;
}
const MarkdownRendering = createContext<MarkdownRenderingValue>(null!);

export default function Markdown({
  text,
  api,
  sessionId,
  cwd,
  basePath,
  onOpenFile,
  variant = "assistant",
}: {
  text: string;
  api: Api;
  sessionId: string;
  cwd: string;
  basePath?: string;
  onOpenFile: (target: FileTarget) => void;
  variant?: "assistant" | "user";
}) {
  const openThread = useThreadLinkNavigation();
  const markdownText =
    variant === "user" ? normalizeUserMessageMarkdown(text) : text;
  function link(
    href: string | undefined,
    children: ReactNode,
    title?: string,
    rawLabel?: string,
  ) {
    if (!href) return <>{children}</>;
    if (messageThreadLinkTarget(href)) {
      return (
        <a
          href={href}
          title={title ?? href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            if (!openThread) return;
            event.preventDefault();
            openThread(href, event, "markdown");
          }}
          onAuxClick={(event) => {
            if (!openThread || event.button !== 1) return;
            event.preventDefault();
            openThread(href, event, "markdown");
          }}
        >
          {children}
        </a>
      );
    }
    const libraryFile = libraryFileLink(href);
    if (libraryFile) {
      const label = (rawLabel ?? textContent(children)).trim();
      return <LibraryFileLink file={libraryFile} label={label} />;
    }
    const target = localFileTarget(href, cwd, basePath);
    return target ? (
      <a
        className="local-file-link"
        href={href}
        title={target.path + (target.line ? `:${target.line}` : "")}
        onClick={(event) => {
          event.preventDefault();
          onOpenFile(target);
        }}
      >
        <FileText size={14} />
        {children}
      </a>
    ) : (
      <a
        href={href}
        title={title}
        target={href?.startsWith("#") ? undefined : "_blank"}
        rel="noreferrer noopener"
        onClick={(event) => {
          if (href?.startsWith("#") && basePath) {
            event.preventDefault();
            onOpenFile({ path: basePath, anchor: href.slice(1) });
          }
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <MarkdownRendering.Provider
      value={{ api, sessionId, cwd, basePath, variant, markdownText, link }}
    >
      <ReactMarkdown
        remarkPlugins={
          variant === "user" ? [remarkGfm, remarkUserMessageLinks] : [remarkGfm]
        }
        urlTransform={(url, key) =>
          (key === "href" || (key === "src" && variant === "user")) &&
          (localFileTarget(url, cwd, basePath) ||
            libraryFileLink(url) ||
            messageThreadLinkTarget(url))
            ? url
            : defaultUrlTransform(url)
        }
        components={markdownComponents}
      >
        {markdownText}
      </ReactMarkdown>
    </MarkdownRendering.Provider>
  );
}
function textContent(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (value && typeof value === "object" && "props" in value)
    return textContent((value.props as { children?: ReactNode }).children);
  return "";
}
function headingId(value: unknown): string {
  return (
    Array.isArray(value)
      ? value.map(headingId).join("")
      : typeof value === "string"
        ? value
        : ""
  )
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

const markdownComponents: Components = {
  a: function MarkdownLink({ href, children, title, node }) {
    const { markdownText, link } = useContext(MarkdownRendering);
    const start = node?.position?.start.offset,
      end = node?.position?.end.offset,
      authored =
        start == null || end == null
          ? null
          : firstAuthoredLink(markdownText.slice(start, end));
    return link(
      href,
      children,
      title,
      authored?.start === 0 ? unescapeAuthoredLabel(authored.label) : undefined,
    );
  },
  p: ({ children }) => <div className="md-paragraph">{children}</div>,
  img: function MarkdownImage({ src, alt, title }) {
    const { variant, link, cwd, basePath, api, sessionId } =
      useContext(MarkdownRendering);
    if (variant === "user") return <>!{link(src, alt || "", title)}</>;
    const target = localFileTarget(src, cwd, basePath);
    return target ? (
      <ImagePreview
        api={api}
        sessionId={sessionId}
        path={target.path}
        thumbnail
      />
    ) : (
      <span className="remote-image-placeholder">
        {alt || "图片"}（外部图片）
      </span>
    );
  },
  h1: ({ children }) => <h1 id={headingId(children)}>{children}</h1>,
  h2: ({ children }) => <h2 id={headingId(children)}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(children)}>{children}</h3>,
};
