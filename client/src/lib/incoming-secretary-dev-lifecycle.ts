export type LiveSessionIdentity = { sessionId: string; requestId: string };

export class ResponseAudioGuard {
  private staleIds = new Set<string>();
  private currentId = "";

  accept(responseId: string) {
    if (!responseId || this.staleIds.has(responseId)) return false;
    this.currentId = responseId;
    return true;
  }

  isCurrent(responseId: string) {
    return Boolean(responseId) && this.currentId === responseId && !this.staleIds.has(responseId);
  }

  clear(responseId?: string) {
    if (this.currentId) this.staleIds.add(this.currentId);
    if (responseId) this.staleIds.add(responseId);
    this.currentId = "";
  }

  reset() {
    this.staleIds.clear();
    this.currentId = "";
  }
}

export async function acquireAndReserveLiveSession<TStream extends { getTracks(): Array<{ stop(): void }> }, TSession extends LiveSessionIdentity>(
  options: {
    getMedia: () => Promise<TStream>;
    reserve: () => Promise<TSession>;
    isCurrent: () => boolean;
    onStream: (stream: TStream) => void;
    onSession: (session: TSession) => void;
    stopReserved: (session: TSession) => Promise<unknown>;
  },
): Promise<{ stream: TStream; session: TSession } | null> {
  const stream = await options.getMedia();
  if (!options.isCurrent()) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  options.onStream(stream);
  const session = await options.reserve();
  if (!options.isCurrent()) {
    stream.getTracks().forEach((track) => track.stop());
    await options.stopReserved(session).catch(() => undefined);
    return null;
  }
  options.onSession(session);
  return { stream, session };
}

export function clearScheduledAudio<T extends { source: { stop(): void }; responseId: string }>(
  queue: T[],
  guard: ResponseAudioGuard,
  responseId?: string,
) {
  guard.clear(responseId);
  queue.forEach((entry) => { try { entry.source.stop(); } catch {} });
  queue.length = 0;
}

export function closeLocalResources(
  stream: { getTracks(): Array<{ stop(): void }> } | null,
  socket: { close(code?: number, reason?: string): void } | null,
  context: { state: string; close(): Promise<unknown> } | null,
) {
  stream?.getTracks().forEach((track) => { try { track.stop(); } catch {} });
  try { socket?.close(1000, "local test stopped"); } catch {}
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
}
