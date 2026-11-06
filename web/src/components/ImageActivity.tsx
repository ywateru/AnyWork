import { useCallback, useState } from "react";
import { ChevronDown, Images } from "lucide-react";
import type { Api } from "../api";
import ImagePreview from "./ImagePreview";
export default function ImageActivity({
  api,
  sessionId,
  path,
  messageId,
  gallery,
  paths,
}: {
  api: Api;
  sessionId: string;
  path: string;
  messageId: string;
  gallery?: string[];
  paths?: string[];
}) {
  const imagePaths = paths?.length ? paths : [path];
  const [sources, setSources] = useState<Record<string, string>>({});
  const loaded = useCallback(
    (path: string, src: string) =>
      setSources((old) => (old[path] === src ? old : { ...old, [path]: src })),
    [],
  );
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="message image-message" data-message-id={messageId}>
      <button
        className="image-tool-label"
        aria-expanded={expanded}
        aria-controls={`image-${messageId}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <Images size={15} />
        <span>已查看 {imagePaths.length} 张图像</span>
        <ChevronDown size={14} />
      </button>
      <div
        className="image-activity-thumbnails"
        id={`image-${messageId}`}
        hidden={!expanded}
      >
        {imagePaths.map((imagePath) => (
          <ImagePreview
            key={imagePath}
            api={api}
            sessionId={sessionId}
            path={imagePath}
            thumbnail
            autoLoad={expanded}
            gallery={gallery}
            localSources={sources}
            onLoaded={loaded}
          />
        ))}
      </div>
    </article>
  );
}
