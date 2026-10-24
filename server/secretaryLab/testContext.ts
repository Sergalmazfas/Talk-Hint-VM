/** Shared bench-only fixture. Never represents a real business or calendar. */
export const SECRETARY_TEST_CONTEXT = Object.freeze({
  id: "secretary-dev-fixture",
  timezone: "America/New_York",
  business: "TalkHint TEST practice",
  availability: ["2026-11-02T10:00:00-05:00", "2026-11-02T14:00:00-05:00"],
  permissions: ["read_test_context", "save_test_message", "prepare_test_booking"],
  restrictions: ["No real calls", "No notifications", "No real calendar writes", "No real booking confirmation"],
});
export function secretaryTestContextPrompt() {
  return "\nBENCH ONLY: This is a browser simulation, not a real telephone call. " +
    "The owner's assignment is the same across comparison modes. Only the following explicitly fictional context is authorized: " +
    JSON.stringify(SECRETARY_TEST_CONTEXT) + ". Never treat fixture availability as real or claim a real message was delivered. " +
    "Only report a TEST action saved after a successful tool result; if no tools are available, collect details without claiming execution. " +
    "ASR errors or an unclear phrase require clarification, not ending the conversation.";
}
