import { describe, it, expect, vi } from "vitest";
import {
  findFlaggedEntries,
  stripFlaggedEntries,
  remediateDialogueLibraries,
  type RemediationDeps,
} from "../dialogueLibraryRemediation";
import type { DialogueEntry, DialogueLibrary } from "@shared/schema";

// Remediation of pre-grounding dialogue libraries: rows whose canned answers
// assert mutable real-world state / unverifiable personal facts must be
// regenerated with the grounded prompt (preserving goalText/goalType/user), or
// at minimum have the offending lines stripped, so that NO saved answer asserts
// unknown facts after the pass.

let nextId = 0;
function entry(answer: string, over: Partial<DialogueEntry> = {}): DialogueEntry {
  return {
    id: `e${nextId++}`,
    type: "typical",
    trigger: "some question",
    variants: [],
    answer,
    translation: "",
    slot: null,
    sortOrder: 0,
    ...over,
  };
}

function lib(id: string, userId: string, entries: DialogueEntry[], over: Partial<DialogueLibrary> = {}): DialogueLibrary {
  return {
    id,
    userId,
    goalType: "support",
    goalText: "fix my internet",
    entries,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as DialogueLibrary;
}

const GROUNDED = entry("Could you tell me a bit more about what happened?");
const ASSERTS_WORKING = entry("Yes, everything works now, thanks for checking.");
const ASSERTS_DEVICE = entry("I'm using an iPhone 15.");
const ASSERTS_ACTION = entry("I already restarted the router twice.");

describe("findFlaggedEntries / stripFlaggedEntries", () => {
  it("flags answers asserting state or unverifiable personal facts", () => {
    const flagged = findFlaggedEntries([GROUNDED, ASSERTS_WORKING, ASSERTS_DEVICE, ASSERTS_ACTION]);
    expect(flagged).toEqual([ASSERTS_WORKING, ASSERTS_DEVICE, ASSERTS_ACTION]);
  });

  it("strips only flagged entries and re-stamps sortOrder contiguously", () => {
    const grounded2 = entry("What plan are you on with us?");
    const out = stripFlaggedEntries([GROUNDED, ASSERTS_WORKING, grounded2]);
    expect(out.map((e) => e.id)).toEqual([GROUNDED.id, grounded2.id]);
    expect(out.map((e) => e.sortOrder)).toEqual([0, 1]);
  });
});

function makeDeps(libraries: DialogueLibrary[], regenerate: RemediationDeps["regenerate"]) {
  const updates: Array<{ userId: string; id: string; entries: DialogueEntry[]; expectedUpdatedAt: Date }> = [];
  const deps: RemediationDeps = {
    listAllLibraries: async () => libraries,
    updateLibraryIfUnchanged: async (userId, id, entries, expectedUpdatedAt) => {
      // Simulate the DB compare-and-swap: only write when updatedAt matches.
      const row = libraries.find((l) => l.id === id && l.userId === userId);
      if (!row || new Date(row.updatedAt).getTime() !== expectedUpdatedAt.getTime()) return undefined;
      updates.push({ userId, id, entries, expectedUpdatedAt });
      return { id };
    },
    regenerate,
  };
  return { deps, updates };
}

describe("remediateDialogueLibraries", () => {
  it("leaves clean libraries untouched", async () => {
    const regenerate = vi.fn();
    const { deps, updates } = makeDeps([lib("L1", "u1", [GROUNDED])], regenerate);
    const res = await remediateDialogueLibraries(deps);
    expect(res).toMatchObject({ scanned: 1, clean: 1, regenerated: 0, stripped: 0, failed: 0 });
    expect(regenerate).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("regenerates a flagged library, preserving its user binding", async () => {
    const flaggedLib = lib("L1", "u42", [GROUNDED, ASSERTS_WORKING]);
    const fresh = [entry("Let me check that for you — what exactly do you see?")];
    const regenerate = vi.fn(async (l: DialogueLibrary) => {
      // regeneration must see the ORIGINAL goal so goalText/goalType survive
      expect(l.goalText).toBe("fix my internet");
      expect(l.goalType).toBe("support");
      return fresh;
    });
    const { deps, updates } = makeDeps([flaggedLib], regenerate);
    const res = await remediateDialogueLibraries(deps);
    expect(res).toMatchObject({ scanned: 1, regenerated: 1, stripped: 0, failed: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].userId).toBe("u42");
    expect(updates[0].id).toBe("L1");
    expect(updates[0].entries.map((e) => e.id)).toEqual(fresh.map((e) => e.id));
  });

  it("filters flagged lines out of the REGENERATED entries too", async () => {
    const still = entry("Everything works now on our side.");
    const good = entry("Happy to walk through it with you step by step.");
    const { deps, updates } = makeDeps(
      [lib("L1", "u1", [ASSERTS_DEVICE])],
      async () => [still, good],
    );
    await remediateDialogueLibraries(deps);
    expect(updates[0].entries.map((e) => e.id)).toEqual([good.id]);
    expect(findFlaggedEntries(updates[0].entries)).toEqual([]);
  });

  it("falls back to stripping flagged entries when regeneration throws", async () => {
    const { deps, updates } = makeDeps(
      [lib("L1", "u1", [GROUNDED, ASSERTS_ACTION])],
      async () => {
        throw new Error("openai down");
      },
    );
    const res = await remediateDialogueLibraries(deps);
    expect(res).toMatchObject({ regenerated: 0, stripped: 1, failed: 0 });
    expect(updates[0].entries.map((e) => e.id)).toEqual([GROUNDED.id]);
  });

  it("falls back to stripping when regeneration returns nothing usable", async () => {
    const { deps, updates } = makeDeps([lib("L1", "u1", [ASSERTS_WORKING, GROUNDED])], async () => []);
    const res = await remediateDialogueLibraries(deps);
    expect(res).toMatchObject({ stripped: 1 });
    expect(findFlaggedEntries(updates[0].entries)).toEqual([]);
    expect(updates[0].entries.map((e) => e.id)).toEqual([GROUNDED.id]);
  });

  it("counts unsaved writes as skipped and keeps processing other libraries", async () => {
    const bad = lib("L1", "u1", [ASSERTS_WORKING]);
    const alsoBad = lib("L2", "u2", [ASSERTS_DEVICE]);
    const deps: RemediationDeps = {
      listAllLibraries: async () => [bad, alsoBad],
      updateLibraryIfUnchanged: async (_u, id) => (id === "L1" ? undefined : { id }),
      regenerate: async () => [GROUNDED],
    };
    const res = await remediateDialogueLibraries(deps);
    expect(res).toMatchObject({ scanned: 2, skipped: 1, regenerated: 1, failed: 0 });
  });

  it("never overwrites a library the user edited while regeneration was in flight", async () => {
    // The scan reads the row, then a user edit bumps updatedAt (and swaps the
    // entries) BEFORE our write lands. The compare-and-swap must miss and the
    // user's newer version must survive untouched.
    const flaggedLib = lib("L1", "u7", [ASSERTS_WORKING], { updatedAt: new Date("2026-01-01T00:00:00Z") });
    const userEdited = [entry("Thanks — could you walk me through what you tried?")];
    const { deps, updates } = makeDeps([flaggedLib], async () => {
      // Concurrent user save happens during the slow regeneration call.
      flaggedLib.entries = userEdited;
      (flaggedLib as any).updatedAt = new Date("2026-01-02T00:00:00Z");
      return [GROUNDED];
    });
    const res = await remediateDialogueLibraries(deps);
    expect(res).toMatchObject({ scanned: 1, skipped: 1, regenerated: 0, stripped: 0, failed: 0 });
    expect(updates).toEqual([]); // no write happened
    expect(flaggedLib.entries).toBe(userEdited); // user's version intact
  });

  it("never throws when listing fails", async () => {
    const res = await remediateDialogueLibraries({
      listAllLibraries: async () => {
        throw new Error("db down");
      },
      updateLibrary: async () => ({}),
      regenerate: async () => [],
    });
    expect(res).toMatchObject({ scanned: 0 });
  });
});
