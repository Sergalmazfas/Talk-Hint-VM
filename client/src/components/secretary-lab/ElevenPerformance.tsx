import type { ElevenProfileId, ElevenTiming } from "../../../../shared/elevenLabProfiles";

type Props = {
  profileId?: string;
  configuration?: unknown;
  timings?: ElevenTiming[];
};

const elapsed = (start: number | null | undefined, end: number | null | undefined) => {
  if (typeof start !== "number" || typeof end !== "number") return "Не измерено";
  return `${Math.round(end - start)} мс`;
};

const profileName = (id?: string) => {
  const labels: Record<ElevenProfileId, string> = {
    baseline: "Исходный",
    flash: "Только Flash",
    eager: "Только Eager",
    low: "Только Low",
    brief: "Только короткие ответы",
    optimized: "Оптимизированный · эксперимент",
  };
  return id && id in labels ? labels[id as ElevenProfileId] : id || "Не сообщён";
};

export default function ElevenPerformance({ profileId, configuration, timings = [] }: Props) {
  return <section className="eleven-performance" aria-label="Серверная производительность ElevenLabs">
    <div className="eleven-performance-head">
      <b>Latency · данные серверного отчёта</b>
      <span>{timings.length} {timings.length === 1 ? "реплика" : "реплик"} · профиль: {profileName(profileId)}</span>
    </div>
    <p className="eleven-performance-note">
      Исторический снимок конфигурации именно этого отчёта — не текущий выбор стенда. Аудиособытия сопоставляются последовательно, best-effort; браузерный SDK playback — не акустическая слышимость. playbackClientMs использует отдельные часы браузера и не вычитается из серверных отметок.
    </p>
    <details className="eleven-readiness-context">
      <summary>Снимок configuration из отчёта</summary>
      <pre>{JSON.stringify(configuration ?? "Сервер не сообщил configuration", null, 2)}</pre>
    </details>
    {timings.length ? <div className="eleven-timing-list">
      {timings.map((timing, index) => <article className="eleven-timing-row" key={`${timing.id}-${index}`}>
        <header><span>TURN {index + 1} · {timing.id || "id не сообщён"}</span><span>{timing.cancelled ? "CANCELLED" : timing.correlation || "корреляция не сообщена"}</span></header>
        <div className="eleven-timing-metrics">
          <span>Запрос сервера → первый текст<b>{elapsed(timing.requestReceivedMs, timing.firstTextMs)}</b></span>
          <span>Первый текст → первое аудио<b>{elapsed(timing.firstTextMs, timing.firstAudioMs)}</b></span>
          <span>Получена транскрипция · сервер<b>{typeof timing.transcriptReceivedMs === "number" ? `${Math.round(timing.transcriptReceivedMs)} мс от запуска` : "Не измерено"}</b></span>
          <span>Speech-end → EOT<b>Не измерено</b></span>
          <span>Playback в браузере · отдельные часы<b>{typeof timing.playbackClientMs === "number" ? `${Math.round(timing.playbackClientMs)} мс` : "Не сообщено"}</b></span>
        </div>
        <div className="eleven-checkpoints">
          <b>Checkpoints:</b> {timing.checkpointsMs?.length ? timing.checkpointsMs.map((value) => `${Math.round(value)} мс`).join(" · ") : "нет"} · пропущено: {timing.checkpointSkipped ?? 0}
          <br />Speech-end: {timing.speechEndMs === null ? "не измерено" : typeof timing.speechEndMs === "number" ? `${Math.round(timing.speechEndMs)} мс` : "не сообщено"}
          {" · "}EOT: {timing.endOfTurnMs === null ? "не измерено" : typeof timing.endOfTurnMs === "number" ? `${Math.round(timing.endOfTurnMs)} мс` : "не сообщено"}
          {" · "}server playback telemetry: {timing.playbackTelemetryReceivedMs === null ? "не сообщено" : typeof timing.playbackTelemetryReceivedMs === "number" ? `${Math.round(timing.playbackTelemetryReceivedMs)} мс` : "не сообщено"}
        </div>
        <details className="eleven-readiness-context"><summary>Все исходные метки этой реплики</summary><pre>{JSON.stringify(timing, null, 2)}</pre></details>
      </article>)}
    </div> : <p className="eleven-performance-note">Timing-данных в отчёте нет. Результаты не синтезируются и не подменяются локальными измерениями.</p>}
  </section>;
}
