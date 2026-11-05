import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RehearsalAudio } from "./audio";
describe("private two-sided rehearsal recording", () => {
  beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", ""); });
  afterEach(() => vi.unstubAllEnvs());
  const row = () => ({ id: "r", report: { callId: "call-owner", status: "ended", rehearsal: { audio: { status: "pending" } } } } as any);
  it("never treats a mono/missing recording as both sides", async () => {
    const store: any = { uploadFromBytes: vi.fn() }, net = vi.fn();
    const a = new RehearsalAudio(store, net), r = row();
    await a.capture("owner", r, { request: vi.fn().mockResolvedValue({ call_id: "call-owner", call_type: "web_call",
      recording_url: "https://example.com/mono" }) });
    expect(r.report.rehearsal.audio.status).toBe("pending");
    expect(store.uploadFromBytes).not.toHaveBeenCalled(); expect(net).not.toHaveBeenCalled();
  });
  it.each(["http://127.0.0.1/audio", "https://localhost/audio", "https://evil.test/audio"])("rejects provider URL outside recording hosts: %s", url => {
    const net = vi.fn(); const a = new RehearsalAudio({} as any, net);
    return expect(a.capture("owner", row(), { request: vi.fn().mockResolvedValue({ call_id: "call-owner", call_type: "web_call",
      recording_multi_channel_url: url }) })).rejects.toThrow("HOST_NOT_ALLOWED");
  });
  it("never records a phone call or another provider call", async () => {
    const a = new RehearsalAudio({} as any, vi.fn());
    await expect(a.capture("owner", row(), { request: vi.fn().mockResolvedValue({ call_id: "other", call_type: "phone_call" }) }))
      .rejects.toThrow("IDENTITY_MISMATCH");
  });
  it("copies provider stereo into private storage and returns only an authorized local URL", async () => {
    const storage: any = { uploadFromBytes: vi.fn().mockResolvedValue({ ok: true }) };
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }));
    const a = new RehearsalAudio(storage, fetcher), r = row();
    await a.capture("owner", r, { request: vi.fn().mockResolvedValue({ call_id: "call-owner", call_type: "web_call",
      recording_multi_channel_url: "https://audio.retellai.com/stereo?capability=private" }) });
    expect(storage.uploadFromBytes).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(JSON.stringify(r)).not.toContain("capability");
    expect(r.report.rehearsal.audio.url).toBe("/api/admin/rehearsal/sessions/r/audio");
    await a.capture("owner", r, {} as any); expect(fetcher).toHaveBeenCalledOnce();
  });
});
