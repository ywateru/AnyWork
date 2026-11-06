import type { ReactNode } from "react";
import type { Session } from "../types";

/** The backend marks every native WorkBuddy child auxiliary and rejects its
 * mutations. Gate before mounting controls; ordinary sessions keep their drafts
 * and do not need a second capability query to mount the editor. */
export default function ComposerAccess({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  return (
    <div className="composer-area">
      {session.agent === "workbuddy" && session.auxiliary ? (
        <div className="agent-waiting" role="status">
          WorkBuddy 子 Agent 仅支持查看
        </div>
      ) : (
        children
      )}
    </div>
  );
}
