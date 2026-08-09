// Tutor Call Memory: prompt-block rendering, provider-chain wiring, and the
// confirmation-lifecycle guarantees (only user-CONFIRMED memories can ever
// reach a real call; consumption stamps, never deletes).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildContextProviderChain, buildTutorMemorySection } from "../contactMemory";
import { formatCallMemoryBlock } from "../tutorStorage";
import type { TutorCallMemory } from "@shared/schema";

const mem = {
  id: "m1",
  userId: "u1",
  engineSessionId: "s1",
  objective: "Book a dentist appointment",
  facts: ["Insurance: Delta Dental"],
  questions: ["Do you take new patients?"],
  rehearsedAnswers: ["My name is Ivan, I need a cleaning."],
  vocabulary: ["copay", "appointment slot"],
  uncertainFacts: ["Maybe closed on Fridays"],
  status: "REAL_CALL_READY",
} as unknown as TutorCallMemory;

describe("formatCallMemoryBlock", () => {
  it("renders all sections and flags uncertain facts as not-to-assert", () => {
    const block = formatCallMemoryBlock(mem);
    expect(block).toContain("TRAINING_CALL_MEMORY");
    expect(block).toContain("user-confirmed");
    expect(block).toContain("Book a dentist appointment");
    expect(block).toContain("Delta Dental");
    expect(block).toContain("Do you take new patients?");
    expect(block).toContain("copay");
    expect(block).toContain("UNCERTAIN facts");
    expect(block).toContain("never assert");
    expect(block).toContain("Maybe closed on Fridays");
  });

  it("omits empty sections", () => {
    const empty = { ...mem, facts: [], questions: [], rehearsedAnswers: [], vocabulary: [], uncertainFacts: [] } as unknown as TutorCallMemory;
    const block = formatCallMemoryBlock(empty);
    expect(block).not.toContain("Facts:");
    expect(block).not.toContain("UNCERTAIN");
  });
});

describe("TUTOR_MEMORY context provider", () => {
  it("is included in the provider chain after STATIC_CARDS", () => {
    const chain = buildContextProviderChain({
      userContext: "uc",
      staticCards: "sc",
      tutorMemory: formatCallMemoryBlock(mem),
    });
    expect(chain).toContain("TRAINING_CALL_MEMORY");
    expect(chain.indexOf("STATIC_CARDS")).toBeLessThan(chain.indexOf("TRAINING_CALL_MEMORY"));
  });

  it("renders nothing when no memory is set", () => {
    expect(buildTutorMemorySection("")).toBe("");
    expect(buildContextProviderChain({ userContext: "uc" })).not.toContain("TRAINING_CALL_MEMORY");
  });
});

// Source-level lifecycle guards: cheap but effective protection against
// accidentally weakening the confirmation gate in future edits.
describe("tutor memory lifecycle (source guards)", () => {
  const storageSrc = fs.readFileSync(path.join(__dirname, "..", "tutorStorage.ts"), "utf8");
  const wsSrc = fs.readFileSync(path.join(__dirname, "..", "websocket.ts"), "utf8");

  it("claimActiveCallMemory only selects REAL_CALL_READY rows and consumes atomically", () => {
    const fn = storageSrc.slice(storageSrc.indexOf("export async function claimActiveCallMemory"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain('"REAL_CALL_READY"');
    expect(body).toContain('"COMPLETED"');
    expect(body).toContain("usedAt");
    expect(body).not.toContain(".delete(");
  });

  it("confirmCallMemory transitions only from MEMORY_CONFIRMATION", () => {
    const fn = storageSrc.slice(storageSrc.indexOf("export async function confirmCallMemory"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain('"MEMORY_CONFIRMATION"');
  });

  it("live call path claims the memory atomically and passes it to translateAndSuggest", () => {
    expect(wsSrc).toContain("claimActiveCallMemory(streamUserId");
    expect(wsSrc).toContain("tutorMemoryBlock)");
  });

  it("/end verifies session ownership and is idempotent", () => {
    const routesSrc = fs.readFileSync(path.join(__dirname, "..", "tutorRoutes.ts"), "utf8");
    const endBlock = routesSrc.slice(routesSrc.indexOf("/end"));
    expect(endBlock).toContain("getTutorSessionRow(user.id, engineSessionId)");
    expect(endBlock).toContain("getCallMemoryByEngineSession(user.id, engineSessionId)");
  });
});
