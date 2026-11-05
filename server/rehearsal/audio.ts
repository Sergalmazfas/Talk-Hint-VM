import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { requireRehearsalDev, type SavedRehearsal } from "./store";
import type { RetellApi } from "../secretaryLab/retellApi";
export class RehearsalAudio {
  constructor(private storage = new Client(), private net: typeof fetch = fetch) {}
  async ready() {
    requireRehearsalDev();
    const result = await this.storage.list({ prefix: "rehearsal/", maxResults: 1 });
    if (!result.ok) throw Error("REHEARSAL_PRIVATE_STORAGE_UNAVAILABLE");
  }
  async capture(owner: string, row: SavedRehearsal, api: Pick<RetellApi, "request">) {
    requireRehearsalDev();
    if (row.audioPrivate) return;
    if (row.report.status !== "ended") throw Object.assign(Error("REHEARSAL_NOT_ENDED"), { status: 409 });
    const call = await api.request(`/v2/get-call/${encodeURIComponent((row.report as any).callId)}`);
    if (call.call_id !== (row.report as any).callId || call.call_type !== "web_call")
      throw Error("REHEARSAL_RECORDING_IDENTITY_MISMATCH");
    const raw = call.recording_multi_channel_url;
    if (!raw) {
      row.report.rehearsal.audio = { status: "pending", reason: "Retell ещё не подготовил двухканальную запись." };
      return;
    }
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !/^(?:[a-z0-9-]+\.)+(?:retellai\.com|cloudfront\.net|amazonaws\.com|storage\.googleapis\.com)$/i.test(url.hostname))
      throw Error("REHEARSAL_RECORDING_HOST_NOT_ALLOWED");
    // URL comes only from the authenticated provider response, never from the browser.
    const response = await this.net(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw Error("REHEARSAL_RECORDING_DOWNLOAD_FAILED");
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > 40_000_000) { await response.body.cancel().catch(() => {}); throw Error("REHEARSAL_RECORDING_TOO_LARGE"); }
      chunks.push(Buffer.from(chunk));
    }
    if (!size) throw Error("REHEARSAL_RECORDING_EMPTY");
    const bytes = Buffer.concat(chunks);
    const key = `rehearsal/${createHash("sha256").update(owner).digest("hex")}/${row.id}/stereo`;
    const stored = await this.storage.uploadFromBytes(key, bytes);
    if (!stored.ok) throw Error("REHEARSAL_RECORDING_STORAGE_FAILED");
    row.audioPrivate = { key, bytes: size, sha256: createHash("sha256").update(bytes).digest("hex"),
      type: /^(?:audio\/(?:wav|x-wav|mpeg|mp4|ogg))$/.test(response.headers.get("content-type") ?? "") ?
        response.headers.get("content-type")! : "audio/wav" };
    row.report.rehearsal.audio = { status: "ready", url: `/api/admin/rehearsal/sessions/${row.id}/audio` };
  }
  async read(row: SavedRehearsal) {
    requireRehearsalDev();
    if (!row.audioPrivate) throw Object.assign(Error("REHEARSAL_AUDIO_NOT_READY"), { status: 409 });
    const result = await this.storage.downloadAsBytes(row.audioPrivate.key);
    if (!result.ok || createHash("sha256").update(result.value[0]).digest("hex") !== row.audioPrivate.sha256)
      throw Error("REHEARSAL_RECORDING_INTEGRITY_FAILED");
    return { bytes: result.value[0], type: row.audioPrivate.type };
  }
}
