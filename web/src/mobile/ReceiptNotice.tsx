import { confirmPlatform } from "../platform";
import type { useUncertainSend } from "./uncertainSend";

export default function ReceiptNotice({
  receipt,
  busy,
  responding = false,
  onRefresh,
}: {
  receipt: ReturnType<typeof useUncertainSend>;
  busy: boolean;
  responding?: boolean;
  onRefresh(): void;
}) {
  if (!receipt.blocked || busy) return null;
  return (
    <div className="mobile-send-uncertain" role="alert">
      <p>
        {responding
          ? "上次回应结果未知，电脑可能已经收到。请先核对审批或问题状态，避免重复回应。"
          : "上次发送结果未知，电脑可能已经收到。请核对会话记录，避免重复发送。"}
      </p>
      <button onClick={onRefresh}>刷新会话记录</button>
      <button
        onClick={() => {
          void confirmPlatform(
            responding
              ? "已核对电脑上的审批或问题状态，允许再次手动回应？这可能重复先前的决定。"
              : "已核对电脑上的会话记录，允许再次手动发送？这可能产生重复消息。",
          ).then((ok) => {
            if (ok) receipt.clear();
          });
        }}
      >
        {responding ? "已核对，解除回应保护" : "已核对，解除发送保护"}
      </button>
    </div>
  );
}
