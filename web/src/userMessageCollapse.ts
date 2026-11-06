export const USER_MESSAGE_COLLAPSED_LINES = 20;
export const USER_MESSAGE_PRECUT_LIMIT = USER_MESSAGE_COLLAPSED_LINES * 512;

/** The shipped renderer slices UTF-16 units, without repairing Markdown boundaries. */
export function userMessagePreview(text: string) {
  return text.length > USER_MESSAGE_PRECUT_LIMIT
    ? text.slice(0, USER_MESSAGE_PRECUT_LIMIT)
    : text;
}

type Reveal = () => () => void;
const fullContent = new WeakMap<HTMLElement, Reveal>();

export function registerFullUserMessageContent(
  element: HTMLElement,
  reveal: Reveal,
) {
  fullContent.set(element, reveal);
  return () => {
    if (fullContent.get(element) === reveal) fullContent.delete(element);
  };
}

/** Read a synchronous snapshot while the original full Markdown is mounted. */
export function withFullUserMessageContent<T>(
  element: HTMLElement | null,
  read: () => T,
): T {
  const restore = element ? fullContent.get(element)?.() : undefined;
  try {
    return read();
  } finally {
    restore?.();
  }
}
