import type { Express } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requireBenchmarkAdmin } from "./benchmark/adminGate";
import { adminActionOrigin } from "./adminWeb";
import { pool } from "./db";
import { hintModeStore } from "./liveHintMode";
export const liveHintModes = hintModeStore(() => pool);
export function registerLiveHintModeRoutes(app: Express) {
  const api = "/api/admin/hint-mode";
  app.use(api, requireBenchmarkAdmin, adminActionOrigin);
  app.get(api, async (req: any, res) => {
    try {
      if (!req.session) return res.status(403).json({ error: "OWNER_SESSION_REQUIRED" });
      const csrf = req.session.hintModeCsrf ??= randomBytes(32).toString("hex");
      res.set("Cache-Control", "no-store").json({ ...await liveHintModes.read(req.user.id), csrf });
    } catch { res.status(503).json({ error: "HINT_MODE_UNAVAILABLE" }); }
  });
  app.put(api, async (req: any, res) => {
    const token = String(req.get("x-hint-mode-csrf") ?? ""), expected = req.session?.hintModeCsrf;
    if (!expected || !/^[a-f0-9]{64}$/.test(token) || token.length !== expected.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(expected)))
      return res.status(403).json({ error: "CSRF_REQUIRED" });
    const { mode, revision, confirmed } = req.body ?? {};
    if (confirmed !== true || !["legacy", "english-first"].includes(mode) || !Number.isSafeInteger(revision) || revision < 0)
      return res.status(400).json({ error: "INVALID_COMMAND" });
    try {
      const written = await liveHintModes.write(req.user.id, mode, revision);
      const readBack = await liveHintModes.read(req.user.id);
      if (readBack.revision !== written.revision || readBack.mode !== written.mode)
        return res.status(409).json({ error: "READBACK_CHANGED_STOP", written, readBack });
      res.set("Cache-Control", "no-store").json(readBack);
    } catch (e) {
      res.status(e instanceof Error && e.message === "HINT_MODE_REVISION_CONFLICT" ? 409 : 503).json({ error: "WRITE_NOT_CONFIRMED_REREAD_NO_RETRY" });
    }
  });
  app.get("/admin/hint-mode", requireBenchmarkAdmin, (_req, res) => res.set("Cache-Control", "no-store").type("html").send(`<!doctype html>
<html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>Hint — режим подсказок</title>
<body style="font:18px system-ui;max-width:650px;margin:30px auto;padding:20px"><h1>Hint — режим подсказок</h1>
<p>Только ваш Hint. Старый — исходная схема. Новый — английская подсказка целиком, затем перевод. Катя и звонки не запускаются.</p>
<p id="state">Чтение…</p><button id="old" disabled>Старый / откат</button> <button id="new" disabled>Новый: английский сначала</button>
<p id="error" role="alert"></p><script>
let state;const api='/api/admin/hint-mode';const buttons=[document.getElementById('old'),document.getElementById('new')];
async function read(){const r=await fetch(api,{cache:'no-store'});if(!r.ok)throw Error('Не удалось прочитать состояние');
state=await r.json();document.getElementById('state').textContent='Режим: '+state.mode+' · revision '+state.revision;buttons.forEach(b=>b.disabled=false);}
async function change(mode){if(!confirm('Вы уверены?'))return;buttons.forEach(b=>b.disabled=true);
try{await read();buttons.forEach(b=>b.disabled=true);const r=await fetch(api,{method:'PUT',headers:{'Content-Type':'application/json','x-hint-mode-csrf':state.csrf},
body:JSON.stringify({mode,revision:state.revision,confirmed:true})});if(!r.ok)throw Error('Запись не подтверждена. Не повторяйте вслепую — перечитайте состояние.');
const w=await r.json();await read();if(state.mode!==w.mode||state.revision!==w.revision)throw Error('Состояние изменилось после записи — стоп');
document.getElementById('error').textContent='';}catch(e){document.getElementById('error').textContent=e.message;}}
buttons[0].onclick=()=>change('legacy');buttons[1].onclick=()=>change('english-first');read().catch(e=>document.getElementById('error').textContent=e.message);
</script></body></html>`));
}
