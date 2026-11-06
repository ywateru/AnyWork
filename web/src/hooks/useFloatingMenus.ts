import { useEffect } from "react";

const selector = "details[data-floating-menu][open]";

/** Native details menus only; activity disclosures and editable dialogs are separate. */
export function useFloatingMenus(scope: string) {
  useEffect(() => {
    const opened = () => [
      ...document.querySelectorAll<HTMLDetailsElement>(selector),
    ];
    const outside = (event: Event) => {
      for (const menu of opened())
        if (!event.composedPath().includes(menu)) menu.open = false;
    };
    const select = (event: Event) => {
      const target = event.target as HTMLElement;
      const menu = target.closest<HTMLDetailsElement>(selector);
      if (!menu || target.closest("summary")) return;
      if (
        event.type === "change" ||
        target.closest("button:not(:disabled), a[href]")
      ) {
        menu.open = false;
        menu
          .querySelector<HTMLElement>("summary")
          ?.focus({ preventScroll: true });
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      const menu = opened().at(-1);
      if (!menu) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
        return;
      }
      if (
        !(event.target instanceof HTMLElement) ||
        !menu.contains(event.target) ||
        menu.querySelector(".queue-menu") ||
        event.target.closest("select,input,textarea") ||
        !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      )
        return;
      const items = [
        ...menu.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), a[href]",
        ),
      ];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % items.length
              : index < 0
                ? items.length - 1
                : (index - 1 + items.length) % items.length;
      items[next].focus();
    };
    const toggle = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || !target.matches(selector))
        return;
      for (const menu of opened()) if (menu !== target) menu.open = false;
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("click", select, true);
    document.addEventListener("change", select, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("toggle", toggle, true);
    return () => {
      for (const menu of opened()) menu.open = false;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("click", select, true);
      document.removeEventListener("change", select, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("toggle", toggle, true);
    };
  }, [scope]);
}
