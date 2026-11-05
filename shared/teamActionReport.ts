/** Facts, not an AI grade or owner acceptance. Stable id deduplicates an action. */
export interface TeamActionReport {
  id: string;
  at: string;
  role: string;
  assigned: string;
  outcome: "completed" | "partial" | "not_completed" | "message_left" | "not_reached";
  succeeded: string[];
  failed: string[];
  needsOwner: string[];
  source: string;
}
