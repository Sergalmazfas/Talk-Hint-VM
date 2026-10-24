import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { handleRetellPhoneMonitor } from "./retellMonitor";
vi.mock("./tasks", () => ({ getSecretaryTaskForCall: vi.fn() }));
class Socket extends EventEmitter {
  close = vi.fn(() => this.emit("close"));
  frame(f: object) { this.emit("message", Buffer.from(JSON.stringify(f)), false); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(provider = "retell", signed = true) {
  const ws = new Socket();
  const deps = {
    verify: vi.fn(() => signed),
    lookup: vi.fn(async () => ({ id: "task", voiceProvider: provider })),
    publish: vi.fn(),
  };
  handleRetellPhoneMonitor(ws as any, deps as any);
  const streamSid = "MZ" + "1".repeat(32);
  ws.frame({ event: "start", start: { callSid: "CA" + "2".repeat(32), streamSid,
    customParameters: { taskId: "task", streamAuth: "signature" },
    mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 } } });
  return { ws, deps, streamSid };
}
describe("Retell native read-only telephone monitor", () => {
  it("routes both guest and Secretary mulaw to the owning task without creating a phone leg", async () => {
    const { ws, deps, streamSid } = setup(); await tick();
    for (const track of ["inbound", "outbound"]) ws.frame({ event: "media", streamSid,
      media: { track, payload: Buffer.alloc(160, 127).toString("base64") } });
    expect(deps.publish.mock.calls.map(c => [c[0], c[1].role])).toEqual([["task", "guest"], ["task", "secretary"]]);
    ws.frame({ event: "stop" });
  });
  it.each([["openai", true], ["retell", false]])("denies wrong provider or bad signature %s/%s", async (provider, signed) => {
    const { ws, deps } = setup(provider as string, signed as boolean); await tick();
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    expect(deps.publish).not.toHaveBeenCalled();
  });
  it("does not forward another stream's audio or malformed payloads", async () => {
    const { ws, deps, streamSid } = setup(); await tick();
    ws.frame({ event: "media", streamSid: "foreign", media: { track: "outbound", payload: "AAAA" } });
    expect(deps.publish).not.toHaveBeenCalled();
    ws.frame({ event: "media", streamSid, media: { track: "outbound", payload: "not base64!" } });
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid media");
  });
});
