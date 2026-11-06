import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  CircleDashed,
  LoaderCircle,
  Zap,
} from "lucide-react";
import ReasoningSlider, { effortLabel } from "./ReasoningSlider";
import type { Api } from "../../api";
import type { Session } from "../../types";
import "./ModelPicker.css";

export interface ComposerModel {
  model: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  serviceTiers?: { id: string; name: string; description: string }[];
  defaultServiceTier?: string | null;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: {
    reasoningEffort: string;
    description?: string;
  }[];
}

interface ModelControls {
  model: string | null;
  effort: string | null;
  settings_available: boolean;
  settings_error?: string | null;
  models?: ComposerModel[];
  service_tier?: string | null;
  service_tier_available?: boolean;
  service_tier_error?: string | null;
}

interface ModelPickerProps {
  api: Api;
  session: Session;
  models: ComposerModel[];
  busy: boolean;
  onError: (error: unknown) => void;
  /** Notification after the server has applied the model; do not send it again. */
  onModelChange?: (model: string) => void;
  controlsRevision?: number;
}

interface SettingsUpdate {
  model?: string;
  effort?: string;
  service_tier?: string | null;
}
const tierLabel = (tier: { id: string; name: string }) =>
  /^(priority|fast)$/i.test(tier.id) || /^fast$/i.test(tier.name.trim())
    ? "快速"
    : /^ultrafast$/i.test(tier.id) || /^ultrafast$/i.test(tier.name.trim())
      ? "超快"
      : tier.name;

export default function ModelPicker({
  api,
  session,
  models,
  busy,
  onError,
  onModelChange,
  controlsRevision = 0,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false),
    [controls, setControls] = useState<ModelControls | null>(null),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState<CSSProperties>({}),
    [view, setView] = useState<"simple" | "advanced">("simple"),
    [speedOpen, setSpeedOpen] = useState(false),
    [speedPosition, setSpeedPosition] = useState<CSSProperties>({}),
    [previewEffort, setPreviewEffort] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    speedTrigger = useRef<HTMLButtonElement>(null),
    speedMenu = useRef<HTMLDivElement>(null),
    pendingEffort = useRef<string | null>(null),
    loadVersion = useRef(0),
    mutationVersion = useRef(0),
    savingRef = useRef(false),
    restoreTrigger = useRef(false),
    restoreSpeed = useRef<{
      session: string;
      mutation: number;
      element: HTMLButtonElement;
    } | null>(null),
    identity = useRef(session.id),
    menuId = useId();
  identity.current = session.id;

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (session.archived) return;
      const version = ++loadVersion.current;
      setLoading(true);
      setError("");
      try {
        const result = await api.request<ModelControls>(
          `/sessions/${session.id}/composer`,
          { signal },
        );
        if (!signal.aborted && version === loadVersion.current)
          setControls(result);
      } catch (e) {
        if (!signal.aborted && version === loadVersion.current)
          setError(e instanceof Error ? e.message : "无法读取模型设置");
      } finally {
        if (!signal.aborted && version === loadVersion.current)
          setLoading(false);
      }
    },
    [api, session.id, session.archived],
  );

  useEffect(() => {
    const controller = new AbortController();
    setControls(null);
    setOpen(false);
    setSaving(false);
    setSpeedOpen(false);
    setView("simple");
    setPreviewEffort(null);
    pendingEffort.current = null;
    restoreSpeed.current = null;
    savingRef.current = false;
    void load(controller.signal);
    return () => {
      controller.abort();
      loadVersion.current++;
      mutationVersion.current++;
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [open, load]);

  // A history-only first read may finish before the original engine attaches.
  // Refresh capabilities after attachment and when a running turn becomes idle.
  const lastRefresh = useRef({ load, controlsRevision, busy });
  useEffect(() => {
    const previous = lastRefresh.current;
    lastRefresh.current = { load, controlsRevision, busy };
    if (
      previous.load !== load ||
      (previous.controlsRevision === controlsRevision &&
        previous.busy === busy) ||
      savingRef.current
    )
      return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [controlsRevision, busy, load]);

  const availableModels = controls?.models || models,
    model =
      controls?.model ||
      session.model ||
      availableModels.find((candidate) => candidate.isDefault)?.model ||
      "",
    activeModel = availableModels.find(
      (candidate) => candidate.model === model,
    ),
    efforts = (activeModel?.supportedReasoningEfforts || []).filter(
      (option) => option.reasoningEffort !== "persistent",
    ),
    savedEffort = controls?.effort || activeModel?.defaultReasoningEffort || "",
    effort =
      previewEffort ||
      (efforts.some((option) => option.reasoningEffort === savedEffort)
        ? savedEffort
        : (efforts.some(
            (option) =>
              option.reasoningEffort === activeModel?.defaultReasoningEffort,
          )
            ? activeModel?.defaultReasoningEffort
            : null) ||
          efforts[0]?.reasoningEffort ||
          ""),
    modelLabel = activeModel?.displayName || model || "默认模型",
    disabled = session.archived || busy || saving,
    editable = controls?.settings_available === true && !disabled,
    sliderAvailable =
      efforts.length >= 2 &&
      efforts.some((option) => option.reasoningEffort === effort),
    simple = view === "simple" && sliderAvailable,
    tiers = activeModel?.serviceTiers || [],
    currentTier = controls?.service_tier ?? null,
    fastTier =
      tiers.length === 1 && tierLabel(tiers[0]) === "快速" ? tiers[0] : null,
    tierEditable =
      controls?.settings_available === true &&
      (controls?.service_tier_available === true || currentTier !== null) &&
      !disabled,
    selectedTier = tiers.find((tier) => tier.id === currentTier);

  const close = useCallback((restoreFocus = false) => {
    restoreSpeed.current = null;
    setOpen(false);
    setSpeedOpen(false);
    restoreTrigger.current = restoreFocus;
    if (restoreFocus)
      requestAnimationFrame(() =>
        trigger.current?.focus({ preventScroll: true }),
      );
  }, []);

  useEffect(() => {
    if (!open && !saving && restoreTrigger.current) {
      restoreTrigger.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [open, saving]);

  // A frame can run before React commits saving=false. Restore only after the
  // initiating button is enabled in the DOM, while its interaction still owns
  // focus. A later user action must never be undone by a save completion.
  useLayoutEffect(() => {
    const pending = restoreSpeed.current;
    if (!pending || saving) return;
    restoreSpeed.current = null;
    if (
      open &&
      tierEditable &&
      pending.session === session.id &&
      pending.mutation === mutationVersion.current &&
      pending.element === speedTrigger.current &&
      !pending.element.disabled &&
      (document.activeElement === document.body ||
        document.activeElement === pending.element)
    )
      pending.element.focus({ preventScroll: true });
  }, [open, saving, tierEditable, session.id]);

  useLayoutEffect(() => {
    if (!open) return;
    const cancel = () => {
      restoreSpeed.current = null;
    };
    const movedFocus = (event: FocusEvent) => {
      if (event.target !== restoreSpeed.current?.element) cancel();
    };
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("focusin", movedFocus, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("focusin", movedFocus, true);
      window.removeEventListener("blur", cancel);
    };
  }, [open, session.id]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewportWidth = window.innerWidth,
        viewportHeight = window.innerHeight,
        width = Math.min(254, viewportWidth - 24),
        above = anchor.top >= viewportHeight - anchor.bottom,
        space = above ? anchor.top - 20 : viewportHeight - anchor.bottom - 20;
      setPosition({
        position: "fixed",
        width,
        left: Math.max(
          12,
          Math.min(anchor.right - width, viewportWidth - width - 12),
        ),
        ...(above
          ? { bottom: viewportHeight - anchor.top + 8 }
          : { top: anchor.bottom + 8 }),
        maxHeight: Math.max(100, Math.min(520, space)),
      });
    };
    place();
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !menu.current?.contains(target) &&
        !speedMenu.current?.contains(target)
      )
        close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (speedMenu.current?.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || loading) return;
    const selected = menu.current?.querySelector<HTMLButtonElement>(
      '[data-picker-option][aria-checked="true"]:not(:disabled)',
    );
    const first = menu.current?.querySelector<HTMLButtonElement>(
      "[data-picker-option]:not(:disabled), [role=slider]:not([aria-disabled=true])",
    );
    // Do not reset keyboard navigation when a settings refresh completes.
    if (!menu.current?.contains(document.activeElement))
      (selected || first || menu.current)?.focus({ preventScroll: true });
  }, [open, loading, simple]);

  async function change(
    update: SettingsUpdate,
    options: {
      close?: boolean;
      nextView?: "simple" | "advanced";
      slider?: boolean;
      focusSpeed?: boolean;
    } = {},
  ) {
    if (
      controls?.settings_available !== true ||
      session.archived ||
      (busy &&
        (update.model !== undefined || update.service_tier !== undefined))
    )
      return;
    if (savingRef.current) {
      if (options.slider && update.effort) {
        pendingEffort.current = update.effort;
        setPreviewEffort(update.effort);
      }
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    if (options.slider && update.effort) setPreviewEffort(update.effort);
    const requestSession = session.id,
      mutation = ++mutationVersion.current;
    if (options.focusSpeed && open && speedTrigger.current)
      restoreSpeed.current = {
        session: requestSession,
        mutation,
        element: speedTrigger.current,
      };
    loadVersion.current++;
    let succeeded = false;
    try {
      const result = await api.post<ModelControls>(
        `/sessions/${session.id}/composer`,
        { action: "settings", ...update },
      );
      if (
        identity.current !== requestSession ||
        mutationVersion.current !== mutation
      )
        return;
      setControls((old) => ({ ...old, ...result }));
      if (result.model && update.model) onModelChange?.(result.model);
      if (options.nextView) setView(options.nextView);
      if (options.close) close(true);
      succeeded = true;
    } catch (e) {
      if (
        identity.current !== requestSession ||
        mutationVersion.current !== mutation
      )
        return;
      setError(e instanceof Error ? e.message : "模型设置未保存，请重试");
      pendingEffort.current = null;
      onError(e);
    } finally {
      if (
        identity.current === requestSession &&
        mutationVersion.current === mutation
      ) {
        savingRef.current = false;
        setSaving(false);
        setLoading(false);
        const next = pendingEffort.current;
        pendingEffort.current = null;
        if (succeeded && next && next !== update.effort)
          void change({ effort: next }, { slider: true });
        else setPreviewEffort(null);
      }
    }
  }

  useLayoutEffect(() => {
    if (!open || !speedOpen) return;
    const place = () => {
      const anchor = speedTrigger.current?.getBoundingClientRect(),
        parent = menu.current?.getBoundingClientRect(),
        panel = speedMenu.current;
      if (!anchor || !parent || !panel) return;
      const width = Math.min(233, innerWidth - 24),
        height = panel.offsetHeight;
      const left =
        parent.right + width + 8 <= innerWidth
          ? parent.right + 4
          : parent.left - width - 4 >= 8
            ? parent.left - width - 4
            : Math.max(12, Math.min(parent.left, innerWidth - width - 12));
      setSpeedPosition({
        position: "fixed",
        width,
        left,
        top: Math.max(12, Math.min(anchor.top, innerHeight - height - 12)),
      });
    };
    place();
    const selected = speedMenu.current?.querySelector<HTMLButtonElement>(
        '[aria-checked="true"]:not(:disabled)',
      ),
      first = speedMenu.current?.querySelector<HTMLButtonElement>(
        "button:not(:disabled)",
      );
    (selected || first)?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, speedOpen]);

  function speedKeys(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (["Escape", "ArrowLeft", "Tab"].includes(event.key)) {
      if (event.key !== "Tab") event.preventDefault();
      setSpeedOpen(false);
      speedTrigger.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      speedMenu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) || [],
    );
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement),
      next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
              items.length;
    items[next].focus();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      trigger.current?.focus({ preventScroll: true });
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(
      menu.current?.querySelectorAll<HTMLElement>(
        "[data-picker-option]:not(:disabled), [role=slider]:not([aria-disabled=true])",
      ) || [],
    );
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowUp" ? -1 : 1) + options.length) %
            options.length;
    options[next].focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="model-picker-trigger"
        aria-label="模型与思考强度"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`${modelLabel}${effort ? ` · 思考强度：${effortLabel(effort)}` : ""}`}
        disabled={session.archived || saving}
        onClick={() => {
          setView("simple");
          setSpeedOpen(false);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setView("simple");
            setOpen(true);
          }
        }}
      >
        {saving ? (
          <LoaderCircle size={14} className="model-picker-spinner" />
        ) : (
          <CircleDashed size={14} aria-hidden="true" />
        )}
        <span className="model-picker-name">{modelLabel}</span>
        {effort && (
          <span className="model-picker-effort">{effortLabel(effort)}</span>
        )}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            className="model-picker-menu"
            role="menu"
            aria-label="模型与思考强度"
            aria-busy={loading || saving}
            tabIndex={-1}
            style={position}
            onKeyDown={navigate}
          >
            {simple && (
              <div className="model-picker-view-controls">
                {(tiers.length > 0 || currentTier !== null) && (
                  <button
                    ref={speedTrigger}
                    type="button"
                    className="model-picker-speed-trigger"
                    data-picker-option
                    disabled={!tierEditable}
                    role={fastTier ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={
                      fastTier ? currentTier === fastTier.id : undefined
                    }
                    aria-haspopup={fastTier ? undefined : "menu"}
                    aria-expanded={!fastTier ? speedOpen : undefined}
                    aria-label={fastTier ? "快速" : "速度"}
                    title={
                      selectedTier
                        ? `${tierLabel(selectedTier)} · ${selectedTier.description}`
                        : "标准 · 使用默认服务等级"
                    }
                    onClick={() => {
                      if (fastTier)
                        void change(
                          {
                            service_tier:
                              currentTier === fastTier.id ? null : fastTier.id,
                          },
                          { focusSpeed: true },
                        );
                      else setSpeedOpen((value) => !value);
                    }}
                    onKeyDown={(event) => {
                      if (!fastTier && event.key === "ArrowRight") {
                        event.preventDefault();
                        event.stopPropagation();
                        setSpeedOpen(true);
                      }
                    }}
                  >
                    <Zap
                      size={16}
                      fill={currentTier !== null ? "currentColor" : "none"}
                    />
                  </button>
                )}
                <button
                  type="button"
                  className="model-picker-view-toggle"
                  data-picker-option
                  aria-label="选择模型"
                  onClick={() => setView("advanced")}
                >
                  <span className="model-picker-power-label">
                    {effortLabel(effort)}
                  </span>
                  <span className="model-picker-view-model">
                    {modelLabel}
                    <ChevronDown size={12} />
                  </span>
                </button>
              </div>
            )}
            {simple ? (
              <div className="model-picker-simple">
                <ReasoningSlider
                  options={efforts}
                  value={effort}
                  disabled={
                    controls?.settings_available !== true || session.archived
                  }
                  onChange={(value) =>
                    void change({ effort: value }, { slider: true })
                  }
                  onConfirm={() => close(true)}
                />
              </div>
            ) : (
              <div className="model-picker-model-list">
                <div className="model-picker-list-heading">选择模型</div>
                {availableModels.map((candidate) => (
                  <button
                    key={candidate.model}
                    type="button"
                    role="menuitemradio"
                    aria-checked={candidate.model === model}
                    data-picker-option
                    disabled={!editable}
                    onClick={() => {
                      if (candidate.model === model) {
                        close(true);
                      } else {
                        const keepEffort =
                          candidate.supportedReasoningEfforts?.some(
                            (option) => option.reasoningEffort === effort,
                          );
                        void change(
                          {
                            model: candidate.model,
                            ...(currentTier !== null &&
                            !candidate.serviceTiers?.some(
                              (tier) => tier.id === currentTier,
                            )
                              ? { service_tier: null }
                              : {}),
                            ...(!keepEffort && candidate.defaultReasoningEffort
                              ? { effort: candidate.defaultReasoningEffort }
                              : {}),
                          },
                          { nextView: "simple" },
                        );
                      }
                    }}
                  >
                    <span className="model-picker-option-copy">
                      <span>{candidate.displayName || candidate.model}</span>
                      {candidate.description && (
                        <small>{candidate.description}</small>
                      )}
                    </span>
                    {candidate.model === model && (
                      <Check size={16} aria-hidden="true" />
                    )}
                  </button>
                ))}
                {!availableModels.some(
                  (candidate) => candidate.model === model,
                ) &&
                  model && (
                    <div className="model-picker-current">
                      <span>
                        {modelLabel}
                        <small>当前会话模型</small>
                      </span>
                      <Check size={16} aria-hidden="true" />
                    </div>
                  )}
              </div>
            )}
            {controls?.service_tier_error && (
              <p className="model-picker-status">
                {controls.service_tier_error}
              </p>
            )}
            {loading && (
              <p className="model-picker-status" role="status">
                正在读取模型设置…
              </p>
            )}
            {busy && (
              <p className="model-picker-status">当前任务完成后可更改模型。</p>
            )}
            {!loading &&
              !availableModels.length &&
              !error &&
              !controls?.settings_error && (
                <p className="model-picker-status">
                  当前 Agent 未提供可用模型。
                </p>
              )}
            {(error || controls?.settings_error) && (
              <p className="model-picker-error" role="alert">
                {error || controls?.settings_error}
              </p>
            )}
          </div>,
          document.body,
        )}
      {open &&
        speedOpen &&
        !fastTier &&
        createPortal(
          <div
            ref={speedMenu}
            className="model-picker-menu model-picker-speed-menu"
            role="menu"
            aria-label="速度"
            style={speedPosition}
            onKeyDown={speedKeys}
          >
            {[
              { id: null, name: "标准", description: "使用默认服务等级" },
              ...tiers,
            ].map((tier) => (
              <button
                key={tier.id ?? "standard"}
                type="button"
                role="menuitemradio"
                aria-checked={currentTier === tier.id}
                disabled={!tierEditable}
                onClick={() => {
                  void change({ service_tier: tier.id }, { focusSpeed: true });
                  setSpeedOpen(false);
                }}
              >
                <span className="model-picker-option-copy">
                  <span>
                    {tier.id === null
                      ? tier.name
                      : tierLabel({ id: tier.id, name: tier.name })}
                  </span>
                  <small>{tier.description}</small>
                </span>
                {currentTier === tier.id && <Check size={16} />}
              </button>
            ))}
            {currentTier !== null && !selectedTier && (
              <p className="model-picker-status">
                当前服务等级：{currentTier}
                。目录未提供此选项，可选择标准清除覆盖。
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
