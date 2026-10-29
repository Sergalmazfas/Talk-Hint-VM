/** Technical preparation after the project's bucket exists. Upload only;
 * never imports to a DB, creates grants, activates a source or publishes.
 */
import { Client } from "@replit/object-storage";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { reviewedPackage } from "../../server/companyData/v3/reviewedPackage";
import { semanticHash } from "../../server/companyData/valueTree";
import { storedTransfer } from "../../server/companyData/v3/packageStorage";
const out = "generated-artifacts/data-platform-publish2";
try {
  const pin = JSON.parse(await readFile(`${out}/REVIEWED_PACKAGE.json`, "utf8"));
  assert.equal(semanticHash(pin), semanticHash(reviewedPackage));
  const readback = JSON.parse(await readFile(`${out}/FILE_READBACK.json`, "utf8"));
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(`${out}/transfer.ndjson.gz`)) hash.update(chunk);
  assert.equal(hash.digest("hex"), readback.gzipSha256);
  const storage = new Client(), exists = await storage.exists(pin.objectName);
  if (!exists.ok) throw new Error("Storage unavailable");
  if (!exists.value) {
    const upload = await storage.uploadFromFilename(pin.objectName, `${out}/transfer.ndjson.gz`, {compress: false});
    if (!upload.ok) throw new Error("Upload not confirmed");
  }
  // Never trust exists() or upload success alone: verify every downloaded row.
  const recordsDigest = createHash("sha256");
  let count = 0;
  for await (const record of storedTransfer(pin)) {
    recordsDigest.update(semanticHash(record)).update("\n"); count++;
  }
  assert.equal(count, pin.manifest.recordCount);
  assert.equal(recordsDigest.digest("hex"), pin.manifest.recordsDigest);
  await writeFile(`${out}/STORAGE_READINESS.json`, JSON.stringify({
    ready: true, privateProjectStorage: true, uploadedOrAlreadyVerified: true,
    downloadedAndVerified: true, manifestHash: pin.manifestHash, fileSha256: pin.fileSha256,
    count, imported: false, published: false, verifiedAt: new Date().toISOString(),
  }, null, 2));
  console.log("Private transfer object verified; no DB/import/publication.");
} catch {
  await writeFile(`${out}/STORAGE_READINESS.json`, JSON.stringify({
    ready: false, uploaded: false, downloadedAndVerified: false,
    requestToOwner: "Tools → App Storage → Create new bucket → talkhint → Create bucket",
    blocked: "Default project bucket or its access not available; no public URL/fallback",
    imported: false, published: false,
  }, null, 2));
  console.log("Storage not ready. Prepare the default private bucket; no import was attempted.");
  process.exitCode = 1;
}
