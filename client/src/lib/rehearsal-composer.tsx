import React from "react";
import { CircleStop, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import type { RehearsalResult, RehearsalScene, RehearsalVersion } from "@shared/rehearsal";
import { canStartRehearsalVersion, isRehearsalCallEnded, rehearsalVersionReason } from "@/lib/rehearsal-helpers";

export const assignmentPresets = {
  // Supplied by the authenticated snapshot, never a second stale plan or a private phone in a JS bundle.
  Шины: "",
  Парковка: "Узнай о парковке для тягача на одну ночь. Спроси наличие мест. Спроси цену и разрешённое время въезда и выезда. Спроси, нужна ли бронь. Дата пока неизвестна, не выдумывать. Не бронировать и не платить.",
  Мойка: "Узнай о мойке тягача и трейлера. Спроси, моют ли тягач и трейлер. Спроси полную цену. Спроси часы работы и время ожидания. Не бронировать и не платить.",
};
export function rehearsalAssignmentPresets(scenes: readonly RehearsalScene[]) {
  const tires = scenes.find(scene => scene.id === "trailer-tire");
  return { ...assignmentPresets, Шины: tires ? JSON.stringify(tires.plan) : "" };
}

type RehearsalComposerProps = {
  scenes?: RehearsalScene[];
  assignment: string;
  onAssignmentChange: (value: string) => void;
  versionId: string;
  versions: RehearsalVersion[];
  selectedVersion: RehearsalVersion | null;
  onVersionChange: (id: string) => void;
  consentGranted: boolean;
  readyToStart: boolean;
  pending: boolean;
  busy: boolean;
  active: RehearsalResult | null;
  uncertain: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpenMore: () => void;
};

/** Owner-facing single-screen call composer; deliberately independent of auth and network hooks. */
export function RehearsalComposer(props: RehearsalComposerProps) {
  const usePreset = (value: string) => props.onAssignmentChange(value);
  return <section className="main-card">
    <div className="main-heading"><div><p className="overline">СЕКРЕТАРЬ · DEV</p><h1>Репетиция <em>Кати</em></h1></div></div>
    <div className="preset-row" aria-label="Примеры поручений">
      {Object.entries(rehearsalAssignmentPresets(props.scenes ?? [])).map(([label, text]) => <button key={label} type="button" disabled={!text} onClick={() => usePreset(text)}>{label}</button>)}
    </div>
    <label className="assignment-label" htmlFor="assignment">Вставь поручение</label>
    <textarea id="assignment" className="assignment-input" value={props.assignment} onChange={(event) => props.onAssignmentChange(event.target.value)} placeholder={"Напиши своими словами или вставь план из ChatGPT.\nНапример: позвони продавцу, узнай цену и когда удобно посмотреть…"} />
    <div className="version-choice" role="group" aria-label="Версия секретаря">
      <button type="button" id="production-C" className={props.versionId === "production-C" ? "version-option selected" : "version-option"} onClick={() => props.onVersionChange("production-C")} disabled={!props.versions.some((version) => version.id === "production-C")}>Как в бою (C)</button>
      <button type="button" id="dev-C" className={props.versionId === "dev-C" ? "version-option selected" : "version-option"} onClick={() => props.onVersionChange("dev-C")} disabled={!props.versions.some((version) => version.id === "dev-C")}>Новая (Dev)</button>
    </div>
    {props.selectedVersion && <div className="version-inline">
      <span className={canStartRehearsalVersion(props.selectedVersion) ? "availability available" : "availability unavailable"}>{canStartRehearsalVersion(props.selectedVersion) ? "Готова к репетиции" : "Версия недоступна"}</span>
      {props.selectedVersion.id === "production-C" && <span className="honesty-note">Изолированный снимок кода; публикация этой версии не подтверждена.</span>}
      {!canStartRehearsalVersion(props.selectedVersion) && <span className="honesty-note">{rehearsalVersionReason(props.selectedVersion)}</span>}
    </div>}
    <div className="consent-reminder">
      <ShieldCheck size={15} />
      <span>{props.consentGranted ? "Запись разрешена в настройках." : "Перед первым звонком настрой согласие на запись."}</span>
      {!props.consentGranted && <button type="button" onClick={props.onOpenMore}>Настроить</button>}
    </div>
    <div className="call-controls">
      {!props.busy ? <button type="button" className="primary-button call-button" disabled={!props.readyToStart} onClick={props.onStart}>
        {props.pending ? <><LoaderCircle size={18} className="spin" />Подключаемся…</> : <><Play size={17} />Позвонить</>}
      </button> : <button type="button" className="stop-button call-button" onClick={props.onStop} disabled={props.pending && !props.active}><CircleStop size={18} />Завершить звонок</button>}
      {props.active && <div className="live-compact" role="status"><i className={isRehearsalCallEnded(props.active.status) ? "is-ended" : "is-live"} /><span>{props.active.status}{props.active.reason ? ` · ${props.active.reason}` : ""}</span></div>}
      {props.uncertain && <p className="warning-copy">Статус создания неясен. Повторный запуск заблокирован до сверки с сервером.</p>}
    </div>
    {props.active && isRehearsalCallEnded(props.active.status) && <div className="finished-listen">
      <strong>{props.active.rehearsal.review.status === "running" ? "Звонок завершён · готовим разбор" : "Звонок завершён"}</strong>
      <span>Результат и запись доступны в разделе «Ещё».</span>
      {props.active.rehearsal.review.status === "running" && <LoaderCircle size={15} className="spin" />}
    </div>}
    {!props.consentGranted && <p className="privacy-note">Согласие сохраняется один раз в настройках. Переключение версии его не сбрасывает.</p>}
  </section>;
}
