// WAV channel splitting + G.711 μ-law encoding for the EARS benchmark.
//
// HARD RULE (Task: real-call benchmark): candidates must hear the ORIGINAL
// telephone-quality audio. We do NOT resample, denoise or "enhance" anything.
// Twilio dual-channel call recordings are 8kHz WAV (PCM16 or μ-law); we only
// de-interleave channels and, where a provider natively consumes μ-law@8k
// (exactly what production Twilio media streams deliver), convert PCM16
// samples to μ-law — a format transcode, not an enhancement. Any WAV that is
// not 8kHz is rejected honestly instead of being silently resampled.

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 1 = PCM, 7 = μ-law */
  audioFormat: number;
  /** raw interleaved sample data */
  data: Buffer;
}

export function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let off = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(off + 8 + size, buf.length));
    if (id === "fmt ") {
      fmt = {
        audioFormat: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14),
      };
    } else if (id === "data") {
      data = body;
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt) throw new Error("WAV has no fmt chunk");
  if (!data) throw new Error("WAV has no data chunk");
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, audioFormat: fmt.audioFormat, data };
}

/** Standard G.711 μ-law encoder for one 16-bit PCM sample. */
export function pcm16ToMulawSample(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export interface ChannelAudio {
  /** μ-law 8kHz mono stream for this channel (production wire format) */
  mulaw8k: Buffer;
  /** mono WAV of the ORIGINAL samples for this channel (for batch upload) */
  wav: Buffer;
}

function buildMonoWav(samples: Buffer, sampleRate: number, bitsPerSample: number, audioFormat: number): Buffer {
  const blockAlign = bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/**
 * Split a Twilio call-recording WAV into per-channel audio.
 * Accepts 8kHz PCM16 or 8kHz μ-law WAVs (mono or dual). Throws (honest
 * failure, no silent resampling) for anything else.
 */
export function splitWavChannels(wavBuf: Buffer): { sampleRate: number; channels: ChannelAudio[] } {
  const wav = parseWav(wavBuf);
  if (wav.sampleRate !== 8000) {
    throw new Error(`WAV sample rate is ${wav.sampleRate}Hz — benchmark requires original 8kHz telephone audio (no resampling performed)`);
  }
  if (wav.audioFormat !== 1 && wav.audioFormat !== 7) {
    throw new Error(`unsupported WAV format code ${wav.audioFormat} (need PCM16 or μ-law)`);
  }
  const isMulaw = wav.audioFormat === 7;
  if (isMulaw && wav.bitsPerSample !== 8) throw new Error(`μ-law WAV with ${wav.bitsPerSample} bits/sample not supported`);
  if (!isMulaw && wav.bitsPerSample !== 16) throw new Error(`PCM WAV with ${wav.bitsPerSample} bits/sample not supported (need 16)`);

  const bytesPerSample = wav.bitsPerSample / 8;
  const frameBytes = bytesPerSample * wav.channels;
  const frames = Math.floor(wav.data.length / frameBytes);
  const out: ChannelAudio[] = [];
  for (let ch = 0; ch < wav.channels; ch++) {
    const raw = Buffer.alloc(frames * bytesPerSample);
    const mulaw = Buffer.alloc(frames);
    for (let f = 0; f < frames; f++) {
      const srcOff = f * frameBytes + ch * bytesPerSample;
      if (isMulaw) {
        const b = wav.data[srcOff];
        raw[f] = b;
        mulaw[f] = b;
      } else {
        const s = wav.data.readInt16LE(srcOff);
        raw.writeInt16LE(s, f * 2);
        mulaw[f] = pcm16ToMulawSample(s);
      }
    }
    out.push({
      mulaw8k: mulaw,
      wav: buildMonoWav(raw, wav.sampleRate, wav.bitsPerSample, wav.audioFormat),
    });
  }
  return { sampleRate: wav.sampleRate, channels: out };
}

/**
 * Slice a MONO WAV (as produced by splitWavChannels) to [startMs, endMs].
 * Bounds are clamped; throws on multi-channel input (honest failure).
 */
export function sliceMonoWav(monoWavBuf: Buffer, startMs: number, endMs: number): Buffer {
  const wav = parseWav(monoWavBuf);
  if (wav.channels !== 1) throw new Error(`sliceMonoWav needs mono WAV, got ${wav.channels} channels`);
  const bytesPerSample = wav.bitsPerSample / 8;
  const toOff = (ms: number) => {
    const sample = Math.max(0, Math.round((ms / 1000) * wav.sampleRate));
    return Math.min(wav.data.length, sample * bytesPerSample);
  };
  const a = toOff(startMs);
  const b = toOff(endMs);
  if (b <= a) throw new Error(`empty slice: ${startMs}..${endMs}ms`);
  return buildMonoWav(wav.data.subarray(a, b), wav.sampleRate, wav.bitsPerSample, wav.audioFormat);
}
