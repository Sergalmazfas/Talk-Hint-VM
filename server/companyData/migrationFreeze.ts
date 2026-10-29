import { ModelError } from "../projectModel/modelError";
import { reviewedAccountBinding } from "./v3/importApproval";

/** Owner freeze until the separately reviewed cutover. Not a runtime toggle.
 * Only company model writes, never call/job/outbox/watchdog persistence.
 * SQL/admin tools still require the same no-write operating instruction.
 */
export function modelWritesFrozen(owner: string, environment: string) {
  return environment === "development" && owner === reviewedAccountBinding.sourceOwner;
}
export function assertModelWriteAllowed(owner: string, environment: string) {
  if (modelWritesFrozen(owner, environment))
    throw new ModelError(423, "Модель Dev заморожена для согласованного переноса. Изменение требует нового пакета и сверки.");
}
