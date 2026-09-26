import { afterEach, expect, it } from "vitest";
import { signSecretaryStream, verifySecretaryStream } from "./streamAuth";

const originalSecret = process.env.SESSION_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

it("binds each media credential to a task and provider CallSid", () => {
  process.env.SESSION_SECRET = "test-secret-not-for-production";
  const signature = signSecretaryStream("task-a", "CA123");
  expect(verifySecretaryStream("task-a", "CA123", signature)).toBe(true);
  expect(verifySecretaryStream("task-b", "CA123", signature)).toBe(false);
  expect(verifySecretaryStream("task-a", "CA456", signature)).toBe(false);
  expect(verifySecretaryStream("task-a", "CA123", "bad")).toBe(false);
  delete process.env.SESSION_SECRET;
  expect(verifySecretaryStream("task-a", "CA123", signature)).toBe(false);
});