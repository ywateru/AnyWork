import { useEffect, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";
import type { Api } from "../api";

export const isDocumentPath = (path: string) =>
  /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i.test(path);

/** Fetch with authorization before creating a local URL; credentials never enter the viewer URL. */
export default function DocumentPreview({
  api,
  sessionId,
  path,
}: {
  api: Api;
  sessionId: string;
  path: string;
}) {
  const [resource, setResource] = useState<{
    path: string;
    url: string;
    pdf: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setResource(null);
    setError("");
    api
      .binary(
        `/sessions/${sessionId}/document?path=${encodeURIComponent(path)}`,
        { signal: controller.signal },
      )
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResource({ path, url, pdf: blob.type === "application/pdf" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "无法读取文档");
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, sessionId, path, attempt]);
  if (error)
    return (
      <div className="document-placeholder" role="alert">
        <p>{error}</p>
        <button onClick={() => setAttempt((n) => n + 1)}>
          <RefreshCw size={15} />
          重试
        </button>
      </div>
    );
  if (!resource || resource.path !== path)
    return (
      <div className="document-placeholder" role="status">
        正在读取文档…
      </div>
    );
  const name = path.split("/").pop() || "document";
  return (
    <div className="binary-document-preview">
      <div className="binary-document-actions">
        <span>
          <FileText size={15} />
          {name}
        </span>
        <a href={resource.url} download={name}>
          <Download size={15} />
          下载文件
        </a>
      </div>
      {resource.pdf ? (
        <iframe
          title={`PDF 预览：${name}`}
          src={resource.url}
          className="pdf-document-frame"
        />
      ) : (
        <div className="document-placeholder">
          <FileText size={32} />
          <p>{name}</p>
          <p>下载后使用文档应用打开。</p>
          <a href={resource.url} download={name}>
            下载文档
          </a>
        </div>
      )}
    </div>
  );
}
