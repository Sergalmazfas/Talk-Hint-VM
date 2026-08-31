import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import {
  handleTranslatorTwilioStream, mulawToPcm24, oppositeTranslatorLeg, registerTranslatorCall,
  configureTranslatorDialer, subscribeTranslatorFeed,
  expireTranslatorCall, getTranslatorBridgeSnapshot, handleTranslatorGuestStatus,
} from "../translation/twilioBridge";
import type { RealtimeTranslationProvider } from "../translation/provider";

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed?: number;
  send(value: string) { this.sent.push(value); }
  close(code?: number) { this.closed = code; this.readyState = 3; }
}
const start = (id: string, leg: string, callSid = leg === "owner" ? "CAowner" : "CAguest") => Buffer.from(JSON.stringify({
  event: "start", start: { streamSid: `${leg}-stream`, callSid, customParameters: { translatorCallId: id, translatorLeg: leg } },
}));
function fakeProvider(sessions: any[]): RealtimeTranslationProvider {
  return {
    name: "test",
    async startSession() {
      let listener: any;
      const session = {
        sendAudio() {}, async stop() {}, cancel() {},
        onEvent(cb: any) { listener = cb; },
        emit(ev: any) { listener(ev); },
      };
      sessions.push(session);
      return session as any;
    },
  };
}

describe("PSTN translator bridge routing", () => {
  it("always targets the other leg, never the speaker's leg", () => {
    expect(oppositeTranslatorLeg("owner")).toBe("guest");
    expect(oppositeTranslatorLeg("guest")).toBe("owner");
  });

  it("converts Twilio 8k μ-law input into PCM16 24k for gpt-realtime", () => {
    const pcm = mulawToPcm24(Buffer.from([0xff, 0x7f]).toString("base64"));
    expect(pcm.length).toBe(12); // 2 μ-law samples × 3 upsample × PCM16
    expect(pcm.readInt16LE(0)).toBe(pcm.readInt16LE(2));
    expect(pcm.readInt16LE(2)).toBe(pcm.readInt16LE(4));
  });

  it("fails closed for an unpaired/forged leg without starting a provider", async () => {
    const ws = new FakeSocket();
    let starts = 0;
    const provider = { name: "test", startSession: async () => { starts++; throw new Error("must not run"); } } as RealtimeTranslationProvider;
    handleTranslatorTwilioStream(ws as any, provider);
    ws.emit("message", start("not-owned", "owner"));
    await new Promise(resolve => setImmediate(resolve));
    expect(starts).toBe(0);
    expect(ws.closed).toBe(1008);
  });

  it("closes rather than falling back when the approved provider cannot start", async () => {
    const id = "provider-failure";
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    const ws = new FakeSocket();
    const provider = { name: "test", startSession: async () => { throw new Error("provider unavailable"); } } as RealtimeTranslationProvider;
    handleTranslatorTwilioStream(ws as any, provider);
    ws.emit("message", start(id, "owner"));
    await new Promise(resolve => setImmediate(resolve));
    expect(ws.closed).toBe(1011);
    expect(ws.sent).toEqual([]);
  });

  it("shares both legs' telemetry with only the owning translator feed and closes both on fatal failure", async () => {
    const id = "paired-telemetry";
    registerTranslatorCall({ id, ownerId: "owner-a", ownerCallSid: "CApaired", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguest" }; } });
    const feed = new FakeSocket(), stranger = new FakeSocket(), owner = new FakeSocket(), guest = new FakeSocket(), sessions: any[] = [];
    subscribeTranslatorFeed("owner-a", feed as any);
    subscribeTranslatorFeed("other-user", stranger as any);
    const provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner", "CApaired"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest", "CAguest"));
    await new Promise(resolve => setImmediate(resolve));
    sessions[0].emit({ type: "source_transcript", text: "Привет", itemId: "i1" });
    sessions[1].emit({ type: "turn_completed", metrics: { turnIndex: 1, provider: "test", model: "gpt-realtime" } });
    sessions[0].emit({ type: "error", message: "fatal upstream", fatal: true });
    expect(JSON.parse(feed.sent[0])).toMatchObject({ type: "source_transcript", leg: "owner", text: "Привет" });
    expect(JSON.parse(feed.sent.at(-1)!)).toMatchObject({ type: "error", fatal: true });
    expect(stranger.sent).toEqual([]);
    expect(owner.closed).toBe(1011);
    expect(guest.closed).toBe(1011);
  });

  it("rejects mismatched and duplicate owner CallSids without a second guest dial", async () => {
    const id = "sid-guards", sessions: any[] = [];
    let dials = 0;
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAexpected", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { dials++; return { sid: "CAguest2" }; } });
    const provider = fakeProvider(sessions);
    const wrong = new FakeSocket(); handleTranslatorTwilioStream(wrong as any, provider);
    wrong.emit("message", start(id, "owner", "CAwrong"));
    const first = new FakeSocket(); handleTranslatorTwilioStream(first as any, provider);
    first.emit("message", start(id, "owner", "CAexpected"));
    await new Promise(resolve => setImmediate(resolve));
    const duplicate = new FakeSocket(); handleTranslatorTwilioStream(duplicate as any, provider);
    duplicate.emit("message", start(id, "owner", "CAexpected"));
    await new Promise(resolve => setImmediate(resolve));
    expect(wrong.closed).toBe(1008);
    expect(duplicate.closed).toBe(1008);
    expect(dials).toBe(1);
  });

  it("attaches a late source transcript to its completed shared turn before teardown", async () => {
    const id = "late-transcript", sessions: any[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAlate", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({ async createGuestLeg() { return { sid: "CAguestlate" }; } });
    const ws = new FakeSocket(); handleTranslatorTwilioStream(ws as any, fakeProvider(sessions));
    ws.emit("message", start(id, "owner", "CAlate"));
    await new Promise(resolve => setImmediate(resolve));
    sessions[0].emit({ type: "turn_completed", metrics: { turnIndex: 0, provider: "test", model: "gpt-realtime", sourceItemId: "item-late" } });
    sessions[0].emit({ type: "source_transcript", itemId: "item-late", text: "Поздний текст" });
    expect(getTranslatorBridgeSnapshot(id)?.turns[0].sourceTranscript).toBe("Поздний текст");
    ws.emit("close");
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });

  it("ends both PSTN legs when either established media leg closes", async () => {
    const id = "peer-close", sessions: any[] = [], hangups: string[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAownerclose", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({
      async createGuestLeg() { return { sid: "CAguestclose" }; },
      async hangup(sid) { hangups.push(sid); },
    });
    const owner = new FakeSocket(), guest = new FakeSocket(), provider = fakeProvider(sessions);
    handleTranslatorTwilioStream(owner as any, provider);
    handleTranslatorTwilioStream(guest as any, provider);
    owner.emit("message", start(id, "owner", "CAownerclose"));
    await new Promise(resolve => setImmediate(resolve));
    guest.emit("message", start(id, "guest", "CAguestclose"));
    await new Promise(resolve => setImmediate(resolve));

    owner.emit("close");
    await new Promise(resolve => setImmediate(resolve));

    expect(guest.closed).toBe(1000);
    expect(hangups.sort()).toEqual(["CAguestclose", "CAownerclose"]);
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });

  it("does not dial a guest if the owner socket closes during provider startup", async () => {
    const id = "close-during-start";
    let resolveStart!: (session: any) => void, dials = 0, cancels = 0;
    const provider: RealtimeTranslationProvider = {
      name: "deferred",
      startSession: () => new Promise(resolve => { resolveStart = resolve; }),
    };
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAearly", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({
      async createGuestLeg() { dials++; return { sid: "CAshould-not-exist" }; },
      async hangup() {},
    });
    const owner = new FakeSocket();
    handleTranslatorTwilioStream(owner as any, provider);
    owner.emit("message", start(id, "owner", "CAearly"));
    owner.readyState = 3;
    owner.emit("close");
    resolveStart({
      sendAudio() {}, async stop() {}, cancel() { cancels++; }, onEvent() {},
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(cancels).toBe(1);
    expect(dials).toBe(0);
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });

  it.each(["busy", "no-answer", "failed", "canceled"])(
    "fails both legs when the guest status callback reports %s",
    async (status) => {
      const id = `guest-status-${status}`, sessions: any[] = [], hangups: string[] = [];
      registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: `CAowner-${status}`, guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
      configureTranslatorDialer({
        async createGuestLeg() { return { sid: `CAguest-${status}` }; },
        async hangup(sid) { hangups.push(sid); },
      });
      const owner = new FakeSocket();
      handleTranslatorTwilioStream(owner as any, fakeProvider(sessions));
      owner.emit("message", start(id, "owner", `CAowner-${status}`));
      await new Promise(resolve => setImmediate(resolve));

      expect(handleTranslatorGuestStatus(`CAguest-${status}`, status)).toBe(true);
      await new Promise(resolve => setImmediate(resolve));

      expect(owner.closed).toBe(1011);
      expect(hangups.sort()).toEqual([`CAguest-${status}`, `CAowner-${status}`].sort());
      expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
    },
  );

  it("actively tears down an owner leg when its translator pairing expires", async () => {
    const id = "expired-call", sessions: any[] = [], hangups: string[] = [];
    registerTranslatorCall({ id, ownerId: "owner", ownerCallSid: "CAowner-expired", guestNumber: "+15551234567", callerId: "+15557654321", baseUrl: "https://example.test" });
    configureTranslatorDialer({
      async createGuestLeg() { return { sid: "CAguest-expired" }; },
      async hangup(sid) { hangups.push(sid); },
    });
    const owner = new FakeSocket();
    handleTranslatorTwilioStream(owner as any, fakeProvider(sessions));
    owner.emit("message", start(id, "owner", "CAowner-expired"));
    await new Promise(resolve => setImmediate(resolve));

    expect(expireTranslatorCall(id)).toBe(true);
    await new Promise(resolve => setImmediate(resolve));

    expect(owner.closed).toBe(1011);
    expect(hangups.sort()).toEqual(["CAguest-expired", "CAowner-expired"]);
    expect(getTranslatorBridgeSnapshot(id)).toBeUndefined();
  });
});