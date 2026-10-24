const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function encodePcmuSample(sample: number): number {
  let value = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = value < 0 ? 0x80 : 0;
  if (value < 0) value = -value;
  value = Math.min(value, MULAW_CLIP) + MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (value & mask) === 0; exponent -= 1, mask >>= 1) {}
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function decodePcmuSample(byte: number): number {
  const value = (~byte) & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  const magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
  return sign ? MULAW_BIAS - magnitude : magnitude - MULAW_BIAS;
}

export function encodePcmu(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) bytes[index] = encodePcmuSample(samples[index]);
  return bytes;
}

export function decodePcmu(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) samples[index] = decodePcmuSample(bytes[index]);
  return samples;
}

export function resampleLinear(input: Float32Array, fromRate: number, toRate = 8000): Float32Array {
  if (!Number.isFinite(fromRate) || fromRate <= 0 || toRate <= 0) throw new Error("Sample rates must be positive.");
  if (input.length === 0) return new Float32Array();
  if (fromRate === toRate) return input.slice();
  const outputLength = Math.max(1, Math.floor(input.length * toRate / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const fraction = position - lower;
    output[index] = input[lower] * (1 - fraction) + input[upper] * fraction;
  }
  return output;
}

/**
 * Stateful linear resampler for AudioWorklet-sized input blocks. It preserves
 * interpolation phase across block boundaries and emits telephony-sized frames.
 */
export class StreamingPcmuResampler {
  private carry = new Float32Array(0);
  private position = 0;
  private pending = new Float32Array(160);
  private pendingLength = 0;

  constructor(private readonly fromRate: number, private readonly toRate = 8000) {
    if (!Number.isFinite(fromRate) || fromRate <= 0 || toRate <= 0) throw new Error("Sample rates must be positive.");
  }

  push(input: Float32Array): Float32Array[] {
    if (!input.length) return [];
    const merged = new Float32Array(this.carry.length + input.length);
    merged.set(this.carry);
    merged.set(input, this.carry.length);
    const frames: Float32Array[] = [];
    const step = this.fromRate / this.toRate;
    while (this.position + 1 < merged.length) {
      const low = Math.floor(this.position);
      const fraction = this.position - low;
      const sample = merged[low] * (1 - fraction) + merged[low + 1] * fraction;
      this.pending[this.pendingLength] = sample;
      this.pendingLength += 1;
      if (this.pendingLength === this.pending.length) {
        frames.push(this.pending);
        this.pending = new Float32Array(160);
        this.pendingLength = 0;
      }
      this.position += step;
    }
    const consumed = Math.min(Math.floor(this.position), merged.length);
    this.carry = merged.slice(consumed);
    this.position -= consumed;
    return frames;
  }
}

export function createIncomingSecretaryWorkletSource() {
  return `
    const StreamingPcmuResampler = ${StreamingPcmuResampler.toString()};
    class SecretaryCapture extends AudioWorkletProcessor {
      constructor() { super(); this.converter = new StreamingPcmuResampler(sampleRate); }
      process(inputs) {
        const input = inputs[0] && inputs[0][0];
        if (!input || !input.length) return true;
        const frames = this.converter.push(input);
        for (const frame of frames) this.port.postMessage(frame, [frame.buffer]);
        return true;
      }
    }
    registerProcessor("talkhint-secretary-capture", SecretaryCapture);
  `;
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    output[index] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }
  return output;
}
