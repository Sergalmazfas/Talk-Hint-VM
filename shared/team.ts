export type TeamStatus = "autonomous" | "replit" | "disconnected" | "planned" | "unresolved";
export interface TeamMember {
  id: string; name: string; title: string; code: string; department: string;
  mode: string | null; status: TeamStatus; statusEvidence: string;
  portrait: string | null; nameStatus: string | null;
  traits: (string | null)[]; motto: string | null;
  duties: { id: string; title: string; detail: string | null }[];
  relations: { kind: string; id: string; name: string }[];
  tools: string[]; prohibitions: string[];
  model: string | null;
  prompt: { text: string | null; version: string | null; status: string | null; acceptedBy: string | null };
  metrics: { plan: string | null; fact: string | null };
  lastWork: string | null; lessons: string[];
  history: { at: string; text: string }[];
}
export interface TeamEvent {
  id: string; at: string; source: "journal" | "call_lab" | "oncall";
  title: string; detail: string | null; role: string | null;
}
export interface TeamPin {
  workspace: string; revision: number; rootHash: string; planHash: string; step: number;
}
export interface TeamView {
  source: { environment: string; workspace: string; revision: number; rootHash: string; phase: string };
  owner: { name: string; code: string };
  members: TeamMember[]; feed: TeamEvent[];
  apply: { available: boolean; reason: string | null; completed: number; total: number;
    pin: TeamPin | null; csrfToken?: string };
}
