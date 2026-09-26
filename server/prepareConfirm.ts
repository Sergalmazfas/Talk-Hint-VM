import {
  prepareOpeningPhrase,
  hasOpeningEntry,
  hasCompletedOpeningEntry,
  getOpeningGoal,
  claimSecretaryProposal,
  isCurrentSecretaryProposalClaim,
  getClaimedSecretaryProposalVersion,
  releaseSecretaryProposalClaim,
  PrepareUnavailableError,
} from "./prepare";

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
  /// Secretary confirmation generation check, re-evaluated inside the
  /// serialized opening operation as well as before activation.
  isConfirmationCurrent?: () => boolean;
  log?: (msg: string) => void;
}

export interface SecretaryConfirmationAuthorization {
  goal: string;
  generation: number | null;
  replay: boolean;
}

/// Server-side gate used by the Secretary websocket path. An already accepted
/// id may only replay its original goal; a first confirmation must match the
/// currently pending server-generated proposal exactly.
export function authorizeSecretaryConfirmation(
  userId: string,
  rawGoal: unknown,
  rawClientMessageId: unknown,
): SecretaryConfirmationAuthorization | null {
  const goal = String(rawGoal || "").trim();
  if (!goal || !userId) return null;
  const confirmId = typeof rawClientMessageId === "string"
    ? rawClientMessageId.trim().slice(0, 64) : "";

  if (confirmId && hasOpeningEntry(userId, confirmId)) {
    const originalGoal = getOpeningGoal(userId, confirmId);
    if (originalGoal !== goal) return null;
    if (hasCompletedOpeningEntry(userId, confirmId)) {
      return { goal: originalGoal, generation: null, replay: true };
    }
    const generation = currentClaimGeneration(userId, originalGoal);
    return generation === null ? null : { goal: originalGoal, generation, replay: false };
  }
  const generation = claimSecretaryProposal(userId, goal);
  return generation === null ? null : { goal, generation, replay: false };
}

function currentClaimGeneration(userId: string, goal: string): number | null {
  return getClaimedSecretaryProposalVersion(userId, goal);
}

export function isSecretaryConfirmationCurrent(
  userId: string,
  goal: string,
  generation: number | null,
  clientMessageId: unknown,
): boolean {
  const confirmId = typeof clientMessageId === "string"
    ? clientMessageId.trim().slice(0, 64) : "";
  if (confirmId && hasCompletedOpeningEntry(userId, confirmId) && getOpeningGoal(userId, confirmId) === goal) return true;
  return generation !== null && isCurrentSecretaryProposalClaim(userId, goal, generation);
}

export function releaseSecretaryConfirmation(userId: string, goal: string, generation: number): void {
  releaseSecretaryProposalClaim(userId, goal, generation);
}

export async function handlePrepareConfirmGoal(
  userId: string,
  rawGoal: unknown,
  rawClientMessageId: unknown,
  deps: PrepareConfirmDeps,
  mode: "hint" | "secretary" = "hint",
): Promise<void> {
  const goal = String(rawGoal || "").trim();
  if (!goal || !userId) return;
  const confirmId = typeof rawClientMessageId === "string"
    ? rawClientMessageId.trim().slice(0, 64) : "";

  const isDuplicate = confirmId && hasOpeningEntry(userId, confirmId);
  if (mode === "secretary" && deps.isConfirmationCurrent && !deps.isConfirmationCurrent()) {
    deps.sendFrame({ type: "prepare_error", text: "Подготовка была сброшена или обновлена. Подтвердите актуальное задание заново.", ...(confirmId ? { clientMessageId: confirmId } : {}) });
    return;
  }
  if (isDuplicate) {
    // Lost-ack replay: re-deliver goal_set to THIS socket only, without
    // re-running activation side effects or broadcasting again.
    deps.sendFrame({ type: "goal_set", goal });
  } else {
    if (mode !== "secretary") deps.activateGoal(goal);
  }

  try {
    const opening = await prepareOpeningPhrase(userId, goal, confirmId || undefined, mode, deps.isConfirmationCurrent);
    if (mode === "secretary" && deps.isConfirmationCurrent && !deps.isConfirmationCurrent()) {
      deps.sendFrame({ type: "prepare_error", text: "Подготовка была сброшена или обновлена. Подтвердите актуальное задание заново.", ...(confirmId ? { clientMessageId: confirmId } : {}) });
      return;
    }
    if (!isDuplicate && mode === "secretary") deps.activateGoal(goal);
    deps.sendFrame({ type: "prepare_opening", phraseEn: opening.phraseEn, translation: opening.translation, ...(confirmId ? { clientMessageId: confirmId } : {}) });
  } catch (err: any) {
    const msg = err instanceof PrepareUnavailableError ? err.message : "Не удалось получить первую фразу.";
    deps.log?.(`prepare_opening error: ${err?.message}`);
    deps.sendFrame({ type: "prepare_error", text: msg, ...(confirmId ? { clientMessageId: confirmId } : {}) });
  }
}
