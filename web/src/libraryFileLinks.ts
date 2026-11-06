const libraryFilePrefix = "chatgpt-library-file://";

export type LibraryProvider =
  "google_drive" | "box" | "dropbox" | "onedrive" | "sharepoint";

export interface LibraryFileLink {
  mentionPath: string;
  libraryFileId: string;
  mimeType: string;
  href: string;
  sourceProvider: LibraryProvider;
}

/** Shipped _pn/vpn: this is deliberately stricter than input restoration QEe. */
export function libraryFileLink(
  href: string | undefined,
): LibraryFileLink | null {
  if (!href?.startsWith(libraryFilePrefix)) return null;
  const rest = href.slice(libraryFilePrefix.length),
    queryIndex = rest.indexOf("?");
  try {
    const libraryFileId = decodeURIComponent(
      queryIndex === -1 ? rest : rest.slice(0, queryIndex),
    ).trim();
    if (!libraryFileId) return null;
    const params = new URLSearchParams(
      queryIndex === -1 ? "" : rest.slice(queryIndex + 1),
    );
    const sourceUrl = params.get("sourceUrl");
    if (
      params.get("asUrl") !== "1" ||
      !sourceUrl ||
      sourceUrl !== sourceUrl.trim() ||
      /\s/u.test(sourceUrl)
    )
      return null;
    const sourceProvider = librarySourceProvider(sourceUrl);
    return sourceProvider
      ? {
          mentionPath: href,
          libraryFileId,
          mimeType: params.get("mimeType") ?? "",
          href: sourceUrl,
          sourceProvider,
        }
      : null;
  } catch {
    return null;
  }
}

/** Shipped Zfn -> Xfn/Ydn, including each provider's own URL grammar. */
export function librarySourceProvider(source: string): LibraryProvider | null {
  if (
    /^https:\/\/(?:www\.)?dropbox\.com\/embedded_preview\?fileId=id(?:%3[Aa]|:)([A-Za-z0-9_-]{1,253})$/u.test(
      source,
    )
  )
    return "dropbox";
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  )
    return null;
  if (url.hostname === "docs.google.com") {
    const match =
      /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/|$)/.exec(
        url.pathname,
      );
    if (match && match[2] !== "e") return "google_drive";
  }
  if (url.hostname === "drive.google.com") {
    const id = /^\/(?:a\/[^/]+\/)?open\/?$/.test(url.pathname)
      ? url.searchParams.get("id")
      : null;
    if (
      /^\/file\/d\/([\w-]+)(?:\/|$)/.test(url.pathname) ||
      (id != null && /^[\w-]+$/.test(id))
    )
      return "google_drive";
  }
  if (
    source.length <= 2048 &&
    !/[\s\\]/u.test(source) &&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)?(?:app\.)?box\.com$/.test(
      url.hostname,
    ) &&
    /^\/file\/([1-9][0-9]{0,511})\/?$/.test(url.pathname)
  )
    return "box";

  // Shipped nfn rejects credentials, explicit ports (even :443), backslashes
  // and control characters for Dropbox, SharePoint and OneDrive.
  const authority = /^https:\/\/([^/?#]+)/i.exec(source)?.[1];
  if (
    source.length > 8192 ||
    /[\s\\\u0000-\u001f\u007f]/u.test(source) ||
    authority?.toLowerCase() !== url.hostname
  )
    return null;
  if (url.hostname === "dropbox.com" || url.hostname === "www.dropbox.com") {
    const previews = url.searchParams.getAll("preview"),
      preview = previews.length === 1 ? previews[0] : undefined;
    if (
      /^\/(?:s|scl\/fi)\/[A-Za-z0-9_-]+\/[^/?#]+$/.test(url.pathname) ||
      (url.pathname.startsWith("/preview/") && !url.pathname.endsWith("/")) ||
      (/^\/home(?:\/.*)?$/.test(url.pathname) &&
        preview != null &&
        preview.trim().length > 0 &&
        !preview.endsWith("/"))
    )
      return "dropbox";
  }
  if (
    url.hostname === "graph.microsoft.com" &&
    url.search === "" &&
    /^\/v1\.0\/drives\/[A-Za-z0-9._!~:-]{1,512}\/items\/[A-Za-z0-9._!~:-]{1,512}$/.test(
      url.pathname,
    )
  )
    return "onedrive";
  if (
    /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?-my\.sharepoint\.com$/.test(
      url.hostname,
    )
  ) {
    if (/\/_layouts\/15\/onedrive\.aspx$/i.test(url.pathname)) {
      const id = url.searchParams.get("id");
      return id != null && /^\/personal\/.+\/[^/]+\.[^/.]+$/.test(id)
        ? "onedrive"
        : null;
    }
    return sharePointFilePath(url) ? "onedrive" : null;
  }
  if (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sharepoint\.com$/.test(
      url.hostname,
    ) &&
    !/-my\.sharepoint\.com$/.test(url.hostname) &&
    sharePointFilePath(url)
  )
    return "sharepoint";
  return null;
}

function sharePointFilePath(url: URL) {
  return /^\/:[a-z]:\//i.test(url.pathname)
    ? /^\/:[a-eg-z]:\/[rsg]\/.+/i.test(url.pathname)
    : /\/_layouts\/15\/Doc\.aspx$/i.test(url.pathname)
      ? !!url.searchParams.get("sourcedoc")
      : !/\.aspx$/i.test(url.pathname) && /\/[^/]+\.[^/.]+$/.test(url.pathname);
}

/** Fpn's mounted-file validation; provider artwork is not inferred from the URL. */
export function libraryMountedProvider(id: string): LibraryProvider | null {
  if (id.startsWith("file-library:")) id = id.slice(13);
  if (!id.startsWith("external-")) return null;
  const match =
    /^external-([a-z0-9][a-z0-9-]*):(?:account:((?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+):)?(?:(file|folder|collection):(\S+)|root)$/.exec(
      id,
    );
  if (!match) return null;
  const [, provider, account, kind, nativeId] = match;
  const accountProviders = ["box", "dropbox", "sharepoint"];
  if (account != null) {
    if (provider === "gdrive") {
      if (!/^[A-Za-z0-9_-]+$/u.test(account)) return null;
    } else {
      try {
        const decoded = decodeURIComponent(account),
          allowWhitespace = accountProviders.includes(provider),
          canonical = encodeURIComponent(decoded).replace(
            /[!'()*]/gu,
            (character) =>
              `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
          );
        if (
          account.length > 1536 ||
          !decoded ||
          (allowWhitespace
            ? /^\p{White_Space}|\p{White_Space}$/u.test(decoded)
            : decoded !== decoded.trim()) ||
          /[\u0000-\u001f\u007f]/u.test(decoded) ||
          new TextEncoder().encode(decoded).length > 512 ||
          canonical !== account
        )
          return null;
      } catch {
        return null;
      }
      if (!accountProviders.includes(provider) && kind !== "file") return null;
      if (
        accountProviders.includes(provider) &&
        (id.length > 4096 ||
          new TextEncoder().encode(id).length > 4096 ||
          (kind === "file" &&
            nativeId != null &&
            (new TextEncoder().encode(nativeId).length > 2048 ||
              /[\u0000-\u001f\u007f]/u.test(nativeId))))
      )
        return null;
    }
  }
  if (kind !== "file" || nativeId == null) return null;
  if (provider === "onedrive") {
    if (!id.startsWith("external-onedrive:file:v3:") || id.length > 2100)
      return null;
    const [, , version, driveType, ...parts] = id.split(":");
    return version === "v3" &&
      (driveType === "personal" || driveType === "business") &&
      parts.length === 3 &&
      parts.every(validMountedIdPart)
      ? "onedrive"
      : null;
  }
  if (provider === "sharepoint") {
    if (!nativeId.startsWith("v1:item:")) return null;
    const parts = nativeId.slice(8).split(":");
    return parts.length === 2 && parts.every(validMountedIdPart)
      ? "sharepoint"
      : null;
  }
  if (nativeId.length > 512) return null;
  if (provider === "gdrive")
    return /^[A-Za-z0-9_-]{5,512}$/u.test(nativeId) ? "google_drive" : null;
  if (provider === "box") return /^[1-9][0-9]*$/u.test(nativeId) ? "box" : null;
  if (provider === "dropbox")
    return nativeId.length <= 256 && /^id:[A-Za-z0-9_:-]+$/u.test(nativeId)
      ? "dropbox"
      : null;
  return null;
}

function validMountedIdPart(part: string) {
  if (!/^[A-Za-z0-9_-]{1,683}$/.test(part)) return false;
  try {
    const base64 = part.replaceAll("-", "+").replaceAll("_", "/"),
      decoded = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return (
      /^[A-Za-z0-9._!~:-]{1,512}$/.test(decoded) &&
      btoa(decoded)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "") === part
    );
  } catch {
    return false;
  }
}
