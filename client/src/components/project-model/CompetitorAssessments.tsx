import React, { useRef, useState } from "react";
import type { ModelCommand } from "@shared/projectModel";
import type { CompetitorSnapshot } from "@shared/projectCompetitors";
import {
  assessmentCategories, assessmentParameters, latestAssessment, assessmentScore, assessmentHref,
  supportFields, supportEvidenceLabels, type AssessmentCategory, type CompetitorReview, type SupportResearch,
  type CompetitorReviewInput,
} from "@shared/competitorAssessments";
import CompetitorReviewForm from "./CompetitorReviewForm";
type Submit = (command: ModelCommand) => Promise<boolean>;
const categories = Object.keys(assessmentCategories) as AssessmentCategory[];
const dateText = (date: string) => new Date(date).toLocaleString("ru-RU", date.length === 10 ? { dateStyle: "medium", timeZone: "UTC" } : { dateStyle: "medium", timeStyle: "short" });
export function AssessmentLinks({ snapshot, id, onSelect }: { snapshot: CompetitorSnapshot; id: string; onSelect?: (category: AssessmentCategory) => void }) {
  return <div className="pm-review-scores">{categories.map(category => {
    const review = latestAssessment(snapshot, category);
    return <a key={category} className="pm-review-score" href={assessmentHref(id, category)} onClick={onSelect ? e => { e.preventDefault(); onSelect(category); } : undefined}>
      <strong>{assessmentCategories[category]}</strong><b>{assessmentScore(review, category)}</b>
      <small>{review ? `${review.author} · ${dateText(review.testedAt)} · ${review.platform} · версия ${review.appVersion || "не указана"}` : "Личная проверка ещё не сохранена"}</small>
    </a>;
  })}</div>;
}
function ReviewView({ review }: { review: CompetitorReview }) {
  const support = review.supportExperience;
  const duration = (end: string | null) => support?.contactedAt && end ? `${Math.round((Date.parse(end) - Date.parse(support.contactedAt)) / 60000 * 10) / 10} мин` : "Не установлено";
  return <article className="pm-review-saved">
    <p>{review.author} · {dateText(review.testedAt)} · {review.platform} · версия {review.appVersion || "не указана"} · {assessmentScore(review, review.category)}</p>
    {(["rationale", "observations", "impression", "likes", "problems", "examples"] as const).map(key => review[key] && <div key={key}><strong>{
      { rationale: "Обоснование", observations: "Наблюдаемое поведение", impression: "Личное впечатление", likes: "Что понравилось", problems: "Проблемы", examples: "Примеры" }[key]
    }</strong><p>{review[key]}</p></div>)}
    {review.parameters.map(parameter => <details key={parameter.key}><summary>{(assessmentParameters[review.category] as Record<string, string>)[parameter.key]} · {parameter.score === null ? "Без балла" : `${parameter.score} / 10`}</summary>
      <p>Применимость: {{ not_tested: "Не проверено", applicable: "Применимо / проверено", not_applicable: "Неприменимо", absent: "Функция отсутствует по проверке" }[parameter.applicability]} · Шаги: {parameter.steps ?? "не измерено"}</p>
      <p>Наблюдения: {parameter.observations || "—"}</p><p>Впечатление: {parameter.impression || "—"}</p><p>Статусы/ошибки: {parameter.statuses || "—"}</p><p>Затруднения: {parameter.issues || "—"}</p><p>Результат: {parameter.result || "—"}</p>
    </details>)}
    {support && <section><h5>Реальное обращение · не публичные обещания</h5>
      <p>Проблема: {support.issue || "не указана"} · Канал: {support.channel || "не указан"}</p>
      <p>Обратились: {support.contactedAt ? dateText(support.contactedAt) : "не зафиксировано"}</p>
      <p>Первый ответ: {support.firstResponseAt ? dateText(support.firstResponseAt) : "не зафиксирован"} · Ожидание: {duration(support.firstResponseAt)}</p>
      <p>Ответил: {{ unknown: "не установлено", bot: "бот", human: "сотрудник" }[support.responder]}</p>
      <p>Исход: {{ unknown: "не установлен", unresolved: "не решено", partial: "частично", resolved: "решено" }[support.outcome]} · Решение: {support.resolvedAt ? dateText(support.resolvedAt) : "не зафиксировано"} · До решения: {duration(support.resolvedAt)}</p>
      <p>{support.resolution}</p><p>Полезность: {support.usefulness || "не описана"} · Повторные обращения: {support.repeatContacts ?? "не указаны"}</p>
    </section>}
    <ul>{review.materials.map((m, i) => <li key={i}><a href={m.url} target="_blank" rel="noreferrer">{m.title}</a></li>)}</ul>
    <small>Запись сохранена: {dateText(review.savedAt)}</small>
  </article>;
}
function PublicSupport({ value, id, version, submit, busy }: { value?: SupportResearch; id: string; version: number; submit?: Submit; busy: boolean }) {
  const [draft, setDraft] = useState<SupportResearch | null>(null);
  const [baseVersion, setBaseVersion] = useState(version);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  return <section className="pm-public-support"><h4>Что заявляет компания</h4><p>Публичные источники — не наш опыт и не оценка качества. Helpdesk, база знаний и CRM не взаимозаменяемы.</p>
    {Object.entries(supportFields).map(([key, label]) => {
      const fact = value?.[key as keyof SupportResearch];
      return <article className="pm-dossier-fact" key={key}><strong>{label}</strong>
        <p>{fact?.value ?? (["helpdesk", "knowledgePlatform", "crm"].includes(key) ? "Не установлено" : "Не подтверждено")}</p>
        {fact && <><small>{supportEvidenceLabels[fact.status]} · Проверено: {fact.checkedAt ? dateText(fact.checkedAt) : "дата не указана"}</small><p>{fact.note}</p><div className="pm-cr-sources">{fact.sourceUrls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}</div></>}
      </article>;
    })}
    {submit && !draft && <button className="pm-btn small" type="button" disabled={busy} onClick={() => { setDraft(structuredClone(value ?? {})); setBaseVersion(version); }}>Обновить публичные сведения вручную</button>}
    {draft && <form className="pm-review-form" onSubmit={async e => {
      e.preventDefault(); if (sending || busy) return; setSending(true); setError("");
      try { if (await submit!({ type: "saveCompetitorSupport", id, baseVersion, support: draft })) setDraft(null);
        else setError("Не сохранено; данные остались в форме. При конфликте перечитайте актуальную карточку."); }
      catch { setError("Ошибка сохранения; данные остались в форме."); } finally { setSending(false); }
    }}>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || sending}><legend>Проверенные публичные сведения</legend>
        {Object.entries(supportFields).map(([key, label]) => {
          const k = key as keyof SupportResearch, fact = draft[k] ?? { value: null, status: "unknown", sourceUrls: [], checkedAt: null, note: "" };
          const patch = (p: Partial<typeof fact>) => setDraft(d => ({ ...d, [k]: { ...fact, ...p } }));
          return <details key={k}><summary>{label}</summary>
            <label>Сведение (пусто = неизвестно)<textarea value={fact.value ?? ""} onChange={e => patch({ value: e.target.value.trim() ? e.target.value : null })} /></label>
            <label>Степень подтверждения<select value={fact.status} onChange={e => patch({ status: e.target.value as typeof fact.status })}>{Object.entries(supportEvidenceLabels).map(([s, text]) => <option key={s} value={s}>{text}</option>)}</select></label>
            <label>Источники HTTPS, по одному на строке<textarea value={fact.sourceUrls.join("\n")} onChange={e => patch({ sourceUrls: e.target.value.split("\n").filter(Boolean) })} /></label>
            <label>Дата проверки<input type="date" value={fact.checkedAt ?? ""} onChange={e => patch({ checkedAt: e.target.value || null })} /></label>
            <label>Основание / ограничения<textarea value={fact.note} onChange={e => patch({ note: e.target.value })} /></label>
          </details>;
        })}
        <div className="pm-review-actions"><button type="submit" className="pm-btn primary">Сохранить публичные сведения</button><button type="button" className="pm-btn" onClick={() => setDraft(null)}>Отмена</button></div>
      </fieldset>
    </form>}
  </section>;
}
export default function CompetitorAssessments({ snapshot, id, version, submit, busy = false, initialCategory }: {
  snapshot: CompetitorSnapshot; id: string; version: number; submit?: Submit; busy?: boolean; initialCategory?: AssessmentCategory;
}) {
  const [category, setCategory] = useState<AssessmentCategory | null>(() => {
    const query = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("review");
    return initialCategory ?? (categories.includes(query as AssessmentCategory) ? query as AssessmentCategory : null);
  });
  const [draftCategory, setDraftCategory] = useState<AssessmentCategory | null>(null);
  const [draftSeed, setDraftSeed] = useState<CompetitorReviewInput | undefined>();
  const baseVersion = useRef(version);
  const [notice, setNotice] = useState("");
  const reviews = category ? snapshot.assessments?.[category] ?? [] : [];
  return <section className="pm-assessments" id="reviews">
    <h3>Наши оценки и проверки</h3><p>Дизайн, удобство и поддержка независимы. Баллы выставляет Сергей после личной проверки, не AI и не App Store.</p>
    <AssessmentLinks snapshot={snapshot} id={id} onSelect={setCategory} />
    {notice && <p role="status">{notice}</p>}
    {category && <section className="pm-review-detail" aria-label={`Разбор: ${assessmentCategories[category]}`}>
      <div className="pm-review-actions"><h4>{assessmentCategories[category]} · подробный разбор</h4><button className="pm-btn small" type="button" onClick={() => setCategory(null)}>Свернуть разбор</button></div>
      {category === "support" && <PublicSupport key={id} value={snapshot.supportResearch} id={id} version={version} submit={draftCategory ? undefined : submit} busy={busy} />}
      <h4>Наш личный опыт</h4>
      {reviews.length ? <ReviewView review={reviews.at(-1)!} /> : <p>{category === "support" ? "Не проверено. Реальных обращений ещё не зафиксировано." : "Не оценено. Личная проверка ещё не сохранена."}</p>}
      <details><summary>История проверок ({reviews.length})</summary>{reviews.slice().reverse().map(review => <ReviewView key={review.id} review={review} />)}</details>
      {submit && !draftCategory && <div className="pm-review-actions">
        <button className="pm-btn primary" type="button" disabled={busy} onClick={() => { baseVersion.current = version; setDraftSeed(undefined); setDraftCategory(category); setNotice(""); }}>Добавить новую личную проверку</button>
        {reviews.length > 0 && <button className="pm-btn small" type="button" disabled={busy} onClick={() => {
          const { id: _id, savedAt: _at, recordedBy: _actor, ...input } = reviews.at(-1)!;
          baseVersion.current = version; setDraftSeed(input); setDraftCategory(category); setNotice("");
        }}>Уточнить последнюю — сохранить новой записью</button>}
      </div>}
    </section>}
    {draftCategory && submit && <CompetitorReviewForm key={draftCategory} category={draftCategory} initialReview={draftSeed} busy={busy} onCancel={() => setDraftCategory(null)} onSave={async (review, requestId) => {
      const ok = await submit({ type: "addCompetitorReview", id, baseVersion: baseVersion.current, requestId, review });
      if (ok) { setDraftCategory(null); setCategory(review.category); setNotice("Проверка сохранена. Предыдущая история не изменена."); }
      return ok;
    }} />}
  </section>;
}
