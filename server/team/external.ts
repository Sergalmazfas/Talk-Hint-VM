import type { TeamMember, TeamView } from "../../shared/team";
import { emptyMember } from "./runtime";
import { teamPortraitManifest } from "./portraits";

const limitations = ["Publish, деньги и ключи — только владелец.", "Приёмка — владелец после независимой сверки Claude."];
export const EXTERNAL_PARTNERS_DOCUMENT = "team-external-partners-v1";
/** Draft only. Runtime MUST obtain these records from the active PG document. */
export function proposeExternalPartners(view: TeamView): TeamView {
  const reviewer: TeamMember = { ...emptyMember("external-klavdiy"), name: "Клавдий Сверкин",
    title: "Независимый ревизор · Claude", code: "CLAUDE", kind: "external", color: "indigo",
    department: "Внешние партнёры", status: "owner_chat",
    statusEvidence: "Работает с владельцем в чате. Не серверный агент; факт текущей сверки не измеряется сервером.",
    portrait: teamPortraitManifest.klavdiy.url, nameStatus: "accepted",
    traits: ["спокойный, не торопится с «да»", "дотошный, пересчитывает сам", "объясняет просто"],
    motto: "Проверено — значит, можно",
    duties: [
      ["review", "Сверяет пакеты до Publish: код, тесты, SHA и цифры"],
      ["explain", "Переводит технику на простой язык и пишет задачи Replit"],
      ["rules", "Следит за правилами, ищет риски, предлагает варианты; решает владелец"],
      ["report", "Рапорт: что проверил → принято / с поправками / нельзя → находки → нужно от владельца"],
    ].map(([id, title]) => ({ id, title, detail: null })),
    relations: [{ kind: "Подчиняется", id: "owner", name: view.owner.name },
      { kind: "Работает рядом", id: "head-product", name: "Мария Соболь" },
      { kind: "Проверяет", id: "head-engineering", name: "Главный инженер и пакеты всех ролей" }],
    tools: ["Чат с владельцем"], prohibitions: [...limitations,
      "Не нажимает кнопки, не трогает production, не видит ключи, не говорит «готово» без проверки."],
    metrics: { plan: "Оценка владельцем: хуже / так же / лучше / отлично", fact: null },
  };
  const hats = [
    { id: "head-engineering", title: "HEAD.07 · главный инженер" },
    { id: "studio-designer", title: "Дизайнер · экраны и макеты" },
    { id: "studio-operations", title: "Эксплуатация · проверки и расследования" },
    { id: "studio-testing", title: "Тестировщик · прогоны и стенды" },
    { id: "studio-model-writer", title: "Исполнитель записей в модель" },
  ].map(hat => {
    const member = view.members.find(m => m.id === hat.id);
    return { ...hat, status: member?.status === "autonomous" ? "работает сам" : "играет Replit",
      history: member?.history ?? [] };
  });
  const studio: TeamMember = { ...emptyMember("external-efim"), name: "Ефим Реплитов",
    title: "Студия Replit · внешний подрядчик", code: "REPLIT", kind: "external", color: "orange",
    department: "Внешние партнёры", status: "contractor",
    statusEvidence: "Внешний подрядчик. Не автономный сотрудник TalkHint. Назначение шляпы не является запуском агента.",
    portrait: teamPortraitManifest.efim.url, nameStatus: "accepted", motto: "Сделаю, покажу, сдам на сверку",
    relations: [{ kind: "Подчиняется", id: "owner", name: view.owner.name }],
    prohibitions: limitations, hats: hats.filter(h => h.status === "играет Replit"),
    duties: hats.map(h => ({ id: h.id, title: h.title, detail: h.status })),
    history: hats.filter(h => h.status === "работает сам").flatMap(h => h.history),
  };
  const members = view.members.map(m => {
    const hat = hats.find(h => h.id === m.id);
    return hat && hat.status === "играет Replit" ? { ...m, status: "replit" as const,
      statusEvidence: "Должность временно закрывает Студия Replit по поручению владельца. Это не автономный AI-агент." } : m;
  });
  // These are explicitly labeled coverage cards, NOT new operating nodes/tasks.
  for (const h of hats.filter(h => !members.some(m => m.id === h.id))) members.push({
    ...emptyMember(h.id), name: h.title, title: h.title, code: "REPLIT-HAT", kind: "role",
    department: "Шляпы Студии Replit", status: "replit",
    statusEvidence: "Играет Replit. Карточка покрытия по решению владельца; не новая должность/агент в графе.",
    relations: [{ kind: "Исполнитель", id: studio.id, name: studio.name }],
    prohibitions: limitations,
  });
  return { ...view, members: [...members, reviewer, studio] };
}

/** No code/JSON fallback for company records after cutover. */
export function withExternalPartners(view: TeamView, documentText?: string): TeamView {
  if (!documentText) return view;
  const doc = JSON.parse(documentText);
  if (doc.schema !== 1 || !Array.isArray(doc.members) || doc.members.length !== 7 ||
      new Set(doc.members.map((m: any) => m.id)).size !== 7 ||
      !doc.members.some((m: any) => m.id === "external-klavdiy" && m.status === "owner_chat") ||
      !doc.members.some((m: any) => m.id === "external-efim" && m.status === "contractor"))
    throw Error("External partner document unavailable");
  for (const member of doc.members) {
    if (!Array.isArray(member.duties) || !Array.isArray(member.history) ||
        !Array.isArray(member.traits) || !Array.isArray(member.relations) ||
        !Array.isArray(member.tools) || !Array.isArray(member.prohibitions) ||
        !member.prompt || member.prompt.text !== null)
      throw Error("External partner document invalid");
  }
  const members: TeamMember[] = view.members.map(m => ({ ...m }));
  const studio = structuredClone(doc.members.find((m: TeamMember) => m.id === "external-efim")) as TeamMember;
  const hats = studio.hats ?? [];
  for (const hat of hats) {
    const current = members.find(m => m.id === hat.id);
    if (current?.status === "autonomous") {
      // History must come from the real recorded handoff, never a fabricated date.
      studio.history.push(...current.history);
    } else if (current) {
      current.status = "replit";
      current.statusEvidence = "Должность закрывает Студия Replit; назначение прочитано из production-документа.";
    }
  }
  studio.hats = hats.filter(h => members.find(m => m.id === h.id)?.status !== "autonomous");
  for (const record of doc.members as TeamMember[]) {
    if (!members.some(m => m.id === record.id)) members.push(record.id === studio.id ? studio : structuredClone(record));
  }
  return { ...view, members };
}
