// LIVE Hint Policy v2.1 — adaptive hint types (Task #234).
//
// Pure sanitization + backward-compatible normalization of the model's
// suggestion object, extracted from server/websocket.ts parseHint so it can be
// unit-tested without the websocket dependency graph.
//
// Contract:
//  - The model MAY return {type, en, translation, options, native_helper}.
//  - Old/legacy replies (no type) keep the exact pre-v2.1 behavior.
//  - CHOICE: `en` may be empty — the server composes a safe compatibility
//    string from the options so any client that only reads en/translation
//    (talkhint/ui, iOS) still shows a usable hint and never renders an empty
//    card. New fields are ADDITIVE on the wire; old clients ignore them.
//  - Translation OFF: every translation field AND native_helper are forced
//    empty (native_helper is native-language by definition, so it obeys the
//    same per-user translation gate as every other translated field).
//  - Options are suggestions, NOT facts: nothing here ever feeds the
//    transcript or contact memory (suggestions never do — see websocket.ts).
//
// No LLM is involved anywhere in this file — normalization is string work on
// the single existing BRAIN reply (hard constraint: no second model call).

export type HintType = "direct" | "choice" | "user_input" | "strategic";

export interface HintOption {
  label: string;
  en: string;
  translation: string;
}

export interface NormalizedSuggestion {
  // Compat fields — ALWAYS populated when a usable suggestion exists.
  en: string;
  translation: string;
  // v2.1 additive fields — present only when valid.
  type?: HintType;
  options?: HintOption[];
  nativeHelper?: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set(["direct", "choice", "user_input", "strategic"]);
const MAX_OPTIONS = 3;

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Server-side sensitive-value backstop (defense in depth behind the prompt's
// placeholder-first rule): if the model echoes a sensitive authentication
// value from the transcript/context into a hint, redact it before broadcast.
// Deliberately HIGH-CONFIDENCE patterns only — over-redaction would break
// legitimate hints (prices, ZIP codes, the user's own phone number are
// explicitly allowed by the policy):
//  - SSN with separators (123-45-6789) — never legitimate in a spoken hint.
//  - Card-like runs of 13-19 digits (with optional spaces/dashes).
//  - For user_input hints ONLY (where the frame must be a placeholder anyway):
//    any bare run of 6+ digits (covers OTP/verification codes, PINs, account
//    numbers echoed into what should be a placeholder frame).
// Short numeric codes (4-5 digits) in non-user_input hints are left to the
// prompt rule — they are indistinguishable from prices/quantities/ZIPs.
const SSN_RE = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const LONG_DIGITS_RE = /\b\d{6,}\b/g;

export function redactSensitive(text: string, opts?: { aggressive?: boolean }): string {
  if (!text) return text;
  let out = text.replace(SSN_RE, "[your SSN]").replace(CARD_RE, "[your card number]");
  if (opts?.aggressive) out = out.replace(LONG_DIGITS_RE, "[your number]");
  return out;
}

// Compose the old-client compatibility string for a CHOICE hint:
//   'If yes: "Yes, I got it." / If no: "No, not yet."'
// Chosen to read naturally on a single legacy hint card while making it
// obvious these are alternatives, not one sentence to say verbatim.
export function composeChoiceCompat(options: HintOption[], field: "en" | "translation"): string {
  const parts = options
    .map((o) => {
      const text = field === "en" ? o.en : o.translation;
      if (!text) return "";
      return o.label ? `If ${o.label}: "${text}"` : `"${text}"`;
    })
    .filter(Boolean);
  return parts.join(" / ");
}

// Sanitize the raw model suggestion object (already JSON.parsed, unknown
// shape) into a normalized suggestion, applying the translate gate.
// Returns null when there is no usable suggestion at all.
export function normalizeSuggestion(
  raw: any,
  opts: { translateEnabled: boolean; stripPreamble?: (s: string) => string }
): NormalizedSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const strip = opts.stripPreamble ?? ((s: string) => s);

  const typeRaw = asTrimmedString(raw.type).toLowerCase();
  // Unknown/missing type → legacy behavior: plain en/translation hint.
  const type: HintType | undefined = VALID_TYPES.has(typeRaw) ? (typeRaw as HintType) : undefined;

  let en = strip(asTrimmedString(raw.en));
  let translation = strip(asTrimmedString(raw.translation));

  // Options: only meaningful for choice. Filter junk entries, cap the count.
  let options: HintOption[] | undefined;
  if (type === "choice" && Array.isArray(raw.options)) {
    const cleaned: HintOption[] = [];
    for (const o of raw.options) {
      if (!o || typeof o !== "object") continue;
      const oEn = strip(asTrimmedString(o.en));
      if (!oEn) continue;
      cleaned.push({
        label: asTrimmedString(o.label),
        en: oEn,
        translation: strip(asTrimmedString(o.translation)),
      });
      if (cleaned.length >= MAX_OPTIONS) break;
    }
    // A "choice" needs genuine alternatives; a single option is just a direct hint.
    if (cleaned.length >= 2) options = cleaned;
  }

  // native_helper: only meaningful for user_input.
  let nativeHelper = type === "user_input" ? asTrimmedString(raw.native_helper ?? raw.nativeHelper) : "";

  // Translation OFF: force-empty every translated field, including the
  // native-language helper — same gate as the legacy translation fields.
  if (!opts.translateEnabled) {
    translation = "";
    nativeHelper = "";
    if (options) options = options.map((o) => ({ ...o, translation: "" }));
  }

  // CHOICE compatibility: old clients only read en/translation, so for every
  // valid CHOICE the compat string is ALWAYS composed deterministically from
  // the validated options — a model-provided main reply is ignored, so dedup,
  // telemetry, and hint-usage matching always operate on the same canonical
  // string the legacy client displays. (If no option carries a translation,
  // the compat translation is empty — same as any legacy hint whose model
  // omitted the translation; the en side is always populated.)
  if (options && options.length >= 2) {
    en = composeChoiceCompat(options, "en");
    translation = opts.translateEnabled ? composeChoiceCompat(options, "translation") : "";
  } else if (type === "choice" && !en) {
    // Malformed choice (fewer than 2 usable options, no main text) — no
    // usable suggestion. Fail closed rather than showing an empty card.
    return null;
  }

  if (!en) return null;

  // Sensitive-value backstop on every user-visible field. user_input frames
  // get the aggressive pass (bare 6+ digit runs) — the frame must be a
  // placeholder by definition, so digits there are always an echo violation.
  const aggressive = type === "user_input";
  en = redactSensitive(en, { aggressive });
  translation = redactSensitive(translation, { aggressive });
  if (options) {
    options = options.map((o) => ({
      ...o,
      en: redactSensitive(o.en),
      translation: redactSensitive(o.translation),
    }));
  }
  if (nativeHelper) nativeHelper = redactSensitive(nativeHelper, { aggressive: true });

  const result: NormalizedSuggestion = { en, translation };
  if (type) result.type = type;
  if (options) result.options = options;
  if (nativeHelper) result.nativeHelper = nativeHelper;
  return result;
}
