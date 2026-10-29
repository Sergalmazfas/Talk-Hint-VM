/** Bounded linear-copy parser. Huge immutable archive rows are retained as
 * segments and concatenated once, never copied once per 16KB network chunk.
 */
export async function* importLines(input: AsyncIterable<Buffer | string>, limits: {
  maxLineBytes?: number; maxBytes?: number;
} = {}) {
  const maxLine = limits.maxLineBytes ?? 20 * 1024 * 1024;
  const maxTotal = limits.maxBytes ?? 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(maxLine) || maxLine < 1 || maxLine > 128 * 1024 * 1024 ||
      !Number.isSafeInteger(maxTotal) || maxTotal < 1 || maxTotal > 4 * 1024 * 1024 * 1024)
    throw new Error("Unreviewed import limits");
  let parts: Buffer[] = [], pendingBytes = 0, bytes = 0;
  for await (const chunk of input) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    if (bytes > maxTotal) throw new Error("Import byte limit exceeded");
    let start = 0;
    while (start < b.length) {
      const newline = b.indexOf(10, start), end = newline === -1 ? b.length : newline;
      if (end > start) { parts.push(b.subarray(start, end)); pendingBytes += end - start; }
      if (pendingBytes > maxLine) throw new Error("Import line limit exceeded");
      if (newline === -1) break;
      if (pendingBytes) {
        const line = parts.length === 1 ? parts[0] : Buffer.concat(parts, pendingBytes);
        parts = []; pendingBytes = 0;
        yield JSON.parse(line.toString("utf8"));
      }
      start = newline + 1;
    }
  }
  if (pendingBytes) yield JSON.parse(Buffer.concat(parts, pendingBytes).toString("utf8"));
}
