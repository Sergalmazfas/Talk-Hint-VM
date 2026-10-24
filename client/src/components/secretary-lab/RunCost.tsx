import type { LabRunCost } from "../../../../shared/secretaryLabCost";
import "./run-cost.css";

const money = (value: number | null) => value === null ? "Неизвестно" : `$${value.toFixed(6)}`;
const status = { estimated: "Оценка", included: "Включено", unknown: "Неизвестно", not_applicable: "Не используется" };
const units = { minute: "мин", million_tokens: "млн токенов", item: "ед." };
export default function RunCost({ cost }: { cost?: LabRunCost }) {
  if (!cost) return <section className="lab-run-cost"><h4>Стоимость не измерялась</h4><p>У этого отчёта нет тарифного снимка. Старый тест не пересчитывается по сегодняшним ценам; это не $0.</p></section>;
  return <section className="lab-run-cost" aria-label="Стоимость теста">
    <h4>Стоимость теста · {cost.complete ? "оценка" : "неполная оценка"}</h4>
    <p><b>{cost.complete ? `Итого: ${money(cost.estimatedTotalUsd)}` : `Полная сумма неизвестна · известная часть: ${money(cost.knownSubtotalUsd)}`}</b></p>
    <p>Подтверждённое списание: {money(cost.confirmedChargeUsd)}. Длительность: {cost.durationSeconds === null ? "неизвестна / ещё не завершён" : `${cost.durationSeconds.toFixed(2)} сек.`}</p>
    <p>{cost.durationBasis === "provider_reported_duration" ? "Длительность сообщена провайдером; это не подтверждение оплаты." : "Длительность измерена локально от подключения аудио до остановки; это не биллинговый таймер."}</p>
    <p>Модель: {cost.model || "неизвестна"} · голос: {cost.voice || "неизвестен"}{cost.profileId ? ` · профиль: ${cost.profileId}` : ""}{cost.ttsModel ? ` · TTS: ${cost.ttsModel}` : ""}</p>
    {cost.tokenUsage && <p>Токены Engine: input {cost.tokenUsage.input}, из них cached {cost.tokenUsage.cachedInput}, output {cost.tokenUsage.output}. Usage получен для {cost.tokenUsage.measuredRequests} из {cost.tokenUsage.requests} запросов.</p>}
    {cost.realtimeUsage && <p>OpenAI Realtime: usage получен для {cost.realtimeUsage.measuredRequests} из {cost.realtimeUsage.requests} ответов. Расход text/audio и кэша разнесён ниже.</p>}
    <div className="lab-cost-lines">{cost.lines.map((line, index) => <div className="lab-cost-line" key={index}>
      <b>{line.label}</b><span>{status[line.status]}{line.status === "estimated" ? ` · ${money(line.amountUsd)}` : ""}</span>
      <small>{line.quantity === null ? "Расход неизвестен / неприменим" : line.quantity.toLocaleString("ru", { maximumFractionDigits: 8 })} {units[line.unit]} × {line.rateUsd === null ? "ставка неизвестна / неприменима" : `${money(line.rateUsd)}/${units[line.unit]}`}</small>
      <p>{line.note}</p>
    </div>)}</div>
    <details><summary>Источники и тарифный снимок · проверено {cost.tariff.checkedAt}</summary>
      <p>Снимок сохранён {cost.tariff.capturedAt}. Исторические отчёты не переоцениваются при смене тарифов.</p>
      <div className="lab-cost-sources">{cost.tariff.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div>
      {cost.notes.map((note, i) => <p key={i}>{note}</p>)}
    </details>
  </section>;
}
