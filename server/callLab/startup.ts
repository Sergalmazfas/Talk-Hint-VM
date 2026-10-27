/** Safe diagnostics: never retain arbitrary SDK errors, profiles or credentials. */
export type LabStartupStage = "configuration" | "scratch" | "gmail" | "owner" | "worker" | "control";
let state: { status: "not_checked" | "checking" | "blocked" | "ready";
  stage: LabStartupStage | null; code: string | null; checkedAt: string | null } =
  { status: "not_checked", stage: null, code: null, checkedAt: null };
export function labStartupStatus() { return { ...state }; }
export function resetLabStartup() {
  state = { status: "not_checked", stage: null, code: null, checkedAt: null };
}
export function labStartsPaused() {
  return process.env.NODE_ENV === "production" || process.env.LAB_START_PAUSED !== "false";
}
export function safeLabError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (["LAB_GMAIL_NOT_PINNED", "LAB_GMAIL_PROFILE_INVALID", "LAB_OWNER_NOT_ADMIN",
    "LAB_OWNER_NOT_FOUND", "LAB_OWNER_MISMATCH", "LAB_MODEL_NOT_CONFIGURED",
    "LAB_PYTHON_UNAVAILABLE", "LAB_PYTHON_VERSION_MISMATCH"].includes(message) ||
    /^LAB_GMAIL_PROFILE_[0-9]{3}$/.test(message)) return message;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^(?:42P01|42703|23502|42501|08006|ECONNREFUSED)$/.test(code))
    return `LAB_DATABASE_${code}`;
  if (/Could not mint an audience-scoped deployment identity|identity endpoint/i.test(message))
    return "LAB_CONNECTOR_IDENTITY_UNAVAILABLE";
  return "LAB_DEPENDENCY_UNAVAILABLE";
}
export async function labStartupStep<T>(stage: LabStartupStage, work: () => Promise<T>): Promise<T> {
  state = { status: "checking", stage, code: null, checkedAt: new Date().toISOString() };
  try { return await work(); } catch (error) {
    state = { status: "blocked", stage, code: safeLabError(error), checkedAt: new Date().toISOString() };
    throw error;
  }
}
export function labStartupReady() {
  state = { status: "ready", stage: "control", code: null, checkedAt: new Date().toISOString() };
}
