import React, { useEffect, useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import type { ProjectModelState } from "@shared/projectModel";
import { chapterLayers, getPassportChapterPacket, type PassportLayer } from "@shared/passportChapter";
import "./PassportChapterView.css";

type Props = { state: ProjectModelState };
const noData = "Нет данных";
const progressLabels = [
  ["described", "Описано"], ["implemented", "Реализовано"], ["verified", "Проверено"], ["accepted", "Принято"],
] as const;

function readableDate(value: string | null | undefined) {
  if (!value) return noData;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ru-RU", { dateStyle: "medium" });
}

function safeSourceHref(value: string) {
  try {
    if (value.startsWith("//") || value.includes("\\")) return "";
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (value.startsWith("/") && url.origin !== window.location.origin) return "";
    if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function downloadPacket(packet: NonNullable<ReturnType<typeof getPassportChapterPacket>>) {
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "talkhint-hint-chapter-packet.json";
  link.click();
  URL.revokeObjectURL(url);
}

function Field({ label, value, wide = false }: { label: string; value: string | null | undefined; wide?: boolean }) {
  const shown = value?.trim() || noData;
  return <div className={`hint-data${wide ? " wide" : ""}`}>
    <h4>{label}</h4>
    <p className={shown === noData ? "is-empty" : ""}>{shown}</p>
  </div>;
}

function RecordDetails({ title, fields }: { title: string; fields: [string, string | null | undefined, boolean?][] }) {
  return <details className="hint-record">
    <summary>{title}</summary>
    <dl className="hint-record-body">
      {fields.map(([label, value, full]) => <div className={full ? "full" : ""} key={label}>
        <dt>{label}</dt><dd>{value?.trim() || noData}</dd>
      </div>)}
    </dl>
  </details>;
}

export default function PassportChapterView({ state }: Props) {
  const packet = getPassportChapterPacket(state, "hint");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<PassportLayer>(() => {
    const value = new URLSearchParams(window.location.search).get("layer");
    return chapterLayers.some(([id]) => id === value) ? value as PassportLayer : "product";
  });

  useEffect(() => {
    const syncLayer = () => {
      const value = new URLSearchParams(window.location.search).get("layer");
      setSelectedLayer(chapterLayers.some(([id]) => id === value) ? value as PassportLayer : "product");
    };
    window.addEventListener("popstate", syncLayer);
    return () => window.removeEventListener("popstate", syncLayer);
  }, []);
  useEffect(() => {
    if (selectedNodeId) document.getElementById("hint-linked-record")?.scrollIntoView({ block: "nearest" });
  }, [selectedNodeId]);

  function selectLayer(layer: PassportLayer) {
    setSelectedLayer(layer);
    setSelectedNodeId(null);
    const params = new URLSearchParams(window.location.search);
    params.set("hypothesis", "new-country");
    params.set("view", "book");
    params.set("chapter", "hint");
    params.set("layer", layer);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }

  if (!packet) return <section className="hint-chapter">
    <div className="hint-caveat"><strong>Глава не найдена.</strong> Канонический пакет Hint отсутствует или не прошёл проверку контракта. Другие документы не подменяются.</div>
  </section>;

  const { chapter, context } = packet;
  const layer = chapter.layers[selectedLayer];
  const roleById = new Map(context.roles.map((role) => [role.id, role]));
  const actionById = new Map(context.actions.map((action) => [action.id, action]));
  const sourceById = new Map(chapter.sources.map((source) => [source.id, source]));
  const layerSources = layer.sourceIds.map((id) => sourceById.get(id)).filter((source) => source !== undefined);
  const selectedNode = [...context.roles, ...context.actions].find(node => node.id === selectedNodeId);
  const nodes = state.operatingModel?.revisions.at(-1)?.data.nodes ?? [];
  const nodeName = (id: string | null) => id ? nodes.find(node => node.id === id)?.name || noData : noData;
  const sourceHref = (location: string) => location.startsWith("DOC-")
    ? `/api/admin/product-crew/documents/${encodeURIComponent(location)}/download`
    : safeSourceHref(location);

  function roleLinks(ids: string[]) {
    return ids.map((id) => {
      const role = roleById.get(id);
      return role ? <button type="button" className="pm-btn small" onClick={() => setSelectedNodeId(id)} key={id}>{role.name}<ArrowUpRight size={12} /></button> :
        <span key={id}>{noData}</span>;
    });
  }
  function actionLinks(ids: string[]) {
    return ids.map((id) => {
      const action = actionById.get(id);
      return action ? <button type="button" className="pm-btn small" onClick={() => setSelectedNodeId(id)} key={id}>{action.name}<ArrowUpRight size={12} /></button> :
        <span key={id}>{noData}</span>;
    });
  }
  function progressValue(value: boolean | null) {
    return value === null ? noData : value ? "Да" : "Нет";
  }

  return <section className="hint-chapter">
    <header className="hint-intro">
      <div><span className="hint-kicker">TalkHint · рабочая глава / Hint</span>
        <h2>{chapter.title}</h2>
        <p>{chapter.scope}</p>
      </div>
      <button type="button" className="hint-download" onClick={() => downloadPacket(packet)}><Download size={14} />Скачать полный JSON</button>
    </header>
    <div className="hint-meta">
      <span>СТАТУС <strong>{chapter.status}</strong></span>
      <span>СНИМОК <strong>{readableDate(chapter.snapshotDate)}</strong></span>
      <span>СОБРАНО <strong>{readableDate(chapter.capturedAt)}</strong></span>
      <span>РЕВИЗИЯ ИСТОЧНИКА <strong>{chapter.sourceRevision}</strong></span>
    </div>
    <nav className="hint-layers" aria-label="Слои главы Hint">
      {chapterLayers.map(([id, label], index) => <button type="button" key={id} className="hint-layer-tab"
        aria-current={selectedLayer === id} onClick={() => selectLayer(id)}>
        <small>{String(index + 1).padStart(2, "0")}</small><strong>{label}</strong>
      </button>)}
    </nav>
    <article className="hint-layer-view">
      <header className="hint-layer-head">
        <div><span className="hint-kicker">Слой {String(chapterLayers.findIndex(([id]) => id === selectedLayer) + 1).padStart(2, "0")} / 06</span>
          <h3>{layer.title}</h3><p>{layer.summary}</p>
        </div>
        <div className="hint-progress" aria-label="Состояние слоя">
          {progressLabels.map(([key, label]) => {
            const value = layer.progress[key];
            return <span className={value === true ? "yes" : ""} key={key}>{label}: {progressValue(value)}</span>;
          })}
          <span className={layer.progress.planned ? "planned" : ""}>План: {layer.progress.planned ? "Да" : "Нет"}</span>
        </div>
      </header>
      <div className="hint-data-grid">
        <div className="hint-data">
          <h4>Ответственная роль</h4>
          {layer.leadRoleId ? <div className="hint-ref-list">{roleLinks([layer.leadRoleId])}</div> : <p className="is-empty">{noData}</p>}
        </div>
        <div className="hint-data">
          <h4>Участники</h4>
          {layer.participantRoleIds.length ? <div className="hint-ref-list">{roleLinks(layer.participantRoleIds)}</div> : <p className="is-empty">{noData}</p>}
        </div>
        <Field label="Поручение / ответственность" value={layer.assignment} wide />
        <Field label="Входные данные" value={layer.inputs} />
        <Field label="Результат" value={layer.output} />
        <Field label="Получатель результата" value={layer.receiver} />
        <Field label="Критерий приёмки" value={layer.acceptance} />
        <Field label="Следующий шаг" value={layer.next} />
        <div className="hint-data wide">
          <h4>Связанные действия</h4>
          {layer.actionIds.length ? <div className="hint-ref-list">{actionLinks(layer.actionIds)}</div> : <p className="is-empty">{noData}</p>}
        </div>
        <div className="hint-data wide">
          <h4>Источники этого слоя</h4>
          {layerSources.length ? layerSources.map((source) => {
            const href = sourceHref(source.location);
            const external = /^https?:\/\//i.test(source.location);
            return <div key={source.id}>
              <RecordDetails title={source.title} fields={[
              ["Тип", source.type], ["Дата", readableDate(source.date)], ["Свидетельство", source.evidence, true],
              ["Ограничение / оговорка", source.limitation, true],
            ]} />
              {href ? <a className="hint-inline-link" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{source.location}</a> :
                <span className="hint-null">Для этого источника нет безопасной ссылки.</span>}
            </div>;
          }) : <p className="is-empty">{noData}</p>}
        </div>
        {selectedNode && <section id="hint-linked-record" className="hint-data wide" aria-label="Связанная запись">
          <h4>{selectedNode.kind === "role" ? "Паспорт существующей роли" : "Существующее действие"} · {selectedNode.name}</h4>
          <button className="pm-btn small" type="button" onClick={() => setSelectedNodeId(null)}>Закрыть запись</button>
          <p>Запись структуры, не свидетельство работающего AI-исполнителя. Согласование записи: {selectedNode.status === "agreed" ? "согласовано" : "предложение"}.</p>
          <Field label="Назначение" value={selectedNode.purpose || selectedNode.description} />
          <Field label="Клиент результата" value={nodeName(selectedNode.clientId)} />
          <Field label="Входы / поставщики" value={selectedNode.inputs.map(i => `${i.name} · ${nodeName(i.sourceId)} · ${i.freshness || noData}`).join("\n")} />
          <Field label="Процедура" value={selectedNode.procedure} />
          <Field label="Получатель" value={nodeName(selectedNode.recipientId)} />
          <Field label="Принимающий" value={nodeName(selectedNode.acceptorId)} />
          <Field label="Приёмка" value={selectedNode.success} />
          <Field label="Ресурсы" value={selectedNode.resourceIds.map(nodeName).join("\n")} />
          <Field label="Правила / границы" value={[selectedNode.rules, selectedNode.constraints].filter(Boolean).join("\n")} />
          <Field label="Возврат / исключения" value={selectedNode.exceptions} />
          <Field label="Отчётность" value={selectedNode.reporting ? `${selectedNode.reporting.formName} · ${selectedNode.reporting.formStatus} · ${selectedNode.reporting.storage}` : noData} />
          <Field label="Неизвестное" value={selectedNode.questions} />
        </section>}
        <div className="hint-data wide">
          <h4>Неизвестное и пробелы</h4>
          {layer.unknown.length ? <ul>{layer.unknown.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="is-empty">{noData}</p>}
        </div>
      </div>
      {layer.sourceIds.length > 0 && <details className="hint-raw">
        <summary>Технические ссылки слоя</summary><div className="hint-ref-list">{layer.sourceIds.map((id) => <code key={id}>{id}</code>)}</div>
      </details>}
    </article>

    {selectedLayer === "metrics" && <section className="hint-section">
      <header><h4>Метрики</h4><span>Целевые значения не заданы автоматически</span></header>
      {chapter.metrics.length ? chapter.metrics.map((metric) => <RecordDetails key={metric.id} title={metric.name} fields={[
        ["Определение", metric.definition, true], ["Единица", metric.unit], ["Знаменатель", metric.denominator],
        ["Цель", metric.target === null ? noData : String(metric.target)], ["Факт", metric.actual === null ? noData : String(metric.actual)],
        ["Статус", metric.status], ["Метод", metric.method, true], ["ID", metric.id],
      ]} />) : <p className="hint-caveat">{noData}: метрики не представлены.</p>}
    </section>}

    <details className="hint-section">
      <summary>Все источники главы</summary>
      <header><h4>Источники главы</h4><span>Дата и оговорка сохраняются рядом с доказательством</span></header>
      {chapter.sources.map((source) => {
        const href = sourceHref(source.location);
        const external = /^https?:\/\//i.test(source.location);
        return <div key={source.id}>
          <RecordDetails title={source.title} fields={[
            ["Тип", source.type], ["Дата", readableDate(source.date)], ["Свидетельство", source.evidence, true],
            ["Ограничение / оговорка", source.limitation, true],
          ]} />
          {href ? <a className="hint-inline-link" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{source.location}</a> :
            <span className="hint-null">Для этого источника нет безопасной ссылки.</span>}
        </div>;
      })}
      {!chapter.sources.length && <p className="hint-caveat">{noData}: источники не представлены.</p>}
    </details>

    {selectedLayer === "lab" && <section className="hint-section">
      <header><h4>Лаборатория · запуски и хранение</h4><span>Сохранённые сведения, не запуск</span></header>
      {chapter.labs.length ? chapter.labs.map((lab) => <RecordDetails key={`${lab.name}-${lab.path}`} title={lab.name} fields={[
        ["Путь", lab.path, true], ["Рабочий процесс", lab.workflow, true], ["Хранение", lab.storage, true],
        ["Срок хранения", lab.retention], ["Ограничения", lab.limitations, true],
      ]} />) : <p className="hint-caveat">{noData}: лабораторные площадки не представлены.</p>}
      {chapter.runs.length ? chapter.runs.map((run) => <RecordDetails key={run.id} title={`${run.status} · ${readableDate(run.createdAt)}`} fields={[
        ["Краткий итог", run.summary, true], ["Конфигурация", run.configuration, true], ["Источник", run.source, true],
        ["Ограничения", run.limitations, true], ["Метрики прогона", JSON.stringify(run.metrics, null, 2), true],
      ]} />) : <p className="hint-caveat">Сохранённых запусков нет; отсутствие записи не является результатом лабораторной проверки.</p>}
      <RecordDetails title={`История лаборатории · ${chapter.labHistory.status}`} fields={[
        ["Предложение", chapter.labHistory.proposal, true], ["Поля", chapter.labHistory.fields.join(", ") || noData, true],
        ["Без реализации", chapter.labHistory.noImplementation, true],
      ]} />
    </section>}

    <section className="hint-section">
      <header><h4>Процедуры и передача результата</h4><span>Ответственность из текущего пакета</span></header>
      {chapter.procedures.length ? chapter.procedures.map((procedure) => {
        const role = roleById.get(procedure.roleId);
        return <RecordDetails key={procedure.id} title={procedure.title} fields={[
          ["Роль", role?.name || noData], ["Вход", procedure.input, true], ["Шаги", procedure.steps.join("\n") || noData, true],
          ["Ресурсы", procedure.resources, true], ["Результат", procedure.result, true], ["Получатель", procedure.recipient],
          ["Приёмка", procedure.acceptance, true], ["Возврат / следующий адресат", procedure.returnTo, true],
          ["Срок", procedure.deadline], ["Ограничения", procedure.limitations, true],
        ]} />;
      }) : <p className="hint-caveat">{noData}: процедуры не описаны.</p>}
    </section>

    <section className="hint-section">
      <header><h4>Запросы и проверка</h4><span>Запрос — не подтверждение выполнения</span></header>
      {chapter.requests.map((request) => {
        const receivingAction = request.receivingActionId ? actionById.get(request.receivingActionId) : undefined;
        return <RecordDetails key={request.id} title={request.to} fields={[
          ["Запрос", request.request, true], ["Материалы", request.materials.join("\n") || noData, true],
          ["Статус", request.status], ["Ответ", request.response, true],
          ["Действие-получатель", receivingAction?.name || noData, true],
        ]} />;
      })}
      {chapter.reviewProtocol.length ? chapter.reviewProtocol.map((check) => <RecordDetails key={check.id} title={check.check} fields={[
        ["Статус", check.status], ["Ответственный", check.responsible], ["Свидетельство", check.evidence, true],
        ["Блокер", check.blocker, true],
      ]} />) : <p className="hint-caveat">Проверки не представлены.</p>}
      <p className="hint-caveat"><strong>Протокол исполнения и ревью не выполнен.</strong> Глава — readonly-снимок. Открытие книги, ссылок и скачивание не запускают звонки, агентов, проверки или платные операции.</p>
    </section>

    <section className="hint-section">
      <header><h4>Контекст и границы главы</h4><span>Текущая сохранённая модель</span></header>
      <div className="hint-data-grid">
        <div className="hint-data wide">
          <h4>Связанные возможности</h4>
          {context.features.length ? <div className="hint-ref-list">{context.features.map((feature) => <a
            href="/admin/project-model?hypothesis=new-country&view=book&chapter=features" key={feature.id}>{feature.name}<ArrowUpRight size={12} /></a>)}</div> :
            <p className="is-empty">{noData}</p>}
        </div>
        <Field label="Примечание об идентичности" value={chapter.identityNote} wide />
        <Field label="Период · начало" value={chapter.schedule.startedOn} />
        <Field label="Период · срок" value={chapter.schedule.dueOn} />
        <Field label="Основание периода" value={chapter.schedule.basis} wide />
        <Field label="Длительность проверки Катя" value={`${chapter.katyaDuration.milliseconds / 60000} минут · ${chapter.katyaDuration.scope}`} wide />
        <Field label="Доказательство длительности" value={chapter.katyaDuration.evidence} wide />
        <Field label="Удалённая проверка" value={chapter.katyaDuration.remoteVerified ? "Да" : "Нет"} />
        <Field label="Таймаут тишины отдельно" value={chapter.katyaDuration.separateSilenceTimeout ? "Да" : "Нет"} />
      </div>
      {chapter.limitations.length > 0 && <ul>{chapter.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
      {chapter.nextChapters.length > 0 && <p className="hint-caveat">Следующие главы: {chapter.nextChapters.join(" · ")}</p>}
      <details className="hint-raw"><summary>Показать технические ссылки и недостающие связи</summary>
        <p>Отсутствующие роли: {context.missingRoleIds.join(", ") || noData}</p>
        <p>Отсутствующие действия: {context.missingActionIds.join(", ") || noData}</p>
        <p>Связанные возможности: {context.features.map((feature) => feature.name).join(" · ") || noData}</p>
      </details>
    </section>
  </section>;
}
