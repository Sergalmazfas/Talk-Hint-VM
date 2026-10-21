import { describe, expect, it } from "vitest";
import {
  MIC_QUEUE_MAX_FRAMES, MULAW_FRAME_BYTES, ULAW_SILENCE_FRAME,
  UlawFrameQueue, floatToUlaw, makeHoldMusic, markPlaybackDecision,
  pcmToUlaw, playbackWouldExceedLimit, selectOutboundFrame, ulawToPcm,
} from "./secretary-lab";

describe("Secretary Lab μ-law helpers", () => {
  it("round-trips μ-law silence and preserves polarity for representative PCM samples", () => {
    expect(pcmToUlaw(0)).toBe(0xff);
    expect(ulawToPcm(pcmToUlaw(0))).toBe(0);
    expect(ulawToPcm(pcmToUlaw(12000))).toBeGreaterThan(0);
    expect(ulawToPcm(pcmToUlaw(-12000))).toBeLessThan(0);
  });

  it("resamples float input to 8 kHz and encodes the expected sample count", () => {
    const encoded = floatToUlaw(new Float32Array([0, 0.5, -0.5, 0]), 16000);
    expect(encoded).toHaveLength(2);
    expect(ulawToPcm(encoded[0])).toBe(0);
    expect(ulawToPcm(encoded[1])).toBeLessThan(0);
  });

  it("bounds the microphone queue at three seconds and keeps the newest complete frames", () => {
    const queue = new UlawFrameQueue(MIC_QUEUE_MAX_FRAMES);
    queue.pushBytes(new Uint8Array((MIC_QUEUE_MAX_FRAMES + 4) * MULAW_FRAME_BYTES).map((_, index) => Math.floor(index / MULAW_FRAME_BYTES)));
    expect(queue.length).toBe(MIC_QUEUE_MAX_FRAMES);
    expect(queue.shift()?.[0]).toBe(4);
    expect(queue.length).toBe(MIC_QUEUE_MAX_FRAMES - 1);
    queue.clear();
    expect(queue.length).toBe(0);
  });

  it("selects one media source per tick: music, live microphone, then silence", () => {
    const microphone = new UlawFrameQueue(2);
    microphone.pushFrame(new Uint8Array(MULAW_FRAME_BYTES).fill(0x22));
    const music = new Uint8Array(MULAW_FRAME_BYTES * 2).fill(0x33);

    const musicFrame = selectOutboundFrame({ music, musicOffset: 0, microphone, microphonePaused: false });
    expect(musicFrame.source).toBe("music");
    expect(musicFrame.nextMusicOffset).toBe(MULAW_FRAME_BYTES);
    expect(microphone.length).toBe(1);

    const micFrame = selectOutboundFrame({ music: null, musicOffset: 0, microphone, microphonePaused: false });
    expect(micFrame.source).toBe("microphone");
    expect(micFrame.frame[0]).toBe(0x22);

    const silence = selectOutboundFrame({ music: null, musicOffset: 0, microphone, microphonePaused: true });
    expect(silence.source).toBe("silence");
    expect(silence.frame).toBe(ULAW_SILENCE_FRAME);
    expect(silence.frame.every((byte) => byte === 0xff)).toBe(true);
  });

  it("generates bounded-duration 8 kHz μ-law synthetic hold fixtures", () => {
    const sample = makeHoldMusic(1);
    expect(sample).toHaveLength(8000);
    expect(sample.byteLength).toBe(8000);
    expect(sample[0]).toBe(0xff);
    expect(sample[100]).not.toBe(0xff);
    expect(makeHoldMusic(181)).toHaveLength(180 * 8000);
  });

  it("waits for AudioContext time, and refuses acknowledgments after suspension", () => {
    expect(markPlaybackDecision("running", 2.49, 2.5)).toBe("wait");
    expect(markPlaybackDecision("running", 2.5, 2.5)).toBe("ack");
    expect(markPlaybackDecision("suspended", 3, 2.5)).toBe("stop");
    expect(markPlaybackDecision("missing", 3, 2.5)).toBe("stop");
  });

  it("rejects playback scheduling beyond the two-second queue ceiling", () => {
    expect(playbackWouldExceedLimit(1, 2.5, 0.49)).toBe(false);
    expect(playbackWouldExceedLimit(1, 2.5, 0.51)).toBe(true);
    expect(playbackWouldExceedLimit(1, 1, 2.01)).toBe(true);
  });
});
