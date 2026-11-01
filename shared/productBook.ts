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
  [extra: string]: unknown;
  version: number; updatedAt: string; snapshotDate: string; status: string;
  lifecycle: string; purpose: string; vision: string; b2c: string; b2b: string;
  current: string; nextStage: string; completion: string;
  features: ProductBookFeature[]; legal: string; finance: string;
  responsibilities: string; contradictions: string; roadmap: string;
  previousPassport: string;
  chapterRefs?: Record<string, string>;
}
export function readProductBook(document?: ModelDocument, options: { strictReviewAppendix?: boolean } = {}): ProductBook | null {
  if (!document?.text.includes(productBookMarker)) return null;
  // A marker can also occur inside an escaped previousPassport. Never split
  // the structured JSON on such a marker, or discard appended owner notes.
  const raw = document.text.slice(document.text.indexOf(productBookMarker) + productBookMarker.length).trim();
  try {
    if (!raw.startsWith("{")) return null;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (--depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) return null;
    const book = JSON.parse(raw.slice(0, end)) as ProductBook;
    const suffix = raw.slice(end);
    if (suffix.trim()) {
      // Human addenda start on a new line. A glued JSON token is corruption,
      // not an extension (e.g. `}invalid` must remain unreadable).
      if (!/^[ \t]*\r?\n/.test(suffix)) return null;
      // Read-only display preserves owner addenda without interpreting them.
      // Legacy rules writers may request their narrower recovery policy.
      if (options.strictReviewAppendix &&
          !suffix.trimStart().startsWith("## Правила v3 и единый журнал улучшений\n")) return null;
      // Preserve every original field, even in the unlikely event that a
      // previous extension already used the metadata key.
      let field = "preservedSourceSuffix";
      while (Object.prototype.hasOwnProperty.call(book, field)) field = `_${field}`;
      book[field] = suffix;
    }
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
  const structured = `${productBookMarker}\n${JSON.stringify(book)}`;
  const full = `${chapters}\n\n${structured}`;
  if (full.length <= 50000) return full;
  // Markdown is a convenient duplicate, not the source of truth. Both the UI
  // and imports use this serializer so adding a standard cannot make the next
  // ordinary edit unsaveable. Never trim canonical fields to fit a preamble.
  const compact = `${chapters.split("\n\n")[0]}\n\nВсе главы, исходный паспорт и связи сохранены полностью в структурированном блоке; веб-книга открывает те же данные.\n\n## Ответственность\n${book.responsibilities}\n\n${structured}`;
  if (compact.length <= 50000) return compact;
  // A large responsibilities section must not be duplicated either.
  return `# TalkHint — живая книга продукта · v${book.version}\nПолные данные глав сохранены ниже; прежние редакции — в истории документа.\n\n${structured}`;
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
