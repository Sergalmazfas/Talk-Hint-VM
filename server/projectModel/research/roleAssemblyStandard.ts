import assert from "node:assert/strict";
import type { ProjectModelState } from "../../../shared/projectModel";
import { productBookDocumentId, productBookText, readProductBook } from "../../../shared/productBook";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";

export const standardHeading = "## Как собирается каждая должность";
export const roleAssemblyStandard = `${standardHeading}
Стандарт сборки структуры Crew всей компании. Источник: прямое уточнение Сергея от 26.10.2026 в чате Replit. Это согласованное правило сборки, не утверждение новых должностей, ресурсов, форм, сроков или запуск исполнителей.

1. Действия. Для каждого: назначение, вход и поставщик, выход и получатель/клиент результата, частота или триггер, время выполнения либо неизвестно, критерий готовности, контролёр и метрика. Польза внутреннему клиенту связана с пользой конечному пользователю.
2. Отчёт — тоже действие, и их два: сформировать отчёт у исполнителя и принять отчёт у получателя. Отказ сопровождается причиной и возвратом на доработку; молчание не приёмка.
3. Ресурсы выдаются для выполнения действий: документы, интернет, стенды и данные, инструменты. У каждого есть владелец и статус «выдан / не выдан»; неизвестный доступ не считается выданным. Описание инструмента не доказывает доступ AI-исполнителя.
4. Выход одного действия — вход другого; вход без поставщика считается разрывом. Связаны исполнение, проверка, результат и следующий принимающий шаг.
5. Должностные обязанности собираются из действий, ресурсов и связей общей модели, не из отдельного независимого текста или каталога.
6. JSON должности выгружается из этой структуры с идентификаторами, версиями, процедурами, входами, ресурсами, результатами, контролем, приёмкой и отчётностью. Для каждой новой выгрузки проверяется полнота этих пунктов; неизвестное и несогласованное обозначаются явно.
7. JSON проходим сами: фиксируем реальные результаты шагов, блокеры и разрывы, дополняем, ставим оценку правильности и принимаем только по фактическому решению. Сохраняем доказательство приёмки/возврата. Наличие JSON не означает исполненного прохода или работающего агента.

Каждый отдел и лаборатория передают в общую отчётность план-факт, показатели, нововведения, предложения, сбои и новое на рынке; формирование, анализ и приёмка имеют ответственных. На этой основе готовятся связанные выводы и записки для продукта, техники, финансов и других получателей.

Состояния различаются: описано / согласовано / обеспечено / исполнено / принято. Сначала прорабатываем одну должность до результата, затем следующую. Принятие описания не заменяет проверку ресурсов и исполнения. Число непройденных должностей и чужие утверждения о сохранении документов этим стандартом не подтверждаются.`;

/** Narrow explicit Dev documentation edit; no operating-model or runtime changes. */
export function saveRoleAssemblyStandard(root: ProjectModelState, now: string): ProjectModelState {
  const state = readHypothesis(root, "new-country");
  const doc = state.documents.find(d => d.id === productBookDocumentId);
  const book = readProductBook(doc);
  assert.ok(doc && book, "Existing canonical book required; no new book or seed");
  if (book.responsibilities.includes(roleAssemblyStandard)) return root;
  const start = book.responsibilities.indexOf(standardHeading);
  let responsibilities: string;
  if (start < 0) responsibilities = `${book.responsibilities}\n\n${roleAssemblyStandard}`;
  else {
    const tail = book.responsibilities.slice(start + standardHeading.length);
    const following = tail.search(/\n## /);
    responsibilities = book.responsibilities.slice(0, start) + roleAssemblyStandard
      + (following < 0 ? "" : tail.slice(following));
  }
  const nextBook = { ...book, version: book.version + 1, updatedAt: now, responsibilities };
  // Use the same bounded, lossless serialization as the existing book editor.
  const text = productBookText(nextBook);
  assert.ok(text.length <= 50000, "Book exceeds existing document limit; do not truncate canonical data");
  const next = applyHypothesisCommand(root, "new-country", { type: "saveDocument", id: doc.id,
    title: doc.title.replace(/\bv\d+\b/, `v${nextBook.version}`), text, url: doc.url, elementIds: doc.elementIds },
  "Replit: прямое правило владельца о сборке каждой должности; без назначения и запуска");
  const after = readHypothesis(next, "new-country");
  assert.deepEqual(after.elements, state.elements);
  assert.deepEqual(after.relations, state.relations);
  assert.deepEqual(after.operatingModel, state.operatingModel);
  assert.deepEqual(after.documents.filter(d => d.id !== doc.id), state.documents.filter(d => d.id !== doc.id));
  assert.deepEqual(next.alternatives?.filter(h => h.id !== "new-country"), root.alternatives?.filter(h => h.id !== "new-country"));
  const saved = readProductBook(after.documents.find(d => d.id === doc.id))!;
  assert.deepEqual({ ...saved, version: book.version, updatedAt: book.updatedAt, responsibilities: book.responsibilities }, book);
  return next;
}
