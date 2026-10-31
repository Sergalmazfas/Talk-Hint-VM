import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ProductCrewSecretKey, type SecretKeyStore } from "./secretKey";
// Synthetic credentials, never project environment or production.
const fixture = "fixture_only_secret_".repeat(4);
function setup() {
  let secret: string | undefined = fixture;
  const disabled = new Set<string>();
  const used = new Map<string, string>();
  const store: SecretKeyStore = {
    status: vi.fn(async (owner, hash) => ({ disabled: disabled.has(owner + hash), lastUsedAt: used.get(owner + hash) ?? null })),
    use: vi.fn(async (owner, hash) => {
      if (disabled.has(owner + hash)) return false;
      used.set(owner + hash, new Date().toISOString()); return true;
    }),
    disable: vi.fn(async (owner, hash) => { disabled.add(owner + hash); }),
  };
  const key = new ProductCrewSecretKey(store, "owner", () => secret);
  return { key, store, set: (s: string | undefined) => { secret = s; } };
}
describe("Secrets credential, no plaintext persistence", () => {
  it("compares SHA256 digests, denies missing/wrong/malformed inputs and undersized configuration", async () => {
    const f = setup();
    for (const value of [undefined, "", "wrong", fixture.slice(1), "я".repeat(80), fixture + ",other"])
      await expect(f.key.authenticate(value)).rejects.toMatchObject({ status: 401 });
    expect(f.store.use).not.toHaveBeenCalled();
    expect(await f.key.authenticate(fixture)).toBe("owner");
    expect(f.store.use).toHaveBeenCalledWith("owner", createHash("sha256").update(fixture).digest("hex"));
    expect(JSON.stringify((f.store.use as any).mock.calls)).not.toContain(fixture);
    for (const config of [undefined, "", "short", "я".repeat(80)]) {
      f.set(config);
      expect(await f.key.status()).toEqual({ configured: false, disabled: false, lastUsedAt: null });
      await expect(f.key.authenticate(fixture)).rejects.toMatchObject({ status: 401 });
    }
  });
  it("disable persists across instances, rotation selects a new secret, reverting never re-enables old secret", async () => {
    const f = setup();
    await f.key.authenticate(fixture);
    await f.key.disable();
    expect(await f.key.status()).toMatchObject({ configured: true, disabled: true, lastUsedAt: expect.any(String) });
    await expect(new ProductCrewSecretKey(f.store, "owner", () => fixture).authenticate(fixture))
      .rejects.toMatchObject({ status: 401 });
    const next = fixture + "_next";
    f.set(next);
    expect(await f.key.status()).toEqual({ configured: true, disabled: false, lastUsedAt: null });
    expect(await f.key.authenticate(next)).toBe("owner");
    f.set(fixture);
    await expect(f.key.authenticate(fixture)).rejects.toMatchObject({ status: 401 });
  });
  it("fails closed without echoing storage messages or secrets", async () => {
    const fail = async () => { throw Error(`driver unsafe ${fixture}`); };
    const key = new ProductCrewSecretKey({ status: fail, use: fail, disable: fail }, "owner", () => fixture);
    for (const action of [() => key.status(), () => key.authenticate(fixture), () => key.disable()]) {
      await expect(action()).rejects.toMatchObject({ status: 503, message: "Product secret state unavailable" });
    }
  });
});
