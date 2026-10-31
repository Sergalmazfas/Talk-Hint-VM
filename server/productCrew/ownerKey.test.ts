import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { equalCsrf, OWNER_KEY_TTL_MS, pgOwnerKeyStore, ProductCrewOwnerKey,
  type OwnerKeyStatus, type OwnerKeyStore } from "./ownerKey";

export class MemoryOwnerKeys implements OwnerKeyStore {
  row: { owner: string; hash: string; created: number; expires: number; lastUsed: number | null } | null = null;
  async rotate(owner: string, hash: string, expires: Date) {
    this.row = { owner, hash, created: Date.now(), expires: expires.getTime(), lastUsed: null };
    return (await this.status(owner))!;
  }
  async status(owner: string): Promise<OwnerKeyStatus | null> {
    const r = this.row;
    return !r || r.owner !== owner || r.expires <= Date.now() ? null : {
      createdAt: new Date(r.created).toISOString(), expiresAt: new Date(r.expires).toISOString(),
      lastUsedAt: r.lastUsed === null ? null : new Date(r.lastUsed).toISOString(),
    };
  }
  async revoke(owner: string) { if (this.row?.owner === owner) this.row.expires = 0; }
  async use(owner: string, hash: string) {
    const r = this.row;
    if (!r || r.owner !== owner || r.hash !== hash || r.expires <= Date.now()) return false;
    r.lastUsed = Date.now(); return true;
  }
}

describe("production MCP owner key", () => {
  it("issues 256-bit opaque keys for exactly 90 days, persisting only a hash and metadata", async () => {
    const store = new MemoryOwnerKeys(), keys = new ProductCrewOwnerKey(store, "owner");
    const before = Date.now(), issued = await keys.create(), after = Date.now();
    expect(issued.key).toMatch(/^thpk_[A-Za-z0-9_-]{43}$/);
    expect(store.row!.hash).toBe(createHash("sha256").update(issued.key).digest("hex"));
    expect(JSON.stringify(store)).not.toContain(issued.key);
    expect(Date.parse(issued.status.expiresAt)).toBeGreaterThanOrEqual(before + OWNER_KEY_TTL_MS);
    expect(Date.parse(issued.status.expiresAt)).toBeLessThanOrEqual(after + OWNER_KEY_TTL_MS);
    expect(issued.status.lastUsedAt).toBe(null);
    expect(await keys.authenticate(issued.key)).toBe("owner");
    const status = await keys.status();
    expect(status?.lastUsedAt).not.toBe(null);
    expect(Object.keys(status!)).toEqual(["createdAt", "expiresAt", "lastUsedAt"]);
    expect(JSON.stringify(status)).not.toContain(issued.key);
    expect(JSON.stringify(status)).not.toContain(store.row!.hash);
  });
  it("rotation leaves one active key; old, forged, expired and revoked keys fail", async () => {
    const store = new MemoryOwnerKeys(), keys = new ProductCrewOwnerKey(store, "owner");
    const first = await keys.create(), second = await keys.create();
    expect(first.key).not.toBe(second.key);
    for (const raw of [undefined, "", first.key, `thpk_${"x".repeat(43)}`, "Bearer " + second.key, second.key + ",another"]) {
      await expect(keys.authenticate(raw)).rejects.toMatchObject({ status: 401 });
    }
    expect(await keys.authenticate(second.key)).toBe("owner");
    store.row!.expires = Date.now();
    await expect(keys.authenticate(second.key)).rejects.toMatchObject({ status: 401 });
    const third = await keys.create();
    await keys.revoke();
    await expect(keys.authenticate(third.key)).rejects.toMatchObject({ status: 401 });
    expect(await keys.status()).toBe(null);
  });
  it("does not authenticate a key against another owner", async () => {
    const store = new MemoryOwnerKeys(), own = new ProductCrewOwnerKey(store, "owner");
    const { key } = await own.create();
    await expect(new ProductCrewOwnerKey(store, "other").authenticate(key)).rejects.toMatchObject({ status: 401 });
  });
  it("validates CSRF length and compares equal length tokens without plaintext equality", () => {
    expect(equalCsrf("a".repeat(64), "a".repeat(64))).toBe(true);
    for (const pair of [[undefined, undefined], ["", ""], ["a", "a"],
      ["я".repeat(64), "a".repeat(64)], ["a".repeat(64), "b".repeat(64)]])
      expect(equalCsrf(pair[0], pair[1])).toBe(false);
  });
});

describe("hash-only PostgreSQL marker storage (SQL contract)", () => {
  function fixture(failInsert = false) {
    const query = vi.fn(async (sql: string, _params: any[] = []) => {
      if (sql.startsWith("INSERT INTO sessions(id,user_id,expires_at)") && failInsert) throw Error("fixture failure");
      return { rows: sql.includes("RETURNING") ? [{ created_at: new Date(), expires_at: new Date(Date.now() + OWNER_KEY_TTL_MS) }]
        : sql.startsWith("SELECT expires_at") ? [{ expires_at: new Date(Date.now() + OWNER_KEY_TTL_MS) }] : [] };
    });
    const release = vi.fn(), connect = vi.fn(async () => ({ query, release }));
    const pool = { connect, query } as unknown as Pool;
    return { store: pgOwnerKeyStore(async () => pool), query, release };
  }
  it("rotation serializes all owner keys and expires only its namespaced markers in one transaction", async () => {
    const f = fixture(), keys = new ProductCrewOwnerKey(f.store, "owner");
    const issued = await keys.create();
    const calls = f.query.mock.calls;
    expect(calls[0][0]).toBe("BEGIN");
    expect(calls[1][0]).toContain("pg_advisory_xact_lock");
    expect(calls[2][0]).toContain("user_id=$1");
    expect(calls[2][1]).toEqual(["owner", "productcrew:ownerkey:%", "productcrew:ownerkey-use:%"]);
    expect(calls.at(-1)![0]).toBe("COMMIT");
    expect(JSON.stringify(calls)).not.toContain(issued.key);
    expect(JSON.stringify(calls)).not.toMatch(/DELETE|ALTER TABLE|CREATE TABLE/);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("failed rotation rolls back old-key revocation; connection is released", async () => {
    const f = fixture(true);
    await expect(new ProductCrewOwnerKey(f.store, "owner").create()).rejects.toThrow("fixture failure");
    expect(f.query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
  });
  it("successful use and revoke share the rotation lock, expiry and owner checks", async () => {
    const f = fixture();
    expect(await f.store.use("owner", "hash-only")).toBe(true);
    expect(f.query.mock.calls[1][0]).toContain("pg_advisory_xact_lock");
    expect(f.query.mock.calls[2][0]).toContain("user_id=$2 AND expires_at>NOW() FOR UPDATE");
    expect(f.query.mock.calls[2][1]).toEqual(["productcrew:ownerkey:hash-only", "owner"]);
    expect(f.query.mock.calls[3][0]).toContain("created_at=NOW()");
    expect(f.query.mock.calls[3][1][0]).toBe("productcrew:ownerkey-use:hash-only");
    f.query.mockClear();
    await f.store.revoke("owner");
    expect(f.query.mock.calls[1][0]).toContain("pg_advisory_xact_lock");
    expect(f.query.mock.calls[2][1]).toEqual(["owner", "productcrew:ownerkey:%", "productcrew:ownerkey-use:%"]);
  });
});
