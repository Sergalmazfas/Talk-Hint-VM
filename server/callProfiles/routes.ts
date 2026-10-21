import type { Express, RequestHandler } from "express";
import { numberProfile, PROFILE_KEYS, verifyNumberRouting, WORK_NUMBER_CANDIDATE, WORK_NUMBER_OWNER } from "./policy";

interface Dependencies {
  numbers(owner: string): Promise<Array<{ id: string; userId: string; twilioNumber: string; name: string; type: string; createdAt?: Date }>>;
  pool(): Promise<Array<{ id: string; twilioNumber: string; isAssigned: boolean }>>;
  inspect(number: string): Promise<Parameters<typeof verifyNumberRouting>[0]>;
  assign(numberId: string, owner: string): Promise<{ id: string; twilioNumber: string; name: string; type: string }>;
}

/** Owner-authenticated setup only. Never dials, buys, transfers or reconfigures a number. */
export function registerCallProfileRoutes(app: Express, auth: RequestHandler, deps: Dependencies) {
  app.get("/api/call-profiles", auth, async (req, res) => {
    try {
      const owner = req.user!.id;
      const [numbers, pool] = await Promise.all([deps.numbers(owner), deps.pool()]);
      const candidate = pool.find(n => n.id === WORK_NUMBER_CANDIDATE.id && n.twilioNumber === WORK_NUMBER_CANDIDATE.phoneNumber);
      res.json({
        profiles: PROFILE_KEYS.map(id => ({
          id, label: id === "personal" ? "Личное" : "Работа",
          numbers: numbers.filter(n => numberProfile(n.type) === id)
            .map(n => ({ id: n.id, phoneNumber: n.twilioNumber, name: n.name, type: n.type })),
          secretaryOutboundReady: id === "personal" && numbers.some(n => numberProfile(n.type) === "personal"),
        })),
        recommendedWorkNumber: { ...WORK_NUMBER_CANDIDATE, available: owner === WORK_NUMBER_OWNER && !!candidate && !candidate.isAssigned },
        incomingAiEnabled: false, calendarConnected: false,
      });
    } catch { res.status(503).json({ error: "Не удалось загрузить профили звонков." }); }
  });
  app.post("/api/call-profiles/work-number", auth, async (req, res) => {
    try {
      if (req.user!.id !== WORK_NUMBER_OWNER)
        return res.status(403).json({ error: "Подключение этого номера разрешено только владельцу согласованного плана." });
      // Existing same-origin app and native Bearer clients; reject foreign browser writes.
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.get("host") ||
          (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)))
          return res.status(403).json({ error: "Cross-origin request denied" });
      }
      if (!req.is("application/json") || !req.body || Object.keys(req.body).some(k => k !== "numberId") ||
        req.body.numberId !== WORK_NUMBER_CANDIDATE.id)
        return res.status(400).json({ error: "Выберите предложенный свободный рабочий номер." });
      const owner = req.user!.id;
      const numbers = await deps.numbers(owner);
      const existing = numbers.find(n => n.type === "work");
      if (existing) {
        if (existing.twilioNumber !== WORK_NUMBER_CANDIDATE.phoneNumber)
          return res.status(409).json({ error: "Рабочий номер уже назначен. Переназначение не выполнялось." });
        return res.json({ phoneNumber: { id: existing.id, phoneNumber: existing.twilioNumber, name: existing.name, type: existing.type }, reused: true });
      }
      // The provider is read before DB assignment. A disconnected/foreign route is a blocker, not an invitation to change it.
      const inspected = await deps.inspect(WORK_NUMBER_CANDIDATE.phoneNumber);
      if (!verifyNumberRouting(inspected))
        return res.status(409).json({ error: "Номер не прошёл проверку голосового маршрута. Ничего не перенастроено." });
      const assigned = await deps.assign(WORK_NUMBER_CANDIDATE.id, owner);
      res.json({ phoneNumber: { id: assigned.id, phoneNumber: assigned.twilioNumber, name: assigned.name, type: assigned.type }, reused: false });
    } catch (error: any) {
      const conflict = error?.status === 409 || /not available|already|lock/i.test(error?.message ?? "");
      res.status(conflict ? 409 : 503).json({ error: conflict ?
        "Номер уже занят или назначение выполняется. Обновите список; чужой номер не переназначен." :
        "Не удалось проверить или подключить номер. Новый звонок не запускался." });
    }
  });
}
