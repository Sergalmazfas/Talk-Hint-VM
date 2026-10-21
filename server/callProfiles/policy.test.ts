import { describe, expect, it } from "vitest";
import { cardsForCall, defaultCallingNumber, profileForCall, validCardScope, verifyNumberRouting } from "./policy";

describe("personal and work profiles", () => {
  const personal = { id: "p", userId: "owner", twilioNumber: "+19543200848", type: "personal", createdAt: new Date(1) };
  const work = { id: "w", userId: "owner", twilioNumber: "+17867331025", type: "work", createdAt: new Date(0) };
  it("keeps personal caller ID regardless of result order and preserves work-only legacy accounts", () => {
    expect(defaultCallingNumber([work, personal])?.id).toBe("p");
    expect(defaultCallingNumber([personal, work])?.id).toBe("p");
    expect(defaultCallingNumber([work])?.id).toBe("w");
    expect(defaultCallingNumber([])).toBeUndefined();
  });
  it("resolves the profile from this owner's actual call number, not the caller's name", () => {
    const incoming = { userId: "owner", direction: "incoming", fromNumber: "+13176021987", toNumber: work.twilioNumber };
    expect(profileForCall("owner", incoming, [personal, work])).toBe("work");
    expect(profileForCall("owner", { ...incoming, direction: "outgoing", fromNumber: personal.twilioNumber }, [personal, work])).toBe("personal");
    expect(profileForCall("other", incoming, [personal, work])).toBeUndefined();
    expect(profileForCall("owner", { ...incoming, toNumber: "+19995550100" }, [personal, work])).toBeUndefined();
    expect(profileForCall("owner", undefined, [personal, work])).toBeUndefined();
  });
  it("never automatically promotes legacy personal cards to work or shares another owner's cards", () => {
    const cards = [
      { id: "legacy", userId: "owner" }, { id: "personal", userId: "owner", profileScope: "personal" },
      { id: "work", userId: "owner", profileScope: "work" }, { id: "shared", userId: "owner", profileScope: "shared" },
      { id: "foreign", userId: "other", profileScope: "shared" },
    ];
    expect(cardsForCall(cards, "owner", "work").map(c => c.id)).toEqual(["work", "shared"]);
    expect(cardsForCall(cards, "owner", "personal").map(c => c.id)).toEqual(["legacy", "personal", "shared"]);
    expect(cardsForCall(cards, "owner")).toEqual([]);
    expect(validCardScope("all")).toBe(false);
  });
  it("requires existing main-account voice routing, and never treats another service as ready", () => {
    const ready = { foundOnMain: true, voiceEnabled: true, usesVoiceApplication: false,
      voiceMethod: "POST", voiceUrl: "https://talk-hint-vm.replit.app/twilio/voice",
      statusCallback: "https://talk-hint-vm.replit.app/twilio/status" };
    expect(verifyNumberRouting(ready)).toBe(true);
    for (const change of [
      { foundOnMain: false }, { voiceEnabled: false }, { usesVoiceApplication: true },
      { voiceUrl: "https://talking-cdl.example/voice" }, { voiceMethod: "GET" },
      { statusCallback: "https://talkhint.app/twilio/status?private=1" },
    ]) expect(verifyNumberRouting({ ...ready, ...change })).toBe(false);
  });
});
