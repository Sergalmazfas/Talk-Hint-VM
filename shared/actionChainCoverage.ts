import type { OperatingData, WorkNode } from "./operatingModel";
import { actionOutputs } from "./actionRegister";
/** Formal design contracts only. Never reports a worker or an accepted result. */
export function inputSupplier(data: OperatingData, sourceId: string | null): WorkNode | undefined {
  const source = data.nodes.find(n => n.id === sourceId);
  if (!source) return undefined;
  if (source.kind === "client") return source;
  return data.nodes.find(n => n.id === source.roleId) ??
    data.nodes.find(n => n.id === data.nodes.find(p => p.id === source.parentId)?.roleId);
}
export function actionChainGaps(data: OperatingData, ids?: Set<string>) {
  const gaps: { id: string; message: string }[] = [];
  for (const n of data.nodes.filter(n => n.kind === "action" && (!ids || ids.has(n.id)))) {
    const issues: string[] = [];
    const outputs = actionOutputs(data, n.id);
    if (!n.inputs.length) issues.push("Нет входа");
    if (n.inputs.some(i => !i.sourceId || !i.freshness || !inputSupplier(data, i.sourceId))) issues.push("Не определён источник/поставщик/актуальность входа");
    if (!n.roleId) issues.push("Не описана должность исполнителя");
    if (!n.resourceIds.length) issues.push("Не описаны ресурсы");
    if (!outputs.length) issues.push("Нет связанного результата");
    if (!data.links.some(l => l.from === n.id && l.kind === "accountable_to")) issues.push("Не указан контролирующий");
    if (!n.nextId) issues.push("Нет следующего шага");
    if (!n.success || !n.acceptorId) issues.push("Не описана приёмка");
    if (data.links.some(l => l.kind === "handoff" && l.to === n.id && !n.inputs.some(i => i.sourceId === l.from)))
      issues.push("Передаваемый результат не описан во входах принимающего действия");
    for (const r of outputs) {
      if (!r.recipientId) issues.push("Нет получателя результата");
      if (!data.links.some(l => l.from === r.id && l.kind === "acceptance")) issues.push("Нет связи приёмки результата");
      if (!data.links.some(l => l.kind === "return" && l.to === n.id)) issues.push("Нет пути возврата автору");
    }
    for (const message of Array.from(new Set(issues))) gaps.push({ id: n.id, message });
  }
  return gaps;
}
