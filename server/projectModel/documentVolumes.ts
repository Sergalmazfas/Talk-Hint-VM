import { createHash } from "node:crypto";

/** Transitional storage volumes; public document identity and full text are unchanged. */
export const documentVolumeLength = 50_000;
export const documentTextLimit = 500_000;
export const textDigest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function splitDocumentText(text: string): string[] {
  const volumes: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + documentVolumeLength, text.length);
    // Do not cut a surrogate pair: digests use the exact UTF-8 text.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(text[end])) end--;
    volumes.push(text.slice(start, end));
    start = end;
  }
  return volumes;
}

export function documentVolumeManifest(id: string, text: string) {
  return {
    schema: 1, documentId: id, digest: textDigest(text), length: text.length,
    lengthUnit: "UTF-16 code units",
    volumes: splitDocumentText(text).map((part, index) => ({
      number: index + 1, length: part.length, digest: textDigest(part),
    })),
  };
}
