import type { ModelCommand, ProjectModelState } from "../../../shared/projectModel";
import type { CompetitorSnapshot } from "../../../shared/projectCompetitors";
import type { ResearchEvidence } from "../../../shared/competitorResearch";
import { emptyWorkNode } from "../../../shared/operatingModelTemplate";
import { defaultRegister } from "../../../shared/actionRegister";
import { actionChainGaps } from "../../../shared/actionChainCoverage";
import { applyHypothesisCommand, readHypothesis } from "../hypotheses";
import { ownershipRoadmapTitle } from "./benchmarkOwnership";
import { productPassportId } from "./productPassport";

export const ownerTestActionId = "company-action-owner-competitor-test";
export const threeCardsMarker = "<!-- THREE-CARDS-OWNER-TESTS-20261025-V1 -->";
export const threeCardsRoadmapTitle = "TalkHint — единый roadmap работы crew над продуктом — v12 — три паспорта и ручные тесты Сергея";
export const ownerTestingRule = "Все установки, подписки, тестовые звонки и проверки внутри мобильных приложений выполняет Сергей. Отдельной должности тестировщика конкурентов нет. Аналитик проверяет публичные источники, продукт принимает результат и обновляет тот же паспорт с источником «тест владельца», затем возвращает решение аналитику.";
const pending = "Снимок 25.10.2026: источники проверены / на согласовании. Это проверка заявлений, не живой тест. Приёмка продукта не подтверждена. Дата первого обнаружения и дата выпуска не установлены.";
export const threeCardSpecs = [
  {
    appId:"1367461351",name:"Lingvanex",
    urls:["https://lingvanex.com/products/phone-call-translator/","https://apps.apple.com/us/app/live-ai-phone-call-translator/id1367461351"],
    audience:"Личные и рабочие телефонные разговоры на другом языке, поручения вроде бронирования/отмены/подтверждения встречи. Сегменты и готовность платить не измерены.",
    features:"По официальным источникам: перевод звонков; исходящий AI Companion с возможностью вмешаться; второй номер US/Canada и перевод SMS с Premium; история транскрипций и суммари. Входящий перевод не равен автономному входящему секретарю.",
    channels:"Сайт заявляет iPhone/iPad и Android; доступность конкретной функции/покупки на устройстве и в регионе Сергей проверяет отдельно. Сайт 150+ направлений, App Store 160 — расхождение сохранено, не число стран с клиентами.",
    unknown:"Не установлены механизм вмешательства, остаётся ли AI в разговоре и можно ли вернуть ему разговор; автономный входящий секретарь не подтверждён. Не доказано одновременное участие человека+AI.",
    prices:"Сохранены опубликованные US App Store Week $9.99, Year $69.99 и пакеты COINS из прежнего снимка. COINS не приравниваются credits; минуты, расход Companion, включённые SMS, доплаты и применимость предложений неизвестны. Источник цены и канал указаны в тарифах.",
    current:"С текущим TalkHint есть пересечение по переводу и исходящему поручению секретарю; в TalkHint переводчик, Copilot и одна Катя подтверждены владельцем, исходящие описаны с ограничениями. Premium-номер/SMS и вмешательство Lingvanex — заявления источников, не проверенное превосходство над TalkHint. Аналогичный сквозной SMS-сценарий у TalkHint не объявляется готовым.",
    question:"При вмешательстве человека Companion продолжает участвовать, замолкает или выходит? Можно ли после этого вернуть ему разговор в рамках того же звонка?",
    steps:"1. Проверить на iPhone версию, регион, условия аккаунта, Companion и стоимость; до согласованных расходов остановиться. 2. Сергей с согласным тестовым собеседником задаёт короткое поручение. 3. Зафиксировать начало работы AI и доступные элементы управления. 4. Вмешаться доступным способом и наблюдать, остаётся ли AI. 5. Если интерфейс позволяет — попробовать вернуть ему разговор; иначе записать отсутствие найденного способа, не доказанное отсутствие функции. 6. Завершить и проверить историю/транскрипт/суммари.",
    materials:"Скриншоты версии/плана и цены перед звонком, поручения, кнопок до/после вмешательства, состояния при возврате и истории; временная последовательность, кто говорил и что слышал собеседник. Только разрешённые материалы с замаскированными личными номерами.",
    access:"Установка и вход — Сергей; обязательность аккаунта, подписки/кредитов именно для Companion уточнить в приложении. Premium заявлен для номера/SMS, не доказано, что он достаточен для всего теста. Расходы пока не утверждены.",
  },
  {
    appId:"6758815817",name:"VocaLingo",
    urls:["https://help.vocalingo.app/en/help/articles/9323243-ai-assistant-mode-during-calls","https://help.vocalingo.app/en/help/articles/0276096-how-ai-calls-work"],
    audience:"Люди, которые сами ведут личный/рабочий разговор и нуждаются в переводе либо подсказках по сценарию. Автономные поручения не подтверждены.",
    features:"Translation либо текстовый call copilot / AI Assistant: говорит пользователь. Переключение режима требует завершить звонок. История содержит детали, режим и AI-события; запись — когда доступна. Контакты и выбор своего/виртуального номера описаны в справке.",
    channels:"Справка: web — исходящие; iOS/Android — исходящие и входящие при наличии verified/virtual number. Для исходящих требуется caller ID. Языки медиа/текста нельзя автоматически считать языками звонка.",
    unknown:"Автономный исходящий или входящий секретарь не подтверждён. Реальная задержка/полезность подсказок, затраты по конкретному сценарию и фактическое переключение на iPhone не проверены.",
    prices:"Прежние подтверждённые предложения сайта и US App Store сохранены раздельно, включая расхождение годовой суммы $99 на сайте и $99.99 в магазине. Справка: поминутная цена зависит от направления, STT, модели и TTS; единой долларовой минуты и точной цены аренды номера нет. Нельзя смешивать цены пакетов разных каналов.",
    current:"Сценарий текстовых подсказок пересекается с подтверждённым владельцем Copilot TalkHint, перевод — с переводчиком. VocaLingo оставляет разговор пользователю; у TalkHint также описаны исходящие поручения Кате. Это различие сценариев, а не вывод о качестве. Переключение режимов TalkHint этим исследованием не проверялось.",
    question:"Насколько быстро и полезно появляются подсказки во время моего разговора? Как фактически меняется режим и что сохраняется после завершения?",
    steps:"1. Сергей проверяет версию, caller ID, аккаунт, баланс и цену до теста. 2. С согласным собеседником выбирает AI Assistant, задаёт контекст и сам говорит. 3. Фиксирует момент реплики и появления первой/следующих подсказок, отмечает использованные/неподходящие варианты. 4. Проверяет возможность смены режима без выдуманного ожидания; по инструкции завершает звонок и начинает отдельный в Translation только по собственному разрешению. 5. Сравнивает историю двух разных звонков и списания.",
    materials:"Скриншоты выбора режима и цены, контекста/подсказок с отметками времени, попытки переключения, истории и фактических списаний. Наблюдения о полезности — личный тест, не статистическая оценка всех пользователей.",
    access:"Установка/вход/верификация или аренда номера — только Сергей. Caller ID и достаточный баланс требуются по справке; необходимость подписки и сумма расхода проверяются перед тестом, сейчас неизвестны и не разрешены.",
  },
  {
    appId:"6744344005",name:"AI Call / TaraAI",
    urls:["https://1aicall.com/","https://apps.apple.com/us/app/ai-call-phone-translator-agent/id6744344005"],
    audience:"Личные и рабочие межъязыковые разговоры и исходящие поручения AI Phone Agent. Наличие функций не доказывает спрос выбранного сегмента.",
    features:"Заявлены перевод телефонных и интернет voice/video звонков, AI Phone Agent с транскриптом после поручения, Call Links. Call Link создаёт отдельный разговор через AI Call/браузер; не накладка на уже идущий WhatsApp/FaceTime. Перевод текста внутри приложения — не доказательство SMS/MMS с того же номера.",
    channels:"Сайт указывает iPhone/Android, браузерное присоединение по Call Link и ссылку на Mac; App Store — приложение iPhone, macOS там не verified. Это различие источников, не проверенная установка. Для обычного телефонного адресата приложение не нужно; для Call Link — браузер/микрофон/камера/интернет; для in-app чата обеим сторонам нужно приложение.",
    unknown:"Не установлены механизм вмешательства в Agent, продолжает ли AI участие, возврат разговора AI и автономный входящий секретарь. Сведения отзывов не считаются официальным подтверждением или отсутствием этих функций.",
    prices:"Существующие опубликованные IAP/каналы и источники сохранены. Free download не означает бесплатные звонки. Состав включённых минут, цена Agent/номера, расход credits и доступность подписки каждому пользователю требуют проверки в приложении; единой цены минуты не выводим.",
    current:"Перевод и исходящий Agent пересекаются со сценариями переводчика/Кати в текущем паспорте TalkHint, но не доказывают равенство реализации. Call Links и voice/video — дополнительные заявленные сценарии TaraAI, не подтверждённые этим исследованием для TalkHint. Неопределённый «линк» в нашем паспорте нельзя автоматически отождествлять с Call Links.",
    question:"Что Agent действительно делает самостоятельно, как пользователь вмешивается и что остаётся в результате поручения?",
    steps:"1. Сергей проверяет версию, доступность Agent, аккаунт, план/credits и цену. 2. На разрешённом тестовом контакте задаёт простое поручение и критерий результата. 3. Отмечает, что Agent делает сам, какие сведения запрашивает и что доступно пользователю во время разговора. 4. Если предусмотрено — вмешивается; фиксирует состояние AI и возможность продолжения/возврата. Если способ не найден — оставляет вопрос открытым. 5. Проверяет исход, полный доступный транскрипт и списания. Автономный входящий приём — отдельная будущая проверка, не выполненная этим тестом.",
    materials:"Скриншоты версии/плана/цены, текста поручения, элементов управления Agent, состояния до/после вмешательства, итогового транскрипта и списаний; последовательность действий и фактический исход без домыслов.",
    access:"Аккаунт, нужность подписки/credits и ограничения региона для Agent — проверить Сергею. Установка и возможные покупки только владельцем после отдельного решения о расходах. Пока ничего не куплено и тест не начат.",
  },
] as const;

export function prepareThreeCardSnapshot(existing: CompetitorSnapshot, appId: string, recheckedAt: string): CompetitorSnapshot {
  const spec=threeCardSpecs.find(s=>s.appId===appId);
  if(!spec || !existing.appStore.includes(`/id${appId}`) || !existing.dossier)throw Error("Existing matching six-section card required");
  const s=structuredClone(existing),urls=Array.from(spec.urls);
  s.checkedAt="2026-10-25";
  s.audience=spec.audience;
  s.offer.features=spec.features; s.offer.channels=spec.channels;
  const ev=(status:ResearchEvidence["status"],note:string):ResearchEvidence=>({status,note,sourceUrls:urls,checkedAt:"2026-10-25"});
  const put=(id:string,title:string,value:string,status:ResearchEvidence["status"]="planned")=>{
    const fact={id,title,value,evidence:ev(status,"Снимок и переданные договорённости 25.10.2026; статус результата/приёмки отделён от заявления сайта. "+ownerTestingRule)};
    const i=s.dossier!.offerFacts.findIndex(f=>f.id===id);
    if(i<0)s.dossier!.offerFacts.push(fact);else s.dossier!.offerFacts[i]=fact;
  };
  put("snapshot-20261025","Снимок и границы проверки",`${pending}\n${spec.features}\n${spec.unknown}\nПовторное чтение указанных публичных страниц Replit: ${recheckedAt}, не дата живого теста или появления функции. Публичные страницы могут изменяться; историческая дата снимка взята из переданного материала, повторное чтение не доказывает весь их вид в прошлом.`,"official_claim");
  put("comparison-current-talkhint","Сравнение с ТЕКУЩИМ TalkHint — на согласовании",`${spec.current}\nОснование TalkHint: TH-PRODUCT v2, ${productPassportId} v1, «В разработке» / «На согласовании», снимок 25.10.2026. Цены/общие лимиты TalkHint не утверждены. Это не объективный рейтинг ближайших конкурентов.`);
  put("comparison-planned-talkhint","Сравнение с ЗАПЛАНИРОВАННЫМ TalkHint — отдельно от готовности",
    "Целевая концепция TalkHint: единая помощница/чат для личных и бизнес-дел, связанная история контактов, календарь/напоминания, почта и сообщения с управляемыми разрешениями. Эти возможности не объявляются готовыми. Заявленные функции конкурента не доказывают ни готовность нашей цели, ни отсутствие её частей у конкурента; требуется отдельная сценарная проверка. WhatsApp — последующий этап.");
  put("owner-manual-test","Задание Сергею: ручной тест — НЕ НАЧАТ",
    `Ответственный: Сергей. Статус: ожидает Сергея, тест не начат; установка/аккаунт/подписка/расходы не выполнены и не разрешены этим сохранением.\nВопрос/цель: ${spec.question}\nШаги: ${spec.steps}\nСкриншоты и наблюдения: ${spec.materials}\nАккаунт/подписка: ${spec.access}\nРезультат: версия приложения/устройство/регион/языки/дата теста, выполненные шаги, наблюдения, материалы и ограничения; отдельно не выполненное. Передать P.PRODUCT; он принимает достаточность/возвращает вопрос, сохраняет новую версию этого же паспорта с источником «тест владельца» только после фактического теста, сообщает аналитику. Связь: ${ownerTestActionId} / MKT.2.19 → PRD.1.1/1.2 → PRD.1.13 → PRD.1.7 → MKT.2.6.`);
  const priceId="price-scope-20261025";
  const priceFact={id:priceId,title:"Цены и неизвестные расходы — без смешивания каналов",value:spec.prices,evidence:ev("official_claim","Точные прежние опубликованные тарифы/источники сохранены; новые расходы по тесту не измерены, неизвестное не ноль.")};
  const pi=s.dossier!.pricingNotes.findIndex(f=>f.id===priceId);
  if(pi<0)s.dossier!.pricingNotes.push(priceFact);else s.dossier!.pricingNotes[pi]=priceFact;
  for(const url of urls)if(!s.sources.some(x=>x.url===url&&x.checkedAt===recheckedAt))
    s.sources.push({url,checkedAt:recheckedAt,note:"Публичная страница повторно прочитана Replit; не вход в приложение и не живой тест. Снимок 25.10 — из существующего материала/поручения. Дата выпуска не установлена."});
  if(s.research) {
    s.research.features.translation=ev("official_claim",spec.features);
    s.research.features.incoming=ev("unknown","Автономный входящий секретарь не подтверждён. Входящий звонок/перевод не равен автономному приёму.");
    s.research.features.secretary_outgoing=ev(appId==="6758815817"?"unknown":"official_claim",
      appId==="6758815817"?"В AI Assistant говорит пользователь; автономный секретарь не подтверждён.":spec.features+" "+spec.unknown);
    if(appId==="6758815817")s.research.features.live_hints=ev("official_claim","Текстовый AI Assistant по контексту; говорит пользователь. Для смены режима завершить звонок. Скорость/полезность не тестировались.");
  }
  s.scenarios=s.scenarios.map(row=>row.scenario==="secretary_outgoing"
    ? {...row,status:appId==="6758815817"?"unknown":"official_claim",note:spec.features+" "+spec.unknown,sourceUrls:urls}
    : row.scenario==="incoming"?{...row,status:"unknown",note:"Автономный входящий секретарь не подтверждён; входящий перевод не то же самое.",sourceUrls:urls}:row);
  const legacy=s.limitations.replace(/Очень близок к целевой связке TalkHint:/g,"Пересечение с целевыми сценариями TalkHint, не сравнительный рейтинг:")
    .replace(/Близкий телефонный конкурент:/g,"Исследуемый телефонный продукт, без рейтинга близости:");
  s.limitations=`${pending}\n${spec.unknown}\nРост/отток, причинность и дата появления функций не установлены этим снимком. Существующие внешние оценки установок — другие метрики, не доказательство роста или оттока.\n${ownerTestingRule}\n\nПредыдущие материалы (интерпретации не объективный рейтинг):\n${legacy}`;
  return s;
}

export function prepareThreeCards(root:ProjectModelState,actor:string,recheckedAt:string):ProjectModelState {
  const m=readHypothesis(root,"new-country"),rev=m.operatingModel?.revisions.at(-1);
  const docs=m.documents.filter(d=>[ownershipRoadmapTitle,threeCardsRoadmapTitle].includes(d.title));
  if(!rev||docs.length!==1||!m.documents.some(d=>d.id===productPassportId))throw Error("Existing model, product passport and unique current roadmap required");
  const roadmap=docs[0];
  if(roadmap.text.includes(threeCardsMarker))return root;
  const selected=threeCardSpecs.map(spec=>{
    const matches=m.competitorDirectory!.records.filter(r=>r.revisions.at(-1)!.snapshot.appStore.includes(`/id${spec.appId}`));
    if(matches.length!==1)throw Error(`Exactly one existing ${spec.name} card required`);
    return {spec,record:matches[0],prior:matches[0].revisions.at(-1)!};
  });
  const data=structuredClone(rev.data);
  const get=(id:string)=>{const n=data.nodes.find(n=>n.id===id);if(!n)throw Error(`Missing existing ${id}`);return n;};
  const result=(id:string)=>get(data.links.find(l=>l.from===id&&l.kind==="produces")?.to??"missing-result");
  const link=(from:string,to:string,kind:typeof data.links[number]["kind"],reason:string)=>{
    if(!data.links.some(l=>l.from===from&&l.to===to&&l.kind===kind))data.links.push({id:`owner-tests:${kind}:${from}:${to}`,from,to,kind,reason});
  };
  if(data.nodes.some(n=>n.id===ownerTestActionId||n.code==="MKT.2.19"))throw Error("Reconcile existing owner-test action; no duplicate");
  const n=emptyWorkNode(ownerTestActionId,"MKT.2.19","Организовать ручной тест Сергея и получить материалы","action","competitor-monitor");
  Object.assign(n,{roleId:"product-manager-specialist",executorId:"owner",level:"operation",detailState:"described",status:"agreed",
    description:"P.PRODUCT отвечает за протокол/передачу/получение; ручной исполнитель — существующий владелец Сергей, не новая должность и не AI-агент. В трёх карточках отдельные вопросы и протоколы; тесты не начаты.",
    purpose:"Дать продукту наблюдения и материалы для проверки возможностей вместо домыслов.",
    clientId:"product-manager-specialist",recipientId:"company-action-product",acceptorId:"product-manager-specialist",nextId:"company-action-product",
    resourceIds:["model-resource"],referenceIds:selected.map(x=>x.record.id),
    inputs:[{name:"Разрешённое задание продукта и протокол из карточки; расходы/аккаунт/контакт согласуются отдельно",sourceId:result("company-action-dispatch").id,freshness:"Версия карточки, источник, дата и ограничения"}],
    procedure:ownerTestingRule+" Читать вопрос/цель/шаги/требуемые материалы в той же карточке; не начинать платный шаг без отдельного решения. Записать реальные наблюдения, версию, дату и исход; непройденное оставить открытым. Передать результат продукту.",
    rules:"Подписка/скачивание/звонок не доказательство результата. Дата снимка 25.10.2026 отдельно от будущей даты теста. Не создавать AI-тестировщика.",
    constraints:"Сейчас только подготовка. Покупки, регистрации, установки и звонки не выполнялись. Нет данных — не ноль и не отсутствие функции.",
    success:"P.PRODUCT получил воспроизводимые шаги, версию/дату, наблюдения и разрешённые материалы; явно принял достаточность либо вернул конкретный вопрос. Не принимать самим фактом передачи.",
    storage:"Тот же паспорт конкурента и его существующий раздел оценок/материалов; без второго каталога.",
    delivery:"Ссылка на запись/материалы в карточке; статус приёмки и ответ инициатору.",
    exceptions:"Нет доступа/подписки/лимита/согласия — блокер с вопросом продукту, не попытка обойти доступ.",
    questions:"Доступы и расходы по каждому тесту требуют решения Сергея; даты проведения не назначены.",
    schedule:{days:[],hours:"",timezone:"",trigger:"Только ручное решение Сергея после готовности протокола/разрешений",deadline:"Не согласован"},
    register:{...defaultRegister(),approval:"discussion",source:ownerTestingRule},
    reporting:{required:true,formName:"Результат теста владельца и материалы",templateDocumentId:null,templateVersion:"",formStatus:"required",approvalEvidence:"",storage:"Тот же паспорт конкурента, история и оценки; форму разрабатывают ChatGPT с Сергеем, утверждает Сергей"},
  });
  const r=emptyWorkNode(`${ownerTestActionId}-result`,"MKT.2.19.R","Фактические наблюдения Сергея и материалы либо блокер","result",n.id);
  Object.assign(r,{roleId:"product-manager-specialist",clientId:n.clientId,recipientId:n.recipientId,acceptorId:n.acceptorId,nextId:n.nextId,
    description:"Требуемый результат. Ни один из трёх тестов ещё не выполнен.",storage:n.storage});
  data.nodes.push(n,r);
  link(n.id,r.id,"produces","Результат ручного теста, не результат запуска AI");
  link(n.id,"head-product","accountable_to","HEAD.06 контролирует организацию и приёмку продукта; ручной исполнитель Сергей сам задаёт пределы расходов и доступов");
  const receive=get("company-action-product");
  receive.inputs.push({name:"Результат теста владельца из той же карточки либо блокер",sourceId:r.id,freshness:"Фактическая дата/версия/материалы, не историческая дата снимка"});
  link(r.id,receive.id,"handoff","Парное получение и регистрация продукта");
  link(r.id,receive.id,"acceptance",n.success);link(receive.id,n.id,"return","Вернуть конкретный недостаток, не запускать тест автоматически");
  for(const from of [result("company-action-dispatch"),result("company-action-product-return")]){
    if(!n.inputs.some(i=>i.sourceId===from.id))n.inputs.push({name:"Адресный вопрос на уточнение протокола/наблюдений",sourceId:from.id,freshness:"Версия вопроса и согласованные границы"});
    link(from.id,n.id,"handoff","Ручной тест владельцем либо конкретное уточнение");
    link(from.id,n.id,"acceptance","Сергей принимает готовность протокола или возвращает вопрос; это не согласие на любые расходы");
    link(n.id,from.parentId!,"return","Вернуть поставщику недостающий вход");
  }
  for(const input of n.inputs)link(n.id,input.sourceId!,"requires","Версионный вход и поставщик");
  for(const id of ["company-action-dispatch","company-action-product-sufficiency","company-action-update-passport","company-action-product-notify","company-action-followup","company-action-product-control"]){
    const a=get(id);
    a.procedure+="\n"+ownerTestingRule+" Ручной тест по MKT.2.19/протоколу внутри карточки. Только после фактических материалов — источник «тест владельца» с датой, автором Сергеем и новой версией того же паспорта; до этого проверены лишь заявления источников. Продукт явно принимает/возвращает и сообщает аналитику, контроль HEAD.06.";
    a.referenceIds=Array.from(new Set([...a.referenceIds,...selected.map(x=>x.record.id)]));
  }
  for(const id of ["product-manager-specialist","benchmark-role-reference","head-product"])get(id).rules+="\n"+ownerTestingRule;
  const gaps=actionChainGaps(data,new Set([n.id,receive.id,"company-action-dispatch","company-action-product-return"]));
  if(gaps.length)throw Error(`Owner-test chain gaps ${JSON.stringify(gaps)}`);
  data.stageReports.push({pass:3,described:"Три существующих паспорта сверены, задачи Сергею находятся внутри карточек; продуктовая приёмка и ответ аналитику связаны.",
    boundary:"Снимок 25.10.2026, публичные заявления; не живые тесты и не объективное ранжирование.",
    dependencies:"Решение Сергея о доступах/расходах, фактические наблюдения/материалы, приёмка продукта.",
    gaps:"Механизмы вмешательства/возврата AI и качество подсказок не протестированы; рост/отток неизвестны.",
    next:"Первый ручной тест — Lingvanex: вмешательство, поведение AI и возврат; затем продукт принимает достаточность и обновляет ту же карточку."});
  let next=root;
  const apply=(c:ModelCommand)=>{next=applyHypothesisCommand(next,"new-country",c,actor);};
  for(const {spec,record,prior} of selected)apply({type:"saveCompetitor",id:record.id,baseVersion:prior.version,
    reason:"Снимок 25.10.2026, источники/ограничения/сравнение текущего и планового TalkHint; протокол Сергею, не выполненный тест",snapshot:prepareThreeCardSnapshot(prior.snapshot,spec.appId,recheckedAt)});
  const p=m.analystPreparation?.revisions.at(-1);
  if(!p)throw Error("Existing analyst passport required");
  const preparation=structuredClone(p.data);
  preparation.passport.duties+="\n"+ownerTestingRule;
  preparation.approvalNotes+="\nНовое правило владельца зафиксировано; результаты тестов и детальные бланки не утверждены. "+ownerTestingRule;
  apply({type:"saveAnalystPreparation",baseVersion:p.version,preparation});
  apply({type:"saveDocument",id:roadmap.id,title:threeCardsRoadmapTitle,url:roadmap.url,elementIds:roadmap.elementIds,
    text:roadmap.text+`\n\n## v12 — три существующих паспорта, ручные тесты владельца\n${threeCardsMarker}\n${ownerTestingRule}\nСнимок: 25.10.2026; публичные страницы повторно прочитаны ${recheckedAt}, не дата релиза и не доказательство прежнего вида страницы.\n${selected.map(x=>`- ${x.spec.name}: ${x.record.id}, v${x.prior.version} → v${x.prior.version+1}; источники проверены / на согласовании; задача «owner-manual-test» внутри того же паспорта; тест не начат.`).join("\n")}\nПредыдущие тарифы/каналы/источники/версии сохранены, неизвестные расходы не ноль. Сравнение текущего TalkHint отдельно от целей; объективная близость не установлена. MKT.2.19 — действие существующего владельца, не новая должность. Приёмка PRD.1.1/1.2 → версия паспорта PRD.1.13 с источником «тест владельца» только после реального теста → ответ PRD.1.7/MKT.2.6. Сроки, доступы/бюджет и бланки пока не утверждены. Worker не подключён; ресурсы/расписание не изменены.\nСледующий конкретный шаг: Сергей изучает протокол Lingvanex и решает, готов ли вход для его ручного теста; до этого ожидаем, не имитируем исполнение.\n`});
  apply({type:"saveOperatingModel",baseVersion:rev.version,data});
  return next;
}
