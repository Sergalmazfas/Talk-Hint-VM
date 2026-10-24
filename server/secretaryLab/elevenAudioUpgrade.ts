import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket, WebSocketServer } from "ws";

/** Official client appends source/version even to a signedUrl. They are SDK
 * metadata, NOT credentials or permission to override session configuration. */
export function elevenAudioTicket(url: URL, environment: string | undefined) {
  if (environment !== "development") return undefined;
  const ticket = /^\/eleven-engine-audio\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];
  if (!ticket) return undefined;
  let valid = true;
  url.searchParams.forEach((value, key) => {
    if (!["source", "version"].includes(key) || url.searchParams.getAll(key).length !== 1 ||
      !/^[a-zA-Z0-9._+-]{1,64}$/.test(value)) valid = false;
  });
  return valid ? ticket : undefined;
}
type AudioRuntime = {
  permitsAudio(ticket: string): boolean;
  attachAudio(socket: WebSocket, ticket: string): void;
};
export async function upgradeElevenAudio(request: IncomingMessage, socket: Duplex, head: Buffer,
  options: { server: Pick<WebSocketServer, "handleUpgrade">; runtime: () => Promise<AudioRuntime | undefined>; environment?: string }) {
  const url = new URL(request.url || "", "http://local.invalid");
  const ticket = elevenAudioTicket(url, options.environment);
  if (!ticket) { socket.destroy(); return; }
  try {
    const runtime = await options.runtime();
    if (socket.destroyed || !runtime?.permitsAudio(ticket)) { socket.destroy(); return; }
    options.server.handleUpgrade(request, socket, head, ws => runtime.attachAudio(ws, ticket));
  } catch { socket.destroy(); }
}
