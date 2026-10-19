import type { SavedTaskEvent } from "./savedEvents";

export interface HistoryRow {
  id: string;
  status: string;
  phoneNumber: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export type SecretaryHistoryPage =
  | {
      kind: "secretary-history";
      account: string;
      tasks: HistoryRow[];
      calls: HistoryRow[];
    }
  | {
      kind: "secretary-detail";
      account: string;
      recordType: "task" | "call";
      id: string;
      status: string;
      phoneNumber: string;
      instruction: string;
      summary: string;
      outcome: string;
      nextStep: string;
      createdAt: string;
      updatedAt: string;
      facts: string[];
      transcript?: string;
      turns?: { id: string; role: string; text: string }[];
      events?: SavedTaskEvent[];
    };

const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const detailValue = (label: string, value: unknown): string =>
  `<div class="row"><span class="detail-label">${escapeHtml(label)}</span><div class="detail-value">${escapeHtml(value)}</div></div>`;

const historyRows = (rows: HistoryRow[], recordType: "task" | "call", api: string): string => {
  if (rows.length === 0) {
    return `<li class="notice">Сохранённых ${recordType === "task" ? "заданий" : "звонков"} пока нет.</li>`;
  }

  return rows
    .map((row) => {
      const href = `${api}/secretary/${recordType === "task" ? "tasks" : "calls"}/${encodeURIComponent(row.id)}`;
      return `<li class="row">
        <div class="row-head"><div class="row-title">Запись <span class="detail-value">${escapeHtml(row.id)}</span></div><span class="detail-label">${escapeHtml(row.status)}</span></div>
        <div class="section">${detailValue("Номер", row.phoneNumber)}${detailValue("Кратко", row.summary)}${detailValue("Создано", row.createdAt)}${detailValue("Обновлено", row.updatedAt)}</div>
        <a class="manage" href="${escapeHtml(href)}">Открыть сохранённый отчёт</a>
      </li>`;
    })
    .join("");
};

export function renderSecretaryContent(page: SecretaryHistoryPage, api = "/api/chatgpt"): string {
  if (page.kind === "secretary-history") {
    return `<article class="card">
      <p class="eyebrow">Секретарь · история</p>
      <h1>Сохранённые отчёты</h1>
      <p class="lede">Аккаунт TalkHint: <strong>${escapeHtml(page.account)}</strong></p>
      <p class="notice">До 50 последних записей каждого вида из backend TalkHint. Это сохранённые отчёты, не гарантированные обновления в реальном времени. Эта страница не набирает номера.</p>
      <section class="section" aria-labelledby="secretary-tasks-heading">
        <h2 id="secretary-tasks-heading">Задания</h2>
        <ul class="list">${historyRows(page.tasks, "task", api)}</ul>
      </section>
      <section class="section" aria-labelledby="secretary-calls-heading">
        <h2 id="secretary-calls-heading">Звонки</h2>
        <ul class="list">${historyRows(page.calls, "call", api)}</ul>
      </section>
    </article>`;
  }

  const recordName = page.recordType === "task" ? "задания" : "звонка";
  const detailHref = `${api}/secretary/${page.recordType === "task" ? "tasks" : "calls"}/${encodeURIComponent(page.id)}`;
  const facts = page.facts.length
    ? `<ul class="scope-list">${page.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`
    : `<p class="notice">Подтверждённые факты не сохранены.</p>`;
  const turns = page.turns?.length
    ? `<section class="section" aria-labelledby="saved-turns-heading">
        <h2 id="saved-turns-heading">Сохранённые реплики</h2>
        <ul class="list">${page.turns
          .map(
            (turn) => `<li class="row">
              <div class="row-head"><span class="detail-label">Роль</span><span class="detail-value">${escapeHtml(turn.role)}</span></div>
              ${detailValue("ID реплики", turn.id)}
              ${detailValue("Текст", turn.text)}
            </li>`,
          )
          .join("")}</ul>
      </section>`
    : "";
  const transcript = page.transcript === undefined
    ? `<p class="notice">Транскрипция не загружалась автоматически. <a class="link" href="${escapeHtml(`${detailHref}?transcript=true`)}">Открыть этот отчёт с транскрипцией</a>.</p>`
    : `<section class="section" aria-labelledby="transcript-heading">
        <h2 id="transcript-heading">Сохранённая транскрипция</h2>
        <div class="row detail-value">${escapeHtml(page.transcript)}</div>
      </section>`;
  const eventLabels = { task_created: "Задание создано", dial_attempt: "Попытка набора",
    stream_ended: "Поток завершён", state_snapshot: "Сохранённое состояние" };
  const events = page.events?.length ? `<section class="section"><h2>Сохранённые отметки</h2>
    <p class="notice">Поля сохранённой задачи, не полный журнал переходов статуса.</p>
    <ul class="list">${page.events.map(event => `<li class="row">${detailValue("Событие", eventLabels[event.type])}
      ${detailValue("Время", event.at)}${event.status ? detailValue("Статус", event.status) : ""}</li>`).join("")}</ul></section>` : "";

  return `<article class="card">
    <p class="eyebrow">Секретарь · сохранённый отчёт</p>
    <h1>Отчёт ${recordName}</h1>
    <p class="lede">Аккаунт TalkHint: <strong>${escapeHtml(page.account)}</strong></p>
    <div class="list">
      ${detailValue("ID", page.id)}
      ${detailValue("Статус", page.status)}
      ${detailValue("Номер телефона", page.phoneNumber)}
      ${detailValue("Создано", page.createdAt)}
      ${detailValue("Обновлено", page.updatedAt)}
      ${detailValue("Инструкция", page.instruction)}
      ${detailValue("Краткое содержание", page.summary)}
      ${detailValue("Результат", page.outcome)}
      ${detailValue("Следующий шаг", page.nextStep)}
    </div>
    <section class="section" aria-labelledby="verified-facts-heading">
      <h2 id="verified-facts-heading">Подтверждённые факты</h2>
      ${facts}
    </section>
    ${events}
    ${transcript}
    ${turns}
    <p class="notice">Это сохранённый отчёт, а не гарантированное обновление в реальном времени.</p>
    <a class="manage" href="${api}/secretary">Назад к истории</a>
  </article>`;
}
