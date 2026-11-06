import { useId } from "react";
import { libraryFileIcons } from "../libraryFileIcons";
import {
  libraryMountedProvider,
  type LibraryFileLink as LibraryFile,
} from "../libraryFileLinks";
import "./LibraryFileLink.css";

/** ABo/B2's inline-flow file-reference, retaining both transport and source URLs. */
export default function LibraryFileLink({
  file,
  label,
}: {
  file: LibraryFile;
  label: string;
}) {
  const id = useId().replace(/:/g, ""),
    iconKey = libraryIconKey(file, label),
    icon = libraryFileIcons[iconKey];
  // Original artwork contains local paint-server IDs; scope each inline instance.
  const body = icon.body
    .replace(/id="([^"]+)"/g, `id="${id}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`);
  return (
    <a
      className="library-file-link"
      href={file.href}
      target="_blank"
      rel="noreferrer noopener"
      data-prompt-link-href={file.mentionPath}
      data-prompt-link-label={label}
      data-library-file-id={file.libraryFileId}
      data-library-file-mime-type={file.mimeType}
    >
      <span
        className="library-file-mention"
        data-appearance="inline-mention"
        data-font-weight="medium"
        data-layout="inline-flow"
        data-tone="file-reference"
        data-interactive=""
        data-inline-mention-interactive=""
        data-underline-on-hover=""
      >
        <span className="library-file-icon-slot" aria-hidden="true">
          <svg
            className={`library-file-icon library-file-icon-${iconKey}`}
            data-file-icon={iconKey}
            width="16"
            height="16"
            viewBox={icon.viewBox}
            fill="none"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        </span>
        <span className="library-file-label">{label}</span>
      </span>
    </a>
  );
}

/** The common pgn/a3/Omn message-inline artwork branches. */
export function libraryIconKey(
  file: Pick<LibraryFile, "libraryFileId" | "mimeType" | "href">,
  name: string,
): keyof typeof libraryFileIcons {
  const mime = file.mimeType.toLowerCase(),
    mimeBase = mime.split(";", 1)[0].trim(),
    baseName = name.trim().split(/[\\/]/).pop() ?? "",
    dot = baseName.lastIndexOf("."),
    extension =
      dot === baseName.length - 1
        ? undefined
        : (dot < 0 ? baseName : baseName.slice(dot + 1)).toLowerCase(),
    provider = libraryMountedProvider(file.libraryFileId);
  // eBo resolves these filename extensions before calling pgn/a3.
  if (inSet(extension, "markdown md mdown mdx mkd txt")) return "text";
  const google = {
    "application/vnd.google-apps.document": "google-docs",
    "application/vnd.google-apps.spreadsheet": "google-sheets",
    "application/vnd.google-apps.presentation": "google-slides",
  } as const;
  if (mimeBase in google) return google[mimeBase as keyof typeof google];
  if (provider === "google_drive") {
    const source = new URL(file.href);
    if (source.hostname === "docs.google.com") {
      if (source.pathname.startsWith("/document/")) return "google-docs";
      if (source.pathname.startsWith("/spreadsheets/")) return "google-sheets";
      if (source.pathname.startsWith("/presentation/")) return "google-slides";
    }
  }
  if (
    provider === "box" &&
    extension &&
    ["gdoc", "gsheet", "gslides"].includes(extension)
  ) {
    return extension === "gdoc"
      ? "google-docs"
      : extension === "gsheet"
        ? "google-sheets"
        : "google-slides";
  }
  if (extension === "pdf" || mime.includes("pdf")) return "pdf";
  if (inSet(extension, "csv tsv") || mime.includes("csv")) return "csv";
  if (inSet(extension, "xls xlsm xlsx") || /excel|spreadsheetml/.test(mime))
    return "xls";
  if (mime.includes("spreadsheet")) return "csv";
  if (inSet(extension, "ppt pptx") || /powerpoint|presentationml/.test(mime))
    return "ppt";
  if (extension === "key" || mime.includes("presentation")) return "slides";
  if (inSet(extension, "doc docx") || mime.includes("word")) return "document";
  if (
    inSet(extension, "3ds blend dae fbx glb gltf obj ply stl usdz") ||
    /^model\//.test(mime) ||
    /x-3ds|x-blender|wavefront/.test(mime)
  )
    return "three-d";
  if (inSet(extension, "ts tsx jsx js py java rs php json c cc cpp h hpp"))
    return "code";
  if (inSet(extension, "html htm")) return "html";
  if (/typescript|javascript|python|json/.test(mime)) return "code";
  if (mime.includes("html")) return "html";
  if (
    inSet(
      extension,
      "bash bazel build bzl c cc cpp cs css cxx dockerfile fish gradle go h hh hpp html htm ini ipynb java js jsonc json jsx kt less lua m makefile mjs mk mm ninja php pl ps1 py rb rs scss sass sh sql swift toml ts tsx vue xml yaml yml zsh",
    ) ||
    mime.includes("xml")
  )
    return "code";
  if (
    inSet(
      extension,
      "dotenv env gitignore lock markdown md mdown mdx mkd rtf txt",
    ) ||
    mime.startsWith("text/")
  )
    return "text";
  if (
    inSet(extension, "gz tar tgz zip") ||
    /^(application\/(zip|gzip|x-gzip|x-tar|x-zip|x-zip-compressed)|multipart\/x-zip)$/.test(
      mime,
    )
  )
    return "zip";
  if (
    inSet(extension, "aac aif aiff flac m4a mp3 oga ogg opus wav weba wma") ||
    mime.startsWith("audio/")
  )
    return "audio";
  if (
    inSet(extension, "3gp avi m4v mkv mov mp4 mpeg mpg webm wmv") ||
    mime.startsWith("video/")
  )
    return "file-video";
  if (
    inSet(
      extension,
      "avif bmp gif heic heif jpg jpeg jfif png svg tif tiff webp",
    ) ||
    mime.startsWith("image/")
  )
    return "photo";
  return provider ?? "file";
}

function inSet(value: string | undefined, values: string) {
  return value != null && values.split(" ").includes(value);
}
