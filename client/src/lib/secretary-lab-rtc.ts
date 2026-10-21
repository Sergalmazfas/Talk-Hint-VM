export const OPENAI_LAB_MODEL = "gpt-realtime-2.1";
export const OPENAI_LAB_VOICE = "marin";

interface HoldResources {
  sender: RTCRtpSender;
  destination: MediaStreamAudioDestinationNode | null;
  oscillators: OscillatorNode[];
  gains: GainNode[];
  track: MediaStreamTrack | null;
  cancelled: boolean;
  disposed: boolean;
  timer: number | null;
}

export interface LabRtcControllerOptions {
  stream: MediaStream;
  onReady: () => void;
  onConnectionState?: (connected: boolean, modelReady: boolean) => void;
  onError: (reason: "webrtc_error" | "webrtc_disconnected" | "audio_autoplay_blocked", detail: string) => void;
  sendSocket: (message: Record<string, unknown>) => void;
  createPeerConnection?: () => RTCPeerConnection;
  createAudioElement?: () => HTMLAudioElement;
  setTimer?: (callback: () => void, ms: number) => number;
  clearTimer?: (timer: number) => void;
}

/** Owns the direct browser↔OpenAI peer, remote playback, and test hold track. */
export class LabRtcController {
  readonly pc: RTCPeerConnection;
  readonly audio: HTMLAudioElement;
  private readonly micTrack: MediaStreamTrack;
  private dataChannel: RTCDataChannel | null = null;
  private readonly options: LabRtcControllerOptions;
  private remoteStream: MediaStream | null = null;
  private modelReady = false;
  private connected = false;
  private readyFired = false;
  private connectedSent = false;
  private closed = false;
  private disconnectedTimer: number | null = null;
  private micPaused = false;
  private negotiationPromise: Promise<void> | null = null;
  private hold: HoldResources | null = null;
  private holdResources = new Set<HoldResources>();
  private holdPromise: Promise<void> | null = null;
  private holdStopPromise: Promise<void> | null = null;
  private interruptedResponseIds = new Set<string>();
  private interruptedWithoutId = false;
  private currentOutputResponseId: string | null = null;

  constructor(options: LabRtcControllerOptions) {
    this.options = options;
    const track = options.stream.getAudioTracks()[0];
    if (!track) throw new Error("В потоке микрофона нет аудиодорожки.");
    this.micTrack = track;
    this.micTrack.enabled = false;
    this.pc = (options.createPeerConnection ?? (() => new RTCPeerConnection()))();
    this.audio = (options.createAudioElement ?? (() => new Audio()))();
    this.audio.autoplay = true;
    this.pc.addTrack(this.micTrack, options.stream);
    this.pc.ontrack = (event) => this.handleTrack(event);
    this.pc.onconnectionstatechange = () => this.handleConnectionState();
    this.dataChannel = this.pc.createDataChannel("oai-events");
    this.dataChannel.onmessage = (event) => this.handleDataMessage(event.data);
  }

  get isActuallyConnected() {
    return !this.closed && this.connected && this.modelReady;
  }

  /**
   * One single-use negotiation per controller. Concurrent and later calls reuse
   * the same result; late HTTP completion after close can never set a remote SDP.
   */
  negotiate(postOffer: (sdp: string) => Promise<{ sdp: string; model: string; voice: string }>): Promise<void> {
    if (this.negotiationPromise) return this.negotiationPromise;
    this.assertOpen();
    this.negotiationPromise = this.performNegotiation(postOffer);
    return this.negotiationPromise;
  }

  private async performNegotiation(postOffer: (sdp: string) => Promise<{ sdp: string; model: string; voice: string }>) {
    const offer = await this.pc.createOffer();
    this.assertOpen();
    await this.pc.setLocalDescription(offer);
    this.assertOpen();
    if (!offer.sdp) throw new Error("Браузер не создал SDP offer.");
    const answer = await postOffer(offer.sdp);
    this.assertOpen();
    if (answer.model !== OPENAI_LAB_MODEL || answer.voice !== OPENAI_LAB_VOICE) {
      throw new Error(`Сервер вернул неожиданный голос: ${answer.model} / ${answer.voice}. Ожидался ${OPENAI_LAB_MODEL} / ${OPENAI_LAB_VOICE}.`);
    }
    this.assertOpen();
    await this.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    this.assertOpen();
  }

  /** Called only for the authenticated server's ready event after sideband verification. */
  markModelReady(verified = true) {
    if (this.closed || !verified) return;
    this.modelReady = true;
    if (!this.hold) this.micTrack.enabled = !this.micPaused;
    this.options.onConnectionState?.(this.connected, this.modelReady);
    this.maybeSignalConnected();
  }

  setMicPaused(paused: boolean) {
    this.micPaused = paused;
    if (!this.hold && this.modelReady && !this.closed) this.micTrack.enabled = !paused;
  }

  clearInterruptedOutput(responseId?: string) {
    if (this.closed) return;
    this.audio.muted = true;
    const id = responseId || this.currentOutputResponseId;
    if (id) this.interruptedResponseIds.add(id);
    else this.interruptedWithoutId = true;
  }

  /**
   * Replaces only the sender's mic track. The generated tone graph has no
   * connection to AudioContext.destination, so the owner never hears sidetone.
   */
  startHold(context: AudioContext, seconds: number): Promise<void> {
    this.assertOpen();
    if (this.holdPromise) return this.holdPromise;
    if (this.holdStopPromise) return Promise.reject(new Error("Тест ожидания ещё восстанавливает микрофон."));
    if (this.hold) return Promise.resolve();

    const sender = this.pc.getSenders().find((item) => item.track === this.micTrack);
    if (!sender) return Promise.reject(new Error("Не найдена исходная дорожка микрофона в WebRTC."));

    let destination: MediaStreamAudioDestinationNode | null = null;
    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];
    let track: MediaStreamTrack | null = null;
    try {
      destination = context.createMediaStreamDestination();
      [440, 554.37].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillators.push(oscillator);
        const gain = context.createGain();
        gains.push(gain);
        gain.gain.value = index === 0 ? 0.045 : 0.028;
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(destination!);
        oscillator.start();
      });
      track = destination.stream.getAudioTracks()[0];
      if (!track) throw new Error("Не удалось создать дорожку теста ожидания.");
    } catch (cause) {
      this.disposeHoldResources({ sender, destination, oscillators, gains, track, cancelled: true, disposed: false, timer: null });
      throw cause;
    }

    const resources: HoldResources = { sender, destination: destination!, oscillators, gains, track, cancelled: false, disposed: false, timer: null };
    this.hold = resources;
    this.holdResources.add(resources);
    this.micTrack.enabled = false;
    let operation!: Promise<void>;
    operation = (async () => {
      try {
        await sender.replaceTrack(track!);
        if (this.closed) return;
        if (resources.cancelled || this.hold !== resources) {
        if (sender.track === track) await sender.replaceTrack(this.micTrack);
          return;
        }
        this.micTrack.enabled = false;
        resources.timer = (this.options.setTimer ?? window.setTimeout)(() => {
          void this.stopHold().catch(() => undefined);
        }, Math.max(1, Math.min(180, seconds)) * 1000);
      } catch (cause) {
        if (this.hold === resources) {
          this.hold = null;
          this.disposeHoldResources(resources);
          this.micTrack.enabled = this.modelReady && !this.micPaused && !this.closed;
        }
        throw cause;
      } finally {
        if (this.holdPromise === operation) this.holdPromise = null;
      }
    })();
    this.holdPromise = operation;
    return operation;
  }

  stopHold(): Promise<void> {
    if (this.holdStopPromise) return this.holdStopPromise;
    const resources = this.hold;
    if (!resources) return Promise.resolve();
    this.hold = null;
    resources.cancelled = true;
    if (resources.timer !== null) (this.options.clearTimer ?? window.clearTimeout)(resources.timer);
    resources.timer = null;
    if (resources.track) resources.track.enabled = false;
    this.micTrack.enabled = false;

    let operation!: Promise<void>;
    operation = (async () => {
      try {
        // Let an in-flight replace settle first, then restore the real current sender.
        await this.holdPromise?.catch(() => undefined);
        if (!this.closed && resources.sender.track !== this.micTrack) {
          await resources.sender.replaceTrack(this.micTrack);
        }
        if (!this.closed) this.micTrack.enabled = this.modelReady && !this.micPaused;
      } catch (cause) {
        this.micTrack.enabled = false;
        if (!this.closed) {
          this.options.onError("webrtc_error", `Не удалось восстановить микрофон после теста ожидания: ${cause instanceof Error ? cause.message : "ошибка замены дорожки"}`);
          this.close();
        }
        throw cause;
      } finally {
        this.disposeHoldResources(resources);
        if (this.holdStopPromise === operation) this.holdStopPromise = null;
      }
    })();
    this.holdStopPromise = operation;
    return operation;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.options.onConnectionState?.(false, this.modelReady);
    if (this.disconnectedTimer !== null) (this.options.clearTimer ?? window.clearTimeout)(this.disconnectedTimer);
    this.disconnectedTimer = null;
    this.hold = null;
    const generatedHoldTracks = new Set<MediaStreamTrack>();
    this.holdResources.forEach((resource) => { if (resource.track) generatedHoldTracks.add(resource.track); });
    Array.from(this.holdResources).forEach((hold) => {
      hold.cancelled = true;
      if (hold.timer !== null) (this.options.clearTimer ?? window.clearTimeout)(hold.timer);
      if (hold.track) hold.track.enabled = false;
      this.disposeHoldResources(hold);
    });
    this.micTrack.enabled = false;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    if (this.dataChannel) {
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
      this.dataChannel = null;
    }
    this.pc.getReceivers().forEach((receiver) => receiver.track?.stop());
    this.pc.getSenders().forEach((sender) => {
      if (sender.track !== this.micTrack && sender.track && !generatedHoldTracks.has(sender.track)) sender.track.stop();
    });
    this.pc.getTransceivers().forEach((transceiver) => transceiver.stop());
    this.pc.close();
    this.audio.pause();
    this.audio.srcObject = null;
    this.remoteStream?.getTracks().forEach((track) => track.stop());
    this.remoteStream = null;
  }

  private disposeHoldResources(resources: HoldResources) {
    if (resources.disposed) return;
    resources.disposed = true;
    this.holdResources.delete(resources);
    if (resources.timer !== null) (this.options.clearTimer ?? window.clearTimeout)(resources.timer);
    resources.timer = null;
      resources.track?.stop();
    resources.oscillators.forEach((oscillator) => {
      try { oscillator.stop(); } catch {}
      oscillator.disconnect();
    });
    resources.gains.forEach((gain) => gain.disconnect());
    resources.destination?.disconnect();
  }

  private handleTrack(event: RTCTrackEvent) {
    if (this.closed) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    this.remoteStream = stream;
    this.audio.srcObject = stream;
    void this.audio.play().catch((cause: unknown) => {
      if (this.closed) return;
      this.options.onError("audio_autoplay_blocked", cause instanceof Error ? cause.message : "Не удалось запустить воспроизведение.");
      this.close();
    });
  }

  private handleDataMessage(data: unknown) {
    if (this.closed || typeof data !== "string") return;
    let event: { type?: string; response_id?: string; responseId?: string; response?: { id?: string } };
    try { event = JSON.parse(data) as typeof event; } catch { return; }
    const responseId = event.responseId ?? event.response_id ?? event.response?.id;
    if (event.type === "input_audio_buffer.speech_started" || event.type === "input_audio_buffer.clear") {
      this.clearInterruptedOutput(responseId);
    } else if (event.type === "output_audio_buffer.started") {
      if (responseId) {
        if (this.interruptedResponseIds.has(responseId)) {
          this.audio.muted = true;
          return;
        }
        this.currentOutputResponseId = responseId;
        this.interruptedWithoutId = false;
        this.audio.muted = false;
      } else if (!this.interruptedWithoutId && (!this.currentOutputResponseId || !this.interruptedResponseIds.has(this.currentOutputResponseId))) {
        this.audio.muted = false;
      }
    }
  }

  private handleConnectionState() {
    if (this.closed) return;
    if (this.pc.connectionState === "connected") {
      this.connected = true;
      if (this.disconnectedTimer !== null) (this.options.clearTimer ?? window.clearTimeout)(this.disconnectedTimer);
      this.disconnectedTimer = null;
      this.options.onConnectionState?.(true, this.modelReady);
      this.maybeSignalConnected();
    } else if (this.pc.connectionState === "disconnected") {
      this.connected = false;
      this.options.onConnectionState?.(false, this.modelReady);
      if (this.disconnectedTimer === null) {
        this.disconnectedTimer = (this.options.setTimer ?? window.setTimeout)(() => {
          this.disconnectedTimer = null;
          if (!this.closed && this.pc.connectionState !== "connected") {
            this.options.onError("webrtc_disconnected", "WebRTC не восстановился в течение пяти секунд.");
            this.close();
          }
        }, 5000);
      }
    } else {
      this.connected = false;
      this.options.onConnectionState?.(false, this.modelReady);
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") {
        this.options.onError("webrtc_error", `Соединение WebRTC: ${this.pc.connectionState}.`);
        this.close();
      }
    }
  }

  private maybeSignalConnected() {
    if (this.closed || !this.connected || !this.modelReady) return;
    if (!this.readyFired) {
      this.readyFired = true;
      this.options.onReady();
    }
    if (!this.connectedSent) {
      this.connectedSent = true;
      this.options.sendSocket({ type: "rtc_connected" });
    }
  }

  private assertOpen() {
    if (this.closed) throw new Error("WebRTC-контроллер уже закрыт.");
  }
}

export function createLabRtcController(options: LabRtcControllerOptions) {
  return new LabRtcController(options);
}
