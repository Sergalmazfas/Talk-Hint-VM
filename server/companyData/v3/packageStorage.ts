import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { createGunzip } from "node:zlib";
import { semanticHash } from "../valueTree";
import { importLines } from "./ndjson";
import type { TransferRecord } from "./transport";
import type { ReviewedPackage } from "./reviewedPackage";

/** The browser never supplies a URL, object key, bucket, or file. Private default
 * project bucket; stream is verified before the consuming transaction commits.
 */
export async function* storedTransfer(
  pin: ReviewedPackage,
  open = () => new Client().downloadAsStream(pin.objectName),
): AsyncIterable<TransferRecord> {
  const source = open();
  const stream = pin.compression === "gzip" ? source.pipe(createGunzip()) : source;
  // pipe() does not forward source errors to its destination by itself.
  source.on("error", error => stream.destroy(error));
  const digest = createHash("sha256");
  let bytes = 0;
  async function* checkedBytes() {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      bytes += chunk.length;
      if (bytes > pin.ndjsonBytes) throw new Error("Stored package exceeds reviewed size");
      digest.update(chunk);
      yield chunk;
    }
  }
  try {
    const lines = importLines(checkedBytes(), {
      maxBytes: pin.ndjsonBytes, maxLineBytes: pin.maximumLineBytes,
    });
    const first = await lines.next();
    if (first.done || Object.keys(first.value ?? {}).join() !== "manifest" ||
        semanticHash(first.value.manifest) !== pin.manifestHash ||
        semanticHash(pin.manifest) !== pin.manifestHash)
      throw new Error("Stored manifest differs from reviewed package");
    for await (const record of lines) {
      if (!record || typeof record.table !== "string" || !record.row ||
          typeof record.row !== "object" || Array.isArray(record.row) ||
          Object.keys(record).some(k => !["table", "row"].includes(k)))
        throw new Error("Invalid stored record");
      yield record;
    }
    if (bytes !== pin.ndjsonBytes || digest.digest("hex") !== pin.fileSha256)
      throw new Error("Stored package SHA/size mismatch");
  } finally {
    stream.destroy();
    source.destroy();
  }
}
