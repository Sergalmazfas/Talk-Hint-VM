import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { normalizeCandidate, codeMetrics, validateJudge } from "./unified-hint-metrics";
import { quotaFailure, canReserve } from "./unified-hint-budget";
const dir = "generated-artifacts/hint-unified-preflight";
const s = await readFile(`${dir}/frozen-reference-v1.json`, "utf8");
const f = JSON.parse(s), z = JSON.parse(await readFile(`${dir}/REFERENCE_FREEZE.json`, "utf8"));
assert.equal(createHash("sha256").update(s).digest("hex"), z.sha256);
assert.equal(new Set(f.map((x: any) => x.id)).size, 90);
assert(f.every((x: any) => x.reference.ownerEvidence.every((e: any) => e.sourceTurnIdx < x.sourceTurnIdx)));
const firstCode = f.find((x: any) => x.callId === "august-fixture-2" && x.sourceTurnIdx === 12);
assert(!firstCode.reference.ownerEvidence.some((e: any) => e.meaning.startsWith("Order explicitly completed")));
const laterCode = f.find((x: any) => x.callId === "august-fixture-2" && x.sourceTurnIdx === 18);
assert(laterCode.reference.ownerEvidence.some((e: any) => e.meaning.startsWith("Order explicitly completed")));
assert(!s.includes("954-218-7485") && !s.includes("Nine five four two one eight seven four eight five"));
const n = normalizeCandidate({ translation: "Guest, not owner", suggestion: { type: "direct", en: "I haven't rebooted yet.", translation: "" } });
const judge = { goal: "yes", goalFactsUse: "not_needed", inventedFacts: false, speakingForOwner: false,
  goalScore: 8, usefulnessScore: 8, reason: "test", claims: [] };
assert(validateJudge(judge, n, { ownerEvidence: [] }).some(x => x.includes("reboot")));
const guestCitation = { ...judge, inventedFacts: true, claims: [{ path: "guestTranslation", quote: "Guest",
  status: "unsupported", sourceId: null }] };
assert(validateJudge(guestCitation, n, { ownerEvidence: [] }).some(x => x.includes("wrong field")));
const nullJudge = { ...judge, goal: "unknown", inventedFacts: "unknown", speakingForOwner: "unknown",
  goalScore: null, usefulnessScore: null };
assert.deepEqual(validateJudge(nullJudge, normalizeCandidate({ should_suggest: false }, true), { ownerEvidence: [] }), []);
const ch = normalizeCandidate({ suggestion: { type: "choice", en: "", options: [
  { label: "Да", en: "Yes, I see it.", translation: "" }, { label: "Нет", en: "No, not yet.", translation: "" }] } });
assert.equal(codeMetrics(ch).cardCount, 2);
assert.equal(normalizeCandidate({ should_suggest: false }, true).cards.length, 0);
assert(quotaFailure({ code: "credit_balance_exhausted", type: "insufficient_quota" }));
assert(quotaFailure({ code: "insufficient_quota" }));
assert(!quotaFailure({ code: "rate_limit_exceeded" }));
assert(canReserve(34, .5, .5, 1087));
assert(!canReserve(34, .5, .5001, 1087));
assert(!canReserve(0, 0, .1, 1088));
await writeFile(`${dir}/OFFLINE_CHECKS.json`, JSON.stringify({ passed: true, checks: [
  "90 unique snapshots; no future Owner evidence", "Missing vs later received activation code kept causal",
  "Phone data deidentified", "Unsupported negative reboot rejected", "Guest translation cannot be Owner evidence",
  "Unknown scores remain null", "CHOICE counted as 2 cards; no-suggest as 0",
  "Hard quota failure distinguished from transient rate limit", "In-flight reservations and 1088-request cap checked",
], modelCalls: 0 }, null, 2));
console.log("Offline checks passed; model calls 0");
