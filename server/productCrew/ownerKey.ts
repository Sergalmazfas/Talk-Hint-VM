import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export const OWNER_KEY_HEADER = "X-API-Key";
export const OWNER_KEY_TTL_MS = 90 * 86400000;
const prefix = "productcrew:ownerkey:";
const usagePrefix = "productcrew:ownerkey-use:";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const denied = () => Object.assign(Error("Invalid, expired or revoked product key"), { status: 401 });

export interface OwnerKeyStatus {
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}
export interface OwnerKeyStore {
  rotate(owner: string, hash: string, expiresAt: Date): Promise<OwnerKeyStatus>;
  status(owner: string): Promise<OwnerKeyStatus | null>;
  revoke(owner: string): Promise<void>;
  use(owner: string, hash: string): Promise<boolean>;
}

/** Opaque, high-entropy keys. No key material is persisted or recoverable. */
export class ProductCrewOwnerKey {
  constructor(private store: OwnerKeyStore, private owner: string) {}
  status() { return this.store.status(this.owner); }
  revoke() { return this.store.revoke(this.owner); }
  async create() {
    const key = `thpk_${randomBytes(32).toString("base64url")}`;
    const status = await this.store.rotate(this.owner, digest(key), new Date(Date.now() + OWNER_KEY_TTL_MS));
    return { key, status };
  }
  async authenticate(value: unknown) {
    if (typeof value !== "string" || !/^thpk_[A-Za-z0-9_-]{43}$/.test(value)) throw denied();
    if (!await this.store.use(this.owner, digest(value))) throw denied();
    return this.owner;
  }
}

export function equalCsrf(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" ||
      !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Reuse the existing expiring credential-marker table, not model documents.
 * Key marker: id = namespace + SHA256(key); created_at = issuance date.
 * Usage marker: a separate hash-only marker; created_at = last successful use.
 * No schema change, plaintext key, OAuth/session mutation or model write.
 */
export function pgOwnerKeyStore(getPool: () => Promise<Pool>): OwnerKeyStore {
  const metadata = (r: any): OwnerKeyStatus => ({
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  });
  const locked = async <T>(owner: string, work: (client: import("pg").PoolClient) => Promise<T>) => {
    const client = await (await getPool()).connect();
    try {
      await client.query("BEGIN");
      // All rotations/revocations for an owner serialize, even across workers.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${prefix}${owner}`]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  };
  return {
    rotate: (owner, hash, expiresAt) => locked(owner, async client => {
      await client.query(`UPDATE sessions SET expires_at=to_timestamp(0)
        WHERE user_id=$1 AND (id LIKE $2 OR id LIKE $3) AND expires_at>NOW()`,
      [owner, `${prefix}%`, `${usagePrefix}%`]);
      const { rows } = await client.query(`INSERT INTO sessions(id,user_id,expires_at)
        VALUES($1,$2,$3) RETURNING created_at,expires_at`, [`${prefix}${hash}`, owner, expiresAt]);
      return metadata(rows[0]);
    }),
    async status(owner) {
      const { rows } = await (await getPool()).query(`SELECT k.created_at,k.expires_at,u.created_at AS last_used_at
        FROM sessions k LEFT JOIN sessions u ON u.id=$3||substring(k.id from $4::integer)
        AND u.user_id=k.user_id AND u.expires_at>NOW()
        WHERE k.user_id=$1 AND k.id LIKE $2 AND k.expires_at>NOW() ORDER BY k.created_at DESC LIMIT 2`,
      [owner, `${prefix}%`, usagePrefix, prefix.length + 1]);
      if (rows.length > 1) throw Error("Ambiguous product key state");
      return rows[0] ? metadata(rows[0]) : null;
    },
    revoke: owner => locked(owner, async client => {
      await client.query(`UPDATE sessions SET expires_at=to_timestamp(0)
        WHERE user_id=$1 AND (id LIKE $2 OR id LIKE $3) AND expires_at>NOW()`,
      [owner, `${prefix}%`, `${usagePrefix}%`]);
    }),
    use: (owner, hash) => locked(owner, async client => {
      const { rows } = await client.query(`SELECT expires_at FROM sessions
        WHERE id=$1 AND user_id=$2 AND expires_at>NOW() FOR UPDATE`, [`${prefix}${hash}`, owner]);
      if (!rows[0]) return false;
      await client.query(`INSERT INTO sessions(id,user_id,expires_at,created_at)
        VALUES($1,$2,$3,NOW()) ON CONFLICT(id) DO UPDATE SET created_at=NOW()
        WHERE sessions.user_id=EXCLUDED.user_id`, [`${usagePrefix}${hash}`, owner, rows[0].expires_at]);
      return true;
    }),
  };
}
