import { describe, expect, it, vi } from "vitest";
import { acquireAndReserveLiveSession, clearScheduledAudio, closeLocalResources, ResponseAudioGuard, playbackTotals } from "./incoming-secretary-dev-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] }, stop };
}

describe("incoming dev bench start/stop lifecycle", () => {
  it("counts already-finished audio when reporting interruption playback position",()=>{
    const completed=new Map([["r",0.4]]);
    const totals=playbackTotals([{responseId:"r",startsAt:1,duration:0.3},{responseId:"next",startsAt:2,duration:0.5}],completed,1.2);
    expect(totals.get("r")).toBeCloseTo(0.6);
    expect(totals.get("next")).toBe(0);
    expect(completed.get("r")).toBe(0.4);
  });
  it("stops a late microphone grant and never reserves after Start was cancelled", async () => {
    const permission = deferred<ReturnType<typeof fakeStream>["stream"]>();
    const { stream, stop } = fakeStream();
    let current = true;
    const reserve = vi.fn(async () => ({ sessionId: "session-a", requestId: "request-a" }));
    const started = acquireAndReserveLiveSession({
      getMedia: () => permission.promise,
      reserve,
      isCurrent: () => current,
      onStream: vi.fn(),
      onSession: vi.fn(),
      stopReserved: vi.fn(async () => undefined),
    });
    current = false;
    permission.resolve(stream);
    expect(await started).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("closes a reserved server session if Stop wins while the reservation request is pending", async () => {
    const { stream, stop } = fakeStream();
    const reservation = deferred<{ sessionId: string; requestId: string }>();
    let current = true;
    let liveStream: typeof stream | null = null;
    const socketClose = vi.fn();
    const contextClose = vi.fn(async () => undefined);
    const mockFetch = vi.fn(async () => ({ ok: true }));
    const started = acquireAndReserveLiveSession({
      getMedia: async () => stream,
      reserve: () => reservation.promise,
      isCurrent: () => current,
      onStream: (received) => { liveStream = received; },
      onSession: vi.fn(),
      stopReserved: async (session) => {
        await mockFetch(`/api/incoming-secretary/dev/sessions/${session.sessionId}/stop`);
      },
    });
    await Promise.resolve();
    current = false;
    closeLocalResources(liveStream, { close: socketClose }, { state: "running", close: contextClose });
    expect(stop).toHaveBeenCalled();
    expect(socketClose).toHaveBeenCalledOnce();
    expect(contextClose).toHaveBeenCalledOnce();
    reservation.resolve({ sessionId: "session-late", requestId: "request-late" });
    expect(await started).toBeNull();
    expect(stop).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith("/api/incoming-secretary/dev/sessions/session-late/stop");
  });

  it("clears every scheduled source and rejects late audio for a cleared response", () => {
    const guard = new ResponseAudioGuard();
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const queue = [
      { responseId: "reply-1", source: { stop: firstStop } },
      { responseId: "reply-1", source: { stop: secondStop } },
    ];
    expect(guard.accept("reply-1")).toBe(true);
    clearScheduledAudio(queue, guard, "reply-1");
    expect(queue).toHaveLength(0);
    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
    expect(guard.accept("reply-1")).toBe(false);
    expect(guard.accept("reply-2")).toBe(true);
  });

  it("closes mic tracks, socket, and audio context on local Stop/unmount", () => {
    const { stream, stop } = fakeStream();
    const socketClose = vi.fn();
    const contextClose = vi.fn(async () => undefined);
    closeLocalResources(stream, { close: socketClose }, { state: "running", close: contextClose });
    expect(stop).toHaveBeenCalledOnce();
    expect(socketClose).toHaveBeenCalledOnce();
    expect(contextClose).toHaveBeenCalledOnce();
  });
});
