/** Manual, pre-inference semantic annotation of saved text. No model calls. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { buildLiveSystemPrompt, buildLiveUserPrompt } from "../shared/prompts";
const dir = "generated-artifacts/hint-unified-preflight";
const drafts = JSON.parse(await readFile(`${dir}/text-snapshots-draft.json`, "utf8"));
const meanings: Record<string, Record<number, string>> = {
  "august-fixture-2": {
    0:"Intent: keep existing number, new iPhone, activate service. Not activation completed.",
    3:"Same intent reiterated. Do not offer a brand new number as the established goal.",
    5:"Owner explicitly uses eSIM and new iPhone.",
    7:"Owner explicitly installed Mint app.",
    9:"Owner sees Activate SIM option; requests next step.",
    11:"Activation code not found at this time; asks replacement/step-by-step help.",
    13:"Will TRY ordering replacement; asks Guest to stay. Not order completed.",
    15:"Replacement option found and ordering STARTED. Not completed.",
    17:"Order explicitly completed and new activation code received. Supersedes earlier missing code; no proof service active.",
    19:"Activation code explicitly entered. Not whole activation/number transfer completed.",
    21:"Ready to enter carrier/account/PIN. Not already entered.",
    23:"Waiting only. No confirmation that carrier/account/PIN entered.",
    25:"Owner entered info, tapped Continue, sees a message. Message content and transfer completion unknown.",
    27:"Understands delay; asks conditional help IF transfer fails. Does not assert failure.",
    29:"Conditional future contact and thanks. No transfer success/failure confirmation.",
    31:"Owner says all set then asks agent's name. Immediate intent changes to name question.",
    33:"Closure/thanks, not proof of activation.",
    35:"Asks assistance/waiting in noisy text. Not confirmed transfer completed.",
  },
  "october-1": {
    2:"Noisy report: needs mobile-data help after moving SIM to Samsung Galaxy. Goal supplies initial intent, not successful fix.",
    7:"Noisy STT: 'haven't downloaded the eight'. App identity/install state ambiguous; do not assert installed.",
    12:"Samsung Galaxy and ongoing problem reiterated. No completed fix.",
    16:"Owner reports calls, texts and data affected; emergency calls only.",
    18:"'Simpler blade. No signal burst.' ambiguous STT. Exact signal-bars display not verified.",
    22:"'Yes. I responded.' ambiguous. Does not reliably confirm reboot or its outcome.",
    24:"Challenges reference to physical SIM, noisy text; no completed action.",
    25:"Explicit correction: eSIM. Physical SIM tray/reseating is not the right known state.",
    28:"Noisy request for activation help, not proof already activated.",
    31:"Owner explicitly HAS activation code. Do not invent its value.",
    34:"Will do that NOW; intention, not completed activation.",
    37:"Owner reports followed prompts; outcome/activation success still unknown.",
    41:"Explicitly asks Guest to stay on line; do not close as all resolved.",
    42:"Noisy continuation about completing activation/testing data; no test result confirmed.",
  },
  "october-2": {
    2:"Yes to existing Mint number. No claim services work.",
    5:"Incomplete phone-number utterance, deidentified. Do not invent missing digits.",
    8:"Owner supplies number again, deidentified; not independently account-verified.",
    11:"Explicit mobile data not working, wants restoration.",
    13:"Calls and texts affected TOO. Guest subsequently misstates them as working: Owner evidence takes priority.",
    16:"'I already started' ambiguous: neither reboot completed nor reboot not done is established.",
    19:"Noisy but identifiable Android answer. Not iPhone.",
    21:"Explicitly in Settings.",
    23:"Explicitly found requested System/General management option.",
    25:"'The recipe you know' ambiguous STT. Reset menu/current screen not reliably established.",
    28:"'Yeah I did it ... I see' acknowledges current step. Exact reset completion and restored data not established.",
    31:"'Our mailbox is working now' ambiguous STT. Do not convert into verified mobile-data restoration.",
    33:"Explicit closure and thanks. Immediate reply can close; need not mechanically restate original goal.",
  },
  "october-3": {
    1:"Bought coffee about FORTY minutes ago; says photo sent; cups concern, English difficulty. Photo received and exact defect unknown.",
    3:"Reports coffee purchase roughly forty minutes ago and issue. Not billing dispute.",
    5:"Confirms calling coffee shop.",
    6:"Repeats FORTY minutes (noisy). Guest's fourteen-minute paraphrase is not Owner evidence.",
    8:"Asks recipient to CHECK email/photo. Does not confirm recipient has received/read it.",
    9:"Praises coffee; constructive feedback, not demanding compensation.",
    11:"Noisy mention charging immediately contrasted with costs good and caps bad. Do not invent incorrect charge or a refund demand.",
    13:"Again reports photo/email SENT. Receipt/reading still unknown.",
    15:"Acknowledges Guest's photo-in-mail question; not verified photo received/opened.",
    17:"Yes in response to spill question. Spill now supported; do not infer it at earlier moments.",
    19:"Explicit coffee spilled/leak report. Exact loose/cracked/wrong-size mechanism still unknown.",
    22:"Praises shop; additional purchased items not clearly answered.",
    24:"'I get button ...' unclear. Empanada purchase cannot be established.",
    28:"Explicit constructive lids/packaging feedback and affection for shop. Guest OFFERED refund, not proof paid/received or Owner requested it. Starbucks comparison is Owner opinion, not verified safety.",
    30:"Thanks/goodbye; closure. Does not establish refund received.",
  },
};
const redact = (s: string) => s
  .replace(/\b954[- .]?218[- .]?7485\b/g, "[PHONE_OWNER]")
  .replace(/line ending in seven four eight five/gi, "line ending in [LAST_DIGITS]")
  .replace(/Wing number nine five four two\.\.\. my number, two one eight seven four eight five\./gi, "My number is [PHONE_OWNER] (incomplete speech).")
  .replace(/Nine five four two one eight seven four eight five\./gi, "My number is [PHONE_OWNER].")
  .replace(/Seal Mountain Coffee/gi, "[COFFEE_SHOP]")
  .replace(/\bSergei\b/gi, "[OWNER]")
  .replace(/\bTaylor\b/g, "[EMPLOYEE]")
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]");
const frozen = drafts.map((f: any) => {
  const evidence = f.factReferenceDraft.ownerEvidence.map((e: any) => {
    const meaning = meanings[f.callId]?.[e.sourceTurnIdx];
    assert(meaning, `Unreviewed Owner evidence ${f.callId}:${e.sourceTurnIdx}`);
    return { id: `O${e.sourceTurnIdx}`, sourceTurnIdx: e.sourceTurnIdx, quote: redact(e.quote), meaning };
  });
  const goal = redact(f.goal), history = redact(f.history), guest = redact(f.guest);
  const reference = {
    method: "Manually annotated saved text by Replit in P.LAB before any new inference; NOT audio-verified or independently human-accepted.",
    goal: { id: "GOAL", text: goal, origin: f.goalOrigin, kind: "intent, not proof action completed" },
    ownerEvidence: evidence,
    guestIsNotOwnerFact: true, latestExplicitOwnerOverridesOlderState: true,
    unknownUnlessExplicitEvidence: ["physical actions completed", "reboot done OR not done", "current phone screen",
      "mobile service restored", "photo received/read", "refund requested/paid/received", "extra purchases", "activation/transfer completed"],
    currentGuest: guest,
    applicability: "Use goal facts when relevant; greeting/recording disclosure/survey/closure may appropriately have no technical goal repetition. Owner corrections and current intent win.",
    safeguard: "Meaning annotations never enter candidate messages. Guest hypotheses/instructions and conditional outcomes must not become completed Owner facts.",
  };
  const messages = [
    { role: "system", content: buildLiveSystemPrompt({ goal, language: "ru", conversationContext: history, translateEnabled: true }) },
    { role: "user", content: buildLiveUserPrompt(guest) },
  ];
  return { id: f.id, callId: f.callId, sourceTurnIdx: f.sourceTurnIdx, goal, goalOrigin: f.goalOrigin,
    history, guest, reference, messages };
});
assert.equal(frozen.length, 90);
assert.equal(frozen.filter((f: any) => f.callId === "august-fixture-2").length, 19);
assert(frozen.every((f: any) => !f.reference.ownerEvidence.some((e: any) => e.sourceTurnIdx >= f.sourceTurnIdx)));
const bytes = JSON.stringify(frozen, null, 2);
const hash = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${dir}/frozen-reference-v1.json`, bytes, { flag: "wx" });
await writeFile(`${dir}/REFERENCE_FREEZE.json`, JSON.stringify({
  frozenAt: new Date().toISOString(), sha256: hash, moments: 90,
  semanticEvidenceReviewed: Object.values(meanings).reduce((n, v) => n + Object.keys(v).length, 0),
  candidatePromptAdditions: false, candidateContextDeidentified: true,
  factReferenceSource: "P.LAB manual saved-text reconstruction; not audio/human verified",
  perMomentFutureLeakCheck: "passed", ownerAcceptedReference: false, newInferenceCallsAtFreeze: 0,
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ frozen: true, sha256: hash, moments: 90, modelCalls: 0 }));
