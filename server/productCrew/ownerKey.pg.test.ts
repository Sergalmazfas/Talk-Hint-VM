import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { Pool } from "pg";
import { pgOwnerKeyStore, ProductCrewOwnerKey } from "./ownerKey";
import { pgSecretKeyStore, ProductCrewSecretKey } from "./secretKey";

// Opt-in: starts a disposable local PostgreSQL, NEVER the app's database.
// No DATABASE_URL, credentials, migrations or application state are read.
const enabled = process.env.RUN_LOCAL_PRODUCT_KEY_PG_TEST === "1";
describe.skipIf(!enabled)("owner key: real, isolated PostgreSQL concurrency", () => {
  let pool: Pool, directory: string, started = false;
  let keys: ProductCrewOwnerKey;
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const run = (file: string, args: string[]) => execFileSync(file, args, { env, stdio: "pipe", timeout: 20000 });
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "talkhint-key-pg-"));
    const port = await new Promise<number>(resolve => {
      const socket = net.createServer();
      socket.listen(0, "127.0.0.1", () => {
        const selected = (socket.address() as net.AddressInfo).port;
        socket.close(() => resolve(selected));
      });
    });
    run("initdb", ["-D", join(directory, "data"), "-A", "trust", "-U", "key_fixture", "--no-locale"]);
    run("pg_ctl", ["-D", join(directory, "data"), "-l", join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -p ${port} -k ${directory}`, "-w", "start"]);
    started = true;
    pool = new Pool({ host: "127.0.0.1", port, user: "key_fixture", database: "postgres", max: 12 });
    await pool.query(`CREATE TABLE sessions(id varchar PRIMARY KEY, user_id varchar NOT NULL,
      expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT NOW())`);
    keys = new ProductCrewOwnerKey(pgOwnerKeyStore(async () => pool), "fixture-owner");
  }, 40000);
  afterAll(async () => {
    await pool?.end();
    if (started) run("pg_ctl", ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"]);
  });
  it("simultaneous rotations leave exactly one active hash; the other 19 keys cannot authenticate", async () => {
    const issued = await Promise.all(Array.from({ length: 20 }, () => keys.create()));
    const results = await Promise.all(issued.map(async ({ key }) => {
      try { return await keys.authenticate(key); } catch { return null; }
    }));
    expect(results.filter(Boolean)).toEqual(["fixture-owner"]);
    const { rows } = await pool.query(`SELECT id FROM sessions
      WHERE user_id=$1 AND id LIKE 'productcrew:ownerkey:%' AND expires_at>NOW()`, ["fixture-owner"]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/thpk_/);
    expect(await keys.status()).toMatchObject({ lastUsedAt: expect.any(String) });
  });
  it("checks the owner and database expiry, preserves unrelated sessions and never stores raw keys", async () => {
    const { key } = await keys.create();
    const alien = new ProductCrewOwnerKey(pgOwnerKeyStore(async () => pool), "other-owner");
    await expect(alien.authenticate(key)).rejects.toMatchObject({ status: 401 });
    await pool.query(`INSERT INTO sessions(id,user_id,expires_at) VALUES
      ('fixture-login','fixture-owner',NOW()+interval '1 day'),
      ('productcrew:grant:fixture','fixture-owner',NOW()+interval '1 day')`);
    await keys.revoke();
    await expect(keys.authenticate(key)).rejects.toMatchObject({ status: 401 });
    const { rows } = await pool.query("SELECT * FROM sessions");
    expect(rows.filter(r => ["fixture-login", "productcrew:grant:fixture"].includes(r.id))
      .every(r => new Date(r.expires_at).getTime() > Date.now())).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(key);
    const expired = await keys.create();
    await pool.query(`UPDATE sessions SET expires_at=NOW()-interval '1 second'
      WHERE id LIKE 'productcrew:ownerkey:%'`);
    await expect(keys.authenticate(expired.key)).rejects.toMatchObject({ status: 401 });
    expect(await keys.status()).toBe(null);
  });
  it("failed issuance rolls back revocation of the current key in the same transaction", async () => {
    const issued = await keys.create(), store = pgOwnerKeyStore(async () => pool);
    const { rows } = await pool.query(`SELECT id FROM sessions
      WHERE id LIKE 'productcrew:ownerkey:%' AND expires_at>NOW()`);
    const existingHash = rows[0].id.slice("productcrew:ownerkey:".length);
    await expect(store.rotate("fixture-owner", existingHash, new Date(Date.now() + 86400000))).rejects.toBeDefined();
    expect(await keys.authenticate(issued.key)).toBe("fixture-owner");
  });
  it("Secrets use/disable serialize across workers and revocation survives restart and session expiry cleanup", async () => {
    const raw = "fixture_only_postgres_secret_".repeat(3), owner = "secret-fixture";
    const store = pgSecretKeyStore(async () => pool);
    const key = new ProductCrewSecretKey(store, owner, () => raw);
    expect(await key.status()).toEqual({ configured: true, disabled: false, lastUsedAt: null });
    await key.authenticate(raw);
    await Promise.all([key.disable(), ...Array.from({ length: 20 }, async () => {
      try { await key.authenticate(raw); } catch (e: any) { expect(e.status).toBe(401); }
    })]);
    await pool.query("DELETE FROM sessions WHERE expires_at<NOW()");
    const restarted = new ProductCrewSecretKey(pgSecretKeyStore(async () => pool), owner, () => raw);
    await expect(restarted.authenticate(raw)).rejects.toMatchObject({ status: 401 });
    expect(await restarted.status()).toMatchObject({ configured: true, disabled: true, lastUsedAt: expect.any(String) });
    const rows = (await pool.query("SELECT * FROM sessions WHERE user_id=$1", [owner])).rows;
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(raw);
    const replacement = raw + "_replacement";
    expect(await new ProductCrewSecretKey(store, owner, () => replacement).authenticate(replacement)).toBe(owner);
    const foreign = new ProductCrewSecretKey(store, "other-secret-owner", () => raw);
    expect((await foreign.status()).disabled).toBe(false);
    await expect(restarted.authenticate(raw)).rejects.toMatchObject({ status: 401 });
  });
});
