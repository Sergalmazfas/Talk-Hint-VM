import { PushChannel, IncomingCallPushPayload } from "./types";

// PLACEHOLDER: Real APNs implementation will be added in Task 3
// after VoIP certificate is uploaded.
export class IOSPushChannel implements PushChannel {
  platform = "ios";

  isConfigured(): boolean {
    // Will check APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY in Task 3
    return false;
  }

  async sendIncomingCall(token: string, payload: IncomingCallPushPayload): Promise<void> {
    console.log(
      `[iOS Push] PLACEHOLDER: would send VoIP push to token ${token.substring(0, 16)}... for call ${payload.callSid}`
    );
    // Real implementation in Task 3
  }
}
