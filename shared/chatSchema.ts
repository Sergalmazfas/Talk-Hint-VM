import { pgTable, varchar, text, integer, timestamp, jsonb, uniqueIndex, unique, index, foreignKey } from "drizzle-orm/pg-core";

// Additive 1A storage. No profile memory, phone actions or startup DDL.
export const chatConversations = pgTable("chat_conversations", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  clientRequestId: varchar("client_request_id").notNull(),
  inputHash: text("input_hash").notNull(),
  title: text("title").notNull(),
  nextSequence: integer("next_sequence").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("chat_conversations_request").on(t.userId, t.clientRequestId),
  uniqueIndex("chat_conversations_identity").on(t.id, t.userId),
  // Table constraint survives publish introspection and precedes the composite FK.
  unique("chat_conversations_owner_identity").on(t.id, t.userId),
  index("chat_conversations_owner").on(t.userId, t.updatedAt, t.id),
]);

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  conversationId: varchar("conversation_id").notNull(),
  sequence: integer("sequence").notNull(),
  clientRequestId: varchar("client_request_id").notNull(),
  inputHash: text("input_hash").notNull(),
  role: text("role").notNull(),
  text: text("text").notNull().default(""),
  status: text("status").notNull(),
  attachmentIds: jsonb("attachment_ids").$type<string[]>().notNull().default([]),
  errorCode: text("error_code"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  providerRequestId: text("provider_request_id"),
  model: text("model"),
  usage: jsonb("usage"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("chat_messages_sequence").on(t.conversationId, t.sequence),
  uniqueIndex("chat_messages_request").on(t.conversationId, t.clientRequestId, t.role),
  index("chat_messages_owner").on(t.userId, t.conversationId, t.sequence),
  foreignKey({ columns: [t.conversationId, t.userId],
    foreignColumns: [chatConversations.id, chatConversations.userId], name: "chat_messages_owned_conversation" }),
]);

export const chatAttachments = pgTable("chat_attachments", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  clientRequestId: varchar("client_request_id").notNull(),
  inputHash: text("input_hash").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("chat_attachments_request").on(t.userId, t.clientRequestId)]);
