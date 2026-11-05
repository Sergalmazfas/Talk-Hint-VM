import type { SecretaryConversationEngine } from "../secretary/conversationEngine";
/** Internal bindings, never populated from an HTTP body or production phone path. */
export const rehearsalBindings = new Map<string, {
  create(owner: string, instruction: string): SecretaryConversationEngine;
  waiting: boolean; buffered: boolean; manners?: boolean;
  advanceCompletedTurn?: boolean;
  retellStreaming?: boolean;
}>();
