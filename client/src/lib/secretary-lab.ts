export type VoiceProvider = "elevenlabs" | "cartesia" | "openai";
export type LabStatus = "awaiting_connection" | "running" | "ended";

export interface LabTurn {
  id: string;
  role: "guest" | "secretary";
  text: string;
  translation?: string;
  atMs: number;
  interrupted?: boolean;
}

export interface LabEvent {
  type: string;
  atMs: number;
  detail?: string;
}

export interface LabReport {
  id: string;
  status: LabStatus;
  createdAt: string;
  endedAt?: string;
  reason?: string;
  voiceProvider: VoiceProvider;
  model?: string;
  voice?: string;
  transport?: "webrtc" | "simulated_twilio";
  instruction: string;
  turns: LabTurn[];
  events: LabEvent[];
  metrics: {
    guestTurns: number;
    secretaryTurns: number;
    firstAudioMs?: number;
    lastTurnToAudioMs?: number;
  };
  rating?: string;
}

export interface LabSnapshot {
  providers: Record<"elevenlabs" | "cartesia", { ready: boolean; source: "linked_existing" | "sample_clone" | "unavailable" }> & {
    openai?: { ready: boolean; source: "builtin"; model: string; voice: string; reason?: string; checkedAt?: string };
  };
  models: { realtime: string; stt: string };
  sessions: LabReport[];
  limits: { durationSeconds: number; historyMinutes: number };
  note: string;
}

export const LAB_API = "/api/admin/secretary-lab";
export const MULAW_FRAME_BYTES = 160;
export const MIC_QUEUE_MAX_FRAMES = 150;
export const PLAYBACK_QUEUE_MAX_SECONDS = 2;
export const PLAYBACK_PREFILL_SECONDS = 0.18;
export const ULAW_SILENCE_FRAME = new Uint8Array(MULAW_FRAME_BYTES).fill(0xff);

export class UlawFrameQueue {
  private frames: Uint8Array[] = [];

  constructor(readonly maxFrames: number) {}

  get length() { return this.frames.length; }

  pushFrame(frame: Uint8Array) {
    if (frame.length !== MULAW_FRAME_BYTES) throw new Error("G.711 frames must be exactly 160 bytes.");
    this.frames.push(frame.slice());
    if (this.frames.length > this.maxFrames) this.frames.splice(0, this.frames.length - this.maxFrames);
  }

  pushBytes(bytes: Uint8Array) {
    for (let offset = 0; offset + MULAW_FRAME_BYTES <= bytes.length; offset += MULAW_FRAME_BYTES) {
      this.pushFrame(bytes.subarray(offset, offset + MULAW_FRAME_BYTES));
    }
  }

  shift(): Uint8Array | undefined { return this.frames.shift(); }
  clear() { this.frames = []; }
}

export type OutboundFrame =
  | { source: "music" | "microphone" | "silence"; frame: Uint8Array; nextMusicOffset: number };

/** One clock owns all outbound media. Priority is synthetic fixture, live mic, then μ-law silence. */
export function selectOutboundFrame(input: {
  music: Uint8Array | null;
  musicOffset: number;
  microphone: UlawFrameQueue;
  microphonePaused: boolean;
  silenceFrame?: Uint8Array;
}): OutboundFrame {
  if (input.music && input.musicOffset < input.music.length) {
    const end = Math.min(input.music.length, input.musicOffset + MULAW_FRAME_BYTES);
    const frame = input.music.subarray(input.musicOffset, end);
    if (frame.length === MULAW_FRAME_BYTES) return { source: "music", frame, nextMusicOffset: end };
  }
  if (!input.microphonePaused) {
    const frame = input.microphone.shift();
    if (frame) return { source: "microphone", frame, nextMusicOffset: input.musicOffset };
  }
  return { source: "silence", frame: input.silenceFrame ?? ULAW_SILENCE_FRAME, nextMusicOffset: input.musicOffset };
}

export function markPlaybackDecision(contextState: AudioContextState | "missing", currentTime: number, playbackCursor: number): "ack" | "wait" | "stop" {
  if (contextState !== "running") return "stop";
  return currentTime >= playbackCursor ? "ack" : "wait";
}

export function playbackWouldExceedLimit(currentTime: number, playbackCursor: number, nextDuration: number, maxSeconds = PLAYBACK_QUEUE_MAX_SECONDS): boolean {
  return Math.max(0, playbackCursor - currentTime) + nextDuration > maxSeconds;
}

/** A small jitter reserve, applied once per underrun, NOT to every 20ms frame. */
export function scheduleLabPlayback(currentTime: number, playbackCursor: number, duration: number) {
  const startAt = playbackCursor > currentTime ? playbackCursor : currentTime + PLAYBACK_PREFILL_SECONDS;
  return { startAt, endAt: startAt + duration };
}

export function labEndReasonLabel(reason?: string): string {
  const labels: Record<string, string> = {
    user_stop: "Остановлено пользователем",
    browser_disconnected: "Прервано соединение с браузером",
    audio_suspended: "Браузер приостановил звук",
    audio_decode_error: "Не удалось декодировать звук",
    audio_queue_limit: "Слишком большая очередь воспроизведения",
    audio_input_backpressure: "Слишком большая очередь отправки микрофона",
    microphone_error: "Ошибка микрофона",
    client_error: "Ошибка браузерной сессии",
    duration_limit: "Достигнут лимит времени",
    playback_ack_timeout: "Браузер не подтвердил воспроизведение",
    webrtc_error: "Ошибка аудио WebRTC",
    webrtc_disconnected: "Соединение WebRTC потеряно",
    audio_autoplay_blocked: "Браузер заблокировал воспроизведение аудио",
  };
  return reason ? labels[reason] ?? `Причина завершения: ${reason}` : "Сессия завершена — причина не установлена";
}

export async function labRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Запрос завершился с ошибкой ${response.status}.`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function ulawToPcm(byte: number): number {
  const value = (~byte) & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

export function pcmToUlaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let pcm = Math.max(-CLIP, Math.min(CLIP, Math.round(sample)));
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  pcm += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (pcm & mask) === 0; exponent--, mask >>= 1) {}
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function floatToUlaw(input: Float32Array, inputRate: number, outputLength?: number): Uint8Array {
  const length = outputLength ?? Math.floor(input.length * 8000 / inputRate);
  const output = new Uint8Array(length);
  const ratio = inputRate / 8000;
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const fraction = pos - left;
    const a = input[Math.min(left, input.length - 1)] || 0;
    const b = input[Math.min(left + 1, input.length - 1)] || a;
    output[i] = pcmToUlaw((a + (b - a) * fraction) * 32767);
  }
  return output;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const end = Math.min(bytes.length, i + 0x8000);
    for (let index = i; index < end; index++) binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function makeHoldMusic(seconds: number): Uint8Array {
  const boundedSeconds = Math.max(1, Math.min(180, Math.floor(seconds)));
  const count = boundedSeconds * 8000;
  const audio = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const time = i / 8000;
    const fade = Math.min(1, i / 300, (count - i) / 300);
    const tone = Math.sin(2 * Math.PI * 440 * time) * 0.09 + Math.sin(2 * Math.PI * 554.37 * time) * 0.07;
    audio[i] = pcmToUlaw(tone * fade * 32767);
  }
  return audio;
}

export function socketUrl(path: string): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${path}`;
}

export function formatLabTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

