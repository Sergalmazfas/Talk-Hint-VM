import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { storedTransfer } from "./packageStorage";
import { semanticHash, textHash } from "../valueTree";
import type { ReviewedPackage } from "./reviewedPackage";
import { gzipSync } from "node:zlib";
import { importLines } from "./ndjson";
const manifest = {schemaVersion: 3 as const, schemaDigest: "a".repeat(64), sourceOwner: "synthetic",
  sourceEnvironment: "development", sourceWorkspace: "synthetic", revision: 1,
  rootHash: "b".repeat(64), semanticHash: "c".repeat(64), recordCount: 1, recordsDigest: "d".repeat(64)};
const line = {table: "company_v3_frames", row: {text: "Exact 😀\r\n"}};
const file = JSON.stringify({manifest}) + "\n" + JSON.stringify(line) + "\n";
const pin: ReviewedPackage = {manifest, manifestHash: semanticHash(manifest), objectName: "private",
  fileSha256: textHash(file), ndjsonBytes: Buffer.byteLength(file), maximumLineBytes: 1000,
  documentCount: 1, archiveCount: 0};
async function drain(p = pin, text = file) {
  const rows = [];
  for await (const r of storedTransfer(p, () => Readable.from([Buffer.from(text)]))) rows.push(r);
  return rows;
}
describe("private server package fetch", () => {
  it("verifies exact manifest, file SHA/size and preserves UTF8", async () => {
    expect(await drain()).toEqual([line]);
  });
  it("rejects tampered content, manifest, byte length and truncated input", async () => {
    await expect(drain({...pin, fileSha256: "0".repeat(64)})).rejects.toThrow("SHA/size");
    await expect(drain({...pin, manifestHash: "0".repeat(64)})).rejects.toThrow("manifest");
    await expect(drain(pin, file + "\n")).rejects.toThrow("size");
    await expect(drain(pin, file.slice(0, -2))).rejects.toThrow();
  });
  it("streams gzip and checks decompressed bytes, not compressed size", async () => {
    const rows = [];
    for await (const r of storedTransfer({...pin, compression: "gzip"},
      () => Readable.from([gzipSync(file)]))) rows.push(r);
    expect(rows).toEqual([line]);
  });
  it("accepts a reviewed archive-sized line above the old 20MiB limit", async () => {
    const text = JSON.stringify({text: "x".repeat(21 * 1024 * 1024)}) + "\n";
    async function* chunks() {
      const bytes = Buffer.from(text);
      for (let i = 0; i < bytes.length; i += 16 * 1024) yield bytes.subarray(i, i + 16 * 1024);
    }
    let count = 0;
    for await (const row of importLines(chunks(), {maxLineBytes: Buffer.byteLength(text), maxBytes: Buffer.byteLength(text)})) {
      expect(row.text.length).toBe(21 * 1024 * 1024); count++;
    }
    expect(count).toBe(1);
  });
});
