import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Coverage for the one-time user provisioning bootstrap
// (server/provisionUser.ts). The production DB can't be written from agent
// tooling, so the running server creates the account + assigns a number on
// startup from the ADMIN_PROVISION_USER secret. Behaviours that matter:
//   - absent / malformed / incomplete secret is a no-op
//   - happy path: creates user, sets plan=basic, assigns the first free number
//   - idempotent: existing user with a number is left untouched
//   - falls through to the next candidate when a number is already taken
//
// `../storage` is mocked so no pg pool is needed. `registerUser` is the real
// one (it calls storage.getUserByEmail + storage.createUser, both mocked).
// ---------------------------------------------------------------------------

const storageMock = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  getUserPhoneNumbers: vi.fn(),
  getAvailableNumbers: vi.fn(),
  assignNumber: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

const { provisionUserOnStartup } = await import("../provisionUser");

const SECRET = JSON.stringify({
  email: "leo@talkhint.app",
  password: "Leo123456!",
  name: "Leo",
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_PROVISION_USER;
});

afterEach(() => {
  delete process.env.ADMIN_PROVISION_USER;
});

describe("provisionUserOnStartup", () => {
  it("is a no-op when the secret is absent", async () => {
    await provisionUserOnStartup();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
  });

  it("is a no-op when the secret is not valid JSON", async () => {
    process.env.ADMIN_PROVISION_USER = "leo@talkhint.app:Leo123456!";
    await provisionUserOnStartup();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
  });

  it("is a no-op when email or password is missing", async () => {
    process.env.ADMIN_PROVISION_USER = JSON.stringify({ email: "leo@talkhint.app" });
    await provisionUserOnStartup();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
  });

  it("creates the user, sets plan=basic, and assigns the first free number", async () => {
    process.env.ADMIN_PROVISION_USER = SECRET;
    storageMock.getUserByEmail.mockResolvedValue(undefined); // not found -> create
    storageMock.createUser.mockImplementation(async (u: any) => ({
      id: "u-leo",
      plan: "free",
      ...u,
    }));
    storageMock.updateUser.mockImplementation(async (_id: string, patch: any) => ({
      id: "u-leo",
      email: "leo@talkhint.app",
      plan: patch.plan,
    }));
    storageMock.getUserPhoneNumbers.mockResolvedValue([]);
    storageMock.getAvailableNumbers.mockResolvedValue([
      { id: "n1", twilioNumber: "+15550000001" },
      { id: "n2", twilioNumber: "+15550000002" },
    ]);
    storageMock.assignNumber.mockResolvedValue({ twilioNumber: "+15550000001" });

    await provisionUserOnStartup();

    // user created with a hashed password (never the plaintext)
    expect(storageMock.createUser).toHaveBeenCalledTimes(1);
    expect(storageMock.createUser.mock.calls[0][0].email).toBe("leo@talkhint.app");
    expect(storageMock.createUser.mock.calls[0][0].password).not.toBe("Leo123456!");
    // plan upgraded so a number can attach
    expect(storageMock.updateUser).toHaveBeenCalledWith("u-leo", { plan: "employee" });
    // first candidate claimed with the given name
    expect(storageMock.assignNumber).toHaveBeenCalledWith("n1", "u-leo", "Leo", "personal");
  });

  it("upgrades plan and assigns a number for an existing free-plan user with none", async () => {
    process.env.ADMIN_PROVISION_USER = SECRET;
    storageMock.getUserByEmail.mockResolvedValue({ id: "u-leo", plan: "free" });
    storageMock.updateUser.mockResolvedValue({ id: "u-leo", plan: "basic" });
    storageMock.getUserPhoneNumbers.mockResolvedValue([]);
    storageMock.getAvailableNumbers.mockResolvedValue([
      { id: "n1", twilioNumber: "+15550000001" },
    ]);
    storageMock.assignNumber.mockResolvedValue({ twilioNumber: "+15550000001" });

    await provisionUserOnStartup();

    expect(storageMock.createUser).not.toHaveBeenCalled();
    expect(storageMock.updateUser).toHaveBeenCalledWith("u-leo", { plan: "employee" });
    expect(storageMock.assignNumber).toHaveBeenCalledWith("n1", "u-leo", "Leo", "personal");
  });

  it("does not create or assign when the user already has a number", async () => {
    process.env.ADMIN_PROVISION_USER = SECRET;
    storageMock.getUserByEmail.mockResolvedValue({ id: "u-leo", plan: "basic" });
    storageMock.getUserPhoneNumbers.mockResolvedValue([{ id: "p1" }]);

    await provisionUserOnStartup();

    expect(storageMock.createUser).not.toHaveBeenCalled();
    expect(storageMock.updateUser).not.toHaveBeenCalled();
    expect(storageMock.assignNumber).not.toHaveBeenCalled();
  });

  it("falls through to the next candidate when the first number is already taken", async () => {
    process.env.ADMIN_PROVISION_USER = SECRET;
    storageMock.getUserByEmail.mockResolvedValue({ id: "u-leo", plan: "basic" });
    storageMock.getUserPhoneNumbers.mockResolvedValue([]);
    storageMock.getAvailableNumbers.mockResolvedValue([
      { id: "n1", twilioNumber: "+15550000001" },
      { id: "n2", twilioNumber: "+15550000002" },
    ]);
    storageMock.assignNumber
      .mockRejectedValueOnce(new Error("Number not available"))
      .mockResolvedValueOnce({ twilioNumber: "+15550000002" });

    await provisionUserOnStartup();

    expect(storageMock.assignNumber).toHaveBeenCalledTimes(2);
    expect(storageMock.assignNumber).toHaveBeenLastCalledWith("n2", "u-leo", "Leo", "personal");
  });
});
