const pageStart = "<page-comment-context>\n";
const pageEnd = "\n</page-comment-context>\n";
const requestStart = "## My request:\n";

/** One native Woe pass. The page wrapper takes priority over body markers. */
export function userTextBody(text: string): string {
  if (text.startsWith(pageStart)) {
    const close = text.indexOf(pageEnd, pageStart.length);
    const request = close + pageEnd.length;
    if (close !== -1 && text.startsWith(requestStart, request))
      return text.slice(request + requestStart.length).trim();
  }
  const parts = text.split(/## My request(?: for Codex)?:/g);
  return parts.length > 1 ? parts.at(-1)!.trim() : text;
}

/** Native local normalization and the ordinary user-message renderer each pass once. */
export function renderedUserText(text: string): string {
  return userTextBody(userTextBody(text));
}
