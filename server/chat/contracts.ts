import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatPlanAction } from "./plans";

export class ChatError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export const requestId = z.string().uuid().transform(v => v.toLowerCase());
export const createConversation = z.object({
  clientRequestId: requestId, title: z.string().trim().min(1).max(100).optional(),
}).strict();
export const sendMessage = z.object({
  clientRequestId: requestId, text: z.string().trim().max(8000),
  attachmentIds: z.array(requestId).max(3).default([]),
  language: z.string().max(24).default("en"),
}).strict().refine(v => v.text.length > 0 || v.attachmentIds.length > 0);
export const uploadAttachment = z.object({
  clientRequestId: requestId, name: z.string().min(1).max(180),
  mimeType: z.enum(["text/plain", "image/png", "image/jpeg", "application/pdf"]),
  dataBase64: z.string().min(4).max(2_800_000),
}).strict();
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MIME_TYPES = ["text/plain", "image/png", "image/jpeg", "application/pdf"];
export type MessageInput = z.infer<typeof sendMessage>;
export type AttachmentInput = z.infer<typeof uploadAttachment>;
export type Message = {
  id: string; userId: string; conversationId: string; sequence: number;
  clientRequestId: string; role: string; text: string; status: string;
  attachmentIds: string[]; createdAt: string; errorCode?: string | null;
  action?: ChatPlanAction | null;
};
export type Attachment = {
  id: string; name: string; mimeType: string; size: number; status: string;
  storageKey: string; inputHash: string;
};
export function hash(value: unknown): string {
  // Callers supply fixed-shape records/arrays, never arbitrary JSONB serialization.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function attachmentBytes(input: AttachmentInput): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64))
    throw new ChatError("INVALID_ATTACHMENT", 400);
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new ChatError("ATTACHMENT_TOO_LARGE", 413);
  const signature = bytes.subarray(0, 8);
  const valid = input.mimeType === "image/png" ? signature.equals(Buffer.from("89504e470d0a1a0a", "hex"))
    : input.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : input.mimeType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : !bytes.includes(0);
  if (!valid) throw new ChatError("INVALID_ATTACHMENT_TYPE", 415);
  if (input.mimeType === "text/plain") {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ChatError("INVALID_TEXT_ENCODING", 415); }
  }
  return bytes;
}
export function safeName(name: string): string {
  return name.replace(/[/\\\u0000-\u001f\u007f]/g, "_").slice(0, 180);
}
export function publicAttachment(a: Attachment) {
  return { id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, status: a.status };
}
