import type { Pool } from "pg";
import type { RetellReport } from "./retell";

export const DEV_REPORT_DDL = `CREATE TABLE IF NOT EXISTS secretary_lab_dev_reports (
  id varchar PRIMARY KEY, owner_id varchar NOT NULL REFERENCES users(id),
  report jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  environment text NOT NULL DEFAULT 'development' CHECK (environment = 'development')
)`;
const safe = (key: string, value: unknown) =>
  /^(?:access_token|authorization|ticket|ice_servers)$|(?:^|_)(?:api_key|secret)(?:$|_)|recording.*url/i.test(key) ? undefined : value;

/** No TTL, purge, delete, public access, or production initializer. */
export class DevReportArchive {
  private ready?: Promise<unknown>;
  constructor(private pool: Pick<Pool, "query">, private isDevDatabase: boolean) {}
  private async initialize() {
    if (!this.isDevDatabase || process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1")
      throw Error("DEV_REPORT_ARCHIVE_DEV_ONLY");
    if (!this.ready) this.ready = this.pool.query(DEV_REPORT_DDL).catch(e => { this.ready = undefined; throw e; });
    await this.ready;
  }
  async save(owner: string, report: RetellReport) {
    await this.initialize();
    const json = JSON.stringify(report, safe);
    if (Buffer.byteLength(json) > 1_000_000) throw Error("DEV_REPORT_ARCHIVE_TOO_LARGE");
    const r = await this.pool.query(
      `INSERT INTO secretary_lab_dev_reports (id,owner_id,report) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (id) DO UPDATE SET report=EXCLUDED.report,updated_at=now()
       WHERE secretary_lab_dev_reports.owner_id=EXCLUDED.owner_id RETURNING id`,
      [report.id, owner, json]);
    if (!r.rows.length) throw Error("DEV_REPORT_ARCHIVE_OWNER_CONFLICT");
  }
  async get(owner: string, id: string): Promise<RetellReport | undefined> {
    await this.initialize();
    const r = await this.pool.query("SELECT report FROM secretary_lab_dev_reports WHERE owner_id=$1 AND id=$2", [owner, id]);
    return r.rows[0]?.report;
  }
  async list(owner: string): Promise<RetellReport[]> {
    await this.initialize();
    const r = await this.pool.query(
      "SELECT report FROM secretary_lab_dev_reports WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20", [owner]);
    return r.rows.map(r => r.report);
  }
}
let archive: Promise<DevReportArchive> | undefined;
export function devReportArchive() {
  if (!archive) archive = import("../db").then(async db => {
    await db.dbReady;
    if (!db.pool || !db.isDevDatabase) throw Error("DEV_REPORT_ARCHIVE_DEV_ONLY");
    return new DevReportArchive(db.pool!, true);
  }).catch(e => { archive = undefined; throw e; });
  return archive;
}
