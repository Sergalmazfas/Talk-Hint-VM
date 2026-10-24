/**
 * Stage-one quarantine. There is deliberately NO env/admin/client override.
 * Later stages must supply a reviewed, durable, owner/sender/purpose/recipient
 * bound authority and recheck it immediately before transport (including retry).
 * Until then unknown evidence is denial, not an implicit grant.
 */
export const SMS_PATHS = ["incoming_call_notification", "write_health_alert"] as const;
export type SmsPath = typeof SMS_PATHS[number];
export const RECORDING_PATHS = [
  "incoming_conference", "incoming_browser", "outgoing_browser", "recording_callback",
] as const;
export type RecordingPath = typeof RECORDING_PATHS[number];

const smsReasons = [
  "sender_readiness_unverified",
  "recipient_sms_consent_unverified",
  "suppression_check_unavailable",
] as const;
const recordingReasons = [
  "participant_recording_consent_unverified",
  "recording_disclosure_unverified",
  "recording_purpose_and_retention_unapproved",
] as const;
const blocked = { sms: 0, recording: 0 };

export function communicationReadiness() {
  return {
    policy: "unverified-denied-v1",
    sms: { allowed: false, reasons: [...smsReasons], paths: [...SMS_PATHS] },
    recording: { allowed: false, reasons: [...recordingReasons], paths: [...RECORDING_PATHS] },
    // Transcription/AI disclosure is a separate queued stage, not an SMS grant.
    voiceRoutingChanged: false,
    transcriptionConsentImplemented: false,
    blocked: { ...blocked },
  };
}

export function recordingPermitted(path: RecordingPath): boolean {
  blocked.recording++;
  // Only enumerated paths/reason codes: no numbers, SID, text or credentials.
  console.warn("[CommunicationSafety]", JSON.stringify({
    action: "recording", path, allowed: false, reasons: recordingReasons,
  }));
  return false;
}

/** Transport construction is lazy; a denied action must not even open a client. */
export async function sendSmsSafely(path: SmsPath, _deliver: () => Promise<unknown>) {
  blocked.sms++;
  console.warn("[CommunicationSafety]", JSON.stringify({
    action: "sms", path, allowed: false, reasons: smsReasons,
  }));
  return { sent: false as const, blocked: true as const, reasons: [...smsReasons] };
}
