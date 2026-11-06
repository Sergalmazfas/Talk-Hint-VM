import { randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";
import { ChatError, attachmentBytes, safeName, hash, publicAttachment,
  type AttachmentInput, type MessageInput } from "./contracts";
import { type ChatRepository } from "./repository";
import { CHAT_MODEL, type ChatProvider, type LoadedAttachment } from "./provider";

export class ChatService {
  constructor(public repo: ChatRepository, public provider: ChatProvider, private objects = new Client()) {}
  async storageReady() {
    try { return (await this.objects.list({ prefix: "talkhint-chat/", maxResults: 1 })).ok; }
    catch { return false; }
  }
  async capabilities() {
    return { ai: { available: this.provider.available(), model: CHAT_MODEL },
      voice: { available: !!process.env.OPENAI_API_KEY },
      attachments: { available: await this.storageReady(), maxBytes: 2 * 1024 * 1024,
        mimeTypes: ["text/plain", "image/png", "image/jpeg", "application/pdf"] } };
  }
  async upload(user: string, input: AttachmentInput) {
    const bytes = attachmentBytes(input);
    if (!await this.storageReady()) throw new ChatError("ATTACHMENTS_UNAVAILABLE", 503);
    const intent = await this.repo.attachmentIntent(user, input.clientRequestId, {
      name: safeName(input.name), mimeType: input.mimeType, size: bytes.length,
      storageKey: `talkhint-chat/${hash([user])}/${randomUUID()}`,
      inputHash: hash([input.name, input.mimeType, bytes.toString("base64")]),
    });
    const a = intent.attachment;
    if (!intent.created) {
      if (a.status === "ready") return { attachment: publicAttachment(a) };
      // Retry the SAME deterministic object write (not any model call).
    }
    try {
      const stored = await this.objects.uploadFromBytes(a.storageKey, bytes);
      if (!stored.ok) throw new ChatError("ATTACHMENTS_UNAVAILABLE", 503);
      await this.repo.attachmentStatus(user, a.id, "ready");
      return { attachment: publicAttachment({ ...a, status: "ready" }) };
    } catch {
      await this.repo.attachmentStatus(user, a.id, "failed");
      throw new ChatError("ATTACHMENTS_UNAVAILABLE", 503);
    }
  }
  async download(user: string, id: string) {
    const attachment = await this.repo.attachment(user, id);
    if (attachment.status !== "ready") throw new ChatError("ATTACHMENT_NOT_READY", 409);
    const result = await this.objects.downloadAsBytes(attachment.storageKey);
    if (!result.ok) throw new ChatError("ATTACHMENTS_UNAVAILABLE", 503);
    return { attachment, bytes: result.value[0] };
  }
  async send(user: string, conversation: string, input: MessageInput) {
    const result = await this.repo.accept(user, conversation, input, this.provider.available());
    if (result.created) {
      // Independent of the HTTP socket: losing connection does NOT cancel or duplicate work.
      void this.run(user, conversation, result.reply.id, result.message.sequence, input.attachmentIds)
        .catch(() => console.error("[Chat1A] background persistence unavailable; lease will expire"));
    }
    return result;
  }
  private async run(user: string, conversation: string, reply: string, userSequence: number, ids: string[]) {
    if (!await this.repo.claim(user, reply)) return;
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 85_000);
    deadline.unref();
    let text = "", complete = false, lastSave = 0;
    const evidence: { model: string; requestId?: string; usage?: unknown } = { model: CHAT_MODEL };
    try {
      const history = (await this.repo.messages(user, conversation)).messages.filter(m => m.sequence <= userSequence);
      const loaded: LoadedAttachment[] = [];
      for (const id of ids) loaded.push(await this.download(user, id));
      for await (const event of this.provider.generate(history, loaded, abort.signal)) {
        if (event.requestId) evidence.requestId = event.requestId;
        if (event.usage) evidence.usage = event.usage;
        if (event.text) text += event.text;
        if (text.length > 20_000) throw new ChatError("MODEL_RESPONSE_TOO_LARGE", 502);
        if (event.complete) complete = true;
        if (Date.now() - lastSave > 150 || complete) {
          await this.repo.save(user, reply, text, "generating", null, evidence);
          lastSave = Date.now();
        }
      }
      if (!complete || !text.trim()) throw new ChatError("MODEL_RESPONSE_INCOMPLETE", 502);
      await this.repo.save(user, reply, text, "complete", null, evidence);
    } catch (e: any) {
      const wasAborted = abort.signal.aborted;
      abort.abort();
      const code = e instanceof ChatError ? e.code : wasAborted ? "GENERATION_INTERRUPTED" : "MODEL_REQUEST_FAILED";
      // No provider bodies, keys, private text or attachments in logs.
      console.warn("[Chat1A] response stopped", { code, status: typeof e?.status === "number" ? e.status : undefined,
        requestId: typeof e?.request_id === "string" ? e.request_id : evidence.requestId });
      await this.repo.save(user, reply, text, text ? "interrupted" : "failed", code, evidence);
    } finally { clearTimeout(deadline); }
  }
}
