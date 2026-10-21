import { describe, expect, it, vi } from "vitest";
import { LabRtcController } from "./secretary-lab-rtc";

function harness(play: () => Promise<void> = () => Promise.resolve()) {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const micTrack = { enabled: true, stop: vi.fn(), kind: "audio" } as unknown as MediaStreamTrack;
  const stream = { getAudioTracks: () => [micTrack] } as unknown as MediaStream;
  const sender = { track: micTrack, replaceTrack: vi.fn(async (track) => { sender.track = track; }) };
  const channel = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
  const receiverTrack = { stop: vi.fn() };
  const pc = {
    connectionState: "new",
    localDescription: { sdp: "offer-sdp" },
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    getSenders: () => [sender],
    getReceivers: () => [{ track: receiverTrack }],
    getTransceivers: () => [],
    close: vi.fn(),
    ontrack: null as ((event: RTCTrackEvent) => void) | null,
    onconnectionstatechange: null as (() => void) | null,
  };
  const audio = {
    autoplay: false,
    playsInline: false,
    muted: false,
    srcObject: null as MediaStream | null,
    play: vi.fn(play),
    pause: vi.fn(),
  };
  const errors: string[] = [];
  const sendSocket = vi.fn();
  const onReady = vi.fn();
  const onConnectionState = vi.fn();
  const controller = new LabRtcController({
    stream,
    sendSocket,
    onReady,
    onConnectionState,
    onError: (reason) => errors.push(reason),
    createPeerConnection: () => pc as unknown as RTCPeerConnection,
    createAudioElement: () => audio as unknown as HTMLAudioElement,
    setTimer: (callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimer: (id) => { timers.delete(id); },
  });
  return { controller, pc, audio, channel, sender, micTrack, receiverTrack, sendSocket, errors, timers, stream, onReady, onConnectionState };
}

describe("Secretary Lab direct WebRTC controller", () => {
  it("sends microphone only as a peer track; no local audio graph or sidetone", async () => {
    const h = harness();
    expect(h.pc.addTrack).toHaveBeenCalledWith(h.micTrack, h.stream);
    expect(h.micTrack.enabled).toBe(false);
    expect(h.audio.srcObject).toBeNull();
    await h.controller.negotiate(async (sdp) => {
      expect(sdp).toBe("offer-sdp");
      return { sdp: "answer-sdp", model: "gpt-realtime-2.1", voice: "marin" };
    });
    expect(h.pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    h.controller.close();
  });

  it("announces ready and rtc_connected exactly once only after peer and model are both ready", () => {
    const h = harness();
    h.pc.connectionState = "connected";
    h.pc.onconnectionstatechange?.();
    expect(h.sendSocket).not.toHaveBeenCalled();
    expect(h.onReady).not.toHaveBeenCalled();
    h.controller.markModelReady();
    h.controller.markModelReady();
    h.pc.onconnectionstatechange?.();
    expect(h.sendSocket).toHaveBeenCalledTimes(1);
    expect(h.sendSocket).toHaveBeenCalledWith({ type: "rtc_connected" });
    expect(h.onReady).toHaveBeenCalledOnce();
    expect(h.micTrack.enabled).toBe(true);
    h.pc.connectionState = "disconnected";
    h.pc.onconnectionstatechange?.();
    expect(h.onConnectionState).toHaveBeenLastCalledWith(false, true);
    h.controller.close();
  });

  it("coalesces duplicate negotiation calls into exactly one offer and post", async () => {
    const h = harness();
    let resolvePost!: (answer: { sdp: string; model: string; voice: string }) => void;
    const post = vi.fn(() => new Promise<{ sdp: string; model: string; voice: string }>((resolve) => { resolvePost = resolve; }));
    const first = h.controller.negotiate(post);
    const second = h.controller.negotiate(post);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.pc.createOffer).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    resolvePost({ sdp: "answer", model: "gpt-realtime-2.1", voice: "marin" });
    await Promise.all([first, second]);
    expect(h.pc.setRemoteDescription).toHaveBeenCalledOnce();
    await h.controller.negotiate(post);
    expect(post).toHaveBeenCalledOnce();
    h.controller.close();
  });

  it("ignores a late negotiation answer after close", async () => {
    const h = harness();
    let resolvePost!: (answer: { sdp: string; model: string; voice: string }) => void;
    const post = () => new Promise<{ sdp: string; model: string; voice: string }>((resolve) => { resolvePost = resolve; });
    const pending = h.controller.negotiate(post);
    await Promise.resolve();
    await Promise.resolve();
    h.controller.close();
    resolvePost({ sdp: "late-answer", model: "gpt-realtime-2.1", voice: "marin" });
    await expect(pending).rejects.toThrow("уже закрыт");
    expect(h.pc.setRemoteDescription).not.toHaveBeenCalled();
  });

  it("mutes remote playback on VAD and unmutes on new output without response-ID assumptions", () => {
    const h = harness();
    h.channel.onmessage?.({ data: JSON.stringify({ type: "input_audio_buffer.speech_started" }) } as MessageEvent);
    expect(h.audio.muted).toBe(true);
    h.channel.onmessage?.({ data: JSON.stringify({ type: "input_audio_buffer.clear" }) } as MessageEvent);
    expect(h.audio.muted).toBe(true);
    h.channel.onmessage?.({ data: JSON.stringify({ type: "output_audio_buffer.started" }) } as MessageEvent);
    expect(h.audio.muted).toBe(true);
    h.channel.onmessage?.({ data: JSON.stringify({ type: "output_audio_buffer.started", response_id: "first-response" }) } as MessageEvent);
    expect(h.audio.muted).toBe(false);
    h.controller.clearInterruptedOutput("response-old");
    expect(h.audio.muted).toBe(true);
    h.channel.onmessage?.({ data: JSON.stringify({ type: "output_audio_buffer.started", response_id: "response-old" }) } as MessageEvent);
    expect(h.audio.muted).toBe(true);
    h.channel.onmessage?.({ data: JSON.stringify({ type: "output_audio_buffer.started", response_id: "response-new" }) } as MessageEvent);
    expect(h.audio.muted).toBe(false);
    h.controller.close();
  });

  it("surfaces autoplay rejection and closes the peer instead of claiming playback", async () => {
    const h = harness(() => Promise.reject(new Error("blocked")));
    h.pc.ontrack?.({ streams: [{ getTracks: () => [{ stop: vi.fn() }] }], track: {} } as unknown as RTCTrackEvent);
    await Promise.resolve();
    expect(h.errors).toEqual(["audio_autoplay_blocked"]);
    expect(h.pc.close).toHaveBeenCalledOnce();
    expect(h.audio.pause).toHaveBeenCalledOnce();
  });

  it("restores the original microphone after synthetic hold and respects the prior pause state", async () => {
    const h = harness();
    const holdTrack = { stop: vi.fn(), enabled: true };
    const oscillators: Array<{ frequency: { value: number }; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const createOscillator = () => {
      const oscillator = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
      oscillators.push(oscillator);
      return oscillator;
    };
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const createGain = () => {
      const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(node);
      return node;
    };
    const destination = { stream: { getAudioTracks: () => [holdTrack] }, disconnect: vi.fn() };
    const context = {
      createMediaStreamDestination: () => destination,
      createOscillator,
      createGain,
    } as unknown as AudioContext;
    h.controller.setMicPaused(true);
    await h.controller.startHold(context, 15);
    expect(h.sender.replaceTrack).toHaveBeenCalledWith(holdTrack);
    await h.controller.startHold(context, 60);
    expect(h.sender.replaceTrack).toHaveBeenCalledOnce();
    expect(h.micTrack.enabled).toBe(false);
    await h.controller.stopHold();
    expect(h.sender.replaceTrack).toHaveBeenLastCalledWith(h.micTrack);
    expect(holdTrack.stop).toHaveBeenCalledOnce();
    expect(h.micTrack.enabled).toBe(false);
    expect(oscillators).toHaveLength(2);
    expect(oscillators.every((oscillator) => oscillator.stop.mock.calls.length === 1)).toBe(true);
    expect(gains.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(gains.every((node) => node.connect.mock.calls.every(([target]) => target === destination))).toBe(true);
    h.controller.close();
  });

  it("prevents concurrent hold replacements and cleans the generated track when start replacement rejects", async () => {
    const h = harness();
    const holdTrack = { stop: vi.fn(), enabled: true };
    const oscillators: Array<{ frequency: { value: number }; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const destination = { stream: { getAudioTracks: () => [holdTrack] }, disconnect: vi.fn() };
    const context = {
      createMediaStreamDestination: () => destination,
      createOscillator: () => {
        const node = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
        oscillators.push(node);
        return node;
      },
      createGain: () => {
        const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(node);
        return node;
      },
    } as unknown as AudioContext;
    h.sender.replaceTrack.mockRejectedValueOnce(new Error("replace rejected"));
    const first = h.controller.startHold(context, 15);
    const second = h.controller.startHold(context, 60);
    expect(second).toBe(first);
    await expect(first).rejects.toThrow("replace rejected");
    expect(h.sender.replaceTrack).toHaveBeenCalledOnce();
    expect(holdTrack.stop).toHaveBeenCalledOnce();
    expect(oscillators.every((node) => node.stop.mock.calls.length === 1)).toBe(true);
    expect(gains.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(h.micTrack.enabled).toBe(false);
    h.controller.close();
  });

  it("restores the real sender after stop races a pending hold replacement", async () => {
    const h = harness();
    const holdTrack = { stop: vi.fn(), enabled: true };
    const destination = { stream: { getAudioTracks: () => [holdTrack] }, disconnect: vi.fn() };
    const oscillator = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const context = {
      createMediaStreamDestination: () => destination,
      createOscillator: () => oscillator,
      createGain: () => {
        const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(node);
        return node;
      },
    } as unknown as AudioContext;
    let releaseReplace!: () => void;
    h.sender.replaceTrack.mockImplementationOnce((track) => new Promise<void>((resolve) => {
      releaseReplace = () => { h.sender.track = track; resolve(); };
    }));
    h.controller.markModelReady();
    const starting = h.controller.startHold(context, 15);
    const stopping = h.controller.stopHold();
    releaseReplace();
    await Promise.all([starting, stopping]);
    expect(h.sender.track).toBe(h.micTrack);
    expect(h.sender.replaceTrack).toHaveBeenCalledTimes(2);
    expect(holdTrack.stop).toHaveBeenCalledOnce();
    expect(h.micTrack.enabled).toBe(true);
  });

  it("cleans pending hold resources if the controller closes before replacement settles", async () => {
    const h = harness();
    const holdTrack = { stop: vi.fn(), enabled: true };
    const oscillator = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const destination = { stream: { getAudioTracks: () => [holdTrack] }, disconnect: vi.fn() };
    const context = {
      createMediaStreamDestination: () => destination,
      createOscillator: () => oscillator,
      createGain: () => {
        const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(node);
        return node;
      },
    } as unknown as AudioContext;
    let resolveReplace!: () => void;
    h.sender.replaceTrack.mockImplementationOnce((track) => new Promise<void>((resolve) => {
      resolveReplace = () => { h.sender.track = track; resolve(); };
    }));
    const pending = h.controller.startHold(context, 15);
    h.controller.close();
    expect(holdTrack.stop).toHaveBeenCalledOnce();
    expect(gains.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    resolveReplace();
    await pending;
    expect(h.pc.close).toHaveBeenCalledOnce();
  });

  it("cleans hold nodes immediately when close races a pending restoration", async () => {
    const h = harness();
    const holdTrack = { stop: vi.fn(), enabled: true };
    const oscillators: Array<{ frequency: { value: number }; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const destination = { stream: { getAudioTracks: () => [holdTrack] }, disconnect: vi.fn() };
    const context = {
      createMediaStreamDestination: () => destination,
      createOscillator: () => {
        const node = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
        oscillators.push(node);
        return node;
      },
      createGain: () => {
        const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(node);
        return node;
      },
    } as unknown as AudioContext;
    await h.controller.startHold(context, 15);
    let resolveRestore!: () => void;
    h.sender.replaceTrack.mockImplementationOnce((track) => new Promise<void>((resolve) => {
      resolveRestore = () => { h.sender.track = track; resolve(); };
    }));
    const stopping = h.controller.stopHold();
    await Promise.resolve();
    expect(h.sender.replaceTrack).toHaveBeenCalledTimes(2);
    h.controller.close();
    expect(holdTrack.stop).toHaveBeenCalledOnce();
    expect(oscillators.every((node) => node.stop.mock.calls.length === 1)).toBe(true);
    expect(gains.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    resolveRestore();
    await stopping;
  });

  it("recovers a brief disconnection on the same peer, without another negotiation", async () => {
    const h = harness();
    await h.controller.negotiate(async () => ({ sdp: "answer", model: "gpt-realtime-2.1", voice: "marin" }));
    h.pc.connectionState = "connected";
    h.pc.onconnectionstatechange?.();
    h.pc.connectionState = "disconnected";
    h.pc.onconnectionstatechange?.();
    expect(h.timers.size).toBe(1);
    h.pc.connectionState = "connected";
    h.pc.onconnectionstatechange?.();
    expect(h.timers.size).toBe(0);
    expect(h.pc.createOffer).toHaveBeenCalledOnce();
    expect(h.errors).toHaveLength(0);
    h.controller.close();
  });

  it("stops after five seconds of sustained disconnection and cleans every owned resource", () => {
    const h = harness();
    h.pc.connectionState = "disconnected";
    h.pc.onconnectionstatechange?.();
    const [timer] = h.timers.values();
    timer?.();
    expect(h.errors).toEqual(["webrtc_disconnected"]);
    expect(h.pc.close).toHaveBeenCalledOnce();
    expect(h.channel.close).toHaveBeenCalledOnce();
    expect(h.audio.pause).toHaveBeenCalledOnce();
    expect(h.receiverTrack.stop).toHaveBeenCalledOnce();
    expect(h.micTrack.enabled).toBe(false);
  });
});
