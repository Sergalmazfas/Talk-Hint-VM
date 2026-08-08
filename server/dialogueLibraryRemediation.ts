import type { DialogueEntry, DialogueLibrary } from "@shared/schema";
import type { GoalType } from "@shared/goalTypes";
import { GOAL_REQUIREMENTS } from "@shared/goalTypes";
import { answerAssertsUnverifiableState } from "./dialogueMatch";
import { generateDialogueLibrary } from "./dialogueLibraryGenerator";
import { storage } from "./storage";
import { formatStaticCards } from "./contactMemory";

// One-time (idempotent) remediation of dialogue libraries generated BEFORE the
// grounding rules were added to the generator prompt. Old libraries may contain
// pre-authored answers that assert mutable real-world state or unverifiable
// personal facts ("everything works now", "I'm using an iPhone"). The runtime
// answer-side guard already refuses to SERVE such lines, but the rows still sit
// in the DB and any non-guarded consumer would read them verbatim.
//
// Strategy per library:
//   1. Scan every entry with the same answer-side guard the runtime uses.
//      Clean libraries are skipped (cheap regex pass — safe to run on every
//      startup, no schema flag needed).
//   2. A flagged library is REGENERATED with the current (grounded) prompt,
//      preserving its goalText / goalType / user binding. Regenerated entries
//      are themselves re-scanned and any stragglers dropped.
//   3. If regeneration fails or returns nothing (e.g. no OpenAI access), we
//      fall back to STRIPPING only the flagged entries so the stored data
//      still satisfies "no saved answer asserts unknown facts" without losing
//      the rest of the user's library.
// Never throws; failures are logged and the next startup retries.

export function findFlaggedEntries(entries: DialogueEntry[]): DialogueEntry[] {
  return entries.filter((e) => e && typeof e.answer === "string" && answerAssertsUnverifiableState(e.answer));
}

export function stripFlaggedEntries(entries: DialogueEntry[]): DialogueEntry[] {
  return entries
    .filter((e) => !(e && typeof e.answer === "string" && answerAssertsUnverifiableState(e.answer)))
    .map((e, i) => ({ ...e, sortOrder: i }));
}

function libraryEntries(lib: DialogueLibrary): DialogueEntry[] {
  return Array.isArray(lib.entries) ? (lib.entries as DialogueEntry[]) : [];
}

// Dependencies are injectable so the remediation logic is unit-testable without
// a DB or OpenAI.
export interface RemediationDeps {
  listAllLibraries(): Promise<DialogueLibrary[]>;
  // Optimistic-concurrency write: must replace entries ONLY when the row's
  // updatedAt still equals expectedUpdatedAt (the value read at scan time),
  // returning undefined otherwise. This guarantees a user edit/regeneration
  // that lands while we're regenerating is never overwritten by our stale
  // snapshot — we skip instead and the next startup re-scans.
  updateLibraryIfUnchanged(
    userId: string,
    id: string,
    entries: DialogueEntry[],
    expectedUpdatedAt: Date,
  ): Promise<unknown | undefined>;
  regenerate(lib: DialogueLibrary): Promise<DialogueEntry[]>;
}

async function defaultRegenerate(lib: DialogueLibrary): Promise<DialogueEntry[]> {
  const [userContext, cards, user] = await Promise.all([
    storage.getUserContext(lib.userId),
    storage.listKnowledgeCards(lib.userId),
    storage.getUser(lib.userId),
  ]);
  // Preserve the stored goalType; if it's somehow outside the known set, use
  // the generic "other" domain guidance for generation only.
  const goalType: GoalType = Object.keys(GOAL_REQUIREMENTS).includes(lib.goalType)
    ? (lib.goalType as GoalType)
    : "other";
  return generateDialogueLibrary({
    goalText: lib.goalText || "",
    goalType,
    userContext,
    cards: formatStaticCards(cards),
    language: user?.language || "ru",
  });
}

export const defaultRemediationDeps: RemediationDeps = {
  listAllLibraries: () => storage.listAllDialogueLibraries(),
  updateLibraryIfUnchanged: (userId, id, entries, expectedUpdatedAt) =>
    storage.updateDialogueLibraryEntriesIfUnchanged(userId, id, entries, expectedUpdatedAt),
  regenerate: defaultRegenerate,
};

export interface RemediationResult {
  scanned: number;
  clean: number;
  regenerated: number;
  stripped: number;
  // Write skipped because the library changed (user edit/regeneration) between
  // our scan and our write — their newer version wins; next startup re-scans.
  skipped: number;
  failed: number;
}

export async function remediateDialogueLibraries(
  deps: RemediationDeps = defaultRemediationDeps,
): Promise<RemediationResult> {
  const result: RemediationResult = { scanned: 0, clean: 0, regenerated: 0, stripped: 0, skipped: 0, failed: 0 };
  let libraries: DialogueLibrary[];
  try {
    libraries = await deps.listAllLibraries();
  } catch (err: any) {
    console.error("[Dialogue Remediation] Failed to list libraries:", err?.message || err);
    return result;
  }

  for (const lib of libraries) {
    result.scanned++;
    const entries = libraryEntries(lib);
    const flagged = findFlaggedEntries(entries);
    if (flagged.length === 0) {
      result.clean++;
      continue;
    }
    console.warn(
      `[Dialogue Remediation] Library ${lib.id} (user ${lib.userId}, goal "${lib.goalText}") has ` +
        `${flagged.length}/${entries.length} entries asserting unverifiable state — regenerating with grounded prompt.`,
    );
    // Snapshot the scan-time version BEFORE the (slow) regeneration so the
    // compare-and-swap below detects any user edit that lands in the meantime.
    const scanUpdatedAt = new Date(lib.updatedAt);

    // Regenerate with the grounded prompt, preserving goalText/goalType/user.
    let regenerated: DialogueEntry[] = [];
    try {
      regenerated = stripFlaggedEntries(await deps.regenerate(lib));
    } catch (err: any) {
      console.error(`[Dialogue Remediation] Regeneration failed for ${lib.id}:`, err?.message || err);
    }

    // Fall back to stripping only the flagged lines when regeneration yields
    // nothing usable — the rest of the user's library is preserved.
    const next = regenerated.length > 0 ? regenerated : stripFlaggedEntries(entries);
    const mode = regenerated.length > 0 ? "regenerated" : "stripped";

    try {
      // Compare-and-swap on the updatedAt we read at scan time: if the user
      // saved a newer version while we regenerated, this write misses and we
      // skip — never clobber fresh user data with our stale snapshot.
      const saved = await deps.updateLibraryIfUnchanged(
        lib.userId,
        lib.id,
        next,
        scanUpdatedAt,
      );
      if (!saved) {
        result.skipped++;
        console.warn(
          `[Dialogue Remediation] Library ${lib.id} changed during remediation (or write failed) — ` +
            `skipping to preserve the newer version; next startup re-scans.`,
        );
        continue;
      }
      if (mode === "regenerated") result.regenerated++;
      else result.stripped++;
      console.log(
        `[Dialogue Remediation] Library ${lib.id} ${mode}: ${entries.length} → ${next.length} entries (0 flagged remain).`,
      );
    } catch (err: any) {
      result.failed++;
      console.error(`[Dialogue Remediation] Failed to save ${lib.id}:`, err?.message || err);
    }
  }

  if (result.regenerated || result.stripped || result.skipped || result.failed) {
    console.log(
      `[Dialogue Remediation] Done: ${result.scanned} scanned, ${result.clean} clean, ` +
        `${result.regenerated} regenerated, ${result.stripped} stripped, ` +
        `${result.skipped} skipped (concurrent edit), ${result.failed} failed.`,
    );
  }
  return result;
}
