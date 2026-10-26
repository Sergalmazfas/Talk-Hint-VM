import type { ModelDocument, ProjectModelState } from "./projectModel";

/** The book lives in the existing passport document, not a second catalogue. */
export const productBookDocumentId = "DOC-TALKHINT-PRODUCT-PASSPORT";
export const productBookMarker = "<!-- TALKHINT-PRODUCT-BOOK-V2 -->";
export const bookChapters = [
  ["home", "Главная"], ["vision", "Видение и аудитория"], ["features", "Возможности"],
  ["team", "Отделы и ответственность"], ["competitors", "Конкуренты"],
  ["roadmap", "Roadmap"], ["legal", "Право и документы"], ["finance", "Финансы"],
  ["history", "Эволюция и решения"], ["documents", "Документы"],
] as const;
export interface ProductBookFeature {
  id: string; name: string; behavior: string; actual: string;
  platform: string; evidence: string; implementation: string; verification: string;
  availability: string; acceptance: string; errors: string; limitations: string;
  dependencies: string; requests: string; responsible: string; receiver: string;
  resources: string; next: string; priority: string; rationale: string; deadline: string;
  comparisonKey?: string;
}
export interface ProductBook {
  version: number; updatedAt: string; snapshotDate: string; status: string;
  lifecycle: string; purpose: string; vision: string; b2c: string; b2b: string;
  current: string; nextStage: string; completion: string;
  features: ProductBookFeature[]; legal: string; finance: string;
  responsibilities: string; contradictions: string; roadmap: string;
  previousPassport: string;
}
export function readProductBook(document?: ModelDocument): ProductBook | null {
  if (!document?.text.includes(productBookMarker)) return null;
  const raw = document.text.split(productBookMarker)[1]?.trim();
  try {
    const book = JSON.parse(raw) as ProductBook;
    return book.version >= 2 && Array.isArray(book.features) && typeof book.previousPassport === "string" ? book : null;
  } catch { return null; }
}
export function productBookText(book: ProductBook): string {
  const chapters = [
    `# TalkHint — живая книга продукта\nВерсия: ${book.version}. Обновлено: ${book.updatedAt}.\nСнимок исходных подтверждений: ${book.snapshotDate}.\nПродукт: ${book.lifecycle}. Документ: ${book.status}.`,
    `## Назначение\n${book.purpose}\n## Видение\n${book.vision}\nB2C: ${book.b2c}\nB2B: ${book.b2b}`,
    `## Где мы сейчас\n${book.current}\n## Ближайший этап\n${book.nextStage}\nКритерий завершения: ${book.completion}`,
    `## Возможности\n${book.features.map(f => `### ${f.name} [${f.id}]\n${f.actual}\nСледующий шаг: ${f.next}`).join("\n\n")}\nПолные поля возможностей сохранены в структурированном блоке ниже; это те же данные, которые открывает веб.`,
    `## Ответственность\n${book.responsibilities}\n## Противоречия\n${book.contradictions}`,
    `## Право\n${book.legal}\n## Финансы\n${book.finance}\n## Roadmap\n${book.roadmap}`,
    "## Источник и предыдущая редакция v1\nПолный исходный паспорт сохранён в поле previousPassport структурированного блока и в истории документа; его утверждение не подразумевается.",
  ].join("\n\n");
  return `${chapters}\n\n${productBookMarker}\n${JSON.stringify(book)}`;
}
export function productBookDocument(state: ProjectModelState) {
  return state.documents.find(d => d.id === productBookDocumentId);
}
export const featureFieldLabels: Record<keyof ProductBookFeature, string> = {
  id: "ID", name: "Возможность", behavior: "Заявленное поведение", actual: "Фактическое состояние",
  platform: "Платформа / сборка / окружение", evidence: "Доказательства и даты",
  implementation: "Реализация", verification: "Проверка", availability: "Доступность пользователю",
  acceptance: "Приёмка", errors: "Ошибки", limitations: "Ограничения", dependencies: "Зависимости",
  requests: "Обращения и задания", responsible: "Ответственный", receiver: "Принимающий",
  resources: "Ресурсы", next: "Следующий шаг", priority: "Приоритет", rationale: "Основание",
  deadline: "Срок и согласование", comparisonKey: "Ключ сравнения",
};
