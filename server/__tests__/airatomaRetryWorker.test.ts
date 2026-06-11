import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// End-to-end coverage for the AirAtoma retry-queue ORCHESTRATION
// (server/airatomaRetryWorker.ts). The pure pieces (backoff curve, give-up
// decision) are unit-tested elsewhere; here we tie them to the database + the
// network call with BOTH mocked, so a regression that quietly breaks recovery
// after an AirAtoma outage is caught:
//   - a successful immediate send marks the row "delivered"
//   - a failed attempt leaves the row "pending" with the next retry pushed out
//     by the backoff curve
//   - the row is marked "failed" only once the max attempt budget is reached
//   - the background poller processes every due row and records each outcome
//
// `../storage` is mocked so no pg pool is needed; `fetch` is stubbed so the real
// attemptAirAtomaPost runs without touching the network.
// ---------------------------------------------------------------------------

const storageMock = vi.hoisted(() => ({
  enqueueAirAtomaDelivery: vi.fn(),
  getDueAirAtomaDeliveries: vi.fn(),
  markAirAtomaDeliverySucceeded: vi.fn(),
  markAirAtomaDeliveryRetry: vi.fn(),
  markAirAtomaDeliveryFailed: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

const { deliverCallToAirAtoma, processDueAirAtomaDeliveries } = await import("../airatomaRetryWorker");
const { MAX_AIRATOMA_ATTEMPTS, airAtomaBackoffMs } = await import("../airatomaWebhook");

// Each user supplies their own personal AirAtoma URL — there is no server-wide
// fallback, so every delivery (immediate or retried) carries an explicit target.
const TARGET_URL = "https://airatoma.example.com/api/talkhint/webhook/abc123";
const noopLogger = () => {};

function callInput(callId: string) {
  return {
    callId,
    transcript: [
      { speaker: "Owner", text: "hello" },
      { speaker: "Guest", text: "hi there" },
    ],
    callerName: "Bob",
    durationSecs: 12,
    targetUrl: TARGET_URL,
  } as any;
}

function pendingRow(id: string, attempts: number, callId = id) {
  return {
    id,
    attempts,
    targetUrl: TARGET_URL,
    payload: { callId, transcript: "Owner: hello", callerName: "Bob", durationSecs: 12 },
  } as any;
}

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deliverCallToAirAtoma (call-end immediate send)", () => {
  it("marks the delivery delivered when the immediate send succeeds", async () => {
    storageMock.enqueueAirAtomaDelivery.mockResolvedValue(pendingRow("row1", 0));
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await deliverCallToAirAtoma(callInput("row1"), noopLogger);

    // Persisted before sending, then attempted exactly once.
    expect(storageMock.enqueueAirAtomaDelivery).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Outcome recorded as delivered (attempt #1), never retry/failed.
    expect(storageMock.markAirAtomaDeliverySucceeded).toHaveBeenCalledWith("row1", 1);
    expect(storageMock.markAirAtomaDeliveryRetry).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryFailed).not.toHaveBeenCalled();
  });

  it("leaves the row pending with the next retry pushed out by backoff on failure", async () => {
    storageMock.enqueueAirAtomaDelivery.mockResolvedValue(pendingRow("row2", 0));
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const before = Date.now();
    await deliverCallToAirAtoma(callInput("row2"), noopLogger);
    const after = Date.now();

    expect(storageMock.markAirAtomaDeliverySucceeded).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryFailed).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryRetry).toHaveBeenCalledTimes(1);

    const [id, attempts, nextAttemptAt, error] = storageMock.markAirAtomaDeliveryRetry.mock.calls[0];
    expect(id).toBe("row2");
    expect(attempts).toBe(1);
    expect(error).toBe("http_500");
    // nextAttemptAt is now + backoff(1); allow for the time the call itself took.
    const expectedDelay = airAtomaBackoffMs(1);
    const actualDelay = (nextAttemptAt as Date).getTime() - before;
    expect(actualDelay).toBeGreaterThanOrEqual(expectedDelay - 50);
    expect(actualDelay).toBeLessThanOrEqual(expectedDelay + (after - before) + 50);
  });

  it("retries (not fails) while attempts remain, and fails only at the max", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    // One attempt short of the cap: still a retry.
    storageMock.enqueueAirAtomaDelivery.mockResolvedValue(pendingRow("row3", MAX_AIRATOMA_ATTEMPTS - 2));
    await deliverCallToAirAtoma(callInput("row3"), noopLogger);
    expect(storageMock.markAirAtomaDeliveryRetry).toHaveBeenCalledTimes(1);
    expect(storageMock.markAirAtomaDeliveryRetry.mock.calls[0][1]).toBe(MAX_AIRATOMA_ATTEMPTS - 1);
    expect(storageMock.markAirAtomaDeliveryFailed).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // The attempt that reaches the cap: gives up.
    storageMock.enqueueAirAtomaDelivery.mockResolvedValue(pendingRow("row3", MAX_AIRATOMA_ATTEMPTS - 1));
    await deliverCallToAirAtoma(callInput("row3"), noopLogger);
    expect(storageMock.markAirAtomaDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(storageMock.markAirAtomaDeliveryFailed).toHaveBeenCalledWith("row3", MAX_AIRATOMA_ATTEMPTS, "http_503");
    expect(storageMock.markAirAtomaDeliveryRetry).not.toHaveBeenCalled();
  });

  it("does NOT fall back to AIRATOMA_WEBHOOK_URL when the user has no personal URL", async () => {
    // Regression guard: even with the legacy env var set, a call whose owner has
    // no personal URL must not be delivered (no global catch-all = no cross-user leak).
    process.env.AIRATOMA_WEBHOOK_URL = "https://operator-global.example.com/hook";
    try {
      const fetchMock = stubFetch();

      await deliverCallToAirAtoma({ ...callInput("noTarget"), targetUrl: null }, noopLogger);

      expect(storageMock.enqueueAirAtomaDelivery).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.AIRATOMA_WEBHOOK_URL;
    }
  });

  it("does a one-shot best-effort send (no recordAttempt) when the row cannot be persisted", async () => {
    storageMock.enqueueAirAtomaDelivery.mockResolvedValue(undefined);
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await deliverCallToAirAtoma(callInput("rowX"), noopLogger);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storageMock.markAirAtomaDeliverySucceeded).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryRetry).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryFailed).not.toHaveBeenCalled();
  });
});

describe("processDueAirAtomaDeliveries (background poller)", () => {
  it("processes every due row and records its own outcome", async () => {
    storageMock.getDueAirAtomaDeliveries.mockResolvedValue([
      pendingRow("ok1", 0),
      pendingRow("fail1", 0),
      pendingRow("giveup1", MAX_AIRATOMA_ATTEMPTS - 1),
    ]);
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 }) // ok1 -> delivered
      .mockResolvedValueOnce({ ok: false, status: 500 }) // fail1 -> retry
      .mockResolvedValueOnce({ ok: false, status: 500 }); // giveup1 -> failed

    const before = Date.now();
    const attempted = await processDueAirAtomaDeliveries(noopLogger);

    expect(attempted).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Poller pulls a bounded batch (never an unbounded scan).
    expect(storageMock.getDueAirAtomaDeliveries).toHaveBeenCalledTimes(1);
    expect(storageMock.getDueAirAtomaDeliveries.mock.calls[0][0]).toBeGreaterThan(0);
    expect(storageMock.markAirAtomaDeliverySucceeded).toHaveBeenCalledWith("ok1", 1);
    expect(storageMock.markAirAtomaDeliveryRetry).toHaveBeenCalledTimes(1);
    // The retried row is rescheduled with the right attempt count + backoff window.
    const [retryId, retryAttempts, retryNextAt, retryErr] = storageMock.markAirAtomaDeliveryRetry.mock.calls[0];
    expect(retryId).toBe("fail1");
    expect(retryAttempts).toBe(1);
    expect(retryErr).toBe("http_500");
    expect((retryNextAt as Date).getTime()).toBeGreaterThanOrEqual(before + airAtomaBackoffMs(1) - 50);
    expect(storageMock.markAirAtomaDeliveryFailed).toHaveBeenCalledWith(
      "giveup1",
      MAX_AIRATOMA_ATTEMPTS,
      "http_500",
    );
  });

  it("recovers a previously-failing row once AirAtoma comes back", async () => {
    // Same row had failed before (attempts already at 3); now the send succeeds.
    storageMock.getDueAirAtomaDeliveries.mockResolvedValue([pendingRow("recover1", 3)]);
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const attempted = await processDueAirAtomaDeliveries(noopLogger);

    expect(attempted).toBe(1);
    expect(storageMock.markAirAtomaDeliverySucceeded).toHaveBeenCalledWith("recover1", 4);
    expect(storageMock.markAirAtomaDeliveryRetry).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryFailed).not.toHaveBeenCalled();
  });

  it("skips rows whose destination URL is missing/invalid without burning an attempt", async () => {
    // A row with no personal URL (e.g. the user cleared it) is left untouched.
    storageMock.getDueAirAtomaDeliveries.mockResolvedValue([
      { ...pendingRow("noUrl", 0), targetUrl: null },
    ]);
    const fetchMock = stubFetch();

    const attempted = await processDueAirAtomaDeliveries(noopLogger);

    expect(attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliverySucceeded).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryRetry).not.toHaveBeenCalled();
    expect(storageMock.markAirAtomaDeliveryFailed).not.toHaveBeenCalled();
  });
});
