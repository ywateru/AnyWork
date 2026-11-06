// Adapted from deepseek-ai/deepseek-harness (MIT), fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159.
// Isolated clock, paused observation and accessible non-ticking announcement retained.
import { memo, useEffect, useState } from "react";
import { TextShimmer } from "./TextShimmer";
import {
  formatRunDuration,
  LIVE_RUN_CLOCK_INTERVAL_MS,
} from "./message-chrome";
import css from "./RunningStatus.module.css";
const units = {
  "duration.secondUnit": " 秒",
  "duration.minuteUnit": " 分 ",
  "duration.hourUnit": " 小时 ",
};
const REST_PATH =
  "M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742";
export const RunningStatus = memo(function RunningStatus({
  startTime,
  paused = false,
  activity,
}: {
  startTime?: number;
  paused?: boolean;
  activity: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startTime === undefined || paused) return;
    setNow(Date.now());
    const timer = setInterval(
      () => setNow(Date.now()),
      LIVE_RUN_CLOCK_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [startTime, paused]);
  const duration =
    startTime === undefined
      ? ""
      : formatRunDuration(Math.max(1000, now - startTime), (key) => units[key])
          .map((part) => part.text)
          .join("");
  const label = paused
    ? "连接已断开，等待恢复"
    : duration
      ? `深度求索中，用时 ${duration}…`
      : "深度求索中…";
  return (
    <div
      className={`working ${css.running}`}
      data-chat-running
      data-paused={paused || undefined}
    >
      <span
        className={css.visuallyHidden}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {paused ? "连接已断开，等待恢复" : activity}
      </span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent} aria-hidden="true">
        <svg className={css.runningIcon} viewBox="0 0 16 16" fill="none">
          <path d={REST_PATH} stroke="currentColor" strokeWidth={1} />
        </svg>
        <TextShimmer active={!paused} className={css.runningText}>
          {label}
        </TextShimmer>
      </span>
    </div>
  );
});
