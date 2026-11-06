import { FileText } from "lucide-react";
import type { Api } from "../../api";
import { localFileTarget, type FileTarget } from "../../fileLinks";
import { toolResultPresentation } from "../../toolPresentation";
import ImagePreview from "../ImagePreview";
import RawToolOutput from "./RawToolOutput";

export default function ToolResult({
  item,
  output,
  api,
  sessionId,
  cwd,
  onOpenFile,
}: {
  item: Record<string, any>;
  output: string;
  api: Api;
  sessionId: string;
  cwd: string;
  onOpenFile: (target: FileTarget) => void;
}) {
  const result = toolResultPresentation(item, output);
  const mcp = ["mcpToolCall", "dynamicToolCall"].includes(item.type);
  function resource(block: Record<string, any>) {
    const uri = typeof block.uri === "string" ? block.uri : "";
    const target = localFileTarget(uri, cwd);
    const label = block.title || block.name || uri || "工具资源";
    if (target)
      return (
        <button
          className="tool-resource-link"
          onClick={() => onOpenFile(target)}
        >
          <FileText size={14} />
          {label}
        </button>
      );
    if (/^https?:\/\//i.test(uri))
      return (
        <a
          className="tool-resource-link"
          href={uri}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText size={14} />
          {label}
        </a>
      );
    return (
      <span className="tool-resource-reference">
        <FileText size={14} />
        {label}
      </span>
    );
  }
  return (
    <div
      className={`tool-result-content ${mcp ? "mcp-tool-result" : "command-tool-result"}`}
    >
      {result.error && (
        <div className="tool-result-error" role="alert">
          {result.error}
        </div>
      )}
      {item.type === "fileChange" &&
        Array.isArray(item.changes) &&
        item.changes.map((change: Record<string, any>, index: number) => (
          <div className="tool-file-change" key={index}>
            <button
              className="tool-resource-link"
              onClick={() => onOpenFile({ path: change.path })}
            >
              <FileText size={14} />
              {change.path}
            </button>
            {typeof change.diff === "string" && <pre>{change.diff}</pre>}
          </div>
        ))}
      {result.blocks.map((block, index) => {
        const key = `${item.id || "result"}-${index}`;
        if (block.type === "text" && typeof block.text === "string")
          return (
            <pre className="tool-text-output" key={key}>
              {block.text}
            </pre>
          );
        if (block.type === "localImage" && typeof block.path === "string")
          return (
            <div className="tool-result-image" key={key}>
              <ImagePreview
                api={api}
                sessionId={sessionId}
                path={block.path}
                autoLoad
                thumbnail
                compact
                displayName={block.name || "工具返回的图片"}
              />
            </div>
          );
        if (block.type === "localFile" && typeof block.path === "string")
          return <div key={key}>{resource({ ...block, uri: block.path })}</div>;
        if (
          block.type === "image" &&
          typeof block.data === "string" &&
          /^image\/(png|jpeg|gif|webp)$/.test(block.mimeType)
        ) {
          const path = `tool-result-${key}`;
          return (
            <div className="tool-result-image" key={key}>
              <ImagePreview
                api={api}
                sessionId={sessionId}
                path={path}
                autoLoad
                compact
                localSources={{
                  [path]: `data:${block.mimeType};base64,${block.data}`,
                }}
                displayName="工具返回的图片"
              />
            </div>
          );
        }
        if (
          block.type === "audio" &&
          typeof block.data === "string" &&
          /^audio\/[a-z0-9.+-]+$/i.test(block.mimeType)
        )
          return (
            <audio
              key={key}
              controls
              preload="none"
              src={`data:${block.mimeType};base64,${block.data}`}
              aria-label="工具返回的音频"
            />
          );
        if (block.type === "resource_link")
          return <div key={key}>{resource(block)}</div>;
        if (block.type === "resource" && block.resource)
          return (
            <div key={key}>
              {resource(block.resource)}
              {typeof block.resource.text === "string" && (
                <pre className="tool-text-output">{block.resource.text}</pre>
              )}
            </div>
          );
        return <pre key={key}>{JSON.stringify(block, null, 2)}</pre>;
      })}
      {result.structured != null && (
        <pre className="tool-structured-output">
          {JSON.stringify(result.structured, null, 2)}
        </pre>
      )}
      {result.output && <pre className="tool-text-output">{result.output}</pre>}
      {!result.error &&
        !result.blocks.length &&
        result.structured == null &&
        !result.output &&
        item.type !== "fileChange" && (
          <p className="tool-empty-output">
            {["inProgress", "running", "started"].includes(item.status)
              ? "等待工具结果…"
              : "工具未返回内容"}
          </p>
        )}
      {mcp && <RawToolOutput item={item} />}
    </div>
  );
}
