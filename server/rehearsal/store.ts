import { createHash } from "node:crypto";
import { devReportArchive } from "../secretaryLab/devReportArchive";
import type { RehearsalResult, RehearsalScene } from "../../shared/rehearsal";
export type SavedRehearsal = { id: string; kind: "rehearsal"; requestId: string;
  report: RehearsalResult; reviewRequestId?: string;
  audioPrivate?: { key: string; sha256: string; bytes: number; type: string } };
export function requireRehearsalDev() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1")
    throw Object.assign(Error("REHEARSAL_DEV_ONLY"), { status: 404 });
}
export class RehearsalStore {
  private writes = new Map<string, Promise<void>>();
  private settingsId(owner: string) {
    return "rehearsal-settings-" + createHash("sha256").update(owner).digest("hex");
  }
  async settings(owner: string) {
    requireRehearsalDev();
    const row: any = await (await devReportArchive()).get(owner, this.settingsId(owner));
    if (row && row.kind !== "rehearsal-settings") throw Error("REHEARSAL_SETTINGS_FORMAT");
    return { recordingConsent: row?.recordingConsent === true };
  }
  async saveSettings(owner: string, recordingConsent: boolean) {
    await this.save(owner, { id: this.settingsId(owner), kind: "rehearsal-settings",
      recordingConsent, updatedAt: new Date().toISOString() });
    const saved = await this.settings(owner);
    if (saved.recordingConsent !== recordingConsent) throw Error("REHEARSAL_SETTINGS_READBACK_MISMATCH");
    return saved;
  }
  async save(owner: string, row: SavedRehearsal | (RehearsalScene & { kind: "rehearsal-scene" }) |
      { id: string; kind: "rehearsal-settings"; recordingConsent: boolean; updatedAt: string }) {
    requireRehearsalDev();
    const key = owner + ":" + row.id, snapshot = structuredClone(row);
    const write = (this.writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await (await devReportArchive()).save(owner, snapshot);
    });
    this.writes.set(key, write);
    try { await write; } finally { if (this.writes.get(key) === write) this.writes.delete(key); }
  }
  async get(owner: string, id: string): Promise<SavedRehearsal> {
    requireRehearsalDev();
    const row: any = await (await devReportArchive()).get(owner, id);
    if (row?.kind !== "rehearsal") throw Object.assign(Error("REHEARSAL_NOT_FOUND"), { status: 404 });
    return row;
  }
  async list(owner: string) {
    requireRehearsalDev();
    // Existing Dev-only table; no additional DDL, TTL or history deletion.
    const { pool, isDevDatabase, dbReady } = await import("../db"); await dbReady;
    if (!pool || !isDevDatabase) throw Error("REHEARSAL_DEV_DATABASE_REQUIRED");
    await devReportArchive().then(a => a.list(owner));
    const result = await pool.query(
      `SELECT report FROM secretary_lab_dev_reports WHERE owner_id=$1
       AND report->>'kind' IN ('rehearsal','rehearsal-scene') ORDER BY created_at DESC LIMIT 200`, [owner]);
    return { scenes: result.rows.filter(r => r.report.kind === "rehearsal-scene").map(r => r.report as RehearsalScene),
      history: result.rows.filter(r => r.report.kind === "rehearsal").map(r => r.report.report as RehearsalResult) };
  }
}
