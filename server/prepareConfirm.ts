import { prepareOpeningPhrase, hasOpeningEntry, PrepareUnavailableError } from "./prepare";

/// Protocol-level handling of `prepare_confirm_goal` (extracted from the
/// WebSocket switch so the lost-ack replay path is unit-testable).
///
/// Idempotency contract (Task #197): the client may resend the same
/// confirmation (same `clientMessageId`) after a reconnect, having missed BOTH
/// response frames (`goal_set` and `prepare_opening`). A duplicate must:
///   - NOT re-run goal activation side effects or broadcast to other clients,
///   - replay `goal_set` to the resending socket (so the client persists the
///     confirmed goal exactly once from its point of view),
///   - replay the ORIGINAL opening phrase instead of generating a second one.
export interface PrepareConfirmDeps {
  /// Send a frame to the socket that sent this confirmation.
  sendFrame: (obj: Record<string, unknown>) => void;
  /// First-time activation: setUserGoal + broadcast goal_set to all clients.
  activateGoal: (goal: string) => void;
  log?: (msg: string) => void;
}

export async function handlePrepareConfirmGoal(
  userId: string,
  rawGoal: unknown,
  rawClientMessageId: unknown,
  deps: PrepareConfirmDeps,
): Promise<void> {
  const goal = String(rawGoal || "").trim();
  if (!goal || !userId) return;
  const confirmId = typeof rawClientMessageId === "string"
    ? rawClientMessageId.trim().slice(0, 64) : "";

  const isDuplicate = confirmId && hasOpeningEntry(userId, confirmId);
  if (isDuplicate) {
    // Lost-ack replay: re-deliver goal_set to THIS socket only, without
    // re-running activation side effects or broadcasting again.
    deps.sendFrame({ type: "goal_set", goal });
  } else {
    deps.activateGoal(goal);
  }

  try {
    const opening = await prepareOpeningPhrase(userId, goal, confirmId || undefined);
    deps.sendFrame({ type: "prepare_opening", phraseEn: opening.phraseEn, translation: opening.translation, ...(confirmId ? { clientMessageId: confirmId } : {}) });
  } catch (err: any) {
    const msg = err instanceof PrepareUnavailableError ? err.message : "Не удалось получить первую фразу.";
    deps.log?.(`prepare_opening error: ${err?.message}`);
    deps.sendFrame({ type: "prepare_error", text: msg, ...(confirmId ? { clientMessageId: confirmId } : {}) });
  }
}
