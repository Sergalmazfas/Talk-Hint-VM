import { describe, it, expect } from "vitest";

import { resolveSpeakerRole, streamRidesCallerLeg } from "../speakerRoles";

// ---------------------------------------------------------------------------
// Locks in the Twilio media-stream track -> speaker (Owner/Guest) mapping so a
// future edit to the stream handler can't silently swap CALLER/YOU in the live
// transcript (and therefore in the AirAtoma payload).
//
// The mapping depends on which call LEG the <Stream> rides:
//   - OUTBOUND (browser OR iOS dials out): owner-leg, no callType.
//       inbound  = Owner (HON, "you")
//       outbound = Guest (GST, the other party)
//   - INCOMING answered (browser <Dial><Client> AND iOS <Dial><Conference>
//     bridge): caller-leg, tagged customParameters.callType "incoming_answered".
//       inbound  = Guest (GST, the caller)
//       outbound = Owner (HON, "you")
// ---------------------------------------------------------------------------

describe("streamRidesCallerLeg", () => {
  it("treats incoming_answered as the caller leg", () => {
    expect(streamRidesCallerLeg("incoming_answered")).toBe(true);
  });

  it("treats outbound (no callType) as the owner leg", () => {
    expect(streamRidesCallerLeg(undefined)).toBe(false);
    expect(streamRidesCallerLeg(null)).toBe(false);
    expect(streamRidesCallerLeg("")).toBe(false);
    expect(streamRidesCallerLeg("browser")).toBe(false);
  });

  it("does NOT treat pstn_forwarding as the caller leg (non-functional flag)", () => {
    expect(streamRidesCallerLeg("pstn_forwarding")).toBe(false);
  });
});

describe("resolveSpeakerRole — speaker mapping per call scenario", () => {
  // Each scenario maps to the callType Twilio sends on the <Stream> start, which
  // resolveSpeakerRole consumes via streamRidesCallerLeg().
  const scenarios = [
    { name: "outgoing web (owner-leg)", callType: undefined, expectedCallerLeg: false },
    { name: "outgoing iOS (owner-leg, same path as web)", callType: undefined, expectedCallerLeg: false },
    { name: "incoming web (caller-leg)", callType: "incoming_answered", expectedCallerLeg: true },
    { name: "incoming iOS (caller-leg conference bridge)", callType: "incoming_answered", expectedCallerLeg: true },
  ] as const;

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      const onCallerLeg = streamRidesCallerLeg(scenario.callType);

      it(`derives onCallerLeg=${scenario.expectedCallerLeg}`, () => {
        expect(onCallerLeg).toBe(scenario.expectedCallerLeg);
      });

      if (scenario.expectedCallerLeg) {
        it("maps inbound -> Guest (caller) and outbound -> Owner (you)", () => {
          expect(resolveSpeakerRole("inbound", onCallerLeg)).toMatchObject({
            speakerLabel: "Guest",
            speakerCode: "GST",
            isGuestTrack: true,
            isOwnerTrack: false,
          });
          expect(resolveSpeakerRole("outbound", onCallerLeg)).toMatchObject({
            speakerLabel: "Owner",
            speakerCode: "HON",
            isGuestTrack: false,
            isOwnerTrack: true,
          });
        });
      } else {
        it("maps inbound -> Owner (you) and outbound -> Guest (caller)", () => {
          expect(resolveSpeakerRole("inbound", onCallerLeg)).toMatchObject({
            speakerLabel: "Owner",
            speakerCode: "HON",
            isGuestTrack: false,
            isOwnerTrack: true,
          });
          expect(resolveSpeakerRole("outbound", onCallerLeg)).toMatchObject({
            speakerLabel: "Guest",
            speakerCode: "GST",
            isGuestTrack: true,
            isOwnerTrack: false,
          });
        });
      }
    });
  }

  it("keeps Owner and Guest mutually exclusive and self-consistent on every leg/track", () => {
    for (const onCallerLeg of [true, false]) {
      for (const track of ["inbound", "outbound"]) {
        const role = resolveSpeakerRole(track, onCallerLeg);
        // Exactly one of Owner/Guest is true.
        expect(role.isOwnerTrack).toBe(!role.isGuestTrack);
        // Label and code agree with the guest flag.
        expect(role.speakerCode === "GST").toBe(role.isGuestTrack);
        expect(role.speakerLabel === "Guest").toBe(role.isGuestTrack);
      }
    }
  });
});
