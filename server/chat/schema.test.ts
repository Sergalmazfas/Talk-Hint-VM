import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { chatConversations, chatMessages } from "../../shared/chatSchema";

describe("chat first publication schema", () => {
  it("defines owner identity as a table constraint before creating its foreign key", () => {
    const config = getTableConfig(chatConversations);
    const identity = config.uniqueConstraints.find(c => c.name === "chat_conversations_owner_identity");
    expect(identity?.columns.map(c => c.name)).toEqual(["id", "user_id"]);
  });

  it("keeps the composite owner foreign key and existing idempotency indexes", () => {
    const config = getTableConfig(chatMessages);
    const fk = config.foreignKeys.find(f => f.getName() === "chat_messages_owned_conversation")!;
    expect(fk.reference().columns.map(c => c.name)).toEqual(["conversation_id", "user_id"]);
    expect(fk.reference().foreignColumns.map(c => c.name)).toEqual(["id", "user_id"]);
    const names = getTableConfig(chatConversations).indexes.map(i => i.config.name);
    expect(names).toContain("chat_conversations_request");
    expect(names).toContain("chat_conversations_identity");
  });
});
