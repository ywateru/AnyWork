export interface GoalProgress {
  status: string;
  timeUsedSeconds?: number;
  updatedAt?: number;
  tokensUsed?: number;
  tokenBudget?: number | null;
}

/** The native goal rail shows budget while active/limited, otherwise elapsed time. */
export function goalProgressText(
  goal: GoalProgress,
  now: number,
): string | null {
  if (
    ["active", "budgetLimited"].includes(goal.status) &&
    typeof goal.tokenBudget === "number" &&
    Number.isFinite(goal.tokenBudget) &&
    typeof goal.tokensUsed === "number" &&
    Number.isFinite(goal.tokensUsed)
  ) {
    const number = new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    return `${number.format(goal.tokensUsed)}/${number.format(goal.tokenBudget)}`;
  }
  if (
    typeof goal.timeUsedSeconds !== "number" ||
    !Number.isFinite(goal.timeUsedSeconds)
  )
    return null;
  const sinceUpdate =
    goal.status === "active" &&
    typeof goal.updatedAt === "number" &&
    Number.isFinite(goal.updatedAt)
      ? now - goal.updatedAt * 1000
      : 0;
  let seconds = Math.floor(
    Math.max(0, goal.timeUsedSeconds * 1000 + sinceUpdate) / 1000,
  );
  const values: string[] = [];
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ] as const) {
    const value = Math.floor(seconds / size);
    seconds %= size;
    if (value)
      values.push(
        new Intl.NumberFormat("en", {
          style: "unit",
          unit,
          unitDisplay: "narrow",
        }).format(value),
      );
  }
  return values.length ? values.join(" ") : "0s";
}
