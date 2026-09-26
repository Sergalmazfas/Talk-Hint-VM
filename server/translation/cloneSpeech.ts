const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_VERSION = "2026-08-14";
export const CLONE_SPEECH_MAX_TEXT_CHARS = 1_500;
// 15 seconds of mono PCM16 at 24 kHz. Whole-buffer synthesis trades latency
// for format validation before playback, so bound it tightly before paced send.
export const CLONE_SPEECH_MAX_AUDIO_BYTES = 720_000;
const REQUEST_TIMEOUT_MS = 20_000;

export type TranslatorCloneProvider = "elevenlabs" | "cartesia";

export function resolveTranslatorCloneProvider(value: unknown): TranslatorCloneProvider {
  return value === "cartesia" ? "cartesia" : "elevenlabs";
}

export function requireReadyOwnerClone(
  clone: { status?: unknown; voiceId?: unknown } | null | undefined,
  apiKey: string | undefined,
): string {
  if (!clone || clone.status !== "ready" || typeof clone.voiceId !== "string" ||
    !clone.voiceId.trim() || !apiKey) {
    throw new Error("Translator requires a ready owner clone and configured ElevenLabs service");
  }
  return clone.voiceId;
}

export function requireReadyTranslatorClone(
  provider: TranslatorCloneProvider,
  clone: { status?: unknown; voiceId?: unknown } | null | undefined,
  apiKey: string | undefined,
): string {
  if (!clone || clone.status !== "ready" || typeof clone.voiceId !== "string" ||
      !clone.voiceId.trim() || !apiKey) {
    const providerName = provider === "cartesia" ? "Cartesia" : "ElevenLabs";
    throw new Error(`Translator requires a ready owner ${providerName} clone and configured ${providerName} service`);
  }
  return clone.voiceId;
}

/** Translator speech is restricted to English Latin text, never arbitrary input text. */
export function isSafeEnglishTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > CLONE_SPEECH_MAX_TEXT_CHARS) return false;
  for (const character of trimmed) {
    const code = character.codePointAt(0)!;
    const asciiLetter = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    const latinLetter = asciiLetter || (code >= 0x00c0 && code <= 0x024f) ||
      (code >= 0x1e00 && code <= 0x1eff) || (code >= 0x2c60 && code <= 0x2c7f) ||
      (code >= 0xa720 && code <= 0xa7ff) || (code >= 0xab30 && code <= 0xab6f);
    if (latinLetter) continue;
    // Permit whitespace, ASCII numbers/punctuation, and typographic
    // punctuation; fail closed on other non-Latin scripts and symbols.
    if (code <= 0x7f || (code >= 0x2000 && code <= 0x206f)) continue;
    return false;
  }
  return true;
}

/**
 * Request raw signed PCM16 little-endian mono at 24 kHz. The voice ID is passed
 * only from the server-side, call-snapshotted owner clone.
 */
export async function synthesizeCloneSpeech(
  voiceId: string,
  text: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Owner cloned voice is unavailable: ElevenLabs is not configured");
  if (!voiceId || !isSafeEnglishTranslation(text)) {
    throw new Error("Owner cloned voice received an invalid English translation");
  }
  if (signal?.aborted) throw new Error("Owner cloned voice synthesis was cancelled");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(
      `${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/pcm",
        },
        body: JSON.stringify({ text: text.trim(), model_id: "eleven_multilingual_v2" }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Owner cloned voice synthesis failed (HTTP ${response.status})`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType && contentType !== "audio/pcm" && contentType !== "application/octet-stream") {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Owner cloned voice returned an unsupported audio format");
    }
    if (!response.body) throw new Error("Owner cloned voice returned no audio stream");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > CLONE_SPEECH_MAX_AUDIO_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error("Owner cloned voice audio exceeded the call limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    const pcm = Buffer.concat(chunks, byteLength);
    if (!pcm.length || pcm.length % 2 !== 0) {
      throw new Error("Owner cloned voice returned invalid PCM audio");
    }
    return pcm;
  } catch (error: any) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw new Error("Owner cloned voice synthesis was cancelled");
      throw new Error("Owner cloned voice synthesis timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Cartesia Translator output uses the same raw mono PCM16/24k format as the
 * existing ElevenLabs path so the Twilio μ-law packetizer remains unchanged.
 */
export async function synthesizeCartesiaCloneSpeech(
  voiceId: string,
  text: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error("Owner cloned voice is unavailable: Cartesia is not configured");
  if (!voiceId || !isSafeEnglishTranslation(text)) {
    throw new Error("Owner cloned voice received an invalid English translation");
  }
  if (signal?.aborted) throw new Error("Owner cloned voice synthesis was cancelled");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(CARTESIA_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
        Accept: "audio/raw",
      },
      body: JSON.stringify({
        model_id: "sonic-3.6",
        transcript: text.trim(),
        voice: { mode: "id", id: voiceId },
        locale: "en",
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24_000 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Cartesia cloned voice synthesis failed (HTTP ${response.status})`);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!contentType || !["audio/raw", "audio/pcm", "application/octet-stream"].includes(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Cartesia cloned voice returned an unsupported audio format");
    }
    if (!response.body) throw new Error("Cartesia cloned voice returned no audio stream");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > CLONE_SPEECH_MAX_AUDIO_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new Error("Cartesia cloned voice audio exceeded the call limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    const pcm = Buffer.concat(chunks, byteLength);
    if (!pcm.length || pcm.length % 2 !== 0) throw new Error("Cartesia cloned voice returned invalid PCM audio");
    return pcm;
  } catch (error: any) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw new Error("Owner cloned voice synthesis was cancelled");
      throw new Error("Cartesia cloned voice synthesis timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}