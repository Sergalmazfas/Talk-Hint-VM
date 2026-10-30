import type { Express, RequestHandler } from "express";
import type { Pool } from "pg";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requireBenchmarkAdmin } from "../benchmark/adminGate";
import { ModelError } from "../projectModel/modelError";
import { TeamRepository } from "./repository";
import { teamView } from "./view";
import { portraitManifest, verifiedPortrait } from "./portraits";
import { TEAM_OWNER, TEAM_PLAN_HASH } from "./plan";
import { semanticHash } from "../companyData/valueTree";
import type { TeamPin } from "../../shared/team";

const equal = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" &&
  /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function validPin(v: any): v is TeamPin {
  return !!v && Object.keys(v).sort().join(",") === "planHash,revision,rootHash,step,workspace" &&
    typeof v.workspace === "string" && Number.isSafeInteger(v.revision) &&
    Number.isInteger(v.step) && v.step >= 0 && v.step < 4 &&
    /^[a-f0-9]{64}$/.test(v.rootHash) && v.planHash === TEAM_PLAN_HASH;
}
export function registerTeamRoutes(app: Express, getPool: () => Promise<Pool>, options: {
  environment?: string; repository?: TeamRepository; guard?: RequestHandler;
  portrait?: typeof verifiedPortrait;
} = {}) {
  const environment = options.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  const base = "/api/admin/team";
  let repository: TeamRepository | undefined = options.repository;
  const images = new Map<string, Promise<Buffer>>();
  const portrait = (name: string, digest: string) => {
    const pin = portraitManifest[name];
    if (!pin || digest !== pin.sha256) return Promise.reject(Error("Unknown portrait"));
    const key = `${name}:${digest}`;
    if (!images.has(key)) images.set(key, (options.portrait ?? verifiedPortrait)(name, digest)
      .catch(e => { images.delete(key); throw e; }));
    return images.get(key)!;
  };
  app.all([base, `${base}/*`], options.guard ?? requireBenchmarkAdmin, async (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (!req.isAuthenticated?.() || !req.session || String(req.user?.id) !== TEAM_OWNER || req.get("authorization"))
      return res.status(403).json({ error: "Требуется браузерная сессия владельца." });
    if (environment !== "production")
      return res.status(503).json({ error: "Команда читает только активный production-источник. Dev заморожен; локальная копия не подставляется." });
    try {
      const session = req.session as any;
      session.teamCsrf ??= randomBytes(32).toString("hex");
      if (req.path.startsWith(`${base}/portraits/`) && req.method === "GET") {
        const parts = req.path.slice(`${base}/portraits/`.length).split("/");
        if (parts.length !== 2 || !portraitManifest[parts[0]] || portraitManifest[parts[0]].sha256 !== parts[1])
          return res.status(404).json({ error: "Портрет не найден." });
        return res.type("png").send(await portrait(parts[0], parts[1]));
      }
      repository ??= new TeamRepository(await getPool(), environment);
      const status = async () => {
        const view = teamView(await repository!.read(TEAM_OWNER), environment);
        view.apply.csrfToken = session.teamCsrf; return view;
      };
      if (req.path === base && req.method === "GET") return res.json(await status());
      if (!["/grant", "/apply"].includes(req.path.slice(base.length))) return res.sendStatus(404);
      if (req.method !== "POST") return res.sendStatus(405);
      if (req.get("origin") !== `${req.protocol}://${req.get("host")}` ||
          req.get("sec-fetch-site") === "cross-site" || !equal(req.get("x-team-csrf"), session.teamCsrf))
        return res.status(403).json({ error: "Origin/CSRF подтверждение не совпало." });
      const body = req.body ?? {};
      if (body.confirm !== true || !validPin(body.expected) ||
          Object.keys(body).some(k => !["expected", "confirm", ...(req.path.endsWith("/apply") ? ["grant"] : [])].includes(k)))
        return res.status(400).json({ error: "Требуется точный pin пакета." });
      const view = await status();
      if (!view.apply.available || semanticHash(view.apply.pin) !== semanticHash(body.expected))
        return res.status(409).json({ error: "Источник или этап изменился. Обновите статус; не повторяйте вслепую." });
      if (req.path.endsWith("/grant")) {
        // Fail before issuing a capability if an exact reviewed portrait is missing.
        await Promise.all(Object.entries(portraitManifest).map(([name, pin]) => portrait(name, pin.sha256)));
        const token = randomBytes(32).toString("hex");
        session.teamGrant = { token, pin: semanticHash(body.expected), expires: Date.now() + 120_000 };
        await new Promise<void>((resolve, reject) => req.session!.save(e => e ? reject(e) : resolve()));
        return res.json({ grant: token });
      }
      const grant = session.teamGrant;
      if (!grant || !equal(grant.token, body.grant) || grant.pin !== semanticHash(body.expected) || grant.expires < Date.now())
        return res.status(403).json({ error: "Одноразовое разрешение недействительно." });
      delete session.teamGrant;
      // Consume before write. Loss of response never permits an automatic replay.
      await new Promise<void>((resolve, reject) => req.session!.save(e => e ? reject(e) : resolve()));
      await repository.apply(TEAM_OWNER, body.expected);
      return res.json(await status());
    } catch (e) {
      const code = e instanceof ModelError ? e.status : 503;
      return res.status(code).json({ error: code === 409 ? "Конфликт источника. Обновите статус." :
        "Действие не подтверждено. Обновите статус, не отправляйте запрос повторно. Данные и архивы не удаляются." });
    }
  });
}
