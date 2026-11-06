import { useState, type ReactNode } from "react";
import { TurnProcess } from "./harness/TurnProcess";
import "./harness/conversation.css";
import type { ConversationTurn, Message } from "../types";
import ActivityList from "./ActivityList";
import { splitTurn, turnWorkLabel } from "../transcript";
import TimestampSeparator from "./conversation/TimestampSeparator";
export default function TurnView({
  turn,
  latestWorking,
  storageKey,
  render,
  timestamp,
  showReasoning = false,
}: {
  turn: ConversationTurn;
  latestWorking: boolean;
  storageKey: string;
  render: (message: Message) => ReactNode;
  timestamp?: number | null;
  showReasoning?: boolean;
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("ra.turn-disclosures-v1") || "{}")[
          storageKey
        ] === true
      );
    } catch {
      return false;
    }
  });
  function toggle() {
    setExpanded((value) => {
      const next = !value;
      try {
        const saved = JSON.parse(
          localStorage.getItem("ra.turn-disclosures-v1") || "{}",
        );
        delete saved[storageKey];
        saved[storageKey] = next;
        localStorage.setItem(
          "ra.turn-disclosures-v1",
          JSON.stringify(Object.fromEntries(Object.entries(saved).slice(-200))),
        );
      } catch {
        /* Browsers without storage retain the current view. */
      }
      return next;
    });
  }
  const { user, final, activity, after, errors, collapsible } = splitTurn(
    turn,
    latestWorking,
    showReasoning,
  );
  const label = turnWorkLabel(turn, activity);
  return (
    <section className="conversation-turn" data-turn-id={turn.id}>
      {timestamp != null && <TimestampSeparator time={timestamp} />}
      {user.map(render)}
      {activity.length > 0 && (
        <>
          {collapsible && (
            <TurnProcess
              open={expanded}
              label={
                turn.status === "interrupted"
                  ? "已停止"
                  : turn.status === "failed"
                    ? "执行失败"
                    : label
              }
              controls={`activity-${turn.id}`}
              onToggle={toggle}
            />
          )}
          <div
            className="turn-activity"
            id={`activity-${turn.id}`}
            hidden={collapsible && !expanded}
          >
            <ActivityList messages={activity} render={render} />
          </div>
        </>
      )}
      {final && render(final)}
      <ActivityList messages={after} render={render} />
      {errors.map(render)}
    </section>
  );
}
