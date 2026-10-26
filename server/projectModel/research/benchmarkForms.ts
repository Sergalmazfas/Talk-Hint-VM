import type { ProjectModelState, ModelCommand } from "../../../shared/projectModel";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { emptyReporting } from "../../../shared/actionReporting";
import { readHypothesis, applyHypothesisCommand } from "../hypotheses";
import { benchmarkMarker } from "./benchmarkChain";
import { benchmarkChain, chainId } from "./benchmarkChainSpec";

export const candidatesFormId = "DOC-BENCH-CANDIDATES-TEMPLATE";
export const decisionFormId = "DOC-BENCH-LIST-DECISION-TEMPLATE";
export const formsRoadmapTitle = "TalkHint — единый roadmap работы crew над продуктом — v6 — бланки бенчмаркинга";
const marker = "<!-- BENCHMARK-FORMS-DRAFTS-V1 -->";
const docsPath = "/admin/project-model?hypothesis=new-country&view=overview&tab=documents";
export const reportStorage = "Модель проекта → new-country → Документы. Заполненный результат — отдельный документ, не перезапись шаблона; его ID указывается в основаниях узла результата действия. Правки документов и модели сохраняются в истории.";
const common = `**Статус: черновик v1, не утверждён Сергеем.** Это бланк, не проведённое исследование и не принятое решение.
Код действия, автор/должность, дата составления, период/граница поиска, версия исходного описания TalkHint и версия бланка: **заполнить**.
Источник сведений, статус доказательности, дата публикации (если известна) и дата проверки указываются у существенного утверждения. Неизвестное не равно отсутствию или нулю.
`;
export const candidatesFormText = `# Найденные кандидаты в конкуренты
${common}
## Для чего и кому
Выход MKT.2.1 «Поиск конкурентов», автор — существующий P-BENCH, аналитик конкурентов.
Получатель — MKT.2.9, рассмотрение списка. Соответствие руководителя бенчмаркинга существующему HEAD.01 пока предложено; отдельная новая должность не создана.
## Входы и ресурсы
Актуальное описание TalkHint и аудитории; критерии поиска; интернет-поиск; официальные сайты; App Store и Google Play; существующий список.
Зафиксировать ссылки/версии описания, критериев и исходного списка. Если критерии не согласованы — обозначить это и запросить уточнение.
## Карточка кандидата — повторить для каждого найденного
| Поле | Содержание |
|---|---|
| Название продукта и разработчик | Заполнить; не смешивать одноимённые приложения |
| Ссылки | Официальный сайт, точная страница App Store / Google Play, справка |
| Аудитория | Для кого сервис; география, язык и ситуация, если подтверждены |
| Задачи и действия сервиса | Что помогает сделать; заявления отдельно от проверки |
| Пересечение с TalkHint | Сопоставимые действия и клиентские задачи, версия описания TalkHint |
| Отличия и дополнительные действия | Отдельно подтверждённое, заявленное и предполагаемое |
| Основание включения | Почему кандидат релевантен согласованным критериям |
| Источники и даты | URL у каждого существенного вывода; дата данных и дата проверки |
| Непроверенное и противоречия | Какие сведения отсутствуют и что проверить дальше |
| Предложение для обсуждения | Возможность для продукта, ещё не доказанная польза и не разрешение разработки |

## Условный пример Сергея: пять действий против шести
Это **не факт о конкретном конкуренте**. Если в сопоставимых описаниях TalkHint выделены пять действий, а у кандидата шесть:
1. Перечислить действия обеих сторон и показать соответствия по задаче пользователя, а не только по названиям.
2. Выделить дополнительное действие X; указать первичный источник, дату и статус проверки.
3. Если данные только заявлены, написать «заявленное дополнительное действие X; требуется проверка».
4. Предложить продукту обсудить X: кому может быть полезно и какой вопрос проверить. Не объявлять доказанными работоспособность, спрос, преимущество или причинность роста.
Число «шесть» само по себе не доказывает превосходство сервиса.
## Передача и возврат
Кандидаты, основания, источники и неизвестное должны быть прослеживаемы. MKT.2.9 принимает достаточность списка либо возвращает конкретные вопросы аналитику. Молчание не является приёмкой.
## Как заполнить и сохранить
${reportStorage}
[Открыть существующий раздел «Документы»](${docsPath}): «Новый документ» → перенести и заполнить бланк → сохранить под названием «Найденные кандидаты — [дата/версия]».
В карточке результата MKT.2.1.R указать ID заполненного документа в «Основаниях». Изменение бланка — редактирование этого шаблона, не подмена результата.
Вариант через уже существующее управление Product Crew: create_work → submit_result → review_result; результат сохраняется документом со связанной работой и явной приёмкой/возвратом. Это не запускает автономного исполнителя.
`;
export const decisionFormText = `# Решение по списку конкурентов
${common}
## Для чего и кому
Выход MKT.2.9 «Утвердить найденных конкурентов». Предлагаемый ответственный — существующий HEAD.01 «Рынок и развитие предложения» в функции руководителя бенчмаркинга. Назначение функции ещё обсуждается, нового руководителя не создаём.
Вход: ссылка/ID и версия заполненного отчёта MKT.2.1 «Найденные кандидаты в конкуренты», критерии поиска и актуальное описание TalkHint.
## Решение — строка на кандидата
| Кандидат и ссылки | Решение: включить / отклонить / уточнить | Основание со ссылкой на критерий/источник | Что уточнить | Кто отвечает за решение | Дата решения |
|---|---|---|---|---|---|
| Заполнить | Выбрать явно, не оставлять подразумеваемым | Заполнить | Указать вопрос либо «не требуется» с основанием | Указать должность; фактического автора только если известен | Фактическая дата |

Обязательные общие поля: ID/версия входного отчёта, версия данного бланка, граница рассмотрения и дальнейшая передача.
## Передача и контроль
«Включить»: согласованный для этой работы список передать MKT.2.2 для сбора и проверки данных.
«Уточнить»: вопрос, поставщик и адресный возврат аналитику MKT.2.1; срок отдельно согласуется.
«Отклонить»: сохранить основание и уведомить аналитика; кандидата и историю не удалять.
Спор по полномочиям или существенным основаниям — владельцу; сам бланк не выдаёт новых полномочий.
Приёмка списка не означает утверждение бланка, разрешение платного теста, внешнего действия или выпуска продукта.
## Хранение
${reportStorage}
[Раздел «Документы»](${docsPath}): отдельный заполненный документ «Решение по списку конкурентов — [дата/версия]», ID в основаниях MKT.2.9.R.
Основание изменения решения и предыдущая версия сохраняются существующим механизмом документов/решений; не достраивать прошлые события.
`;

export function prepareBenchmarkForms(root: ProjectModelState, actor: string): ProjectModelState {
  const old = readHypothesis(root, "new-country"), rev = old.operatingModel?.revisions.at(-1);
  const roadmap = old.documents.find(d => d.text.includes(benchmarkMarker));
  if (!rev || !roadmap) throw Error("Existing linked benchmarking model required");
  if (roadmap.text.includes(marker)) return root;
  let next = root;
  const apply = (c: ModelCommand) => { next = applyHypothesisCommand(next, "new-country", c, actor); };
  const forms = [
    { id: candidatesFormId, title: "Найденные кандидаты в конкуренты — бланк v1 (черновик)", text: candidatesFormText },
    { id: decisionFormId, title: "Решение по списку конкурентов — бланк v1 (черновик)", text: decisionFormText },
  ];
  for (const form of forms) {
    if (old.documents.some(d => d.id === form.id || d.title === form.title))
      throw Error("Form already exists; reconcile existing version instead of overwriting");
    apply({ type: "createDocument", ...form, url: "", elementIds: [] });
  }
  const data = structuredClone(rev.data);
  const get = (id: string) => {
    const n = data.nodes.find(n => n.id === id); if (!n) throw Error(`Missing existing identity ${id}`); return n;
  };
  for (const s of benchmarkChain) {
    const n = get(chainId(s.key));
    n.reporting ??= { ...emptyReporting(), formName: `Отчёт / запись результата: ${get(`${n.id}-result`).name}`,
      storage: reportStorage };
  }
  const search = get(chainId("scan")), review = get(chainId("list-review"));
  search.name = "Поиск конкурентов";
  search.reporting = { required: true, formName: "Найденные кандидаты в конкуренты", templateDocumentId: candidatesFormId,
    templateVersion: "1", storage: reportStorage, formStatus: "draft", approvalEvidence: "" };
  review.name = "Утвердить найденных конкурентов";
  review.reporting = { required: true, formName: "Решение по списку конкурентов", templateDocumentId: decisionFormId,
    templateVersion: "1", storage: reportStorage, formStatus: "draft", approvalEvidence: "" };
  review.status = "proposal";
  review.description += "\nУточнение владельца: предложенная должность «руководитель бенчмаркинга» сопоставлена существующему HEAD.01; назначение функции требует обсуждения. Роль и паспорт не дублируются.";
  review.register!.approval = "discussion";
  review.register!.proposalReason = "Предлагаем HEAD.01 как ответственную управленческую роль бенчмаркинга; не создавать дублирующую должность.";
  search.referenceIds = Array.from(new Set([...search.referenceIds, candidatesFormId]));
  review.referenceIds = Array.from(new Set([...review.referenceIds, decisionFormId]));
  const resources = [
    ["description", "Описание TalkHint и аудитории", "Актуальная версия из PRD.1.9; факты реализации подтверждает техника. Не браузерный TEST-контекст.", [chainId("product-reference")]],
    ["criteria", "Критерии поиска конкурентов", "Клиентская задача, аудитория, сценарии и границы включения; содержание согласуется, не считать утверждённым.", [chainId("context-check")]],
    ["sites", "Официальные сайты и справка конкурентов", "Первичные публичные страницы с URL и датой; доступность и заявления проверяются отдельно.", ["competitor-monitor"]],
    ["stores", "App Store / Google Play", "Точные страницы приложений и разработчиков: https://apps.apple.com/ ; https://play.google.com/store/apps . Не подтверждают загрузки или весь состав тарифа.", ["competitor-monitor"]],
    ["list", "Существующий список конкурентов", "Использовать существующий справочник конкурентов новой гипотезы и историю MKT.2; ресурс — ссылка, не второй список.", ["competitor-monitor"]],
  ] as const;
  for (const [key, name, description, refs] of resources) {
    const id = `benchmark-resource-${key}`;
    if (data.nodes.some(n => n.id === id)) throw Error("Resource identity exists; reconcile before updating");
    const n = emptyWorkNode(id, `RES.BENCH.${key.toUpperCase()}`, name, "resource", "competitor-monitor");
    Object.assign(n, { description, resourceState: "required", roleId: "benchmark-role-reference", referenceIds: [...refs],
      questions: "Ресурс необходим; доступ, актуальность и достаточность проверяются до работы. API и исполнители не подключены." });
    data.nodes.push(n);
    if (!search.resourceIds.includes(id)) search.resourceIds.push(id);
  }
  if (!search.resourceIds.includes("search-resource")) search.resourceIds.push("search-resource");
  for (const key of ["description", "criteria", "list"]) {
    const id = `benchmark-resource-${key}`;
    if (!review.resourceIds.includes(id)) review.resourceIds.push(id);
  }
  const note = "\nОтчётность вынесена в отдельные поля реестра. Для MKT.2.1 и MKT.2.9 подготовлены бланки v1 — черновики; прежняя пометка «требуется разработать» сохранена в истории.";
  search.questions = "Бланк v1 подготовлен; требуется совместная проработка и согласование Сергеем." + note;
  review.questions = search.questions;
  for (const n of [search, review]) {
    const result = get(`${n.id}-result`);
    result.storage = reportStorage;
    n.procedure += `\nЗаполненный результат хранить отдельным документом; ссылку внести в основания ${result.code}. При возврате сохранить причину и предыдущую версию.`;
  }
  get("crew-product-roadmap").nextId = search.id;
  get("crew-product-roadmap").questions = "Ближайшее обсуждение — бланк MKT.2.1 v1 и границы поиска. Исходное описание TalkHint PRD.1.9 и техническое подтверждение ENG.1.1 остаются необходимыми входами; не объявлены выполненными.";
  const appendix = `\n\n${marker}
## Уточнение: первые два действия и отчётность (v6)
1. MKT.2.1 **Поиск конкурентов**, P-BENCH. Ресурсы: описание TalkHint/аудитории, критерии поиска, интернет-поиск, официальные сайты, App Store/Google Play и существующий список. Это потребности в ресурсах, не активация API.
2. MKT.2.9 **Утвердить найденных конкурентов**. Предлагаемое соответствие должности руководителя бенчмаркинга — существующий HEAD.01; новая роль не создаётся.
Бланки — отдельные документы той же гипотезы, не новый каталог. Статус бланка отделён от статуса действия и приёмки заполненного результата.
| Действие | Название бланка | Шаблон | Версия | Статус | Где хранится заполненный результат |
|---|---|---|---|---|---|
| MKT.2.1 | Найденные кандидаты в конкуренты | [Скачать](/api/product-crew/documents/${candidatesFormId}/download) | 1 | Черновик, не утверждён | Документы; ID в основаниях MKT.2.1.R |
| MKT.2.9 | Решение по списку конкурентов | [Скачать](/api/product-crew/documents/${decisionFormId}/download) | 1 | Черновик, не утверждён | Документы; ID в основаниях MKT.2.9.R |
У остальных действий согласованной ветви указаны имя требуемого бланка, место хранения и статус «требуется разработать», без фиктивных ссылок. Для старых действий вне ветви отсутствие полей показывается как неуточнённая отчётность, а не как её ненужность.
Работа ведётся в существующем разделе [Документы](${docsPath}): создать отдельный заполненный документ; сохранение/редактирование версионируется существующей историей решений. В узле результата действия указать его ID в основаниях. Шаблон не перезаписывать результатом.
Через существующие инструменты Product Crew можно сохранить работу, передать результат и явно принять/вернуть его (create_work / submit_result / review_result); это не запуск AI-исполнителя. Принятие результата не утверждает бланк.
Условные «пять действий у нас, шесть у конкурента» — методический пример, не исследованный факт: выделить дополнительное действие, проверить источник и предложить обсуждение без заявления о доказанной пользе.
Следующий пункт обсуждения: черновик бланка MKT.2.1 и критерии поиска; PRD.1.9/ENG.1.1 остаются незавершёнными предварительными входами.
`;
  const current = roadmap.text
    .split(rev.data.nodes.find(n => n.id === search.id)!.name).join(search.name)
    .split(rev.data.nodes.find(n => n.id === review.id)!.name).join(review.name)
    .replace("Бланки сейчас только **«требуется разработать»**. Формы, шаблоны отчётов и поля бланков этим поручением не разрабатываются и не утверждаются.",
      "По последующему поручению разработаны два черновика бланков v1 для MKT.2.1 и MKT.2.9. Остальные бланки пока «требуется разработать». Ни один бланк не утверждён автоматически.")
    .replace("Ни бланки, ни реальные SLA, ни полная компания не готовы.", "Два бланка готовы как черновики для обсуждения; остальные бланки, реальные SLA и полная компания не готовы.")
    .replace(/## 10\. Следующий шаг и фиксация договорённостей\n[\s\S]*?\nДальше:/,
      "## 10. Следующий шаг и фиксация договорённостей\nСледующий совместный разбор — MKT.2.1: бланк и критерии поиска конкурентов. PRD.1.9/ENG.1.1 остаются необходимыми, ещё не закрытыми входами.\nДальше:");
  const text = current + appendix;
  if (text.length > 50000) throw Error("Roadmap capacity exceeded; no truncation");
  apply({ type: "saveDocument", id: roadmap.id, title: formsRoadmapTitle, text, url: roadmap.url, elementIds: roadmap.elementIds });
  apply({ type: "saveOperatingModel", baseVersion: rev.version, data });
  return next;
}
