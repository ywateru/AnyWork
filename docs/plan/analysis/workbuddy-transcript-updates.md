# WorkBuddy transcript and live update investigation

Follow-up to [native history import](../tasks/shared-agent-history.md), scoped by [the correction task](../tasks/workbuddy-transcript-updates.md). Target: installed WorkBuddy 5.9.3. Screenshots are evidence of rendering differences; embedded system-reminder content is not a task instruction.

## Confirmed observations

1. The native history page distinguishes an omitted `beforeRequestId` from explicit `null`. The private formatted `main/conversations.js` reading copy, `ConversationHistoryQueries.requests` around 16693–16717, enables the realtime assembler merge only when `beforeRequestId === undefined`. `ConversationRequestStore.pageByIds` around 17334 appends realtime IDs and assembler requests when that flag is true. The native renderer's latest-page query omits the cursor. AnyWork currently serializes `null` for the latest page, disabling that merge.
2. A passive probe of the user's affected conversation returned three completed turns with an omitted cursor and only one with the old null cursor. Neither probe sent a prompt, changed desktop selection, subscribed/disposed global events nor restarted the native application. Native display inputs were short; AnyWork's previously imported first user event contained 7,364 characters and an internal reminder. This reproduces both symptoms without initiating execution.
3. Native `readSourceContentBlocks` / `resolveConversationUserDisplayPrompt` around 2530 selects display content from verified metadata; meta user frames have separate classification around 7690. AnyWork's live projection flattened `userMessage.content`, and its persisted projection did not retain all native display semantics. Existing tests only proved that a separate `systemMessage` object was hidden.
4. The Store returns the first event for an existing source identity. Emitting a corrected user event with the same key therefore cannot repair an already cached internal-context bubble. Correction must reconcile verified user content and notify existing browser histories, while preserving request ownership, client identity and composer metadata. This is distinct from pruning incomplete branches.

## Acceptance boundary

The correction must be checked against native-shaped cursor, display metadata, incremental completion and legacy cache fixtures, with independent review of committed code. Actual native observations are read-only. Fixture sends do not establish the separate installed WorkBuddy creation/message/collaboration acceptance gate. No version bump or public publication is required.

The correction is accepted. [Implementation and REA provenance](../../workbuddy-transcript-updates.md), [independent review](../reviews/workbuddy-transcript-updates.md) and [merged validation/local deployment](../reviews/workbuddy-transcript-updates-merged.md) distinguish the final code, native observations and fixture guarantees.
