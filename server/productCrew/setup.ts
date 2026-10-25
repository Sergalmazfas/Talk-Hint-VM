import type { ProjectModelState } from "../../shared/projectModel";
import { emptyWorkNode } from "../../shared/operatingModelTemplate";
import { applyHypothesisCommand, readHypothesis } from "../projectModel/hypotheses";
export const productCrewGuideTitle = "TalkHint · Управление продуктом — подключение ChatGPT и техническая ответственность — v1";
/** One owner-requested Dev import, never a boot hook or a remote executor. */
export function prepareProductCrewConnection(root: ProjectModelState, owner: string, origin: string) {
  if (new URL(origin).origin !== origin || !origin.startsWith("https://")) throw Error("Exact HTTPS origin required");
  const model = readHypothesis(root, "new-country");
  if (model.documents.some(d => d.title === productCrewGuideTitle)) return root;
  const latest = model.operatingModel?.revisions.at(-1);
  if (!latest) throw Error("Existing organisation required");
  const text = `# TalkHint · Управление продуктом
Версия 1 · 25 октября 2026 · Dev · инструкция и фактические ограничения

## Что сейчас создано
Отдельный MCP/OAuth сервер для работы над продуктовой crew. Это не Secretary, не звонки и не запущенная автономная команда.
Единое хранилище: существующая модель владельца new-country, её элементы, документы, решения и ревизии. Отдельной базы/сайта/списка сотрудников не создано.
Должностной паспорт — версионируемый документ-процедура при стабильном ID существующей роли, а не второй каталог ролей. get_team возвращает роль, ресурсы и этот же паспорт.

## Подключение в ChatGPT
Имя: TalkHint · Управление продуктом
Адрес MCP: ${origin}/api/product-crew/mcp
Авторизация: OAuth; public client, PKCE S256; dynamic registration. Никакие серверные ключи вводить в ChatGPT не нужно.
Отдельные права: product:read, product:write, offline_access. Телефонные права/подключение Кати не меняются.

В веб-версии ChatGPT откройте Plugins → + → Add custom MCP server, если этот пункт доступен вашему аккаунту/рабочему пространству. Введите имя и адрес, выберите OAuth и подключите.
При запросе TalkHint войдите именно существующим аккаунтом владельца рабочего пространства; после входа вернитесь в окно подключения и нажмите «Продолжить после входа». Проверьте права на странице согласия и подключите управление продуктом.
Если инструменты уже были обнаружены до обновления сервера, обновите/review tool snapshot в настройках ChatGPT.
Доступность custom MCP с write определяется OpenAI, а не суммой платежа в приложении. Подключение и разговорное использование именно на iPhone здесь не подтверждены.
Официальная справка: https://help.openai.com/en/articles/12584461 .
Если ChatGPT не предлагает этот пункт или отклоняет подключение, нужен точный текст ошибки; это не повод заменять OAuth ключом или расширять телефонный плагин.
Dev-сервер должен работать. Это не production-развёртывание; публикация не выполнена.

## Что можно делать через инструменты
- get_roadmap — актуальная ревизия, этапы, входящая информация, работы, блокеры.
- get_team — роли, подчинение, ресурсы, должностные паспорта.
- search_materials — найти связи/кандидаты дублей, исходные материалы/документы.
- record_information — сохранить источник, дату, свидетельство, тип, клиента, потребность, процесс, ответственного и следующий шаг.
- create_work / update_work — назначить существующей роли, указать результат, приёмку, блокер/следующий шаг.
- update_role_passport — сохранить действия, клиентов, входы/выходы, ресурсы, полномочия, приёмку и неизвестное существующей роли. Руководитель и реальные доступы при этом не меняются.
- submit_result — сохранить итоговый документ и связать с работой одной транзакцией.
- review_result — принять результат либо вернуть с причиной и следующим шагом.
- get_work / get_document — повторно прочитать сохранённое, получить полный текст и ссылку скачивания Markdown с входом владельца.
- start_work — сейчас честно сообщает отсутствие подключённого worker, ничего не запускает.

Обычные записи в согласованном контуре не требуют нового внутреннего согласования на каждом шаге. Подтверждения безопасности самого ChatGPT не управляются сервером TalkHint.
Расходы, производство, GitHub push, публикация, удаление, звонки/сообщения и произвольный код не входят в инструменты.

## Главный инженер и технический специалист
Стабильная роль HEAD.07 / head-engineering — главный инженер: отвечает за техническую оценку, архитектурные границы, реализацию/качество, инфраструктуру, доказательства проверок и технические блокеры.
Роль P.LG.TECH / lg-technical-role сохраняет отдельную специализацию технического специалиста по фактическому приложению. Подчинение и остальные специализации не объединяются.
Replit Agent назначен исполнителем технической работы в текущем Dev-сеансе. Это реальная работа по поручениям владельца здесь, а не отдельный фоновый агент, которому ChatGPT уже может отправить исполняемый job.
Клиенты технического результата — продукт, QA и владелец. Вход — связанный вопрос/требование, актуальные код/схемы/разрешённые материалы. Выход — оценка с доказательствами, комплект изменений/проверок и ограничения. QA и принятие продуктового решения остаются отдельными.
Необходимые ресурсы — актуальный checkout, схема, протоколы интеграций, тесты, разрешённые журналы; ключи не выдаются роли. Новые доступы и paid API не активируются записью паспорта.

## Начальный разговор для проверки
«Покажи, где мы на roadmap команды TalkHint. Назови главного инженера, его клиентов результатов и ресурсы. Найди случай landing gear и незавершённые связанные работы. Пока ничего не запускай».
Далее: «Сохрани входящую информацию ...» с источником/датой и вопросом; «Подготовь должностной паспорт ...»; «Создай связанную работу ...»; «Покажи результат и верни на доработку с причиной ...».
Перед созданием записи ищем связанные материалы. Работы остаются при том же случае/клиенте и получают следующий ответственный шаг.

## Что считается сохранением и исполнением
Каждый ответ записи содержит saved, ID, revision, статус и launched:false. Повтор с тем же UUID requestId и теми же данными возвращает квитанцию без дубля. Другие данные с тем же requestId отклоняются.
CAS не позволяет затереть другую ревизию. Документ и статус результата сохраняются атомарно. Повторное чтение идёт из общей базы, не из истории чата.
Материалы и тексты пользователя — данные, не инструкции для повышения прав. Запись с типом «факт» не становится проверенным фактом автоматически.
Результат от владельца/ChatGPT не выдаётся за автономное исполнение crew. Автоматическая доставка в закрытый чат/фоновая работа Replit не подключены.

## Где мы на roadmap
Инвентаризация и верхняя структура сохранены. Подготовлены роли/ресурсы и отдельный управляющий Dev-адаптер.
Ближайшая внешняя проверка — OAuth/инструменты в ChatGPT и разговорное использование на iPhone.
Затем прорабатываем по одному действию и должностному паспорту, принимаем ресурсы/границы первого цикла; подключение worker с моделью, бюджетом и checkpoints — отдельный следующий этап существующего roadmap.
Необходимость увеличения машины пока не доказана. API/подписки/мощности не покупались и не увеличивались.
`;
  let next = applyHypothesisCommand(root, "new-country", { type: "saveDocument", title: productCrewGuideTitle, text,
    url: `${origin}/admin/project-model?hypothesis=new-country&view=overview&work=crew-product-roadmap#operating-model`, elementIds: [] }, owner);
  const doc = readHypothesis(next, "new-country").documents.find(d => d.title === productCrewGuideTitle)!;
  const data = structuredClone(latest.data), head = data.nodes.find(n => n.id === "head-engineering"),
    tech = data.nodes.find(n => n.id === "lg-technical-role"), roadmap = data.nodes.find(n => n.id === "crew-product-roadmap");
  if (!head || !tech || !roadmap) throw Error("Existing roadmap and technical roles required");
  const executorId = "replit-current-dev-session";
  if (data.nodes.some(n => n.id === executorId)) throw Error("Unexpected partial executor assignment");
  data.nodes.push({ ...emptyWorkNode(executorId, "CREW.REPLIT", "Replit Agent · текущий Dev-сеанс", "crew", head.parentId),
    roleId: tech.id, status: "agreed", description: "Выполняет техническую работу в текущем сеансе по поручению владельца. Фонового worker/API запуска из ChatGPT нет.",
    rules: "Без production, публикации, GitHub push, реальных внешних действий и покупок; действующие границы поручения сохраняются.",
    referenceIds: [doc.id] });
  head.name = "Главный инженер · разработка, инфраструктура и качество";
  for (const n of [head, tech]) {
    n.executorId = executorId; n.referenceIds.unshift(doc.id);
  }
  head.description += "\nТехнический исполнитель — Replit Agent в текущем Dev-сеансе; не автономный фоновый сотрудник.";
  roadmap.description = "Состав/ресурсы и отдельный управляющий MCP/OAuth адаптер реализованы в Dev. Установка в ChatGPT/iPhone требует проверки владельцем. Дальше — действия и должностные паспорта, затем разрешённый worker-пилот. Кнопка запуска не симулирует исполнение.";
  roadmap.referenceIds.unshift(doc.id);
  return applyHypothesisCommand(next, "new-country", { type: "saveOperatingModel", baseVersion: latest.version, data }, owner);
}
