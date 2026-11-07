import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";

async function animationFrame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

// Deliver native touch input explicitly. Chromium's synthesized gesture backend
// can report completion without delivering touch events in headless environments.
export async function touchStroke(
  page: Page,
  cdp: CDPSession,
  x: number,
  from: number,
  to: number,
) {
  const point = (y: number) => [
    { x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(from),
  });
  for (let step = 1; step <= 4; step++) {
    await animationFrame(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(from + ((to - from) * step) / 4),
    });
  }
  await animationFrame(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await animationFrame(page);
}

export async function observeTouchInput(page: Page, selector: string) {
  await page.evaluate((selector) => {
    const events: Record<string, unknown>[] = [];
    const root = window as Window & {
      __anyworkTouchEvidence?: { selector: string; events: typeof events };
    };
    root.__anyworkTouchEvidence = { selector, events };
    for (const type of [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "pointerdown",
      "pointercancel",
      "pointerup",
      "scroll",
    ]) {
      window.addEventListener(
        type,
        (event) => {
          if (events.length >= 64) return;
          const point =
            event instanceof TouchEvent
              ? event.changedTouches[0]
              : event instanceof PointerEvent
                ? event
                : null;
          events.push({
            type,
            trusted: event.isTrusted,
            prevented: event.defaultPrevented,
            cancelable: event.cancelable,
            target:
              (event.target as Element)?.className ||
              (event.target as Element)?.id,
            x: point?.clientX,
            y: point?.clientY,
            scrollTop: document.querySelector(selector)?.scrollTop,
          });
        },
        { passive: true, capture: type === "scroll" },
      );
    }
  }, selector);
}

export async function touchEvidence(page: Page) {
  return page.evaluate(() => {
    const evidence = (
      window as Window & {
        __anyworkTouchEvidence?: {
          selector: string;
          events: Record<string, unknown>[];
        };
      }
    ).__anyworkTouchEvidence!;
    const el = document.querySelector(evidence.selector)!;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height - 16,
    );
    const ancestors = [];
    for (
      let current: Element | null = hit;
      current;
      current = current.parentElement
    ) {
      const style = getComputedStyle(current);
      ancestors.push({
        tag: current.tagName,
        class: current.className,
        touchAction: style.touchAction,
        overflowY: style.overflowY,
        pointerEvents: style.pointerEvents,
      });
    }
    return {
      ...evidence,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      box: box.toJSON(),
      ancestors,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      devicePixelRatio,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scale: visualViewport?.scale,
      },
    };
  });
}

// A plain nested scrolling control distinguishes browser input transport from
// application hit-testing or React handlers. It never sets scrollTop or uses
// scrollIntoView, and navigating to the application discards this entire fixture.
export async function verifyTouchTransport(page: Page, cdp: CDPSession) {
  const markup = `<meta name="viewport" content="width=device-width,initial-scale=1">
    <div id="touch-control" style="position:fixed;left:10px;top:10px;width:240px;height:300px;overflow-y:auto;overscroll-behavior:contain;touch-action:auto">
      <div style="height:4000px;background:linear-gradient(white,gray)">Native touch control</div>
    </div>`;
  await page.setContent(markup);
  await observeTouchInput(page, "#touch-control");
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 130,
    y: 270,
    yDistance: -220,
    speed: 1000,
    preventFling: true,
    gestureSourceType: "touch",
  });
  await animationFrame(page);
  const synthesized = await touchEvidence(page);
  await page.setContent(markup);
  await observeTouchInput(page, "#touch-control");
  await touchStroke(page, cdp, 130, 270, 50);
  try {
    const direct = await touchEvidence(page);
    expect(
      direct.events.some(
        (event) => event.type === "touchstart" && event.trusted,
      ),
    ).toBe(true);
    await expect
      .poll(() => page.locator("#touch-control").evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
  } finally {
    const direct = await touchEvidence(page);
    console.log(
      "Native touch transport",
      JSON.stringify({
        synthesized: {
          scrollTop: synthesized.scrollTop,
          events: [...new Set(synthesized.events.map((event) => event.type))],
        },
        direct: {
          scrollTop: direct.scrollTop,
          events: [...new Set(direct.events.map((event) => event.type))],
        },
      }),
    );
    await attachTouchEvidence("native-touch-transport.json", {
      synthesized,
      direct,
    });
  }
}

export async function attachTouchEvidence(name: string, evidence: unknown) {
  const path = test.info().outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await test.info().attach(name, { path, contentType: "application/json" });
}
