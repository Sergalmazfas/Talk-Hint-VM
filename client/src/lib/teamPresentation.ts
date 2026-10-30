import type { TeamMember } from "@shared/team";

/** Display only: never remove or rewrite the approved model's plan records. */
export function partitionTeamMembers(members: readonly TeamMember[]) {
  const staff: TeamMember[] = [], external: TeamMember[] = [], plans: TeamMember[] = [];
  for (const member of members) {
    if (member.id.startsWith("planned-") && ["planned", "unresolved"].includes(member.status)) {
      const names: Record<string, string> = {
        "planned-secretary": "Команда секретаря — будущая",
        "planned-copilot": "Команда Copilot — будущая",
        "planned-translator": "Команда переводчика — будущая",
      };
      plans.push({ ...member, name: names[member.id] ?? member.name,
        portrait: null, department: "Планы" });
    } else if (member.kind === "external" || member.status === "owner_chat" || member.status === "contractor") {
      external.push(member);
    } else {
      staff.push(member);
    }
  }
  return { staff, external, plans };
}
