export interface VoiceProvider {
  readonly name: string;
  streamSpeech(voiceId: string, text: string, signal?: AbortSignal): Promise<Response>;
}

export class ElevenLabsProvider implements VoiceProvider {
  readonly name = "elevenlabs";

  async streamSpeech(voiceId: string, text: string, signal?: AbortSignal): Promise<Response> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ElevenLabs API key is not configured");
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      signal,
    });
  }
}

const CARTESIA_VERSION = "2026-08-14";
function cartesiaHeaders() {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error("Cartesia API key is not configured");
  return { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": CARTESIA_VERSION };
}

export class CartesiaProvider implements VoiceProvider {
  readonly name = "cartesia";

  async streamSpeech(voiceId: string, text: string, signal?: AbortSignal): Promise<Response> {
    return fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: { ...cartesiaHeaders(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        model_id: "sonic-3.6", transcript: text, voice: { mode: "id", id: voiceId },
        locale: "en", output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
      signal,
    });
  }
}

export class CartesiaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null = null,
    readonly detail: string | null = null,
    readonly requestId: string | null = null,
  ) {
    super(`Cartesia voice creation failed (HTTP ${status}${code ? `, ${code}` : ""})`);
  }
}

async function cartesiaCloneError(response: Response) {
  let error: unknown;
  try {
    // Never log the provider response or the uploaded audio. Its structured
    // error fields are only returned to the authenticated Voice Lab admin.
    const text = await response.text();
    if (text.length <= 8192) error = JSON.parse(text);
  } catch {
    // Even if Cartesia returns non-JSON, retain the HTTP status.
  }
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof fields.error_code === "string" && /^[a-z_]{1,64}$/.test(fields.error_code)
    ? fields.error_code : null;
  const detail = typeof fields.message === "string" ? fields.message.slice(0, 300) : null;
  const requestId = typeof fields.request_id === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(fields.request_id)
    ? fields.request_id : null;
  return new CartesiaHttpError(response.status, code, detail, requestId);
}

export function supportsCartesiaCloneMime(mimeType: SupportedMime) {
  return ["audio/webm", "audio/wav", "audio/mpeg", "audio/ogg"].includes(mimeType);
}

export async function createCartesiaClonedVoice(audio: Buffer, mimeType: SupportedMime, adminId: string, signal?: AbortSignal) {
  if (!supportsCartesiaCloneMime(mimeType)) {
    throw Object.assign(new Error("Use a WebM, WAV, MP3, or OGG sample for Cartesia"), { status: 400 });
  }
  const form = new FormData();
  form.append("name", `TalkHint Cartesia Voice Lab ${adminId.slice(0, 8)}`);
  form.append("clip", new Blob([audio], { type: mimeType }), `sample.${mimeExtension(mimeType)}`);
  form.append("language", "ru");
  form.append("access", "private");
  const response = await fetch("https://api.cartesia.ai/voices/clone", {
    method: "POST", headers: cartesiaHeaders(), body: form, signal,
  });
  if (!response.ok) {
    throw await cartesiaCloneError(response);
  }
  const data = await response.json() as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) throw new Error("Cartesia returned no voice ID");
  return data.id;
}

export type SupportedMime = "audio/webm" | "audio/wav" | "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/m4a" | "audio/x-m4a";

const MIME_EXTENSIONS: Record<SupportedMime, string> = {
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
};

export function validMime(value: unknown): value is SupportedMime {
  return normalizedMime(value) !== null;
}

function normalizedMime(value: unknown): SupportedMime | null {
  if (typeof value !== "string") return null;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType in MIME_EXTENSIONS ? mediaType as SupportedMime : null;
}

export function mimeExtension(mime: SupportedMime) {
  return MIME_EXTENSIONS[mime];
}

export function decodeAudio(value: unknown, mimeType: unknown, duration: unknown) {
  return decodeAudioWithMaxDuration(value, mimeType, duration, 30_000);
}

export function decodeAudioWithMaxDuration(value: unknown, mimeType: unknown, duration: unknown, maxDurationMs: number) {
  const safeMimeType = normalizedMime(mimeType);
  if (!safeMimeType) throw Object.assign(new Error("Unsupported audio MIME type"), { status: 400 });
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 250 || duration > maxDurationMs) {
    throw Object.assign(new Error(`Audio duration must be between 250 and ${maxDurationMs} ms`), { status: 400 });
  }
  const maxBase64Length = Math.ceil((10 * 1024 * 1024) / 3) * 4;
  if (typeof value === "string" && value.length > maxBase64Length) {
    throw Object.assign(new Error("Audio exceeds the 10 MB upload limit"), { status: 413 });
  }
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !isCanonicalBase64(value)) {
    throw Object.assign(new Error("Audio must be valid base64 and no larger than 10 MB"), { status: 400 });
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.length < 512 || buffer.length > 10 * 1024 * 1024) {
    throw Object.assign(new Error("Audio must be between 512 bytes and 10 MB"), { status: 413 });
  }
  return { buffer, mimeType: safeMimeType, durationMs: duration };
}

function isCanonicalBase64(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentEnd = value.length - padding;
  for (let index = 0; index < contentEnd; index++) {
    const code = value.charCodeAt(index);
    const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (!valid) return false;
  }
  for (let index = contentEnd; index < value.length; index++) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  if (padding === 1) return contentEnd % 4 === 3;
  if (padding === 2) return contentEnd % 4 === 2;
  return true;
}

export class ElevenLabsHttpError extends Error {
  constructor(readonly status: number) {
    super(`ElevenLabs voice creation failed (HTTP ${status})`);
  }
}

export async function createClonedVoice(audio: Buffer, mimeType: SupportedMime, adminId: string, signal?: AbortSignal) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ElevenLabs API key is not configured"), { status: 500 });
  const form = new FormData();
  form.append("name", `TalkHint Voice Lab ${adminId.slice(0, 8)}`);
  form.append("files", new Blob([audio], { type: mimeType }), `sample.${mimeExtension(mimeType)}`);
  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ElevenLabsHttpError(response.status);
  }
  const data = await response.json() as { voice_id?: unknown };
  if (typeof data.voice_id !== "string" || !data.voice_id) {
    throw new Error("ElevenLabs returned no voice ID");
  }
  return data.voice_id;
}

export async function transcribeRussian(audio: Buffer, mimeType: SupportedMime, signal?: AbortSignal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("OpenAI API key is not configured"), { status: 500 });
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "ru");
  form.append("file", new Blob([audio], { type: mimeType }), `recording.${mimeExtension(mimeType)}`);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Russian transcription failed (HTTP ${response.status})`);
  }
  const data = await response.json() as { text?: unknown };
  if (typeof data.text !== "string" || !data.text.trim()) {
    throw Object.assign(new Error("No speech was recognized; please try recording again"), { status: 422 });
  }
  return data.text.trim();
}

export async function translateToNaturalEnglish(russian: string, signal?: AbortSignal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error("OpenAI API key is not configured"), { status: 500 });
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: "Translate the user's Russian utterance into natural, faithful English. Return only the translation. Preserve meaning and details; do not answer, expand, or invent anything." },
        { role: "user", content: russian },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`English translation failed (HTTP ${response.status})`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const english = data.choices?.[0]?.message?.content;
  if (typeof english !== "string" || !english.trim()) {
    throw Object.assign(new Error("English translation returned no text"), { status: 502 });
  }
  return english.trim();
}