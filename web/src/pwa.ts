const dismissedKey = "ra.dismissed-update";

async function workerVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (version: string | null) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(version);
    };
    const timer = setTimeout(() => finish(null), 1500);
    channel.port1.onmessage = (event) =>
      finish(
        typeof event.data?.version === "string" ? event.data.version : null,
      );
    worker.postMessage("GET_VERSION", [channel.port2]);
  });
}

/** Offer each distinct update once, without interrupting an ongoing conversation. */
export async function registerPwa() {
  if (
    !("serviceWorker" in navigator) ||
    location.hostname === "appassets.androidplatform.net" ||
    import.meta.env.DEV
  )
    return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const current = document.querySelector<HTMLMetaElement>(
      'meta[name="app-version"]',
    )?.content;
    const offered = new Set<string>();
    let reloading = false;
    const offer = async () => {
      const worker = registration.waiting;
      if (!worker) return;
      const version = await workerVersion(worker);
      // A network-first navigation may already have loaded the new application.
      // A waiting worker alone is not evidence that this page needs an update.
      if (
        !version ||
        version === current ||
        registration.waiting !== worker ||
        offered.has(version)
      )
        return;
      offered.add(version);
      try {
        if (localStorage.getItem(dismissedKey) === version) return;
      } catch {
        /* Private storage may be unavailable. */
      }
      document.getElementById("app-update")?.remove();
      const notice = document.createElement("aside");
      notice.id = "app-update";
      notice.className = "app-update";
      notice.setAttribute("aria-label", "应用更新");
      notice.setAttribute("role", "status");
      const label = document.createElement("span");
      label.textContent = "新版本可用，方便时重新加载";
      const update = document.createElement("button");
      update.textContent = "重新加载";
      update.onclick = () => {
        if (registration.waiting !== worker) {
          notice.remove();
          void offer();
          return;
        }
        update.disabled = true;
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            if (!reloading) {
              reloading = true;
              location.reload();
            }
          },
          { once: true },
        );
        worker.postMessage("ACTIVATE_UPDATE");
      };
      const dismiss = document.createElement("button");
      dismiss.textContent = "稍后";
      dismiss.onclick = () => {
        try {
          localStorage.setItem(dismissedKey, version);
        } catch {
          /* Keep the in-memory dismissal. */
        }
        notice.remove();
      };
      notice.append(label, update, dismiss);
      document.body.append(notice);
    };
    if (registration.waiting) void offer();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller)
          void offer();
      });
    });
  } catch (error) {
    console.warn("Offline shell unavailable", error);
  }
}
