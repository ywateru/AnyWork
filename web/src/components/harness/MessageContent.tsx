// Adapted from upstream ui-chat MessageItem.UserStyleBubble / UserContent (MIT).
// Source content/Factory seats become React slots; authorization/edit state stays in AnyWork.
import type { ReactNode } from "react";
import { UserMessageBubble } from "./UserMessageBubble";
import messageCss from "./MessageItem.module.css";
import assistantCss from "./AssistantMarkdown.module.css";

export function UserContent({
  attachments,
  children,
}: {
  attachments?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`harness-user-stack ${messageCss.userStack}`}>
      {attachments && (
        <div className={messageCss.attachmentRow} data-message-attachments>
          {attachments}
        </div>
      )}
      <UserMessageBubble className="message-body" data-user-message-bubble>
        {children}
      </UserMessageBubble>
    </div>
  );
}
export const assistantBodyClass = assistantCss.root;
export const assistantMarkdownClass = assistantCss.body;
export const assistantActionsClass = assistantCss.actions;
