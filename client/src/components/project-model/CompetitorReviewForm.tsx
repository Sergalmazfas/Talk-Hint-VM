import React, { useState } from "react";
import { assessmentCategories, assessmentParameters, newReview, type AssessmentCategory, type CompetitorReviewInput } from "@shared/competitorAssessments";
const applicability = { not_tested: "Не проверено", applicable: "Применимо / проверено", not_applicable: "Неприменимо", absent: "Функция отсутствует по проверке" };
function NumberInput({ value, onChange, min = 1, max = 10, disabled = false }: { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; disabled?: boolean }) {
  return <input disabled={disabled} type="number" min={min} max={max} step={min === 0 ? 1 : "any"} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
}
const timeValue = (s: string | null) => s ? new Date(Date.parse(s) - new Date(s).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
export default function CompetitorReviewForm({ category, busy, onSave, onCancel, initialReview }: {
  category: AssessmentCategory; busy: boolean; onSave: (review: CompetitorReviewInput, requestId: string) => Promise<boolean>; onCancel: () => void;
  initialReview?: CompetitorReviewInput;
}) {
  const [review, setReview] = useState(() => initialReview ? structuredClone(initialReview) : newReview(category));
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const patch = (p: Partial<CompetitorReviewInput>) => setReview(r => ({ ...r, ...p }));
  const support = review.supportExperience;
  const supportNotContacted = category === "support" && !(support?.contactedAt && support.issue.trim() && support.channel.trim());
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (sending || busy) return;
    if (review.parameters.some(p => p.score !== null && (p.applicability !== "applicable" || !(p.observations.trim() || p.impression.trim())))) {
      setError("Для каждого оценённого параметра выберите «Применимо / проверено» и опишите наблюдение или впечатление."); return;
    }
    if (support?.outcome === "resolved" && (!support.resolvedAt || !support.resolution.trim())) {
      setError("Укажите время и описание фактического решения; первый ответ ещё не решение."); return;
    }
    if (supportNotContacted && (review.score !== null || review.parameters.some(p => p.score !== null))) {
      setError("Для балла поддержки нужны проблема, канал и время реального обращения."); return;
    }
    setSending(true); setError("");
    try { if (!await onSave(review, requestId)) setError("Не сохранено. Введённые данные остались в форме. При конфликте версии обновите страницу, предварительно скопировав заметки."); }
    catch { setError("Не удалось сохранить; заметки остаются в форме."); }
    finally { setSending(false); }
  }
  return <form className="pm-review-form" onSubmit={save}>
    <h4>Новая проверка: {assessmentCategories[category]}</h4>
    <p>Только ваш реальный опыт. Балл можно не ставить. Автоматического среднего нет; отсутствие аватара не штраф.</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || sending}><legend>Кто и что проверял</legend>
      <div className="pm-review-grid">
        <label>Автор проверки<input required value={review.author} onChange={e => patch({ author: e.target.value })} /></label>
        <label>Дата проверки<input required type="date" max={new Date().toISOString().slice(0, 10)} value={review.testedAt} onChange={e => patch({ testedAt: e.target.value })} /></label>
        <label>Платформа / устройство<input required placeholder="iOS, iPhone…" value={review.platform} onChange={e => patch({ platform: e.target.value })} /></label>
        <label>Версия приложения, если известна<input value={review.appVersion} onChange={e => patch({ appVersion: e.target.value })} /></label>
        <label>Итоговый балл 1–10 (необязательно)<NumberInput disabled={supportNotContacted} value={review.score} onChange={score => patch({ score })} /></label>
      </div>
      {supportNotContacted && <p>Балл поддержки пока недоступен: сначала зафиксируйте реальное обращение ниже — проблему, канал и время.</p>}
      {(["rationale", "observations", "impression", "likes", "problems", "examples"] as const).map(key => <label key={key}>{
        { rationale: "Почему такой балл / вывод", observations: "Наблюдаемое поведение", impression: "Личное впечатление", likes: "Что понравилось", problems: "Проблемы", examples: "Конкретные примеры и сценарии" }[key]
      }<textarea required={key === "rationale" && review.score !== null} value={review[key]} onChange={e => patch({ [key]: e.target.value })} /></label>)}
      <h4>Параметры и сценарии</h4>
      {review.parameters.map((parameter, i) => {
        const update = (value: Partial<typeof parameter>) => patch({ parameters: review.parameters.map((p, j) => j === i ? { ...p, ...value } : p) });
        return <details className="pm-review-parameter" key={parameter.key}>
          <summary>{(assessmentParameters[category] as Record<string, string>)[parameter.key]}</summary>
          <div className="pm-review-grid">
            <label>Применимость<select value={parameter.applicability} onChange={e => update({ applicability: e.target.value as typeof parameter.applicability })}>{Object.entries(applicability).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Балл параметра 1–10<NumberInput disabled={supportNotContacted} value={parameter.score} onChange={score => update({ score })} /></label>
            {category === "usability" && <label>Количество шагов<NumberInput min={0} max={10000} value={parameter.steps} onChange={steps => update({ steps })} /></label>}
          </div>
          {(["observations", "impression", "statuses", "issues", "result"] as const).map(key => <label key={key}>{
            { observations: "Наблюдения / пример", impression: "Личное впечатление", statuses: "Понятность статусов и ошибок", issues: "Затруднения", result: "Фактический результат / причина неприменимости" }[key]
          }<textarea value={parameter[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}
        </details>;
      })}
      {support && <section><h4>Наше реальное обращение</h4><p>Ответ бота сам по себе не решение. Даты вводятся в часовом поясе устройства, сохраняются с точным временем.</p>
        {(["issue", "channel", "resolution", "usefulness"] as const).map(key => <label key={key}>{
          { issue: "С какой проблемой обратились", channel: "Через какой канал", resolution: "Как и чем завершилось / решение", usefulness: "Полезность ответа" }[key]
        }<textarea value={support[key]} onChange={e => patch({ supportExperience: { ...support, [key]: e.target.value } })} /></label>)}
        <div className="pm-review-grid">
          {(["contactedAt", "firstResponseAt", "resolvedAt"] as const).map(key => <label key={key}>{
            { contactedAt: "Дата и время обращения", firstResponseAt: "Первый ответ", resolvedAt: "Время решения" }[key]
          }<input type="datetime-local" value={timeValue(support[key])} onChange={e => patch({ supportExperience: { ...support, [key]: e.target.value ? new Date(e.target.value).toISOString() : null } })} /></label>)}
          <label>Кто ответил<select value={support.responder} onChange={e => patch({ supportExperience: { ...support, responder: e.target.value as typeof support.responder } })}>
            <option value="unknown">Неизвестно / ещё нет ответа</option><option value="bot">Бот</option><option value="human">Сотрудник</option></select></label>
          <label>Фактический исход<select value={support.outcome} onChange={e => patch({ supportExperience: { ...support, outcome: e.target.value as typeof support.outcome } })}>
            <option value="unknown">Не установлен</option><option value="unresolved">Не решено</option><option value="partial">Частично</option><option value="resolved">Решено — с описанием и временем</option></select></label>
          <label>Повторные обращения<NumberInput min={0} max={10000} value={support.repeatContacts} onChange={repeatContacts => patch({ supportExperience: { ...support, repeatContacts } })} /></label>
        </div>
      </section>}
      <h4>Скриншоты и другие материалы</h4><p>Сохраняются ссылки HTTPS без токенов, не копии в новом хранилище. Материалы открываются отдельно.</p>
      {review.materials.map((item, i) => <div className="pm-review-grid" key={i}>
        <label>Название<input required value={item.title} onChange={e => patch({ materials: review.materials.map((v, j) => i === j ? { ...v, title: e.target.value } : v) })} /></label>
        <label>HTTPS-ссылка<input required type="url" value={item.url} onChange={e => patch({ materials: review.materials.map((v, j) => i === j ? { ...v, url: e.target.value } : v) })} /></label>
        <button type="button" className="pm-btn small" onClick={() => patch({ materials: review.materials.filter((_, j) => i !== j) })}>Убрать материал</button>
      </div>)}
      <button type="button" className="pm-btn small" disabled={review.materials.length >= 20} onClick={() => patch({ materials: [...review.materials, { title: "", url: "" }] })}>Добавить ссылку на материал</button>
      <div className="pm-review-actions"><button className="pm-btn primary" type="submit">Сохранить проверку{review.score === null ? " без балла" : ""}</button><button type="button" className="pm-btn" onClick={onCancel}>Отмена</button></div>
    </fieldset>
  </form>;
}
