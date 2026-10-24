export function elevenProxySocketUrl(path: string, origin: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("ElevenLabs proxy must return a same-origin websocket path.");
  const base = new URL(origin);
  const endpoint = new URL(path, base);
  if (endpoint.origin !== base.origin) throw new Error("ElevenLabs proxy path must remain on the current origin.");
  endpoint.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return endpoint.toString();
}

export function isElevenReportEnded(status: string) {
  return status === "ended" || status === "failed";
}

export function elapsedClientMs(startedAt: number, now: number) {
  return Math.max(0, Math.round(now - startedAt));
}
