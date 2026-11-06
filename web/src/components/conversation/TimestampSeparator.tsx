import { useState } from "react";
import { formatTimestampSeparator } from "../../messageTime";

export default function TimestampSeparator({ time }: { time: number }) {
  const [now] = useState(Date.now);
  const label = formatTimestampSeparator(time, now);
  return (
    <div
      className="conversation-timestamp"
      role="separator"
      aria-label={`${label.day} ${label.time}`}
      data-markdown-copy="exclude"
    >
      <time dateTime={new Date(time).toISOString()}>
        <span>{label.day}</span> {label.time}
      </time>
    </div>
  );
}
