import { beforeEach, afterEach, it, expect, vi } from "vitest";
const api = vi.hoisted(() => ({ update: vi.fn(), fetch: vi.fn(), calls: vi.fn() }));
vi.mock("twilio", () => ({ default: () => ({ calls: api.calls }) }));
import { hangupSecretaryCall } from "./dialer";
beforeEach(() => {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "test-account"); vi.stubEnv("TWILIO_AUTH_TOKEN", "test-only");
  api.update.mockReset(); api.fetch.mockReset(); api.calls.mockReset();
  api.calls.mockReturnValue({ update: api.update, fetch: api.fetch });
});
afterEach(() => vi.unstubAllEnvs());
it("ends only the supplied call SID without creating another call", async () => {
  api.update.mockResolvedValue({ status: "completed" });
  await hangupSecretaryCall("CA-owned");
  expect(api.calls).toHaveBeenCalledWith("CA-owned");
  expect(api.update).toHaveBeenCalledWith({ status: "completed" });
  expect(api.fetch).not.toHaveBeenCalled();
});
it.each(["completed", "ongoing", "missing", "wrong-call"])("handles an End retry only with same-call provider evidence (%s)", async status => {
  const failure = new Error("update unavailable");
  api.update.mockRejectedValue(failure);
  if (status === "missing") api.fetch.mockRejectedValue(new Error("404"));
  else api.fetch.mockResolvedValue({ sid: status === "wrong-call" ? "CA-other" : "CA-owned", status });
  if (status === "completed") await expect(hangupSecretaryCall("CA-owned")).resolves.toBeUndefined();
  else await expect(hangupSecretaryCall("CA-owned")).rejects.toBe(failure);
});
