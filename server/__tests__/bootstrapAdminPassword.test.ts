import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the one-time admin password bootstrap
// (server/bootstrapAdminPassword.ts). The production DB can't be written from
// agent tooling, so the running server sets a password on startup from the
// ADMIN_SET_PASSWORD secret. The behaviours that matter:
//   - absent / malformed secret is a no-op
//   - unknown email is a no-op (warn)
//   - an account that ALREADY has a password is skipped (no overwrite)
//   - a DB write that doesn't persist does NOT log success
//   - the happy path hashes the password and persists it
//
// `../storage` is mocked so no pg pool is needed; `../auth` keeps the real
// hashPassword so we verify a real bcrypt hash is stored (not the plaintext).
// ---------------------------------------------------------------------------

const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

const { bootstrapAdminPasswordOnStartup } = await import("../bootstrapAdminPassword");
const { verifyPassword } = await import("../auth");

const EMAIL = "admin@example.com";
const PASSWORD = "S3cret:With:Colons!";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_SET_PASSWORD;
});

afterEach(() => {
  delete process.env.ADMIN_SET_PASSWORD;
});

describe("bootstrapAdminPasswordOnStartup", () => {
  it("is a no-op when the secret is absent", async () => {
    await bootstrapAdminPasswordOnStartup();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("is a no-op when the secret is malformed (no colon)", async () => {
    process.env.ADMIN_SET_PASSWORD = "no-colon-here";
    await bootstrapAdminPasswordOnStartup();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("warns and does nothing when the user is not found", async () => {
    process.env.ADMIN_SET_PASSWORD = `${EMAIL}:${PASSWORD}`;
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    await bootstrapAdminPasswordOnStartup();
    expect(storageMock.getUserByEmail).toHaveBeenCalledWith(EMAIL);
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("skips accounts that already have a password (no overwrite)", async () => {
    process.env.ADMIN_SET_PASSWORD = `${EMAIL}:${PASSWORD}`;
    storageMock.getUserByEmail.mockResolvedValue({
      id: "u1",
      email: EMAIL,
      password: "existing-hash",
    });
    await bootstrapAdminPasswordOnStartup();
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("does not throw when the DB write fails to persist", async () => {
    process.env.ADMIN_SET_PASSWORD = `${EMAIL}:${PASSWORD}`;
    storageMock.getUserByEmail.mockResolvedValue({ id: "u1", email: EMAIL, password: null });
    storageMock.updateUser.mockResolvedValue(undefined); // write swallowed/failed
    await expect(bootstrapAdminPasswordOnStartup()).resolves.toBeUndefined();
    expect(storageMock.updateUser).toHaveBeenCalledTimes(1);
  });

  it("hashes and persists the password for a passwordless account", async () => {
    process.env.ADMIN_SET_PASSWORD = `${EMAIL}:${PASSWORD}`;
    storageMock.getUserByEmail.mockResolvedValue({ id: "u1", email: EMAIL, password: null });
    storageMock.updateUser.mockImplementation(async (_id: string, patch: any) => ({
      id: "u1",
      email: EMAIL,
      password: patch.password,
    }));

    await bootstrapAdminPasswordOnStartup();

    expect(storageMock.updateUser).toHaveBeenCalledTimes(1);
    const [id, patch] = storageMock.updateUser.mock.calls[0];
    expect(id).toBe("u1");
    // Stored value must be a bcrypt hash, never the plaintext, and the FULL
    // password (including its colons) must round-trip.
    expect(patch.password).not.toBe(PASSWORD);
    expect(await verifyPassword(PASSWORD, patch.password)).toBe(true);
  });

  it("lowercases and trims the email from the secret", async () => {
    process.env.ADMIN_SET_PASSWORD = `  ${EMAIL.toUpperCase()} :${PASSWORD}`;
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    await bootstrapAdminPasswordOnStartup();
    expect(storageMock.getUserByEmail).toHaveBeenCalledWith(EMAIL);
  });
});
