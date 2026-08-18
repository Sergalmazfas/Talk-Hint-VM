// End-to-end relay regression (Run #2 forensic review): the stand's WS relay
// must NOT strip forensic correlation ids — translated audio arrives at the
// browser as { type:"audio", data, responseId } so the exported event log can
// correlate playback/audio to a response independently.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranslationEvent } from "../translation/provider";

const sessionEventListeners: Array<(ev: TranslationEvent) => void> = [];
vi.mock("../translation/openaiRealtimeTranslator", () => ({
  openaiRealtimeTranslationProvider: {
    name: "openai-realtime",
    startSession: vi.fn(async () => ({
      sendAudio: vi.fn(),
      stop: vi.fn(async () => {}),
      cancel: vi.fn(),
      onEvent: (cb: (ev: TranslationEvent) => void) => sessionEventListeners.push(cb),
    })),
  },
}));

import { handleTranslatorSpikeStream } from "../translation/spike";

function makeFakeWs() {
  const handlers: Record<string, Function[]> = {};
  const sent: any[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    on(ev: string, cb: Function) {
      (handlers[ev] ||= []).push(cb);
    },
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    async emitMessage(obj: object) {
      for (const cb of handlers["message"] || []) {
        await cb(Buffer.from(JSON.stringify(obj)), false);
      }
    },
    sent,
  };
}

describe("translator spike WS relay preserves forensic ids", () => {
  beforeEach(() => {
    sessionEventListeners.length = 0;
  });

  it("relays translated_audio with responseId and other events verbatim", async () => {
    const ws = makeFakeWs();
    handleTranslatorSpikeStream(ws as any);
    await ws.emitMessage({ type: "start" });
    expect(sessionEventListeners.length).toBe(1);
    const emit = sessionEventListeners[0];

    emit({ type: "translated_audio", base64: "QUJD", responseId: "resp_7" });
    const audio = ws.sent.find((m) => m.type === "audio");
    expect(audio).toBeTruthy();
    expect(audio.data).toBe("QUJD");
    expect(audio.responseId).toBe("resp_7");

    emit({
      type: "invariant_violation",
      ts: 1,
      code: "OUTPUT_AFTER_RESPONSE_DONE",
      detail: "x",
      responseId: "resp_7",
    });
    const viol = ws.sent.find((m) => m.type === "invariant_violation");
    expect(viol.code).toBe("OUTPUT_AFTER_RESPONSE_DONE");
    expect(viol.responseId).toBe("resp_7");

    emit({ type: "response_created", ts: 2, responseId: "resp_8", sourceItemId: "item_1" });
    const rc = ws.sent.find((m) => m.type === "response_created");
    expect(rc.responseId).toBe("resp_8");
    expect(rc.sourceItemId).toBe("item_1");
  });
});
