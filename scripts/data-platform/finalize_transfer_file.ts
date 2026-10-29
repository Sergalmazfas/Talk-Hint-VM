/** Local artifact only. No DB/import/network. Compress and independently re-read
 * the real reviewed transfer; compressed size does not substitute raw limits.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import assert from "node:assert/strict";
import { semanticHash } from "../../server/companyData/valueTree";
import { storedTransfer } from "../../server/companyData/v3/packageStorage";
import type { ReviewedPackage } from "../../server/companyData/v3/reviewedPackage";

const out = "generated-artifacts/data-platform-publish2";
const manifest = JSON.parse(await readFile(`${out}/MANIFEST.json`, "utf8"));
const proof = JSON.parse(await readFile(`${out}/SOURCE_PROOF.json`, "utf8"));
const envelope = Buffer.from(JSON.stringify({manifest}) + "\n");
const rawDigest = createHash("sha256"), compressedDigest = createHash("sha256");
const path = `${out}/transfer.ndjson.gz`;
const tap = (digest: ReturnType<typeof createHash>) => new Transform({
  transform(chunk, _encoding, cb) {digest.update(chunk); cb(null, chunk);},
});
async function* source() {
  yield envelope;
  for await (const chunk of createReadStream(`${out}/records.ndjson`)) yield chunk;
}
await pipeline(Readable.from(source()), tap(rawDigest), createGzip({level: 6}),
  tap(compressedDigest), createWriteStream(path, {flags: "wx", mode: 0o600}));
const fileSha256 = rawDigest.digest("hex"), gzipSha256 = compressedDigest.digest("hex");
const pin: ReviewedPackage = {
  manifest, manifestHash: semanticHash(manifest),
  objectName: `company-transfer/new-country/${fileSha256}/transfer.ndjson.gz`,
  compression: "gzip", fileSha256, ndjsonBytes: proof.recordsBytes + envelope.length,
  maximumLineBytes: Math.max(proof.maximumRecordLineBytes, envelope.length),
  documentCount: proof.documentCount, archiveCount: proof.archiveCount,
};
assert(pin.maximumLineBytes <= 128 * 1024 * 1024);
assert(pin.ndjsonBytes <= 4 * 1024 * 1024 * 1024);
const recordsDigest = createHash("sha256");
let count = 0;
for await (const record of storedTransfer(pin, () => createReadStream(path))) {
  recordsDigest.update(semanticHash(record)).update("\n"); count++;
}
assert.equal(count, manifest.recordCount);
assert.equal(recordsDigest.digest("hex"), manifest.recordsDigest);
await writeFile(`${out}/REVIEWED_PACKAGE.json`, JSON.stringify(pin, null, 2));
await writeFile(`${out}/FILE_READBACK.json`, JSON.stringify({
  passed: true, file: "transfer.ndjson.gz", gzipBytes: (await stat(path)).size, gzipSha256,
  decompressedBytes: pin.ndjsonBytes, fileSha256, manifestHash: pin.manifestHash,
  maximumLineBytes: pin.maximumLineBytes, count, semanticRecordDigest: manifest.recordsDigest,
  method: "Independent exact production parser + streaming gzip + semanticHash for every record; no SQL/import",
  importExecuted: false, storageUploadAttempted: false,
}, null, 2));
console.log("COMPRESSED TRANSFER VERIFIED", {count, fileSha256, maximumLineBytes: pin.maximumLineBytes});
