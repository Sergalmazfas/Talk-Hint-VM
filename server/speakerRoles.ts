/**
 * Pure Twilio media-stream track → speaker (Owner/Guest) mapping.
 *
 * The `inbound`/`outbound` track of a Twilio Media Stream is relative to the
 * call LEG the <Stream> is attached to, not to the conversation — so the
 * track→speaker mapping depends on whose leg carries the stream:
 *
 *  - Owner-leg stream (OUTBOUND: the app — browser or iOS — dials out and the
 *    stream rides the app's own leg): inbound = Owner (HON), outbound = Guest (GST).
 *  - Caller-leg stream (INCOMING answered — browser <Dial><Client> and the iOS
 *    <Dial><Conference> bridge — stream on the original caller's leg): mirrored,
 *    inbound = Guest (GST), outbound = Owner (HON).
 *
 * The hold TwiML tags the caller-leg stream with
 * customParameters.callType === "incoming_answered"; outbound calls carry no
 * callType. This module is the single source of truth for the mapping so a
 * future edit to the stream handler can't silently swap CALLER/YOU in the live
 * transcript (see server/__tests__/speakerRoles.test.ts).
 */

export type TwilioTrack = "inbound" | "outbound";
export type SpeakerLabel = "Owner" | "Guest";
export type SpeakerCode = "HON" | "GST";

/**
 * Whether the <Stream> rides the caller's leg (incoming answered) rather than
 * the owner's leg (outbound). Anything other than "incoming_answered" — including
 * undefined ("browser"/outbound) and the non-functional "pstn_forwarding" — is
 * treated as the owner leg.
 */
export function streamRidesCallerLeg(callType: string | undefined | null): boolean {
  return callType === "incoming_answered";
}

export interface SpeakerRole {
  isOwnerTrack: boolean;
  isGuestTrack: boolean;
  speakerLabel: SpeakerLabel;
  speakerCode: SpeakerCode;
}

/**
 * Maps a media-stream track to the speaker, given which leg the stream rides.
 * Mirrors the leg when `onCallerLeg` is true so CALLER/YOU stay correct on both
 * incoming and outbound calls.
 */
export function resolveSpeakerRole(track: string, onCallerLeg: boolean): SpeakerRole {
  const isGuestTrack = onCallerLeg ? track === "inbound" : track === "outbound";
  const isOwnerTrack = onCallerLeg ? track === "outbound" : track === "inbound";
  return {
    isOwnerTrack,
    isGuestTrack,
    speakerLabel: isOwnerTrack ? "Owner" : "Guest",
    speakerCode: isGuestTrack ? "GST" : "HON",
  };
}
