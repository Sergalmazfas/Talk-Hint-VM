import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export interface SecretKeyStatus {
  configured: boolean;
  disabled: boolean;
  lastUsedAt: string | null;
}
export interface SecretKeyStore {
  status(owner: string, hash: string): Promise<{ disabled: boolean; lastUsedAt: string | null }>;
  use(owner: string, hash: string): Promise<boolean>;
  disable(owner: string, hash: string): Promise<void>;
}
const digest = (value: string) => createHash("sha256").update(value).digest();
const valid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43,512}$/.test(value);
const denied = () => Object.assign(Error("Product secret access denied"), { status: 401 });
const unavailable = () => Object.assign(Error("Product secret state unavailable"), { status: 503 });

/** Reads the secret only at use time; never returns, persists or logs it. */
export class ProductCrewSecretKey {
  constructor(private store: SecretKeyStore, private owner: string, private secret: () => string | undefined) {}
  private hash() {
    const value = this.secret();
    return valid(value) ? digest(value).toString("hex") : null;
  }
  matches(value: unknown) {
    const expected = this.secret();
    return valid(expected) && typeof value === "string" && value.length <= 512 &&
      timingSafeEqual(digest(expected), digest(value));
  }
  async status(): Promise<SecretKeyStatus> {
    const hash = this.hash();
    if (!hash) return { configured: false, disabled: false, lastUsedAt: null };
    try { return { configured: true, ...await this.store.status(this.owner, hash) }; }
    catch { throw unavailable(); }
  }
  async authenticate(value: unknown) {
    if (!this.matches(value)) throw denied();
    const hash = this.hash();
    if (!hash) throw denied();
    let allowed: boolean;
    try { allowed = await this.store.use(this.owner, hash); }
    catch { throw unavailable(); }
    if (!allowed) throw denied();
    return this.owner;
  }
  async disable() {
    const hash = this.hash();
    if (!hash) throw Object.assign(Error("Product secret is not configured"), { status: 409 });
    try { await this.store.disable(this.owner, hash); }
    catch { throw unavailable(); }
  }
}

/** Durable disable markers have no practical expiry, so session cleanup cannot
 * silently re-enable a disabled secret. Rotation selects a new hash namespace.
 * Authentication and disable serialize across workers; no cached enable flag.
 */
export function pgSecretKeyStore(getPool: () => Promise<Pool>): SecretKeyStore {
  const id = (owner: string, hash: string, kind: string) =>
    `productcrew:secret-${kind}:${digest(owner).toString("hex")}:${hash}`;
  const locked = async <T>(owner: string, hash: string, work: (c: import("pg").PoolClient) => Promise<T>) => {
    const client = await (await getPool()).connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id(owner, hash, "lock")]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  };
  return {
    async status(owner, hash) {
      const { rows } = await (await getPool()).query(`SELECT
        EXISTS(SELECT 1 FROM sessions WHERE id=$1 AND user_id=$3) AS disabled,
        (SELECT created_at FROM sessions WHERE id=$2 AND user_id=$3) AS last_used_at`,
      [id(owner, hash, "disabled"), id(owner, hash, "use"), owner]);
      return { disabled: rows[0].disabled,
        lastUsedAt: rows[0].last_used_at ? new Date(rows[0].last_used_at).toISOString() : null };
    },
    use: (owner, hash) => locked(owner, hash, async client => {
      const { rows } = await client.query("SELECT id FROM sessions WHERE id=$1 AND user_id=$2",
        [id(owner, hash, "disabled"), owner]);
      if (rows.length) return false;
      await client.query(`INSERT INTO sessions(id,user_id,expires_at,created_at)
        VALUES($1,$2,'9999-12-31',NOW()) ON CONFLICT(id) DO UPDATE SET created_at=NOW()
        WHERE sessions.user_id=EXCLUDED.user_id`, [id(owner, hash, "use"), owner]);
      return true;
    }),
    disable: (owner, hash) => locked(owner, hash, async client => {
      await client.query(`INSERT INTO sessions(id,user_id,expires_at)
        VALUES($1,$2,'9999-12-31') ON CONFLICT(id) DO NOTHING`,
      [id(owner, hash, "disabled"), owner]);
    }),
  };
}
