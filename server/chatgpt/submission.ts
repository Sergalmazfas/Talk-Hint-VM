import { z } from "zod";
import { isIP } from "node:net";
import { talkHintPluginPackage } from "./plugin";
import { talkHintReviewCases } from "./reviewCases";

const httpsURL = z.string().max(1024).url().refine(value => {
  const u = new URL(value);
  return u.protocol === "https:" && !u.username && !u.password && !u.hash &&
    !Array.from(u.searchParams.keys()).some(key => /token|secret|api.?key|signature|credential|password|session|authorization/i.test(key));
}, "Use HTTPS without credentials or fragments");
/** Public non-secret settings only; reviewer credentials must stay in the portal. */
export const submissionConfig = z.object({
  origin: httpsURL.refine(value => new URL(value).origin === value, "Use an exact origin"),
  developerName: z.string().trim().min(1).max(80),
  websiteURL: httpsURL, privacyPolicyURL: httpsURL, termsOfServiceURL: httpsURL, supportURL: httpsURL,
  demoRecordingURL: httpsURL,
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(250),
  mode: z.enum(["read-only", "outbound"]).default("read-only"),
}).strict();
export type SubmissionConfig = z.infer<typeof submissionConfig>;

function reserved(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  return !!isIP(hostname.replace(/^\[|\]$/g, "")) || !hostname.includes(".") ||
    /(^|\.)(localhost|local|test|invalid|example|internal)$/.test(hostname) ||
    /(^|\.)(example\.com|example\.org|example\.net)$/.test(hostname);
}

export function prepareSubmission(raw: unknown, draft = false) {
  const config = submissionConfig.parse(raw);
  if (!draft && [config.origin, config.websiteURL, config.privacyPolicyURL, config.termsOfServiceURL,
    config.supportURL, config.demoRecordingURL].some(reserved))
    throw new Error("Submission configuration contains a placeholder, IP or local endpoint");
  const outbound = config.mode === "outbound";
  const { origin, mode, demoRecordingURL, countries, ...listing } = config;
  const base = talkHintPluginPackage(origin, outbound, listing);
  const manifest = { ...base.manifest, extensions: { "com.openai": {
    ...base.manifest.extensions["com.openai"],
    interface: { ...base.manifest.extensions["com.openai"].interface,
      composerIcon: "./assets/icon.png", logo: "./assets/logo.png" },
    review: { test_cases: talkHintReviewCases(outbound), demo_recording_url: demoRecordingURL,
      commerce: false, commerce_description: "No checkout or purchases. No SMS. Calls require separate owner approval." },
    publication: { countries: Array.from(new Set(countries)),
      release_notes: outbound ?
        "Own call reports plus separately owner-approved Secretary calls; idempotent dispatch and asynchronous task results." :
        "Read-only own call/task history, saved results and explicitly authorized transcripts." },
  } } };
  // This is deliberately a readiness receipt, not permission to submit.
  const readiness = {
    generatedLocally: true, submitted: false, published: false, readyToSubmit: false,
    mode, sourceDate: "2026-10-19", draft, realCallsMade: false,
    automatedValidation: "Local metadata/packaging policy and mock/integration tests only. No portal scan.",
    blockers: [
      ...(draft ? ["Replace ALL .invalid example URLs and publisher details with owner-approved real values."] : []),
      "Owner must verify identity, brand rights, eligible project and api.apps.read/api.apps.write permissions.",
      "Verify stable publicly reachable universal HTTPS MCP endpoint, domain challenge and exact OAuth callback.",
      "Publish and approve accurate privacy/terms/support pages; verify retention, recipients, consent and regional availability.",
      "Provide a dedicated sample-data reviewer account separately in the portal, not in this ZIP; prove login without MFA/OTP.",
      "Run all five positive and three negative cases in actual ChatGPT; record accessible walkthrough.",
      "Verify installed published-plugin path on actual Plus/iPhone: OAuth, account isolation, approval, return to chat and task read.",
      "Resolve the Agent Plugins core MCP schema / documented OpenAI auth-extension mismatch in portal validation.",
      ...(outbound ? ["The reviewed server must advertise matching outbound tools; current main composition remains read-only."] : []),
      "Separate owner authorization is required before deployment, submission, publication or any real call.",
    ],
    schemaNote: "Agent Plugins 1.0.0 mcp.schema.json currently forbids server extensions, while OpenAI documents extensions.com.openai.auth. OAuth is retained, never stripped or replaced by noauth. Portal acceptance has not been tested.",
  };
  return { manifest, mcp: base.mcp, readiness };
}
