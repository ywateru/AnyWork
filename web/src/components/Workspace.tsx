import { useEffect, useRef, useState } from "react";
import {
  Folder,
  FileCode,
  FileText,
  ChevronRight,
  ChevronDown,
  Save,
  RefreshCw,
  X,
  Search,
  Copy,
  PanelRight,
  Pencil,
  Eye,
  GitCompare,
  MoreHorizontal,
} from "lucide-react";
import { Api } from "../api";
import "./FileSaveStatus.css";
import Markdown from "./Markdown";
import ImagePreview from "./ImagePreview";
import DocumentPreview, { isDocumentPath } from "./DocumentPreview";
import { isImagePath, type FileTarget } from "../fileLinks";
interface Entry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}

function FileTree({
  api,
  id,
  path = "",
  filter,
  onSelect,
  selected,
}: {
  api: Api;
  id: string;
  path?: string;
  filter: string;
  onSelect: (target: FileTarget) => void;
  selected: string;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api
      .request(`/sessions/${id}/files?path=${encodeURIComponent(path)}`, {
        signal: controller.signal,
      })
      .then((data) => {
        if (!controller.signal.aborted) setEntries(data.entries || []);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [api, id, path]);
  useEffect(() => {
    const parents = entries
      .filter(
        (entry) => entry.directory && selected.startsWith(entry.path + "/"),
      )
      .map((entry) => entry.path);
    if (parents.length) setExpanded((old) => new Set([...old, ...parents]));
  }, [selected, entries]);
  return (
    <div
      className="file-tree-level"
      role={path ? "group" : "tree"}
      aria-label={path ? undefined : "工作目录文件树"}
    >
      {error && (
        <p className="file-tree-error" role="alert">
          {error}
        </p>
      )}
      {entries
        .filter(
          (e) =>
            !filter ||
            e.directory ||
            e.name.toLowerCase().includes(filter.toLowerCase()),
        )
        .map((entry) => (
          <div key={entry.path}>
            <button
              role="treeitem"
              aria-expanded={
                entry.directory ? expanded.has(entry.path) : undefined
              }
              aria-selected={
                !entry.directory ? selected === entry.path : undefined
              }
              title={entry.path}
              onClick={() =>
                entry.directory
                  ? setExpanded((old) => {
                      const next = new Set(old);
                      next.has(entry.path)
                        ? next.delete(entry.path)
                        : next.add(entry.path);
                      return next;
                    })
                  : onSelect({ path: entry.path })
              }
            >
              {entry.directory ? (
                expanded.has(entry.path) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : (
                <span className="tree-indent" />
              )}
              {entry.directory ? (
                <Folder size={15} />
              ) : isImagePath(entry.path) ? (
                <FileCode size={15} />
              ) : (
                <FileText size={15} />
              )}
              <span>{entry.name}</span>
            </button>
            {entry.directory && expanded.has(entry.path) && (
              <FileTree
                api={api}
                id={id}
                path={entry.path}
                filter={filter}
                onSelect={onSelect}
                selected={selected}
              />
            )}
          </div>
        ))}
      {!entries.length && !error && <span className="tree-empty">空目录</span>}
    </div>
  );
}
export default function Workspace({
  api,
  id,
  tab,
  cwd,
  target,
  onError,
  onSelectFile,
  onClose,
}: {
  api: Api;
  id: string;
  tab: string;
  cwd: string;
  target?: FileTarget | null;
  onError: (e: unknown) => void;
  onSelectFile?: (target: FileTarget) => void;
  onClose?: () => void;
}) {
  const [file, setFile] = useState<FileTarget | null>(null),
    [content, setContent] = useState<string | null>(null),
    [original, setOriginal] = useState(""),
    [revision, setRevision] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [comparing, setComparing] = useState(false),
    [latest, setLatest] = useState<{
      content: string;
      revision: string;
    } | null>(null),
    [git, setGit] = useState({ status: "", diff: "" }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState(false),
    [tree, setTree] = useState(true),
    [filter, setFilter] = useState(""),
    [changes, setChanges] = useState(false),
    [refresh, setRefresh] = useState(0);
  const preview = useRef<HTMLDivElement>(null),
    editor = useRef<HTMLTextAreaElement>(null);
  const selectFile = (next: FileTarget, notify = true) => {
    setFile({
      ...next,
      path: next.path.startsWith("/") ? next.path : `${cwd}/${next.path}`,
    });
    setEdit(false);
    setChanges(false);
    if (notify) onSelectFile?.(next);
  };
  useEffect(() => {
    setFile(null);
    setContent(null);
    setError("");
    setEdit(false);
  }, [id]);
  useEffect(() => {
    if (target) selectFile(target, false);
    else {
      setFile(null);
      setEdit(false);
      setChanges(false);
    }
  }, [target, id]);
  const path = file?.path || "";
  const owner = useRef({ api, id, path, tab, changes, refresh });
  if (
    owner.current.api !== api ||
    owner.current.id !== id ||
    owner.current.path !== path ||
    owner.current.tab !== tab ||
    owner.current.changes !== changes ||
    owner.current.refresh !== refresh
  )
    owner.current = { api, id, path, tab, changes, refresh };
  const inFlight = useRef<object | null>(null);
  useEffect(() => {
    setSaving(false);
    setSaveError("");
    setComparing(false);
    setLatest(null);
    setRevision(null);
    inFlight.current = null;
  }, [api, id, path, tab, changes, refresh]);
  async function compareLatest() {
    const identity = owner.current;
    setComparing(true);
    try {
      const data = await api.request<{ content: string; revision?: string }>(
        `/sessions/${id}/files?path=${encodeURIComponent(path)}`,
      );
      if (owner.current !== identity) return;
      if (typeof data.content !== "string" || !data.revision)
        throw new Error("服务未提供文件版本，请先升级本地服务；当前草稿已保留");
      setLatest({ content: data.content, revision: data.revision });
    } catch (error) {
      if (owner.current === identity)
        setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      if (owner.current === identity) setComparing(false);
    }
  }
  async function save() {
    const identity = owner.current;
    if (!revision || inFlight.current === identity || content === null) return;
    const submitted = content;
    const expected = revision;
    inFlight.current = identity;
    setSaving(true);
    setSaveError("");
    setLatest(null);
    try {
      const result = await api.request<{ revision?: string }>(
        `/sessions/${id}/files`,
        {
          method: "PUT",
          body: JSON.stringify({
            path,
            content: submitted,
            expected_revision: expected,
          }),
        },
      );
      if (owner.current !== identity) return;
      if (!result.revision)
        throw new Error(
          "保存结果未包含文件版本，请比较最新文件确认；当前草稿已保留",
        );
      // Edits typed while the request is pending remain dirty against this
      // captured submission rather than being incorrectly marked as saved.
      setOriginal(submitted);
      setRevision(result.revision);
    } catch (error) {
      if (owner.current === identity)
        setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      if (inFlight.current === identity) inFlight.current = null;
      if (owner.current === identity) setSaving(false);
    }
  }
  const markdown = /\.(md|mdx|markdown)$/i.test(path),
    image = isImagePath(path),
    binaryDocument = isDocumentPath(path);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    setContent(null);
    const load = async () => {
      if (tab === "git" || changes) {
        const data = await api.request(`/sessions/${id}/git`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setGit(data);
      } else if (path && !image && !binaryDocument) {
        const data = await api.request(
          `/sessions/${id}/files?path=${encodeURIComponent(path)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setContent(data.content ?? null);
          setOriginal(data.content ?? "");
          setRevision(typeof data.revision === "string" ? data.revision : null);
        }
      }
    };
    void load()
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, id, path, tab, image, binaryDocument, changes, refresh]);
  useEffect(() => {
    if (loading || !file) return;
    const frame = requestAnimationFrame(() => {
      if (file.anchor) {
        const heading = Array.from(
          preview.current?.querySelectorAll("[id]") || [],
        ).find((e) => e.id === file.anchor);
        heading?.scrollIntoView({ block: "start" });
      }
      if (file.line && editor.current && content) {
        const lines = content.split("\n");
        const start =
          lines.slice(0, file.line - 1).join("\n").length +
          (file.line > 1 ? 1 : 0);
        editor.current.setSelectionRange(
          start,
          start + (lines[file.line - 1]?.length || 0),
        );
        editor.current.scrollTop = (file.line - 1) * 20;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [file, loading, content, edit]);
  const relative = path.startsWith(cwd + "/")
    ? path.slice(cwd.length + 1)
    : path;
  return (
    <div className="workspace-panel codex-file-panel">
      <div className="document-toolbar">
        <div className="document-breadcrumb" title={path || cwd}>
          {(path.startsWith(cwd + "/")
            ? `${cwd.split("/").filter(Boolean).pop()}/${relative}`
            : path || cwd
          )
            .split("/")
            .filter(Boolean)
            .map((part, index, all) => (
              <span key={index}>
                {index > 0 && <ChevronRight size={12} />}
                <span className={index === all.length - 1 ? "current" : ""}>
                  {part}
                </span>
              </span>
            ))}
        </div>
        <div className="inspector-actions">
          {path && tab !== "git" && (
            <button
              className={changes ? "active" : ""}
              title="显示更改"
              aria-label="显示更改"
              onClick={() => setChanges((v) => !v)}
            >
              <GitCompare size={16} />
              <span>显示更改</span>
            </button>
          )}
          <details className="document-options" data-floating-menu>
            <summary title="文件选项" aria-label="文件选项">
              <MoreHorizontal size={18} />
            </summary>
            <div>
              <button onClick={() => setTree((v) => !v)}>
                <PanelRight size={15} />
                {tree ? "隐藏文件树" : "显示文件树"}
              </button>
              <button onClick={() => setRefresh((v) => v + 1)}>
                <RefreshCw size={15} />
                刷新文件
              </button>
              {path && (
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(path).catch(onError)
                  }
                >
                  <Copy size={15} />
                  复制路径
                </button>
              )}
            </div>
          </details>
          {onClose && (
            <button
              aria-label="关闭侧面板"
              title="关闭侧面板"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          )}
        </div>
      </div>
      <div
        className={`document-layout${tree && tab !== "git" ? " with-tree" : ""}`}
      >
        <div className="document-content" ref={preview}>
          {loading ? (
            <div className="document-placeholder" role="status">
              <span className="loading-spinner" />
              正在加载文件…
            </div>
          ) : error ? (
            <div className="document-placeholder" role="alert">
              {error}
              <button onClick={() => setRefresh((v) => v + 1)}>重试</button>
            </div>
          ) : tab === "git" || changes ? (
            <div className="git-view">
              <h4>{changes ? `${relative} · 工作区差异` : "工作区状态"}</h4>
              <pre>{git.status || "暂无变更"}</pre>
              <h4>差异</h4>
              <pre>
                {git.diff
                  ? git.diff.split("\n").map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.startsWith("+")
                            ? "added"
                            : line.startsWith("-")
                              ? "removed"
                              : ""
                        }
                      >
                        {line || " "}
                      </div>
                    ))
                  : "工作区干净，或尚无提交。"}
              </pre>
            </div>
          ) : !file ? (
            <div className="document-placeholder">
              <FileText size={26} />
              <p>选择文件以预览</p>
            </div>
          ) : image ? (
            <div className="document-image">
              <ImagePreview
                api={api}
                sessionId={id}
                path={path}
                thumbnail
                autoLoad
              />
            </div>
          ) : binaryDocument ? (
            <DocumentPreview
              key={`${id}:${path}:${refresh}`}
              api={api}
              sessionId={id}
              path={path}
            />
          ) : content !== null ? (
            <>
              <div className="document-file-actions">
                <button
                  title="复制文件内容"
                  aria-label="复制文件内容"
                  onClick={() =>
                    navigator.clipboard.writeText(content).catch(onError)
                  }
                >
                  <Copy size={15} />
                </button>
                {markdown && (
                  <button
                    aria-label={edit ? "预览文档" : "编辑文档"}
                    title={edit ? "预览文档" : "编辑文档"}
                    onClick={() => setEdit((v) => !v)}
                  >
                    {edit ? <Eye size={15} /> : <Pencil size={15} />}
                  </button>
                )}
                {(!markdown || edit) && (
                  <button
                    className="save-file"
                    disabled={content === original || saving || !revision}
                    onClick={() => void save()}
                  >
                    <Save size={14} />
                    {saving ? "正在保存…" : "保存"}
                  </button>
                )}
              </div>
              {!revision && (
                <p className="file-save-status" role="status">
                  服务未提供文件版本，暂不能安全保存；请升级本地服务，草稿可复制保留。
                </p>
              )}
              {saveError && (
                <div className="file-save-status" role="alert">
                  <p>{saveError}</p>
                  <p>当前草稿已保留。请先比较最新文件，确认后再保存。</p>
                  <button
                    disabled={comparing}
                    onClick={() => void compareLatest()}
                  >
                    {comparing ? "正在读取最新文件…" : "比较最新文件"}
                  </button>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(content).catch(onError)
                    }
                  >
                    复制当前草稿
                  </button>
                </div>
              )}
              {latest && (
                <section
                  className="file-save-comparison"
                  aria-label="最新文件比较"
                >
                  <h4>服务器最新内容（当前草稿保留在编辑框）</h4>
                  <pre>{latest.content || "（空文件）"}</pre>
                  <button
                    onClick={() => {
                      setOriginal(latest.content);
                      setRevision(latest.revision);
                      setSaveError("");
                      setLatest(null);
                    }}
                  >
                    使用此版本作为保存基线，保留草稿
                  </button>
                  <button
                    onClick={() => {
                      setContent(latest.content);
                      setOriginal(latest.content);
                      setRevision(latest.revision);
                      setSaveError("");
                      setLatest(null);
                    }}
                  >
                    放弃草稿并载入最新文件
                  </button>
                </section>
              )}
              {markdown && !edit ? (
                <div className="markdown document-markdown">
                  <Markdown
                    text={content}
                    api={api}
                    sessionId={id}
                    cwd={cwd}
                    basePath={path}
                    onOpenFile={selectFile}
                  />
                </div>
              ) : (
                <textarea
                  ref={editor}
                  aria-label="文件内容"
                  className="file-editor"
                  spellCheck={false}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              )}
            </>
          ) : null}
        </div>
        {tree && tab !== "git" && (
          <aside className="document-file-tree" aria-label="文件浏览器">
            <label className="file-tree-search">
              <Search size={15} />
              <input
                aria-label="筛选文件"
                placeholder="筛选文件…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <div className="file-tree-scroll">
              <FileTree
                key={`${id}:${refresh}`}
                api={api}
                id={id}
                filter={filter}
                selected={relative}
                onSelect={selectFile}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
