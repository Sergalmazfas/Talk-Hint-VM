import { afterEach, expect, it, vi } from "vitest";
import { watchWaitingMicrophone } from "./secretary-lab-waiting-audio";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(amplitude: number, resumeFails = false) {
  const stop = vi.fn(), disconnect = vi.fn(), close = vi.fn(async () => {});
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  class Context {
    state = "running";
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect });
    createAnalyser = () => ({ fftSize: 2048, getFloatTimeDomainData: (a: Float32Array) => a.fill(amplitude) });
    resume = async () => { if (resumeFails) throw Error("fixture resume failed"); };
    close = close;
  }
  vi.stubGlobal("AudioContext", Context);
  return { stream, stop, disconnect, close };
}
it.each([[0, false], [0.004, true], [0.1, true]])("microphone energy %s sends only boolean %s, never audio", async (amplitude, expected) => {
  vi.useFakeTimers();
  const f = fixture(amplitude as number), publish = vi.fn(async () => {});
  const stop = await watchWaitingMicrophone(f.stream, publish);
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenCalledWith(expected);
  expect(publish.mock.calls[0]).toHaveLength(1);
  stop(); stop();
  const calls = publish.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(publish).toHaveBeenCalledTimes(calls);
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.disconnect).toHaveBeenCalledTimes(1);
  expect(f.close).toHaveBeenCalledTimes(1);
});
it("audio setup failure releases microphone and stops before any paid admission", async () => {
  const f = fixture(0, true);
  await expect(watchWaitingMicrophone(f.stream, vi.fn())).rejects.toThrow("fixture resume failed");
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});
it("unknown network results never trigger a second signal request concurrently", async () => {
  vi.useFakeTimers();
  const f = fixture(0.1), publish = vi.fn(() => new Promise<void>(() => {}));
  const stop = await watchWaitingMicrophone(f.stream, publish);
  await vi.advanceTimersByTimeAsync(5000);
  expect(publish).toHaveBeenCalledTimes(1);
  stop();
});
