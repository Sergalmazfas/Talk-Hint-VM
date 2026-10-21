import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createIncomingSecretaryWorkletSource, decodePcmu, decodePcmuSample, encodePcmu, encodePcmuSample, floatToPcm16, resampleLinear, StreamingPcmuResampler } from "./incoming-secretary-audio";

describe("incoming secretary PCMU audio helpers", () => {
  it("encodes and decodes representative μ-law samples within companding tolerance", () => {
    const input = new Int16Array([-30000, -12000, -1000, 0, 1000, 12000, 30000]);
    const decoded = decodePcmu(encodePcmu(input));
    expect(decoded.length).toBe(input.length);
    input.forEach((sample, index) => {
      expect(Math.abs(decoded[index] - sample)).toBeLessThan(1800);
    });
    expect(encodePcmuSample(0)).toBe(255);
    expect(decodePcmuSample(255)).toBe(0);
  });

  it("resamples from the device sample rate to 8 kHz", () => {
    const input = new Float32Array([0, 1, 0, -1, 0, 1, 0, -1]);
    const output = resampleLinear(input, 16000, 8000);
    expect(output.length).toBe(4);
    expect(Array.from(output)).toEqual([0, 0, 0, 0]);
    expect(resampleLinear(new Float32Array(), 48000, 8000).length).toBe(0);
    expect(Array.from(floatToPcm16(new Float32Array([-1, 0, 1])))).toEqual([-32768, 0, 32767]);
  });

  it("keeps streaming resampling phase across 128-sample 48 kHz callbacks and emits 20 ms frames", () => {
    const converter = new StreamingPcmuResampler(48000);
    let frames = 0;
    let outputSamples = 0;
    const block = new Float32Array(128);
    for (let blockIndex = 0; blockIndex < 374; blockIndex += 1) {
      const result = converter.push(block);
      frames += result.length;
      result.forEach((frame) => { expect(frame.length).toBe(160); outputSamples += frame.length; });
    }
    const finalBlock = converter.push(new Float32Array(128));
    frames += finalBlock.length;
    finalBlock.forEach((frame) => { expect(frame.length).toBe(160); outputSamples += frame.length; });
    expect(frames).toBe(50);
    expect(outputSamples).toBe(8000);
  });

  it("executes the actual generated AudioWorklet source and emits 50 160-sample packets per second", () => {
    const packets: Float32Array[] = [];
    let processorName = "";
    let Processor: new () => { process(inputs: Float32Array[][]): boolean };
    class FakeAudioWorkletProcessor {
      port = {
        postMessage: (message: Float32Array, transfer: ArrayBuffer[]) => {
          packets.push(message);
          expect(transfer[0]).toBe(message.buffer);
        },
      };
    }
    runInNewContext(createIncomingSecretaryWorkletSource(), {
      AudioWorkletProcessor: FakeAudioWorkletProcessor,
      sampleRate: 48000,
      registerProcessor: (name: string, processor: new () => { process(inputs: Float32Array[][]): boolean }) => {
        processorName = name;
        Processor = processor;
      },
    });
    expect(processorName).toBe("talkhint-secretary-capture");
    const worklet = new Processor!();
    for (let frame = 0; frame < 375; frame += 1) {
      expect(worklet.process([[new Float32Array(128)]])).toBe(true);
    }
    expect(packets).toHaveLength(50);
    packets.forEach((packet) => expect(packet.length).toBe(160));
  });
});
