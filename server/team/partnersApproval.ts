import type { ModelDocument } from "../../shared/projectModel";
import type { TeamPartnersPin, TeamView } from "../../shared/team";
import type { TeamContext } from "./repository";
import reviewedDocument from "./approvedPartnersDocument.json";
import { semanticHash } from "../companyData/valueTree";
import { TEAM_BASE } from "./plan";

export const PARTNERS_DOCUMENT_HASH = "6ce52570031d8b35ddf6ac1b79d2817b457cba081b267fc89ba50d56230dc108";
export const PARTNERS_BASE: TeamPartnersPin = {
  workspace: TEAM_BASE.workspace, revision: 918,
  rootHash: "af8fc455ef7fd387cbf368036f1ef5b9fd367e013430f1851da7d83f4a824297",
  documentHash: PARTNERS_DOCUMENT_HASH,
};
// Calibrated only on an isolated retained copy; production never discovers pins.
export const PARTNERS_NEXT_ROOT = "a6ffdc9c8a80242391973d62854f094ae08fc720e68b6eee3ce442170cb14379";
if (semanticHash(reviewedDocument) !== PARTNERS_DOCUMENT_HASH)
  throw Error("Reviewed external partner document changed");
export function partnersDocument(): ModelDocument {
  return structuredClone(reviewedDocument);
}
export function validPartnersPin(value: unknown): value is TeamPartnersPin {
  return !!value && typeof value === "object" && semanticHash(value) === semanticHash(PARTNERS_BASE);
}
export function partnersState(c: TeamContext): NonNullable<TeamView["partners"]> {
  const existing = c.documents.find(d => d.id === reviewedDocument.id);
  const completed = !!existing && semanticHash(existing) === PARTNERS_DOCUMENT_HASH && c.revision >= 919;
  const available = !existing && c.workspace === PARTNERS_BASE.workspace &&
    c.revision === PARTNERS_BASE.revision && c.rootHash === PARTNERS_BASE.rootHash &&
    c.phase === "active" && c.writesOpen;
  return { available, completed, documentHash: PARTNERS_DOCUMENT_HASH,
    pin: available ? { ...PARTNERS_BASE } : null,
    reason: completed ? "Документ применён и точно совпадает со сверенным." :
      available ? null : "Источник не совпадает с pin r918, запись закрыта или документ уже существует. Стоп: нужна новая сверка, без переноса diff." };
}
