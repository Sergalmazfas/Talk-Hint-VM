// Reference-turn metadata preservation for full-transcript (bulk) saves.
//
// HARD RULE (reference integrity): per-turn audio timings (tStartMs/tEndMs)
// and human-verification flags must never be silently lost. A bulk save that
// re-sends only role+text inherits the metadata positionally when the turn
// structure is unchanged; a structural change (count or role sequence) is
// DESTRUCTIVE and must be explicitly confirmed by the caller.

export interface IncomingTurn {
  idx: number;
  role: "owner" | "guest";
  text: string;
  tStartMs?: number;
  tEndMs?: number;
  verified?: boolean;
}

export type MergeResult =
  | { ok: true; turns: IncomingTurn[] }
  | { ok: false; error: string };

export function mergeReferenceTurns(
  existing: IncomingTurn[],
  incoming: IncomingTurn[],
  confirmDestructive: boolean
): MergeResult {
  const hasMeta = existing.some(
    (t) => typeof t?.tStartMs === "number" || typeof t?.tEndMs === "number" || t?.verified === true
  );
  if (!hasMeta) return { ok: true, turns: incoming };

  const sameShape =
    incoming.length === existing.length && incoming.every((t, i) => t.role === existing[i].role);

  if (!sameShape) {
    if (confirmDestructive) return { ok: true, turns: incoming };
    return {
      ok: false,
      error:
        "structural change (turn count or role sequence) would destroy per-turn timings and verified flags — resend with confirmDestructive: true to intentionally reset them, or edit turns individually via PATCH",
    };
  }

  // Same structure: inherit missing metadata positionally. verified survives
  // only when the text is unchanged — an edited turn needs re-verification
  // unless the caller explicitly re-asserts it.
  const turns = incoming.map((t, i) => {
    const e = existing[i];
    const merged: IncomingTurn = { ...t };
    if (merged.tStartMs === undefined && typeof e.tStartMs === "number") merged.tStartMs = e.tStartMs;
    if (merged.tEndMs === undefined && typeof e.tEndMs === "number") merged.tEndMs = e.tEndMs;
    if (merged.verified === undefined && e.verified === true && merged.text.trim() === String(e.text).trim()) {
      merged.verified = true;
    }
    return merged;
  });
  return { ok: true, turns };
}
