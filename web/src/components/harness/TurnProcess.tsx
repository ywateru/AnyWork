// Adapted from upstream ui-chat/TurnProcessNodeView.tsx (MIT).
import { ChevronDown } from "lucide-react";
import css from "./TurnProcessNodeView.module.css";
export function TurnProcess({
  open,
  label,
  controls,
  onToggle,
}: {
  open: boolean;
  label: string;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`turn-disclosure ${css.root}`}
      data-open={open || undefined}
      aria-label={`${open ? "收起" : "展开"}工作过程：${label}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={(event) => {
        event.currentTarget.focus();
        onToggle();
      }}
    >
      <span className={css.label}>{label}</span>
      <ChevronDown className={css.chevron} />
    </button>
  );
}
