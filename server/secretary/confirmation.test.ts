import { afterEach, expect, it, vi } from "vitest";
import { signSecretaryConfirmation, verifySecretaryConfirmation } from "./confirmation";

const originalSecret = process.env.SESSION_SECRET;
afterEach(() => {
  vi.useRealTimers();
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

it("accepts only the same owner and confirmed assignment within the review window", () => {
  process.env.SESSION_SECRET = "test-secret-not-for-production";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  const token = signSecretaryConfirmation("owner-1", "Ask when the hotel will reply");
  expect(verifySecretaryConfirmation(token, "owner-1", "Ask when the hotel will reply")).toBe(true);
  expect(verifySecretaryConfirmation(token, "owner-2", "Ask when the hotel will reply")).toBe(false);
  expect(verifySecretaryConfirmation(token, "owner-1", "Change my booking")).toBe(false);
  vi.setSystemTime(new Date("2026-09-26T12:16:00Z"));
  expect(verifySecretaryConfirmation(token, "owner-1", "Ask when the hotel will reply")).toBe(false);
});