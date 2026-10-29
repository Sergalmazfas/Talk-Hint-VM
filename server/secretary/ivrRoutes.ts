import type { Express } from "express";
import { authMiddleware } from "../auth";
import { ownerIvr } from "./ivrPhone";
import { secretaryTasks } from "@shared/schema";
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";

// Browser-only, same-origin owner action. Native clients need no new build.
const page = `<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Меню звонка Кати</title>
<style>body{font:18px system-ui;max-width:680px;margin:30px auto;padding:20px;color:#173e36;background:#f2f7f4}pre{white-space:pre-wrap}button,input{font:inherit;padding:14px;margin:8px 0}button{background:#146b5c;color:white;border:0;border-radius:8px}input{width:130px}#result{white-space:pre-wrap}</style>
<h1>Катя: помощь с меню</h1><p>Только пункт меню. Не вводите PIN, номера карт, счетов или личные данные.
Звонок ограничен пятью минутами.</p><pre id="menu">Получение статуса…</pre>
<form id="form"><input id="digits" aria-label="Цифры меню" pattern="[0-9*#]{1,5}" maxlength="5" required>
<button id="send" disabled>Нажать цифры</button></form><p id="result"></p>
<script>
let current=null,busy=false;const menu=document.getElementById('menu'),result=document.getElementById('result'),button=document.getElementById('send');
async function refresh(){try{const r=await fetch(location.pathname+'?format=json',{credentials:'same-origin',cache:'no-store'});
if(!r.ok)throw Error('Звонок недоступен, завершён или нужен вход владельца.');
current=await r.json();menu.textContent=current.menu||'Новое меню ещё не услышано.';
button.disabled=busy||!current.waiting;
if(!current.waiting&&!busy)result.textContent='Катя не ожидает выбора владельца. Дождитесь запроса помощи.';
}catch(e){current=null;button.disabled=true;result.textContent=e.message;}}
document.getElementById('form').onsubmit=async e=>{e.preventDefault();if(!current||!current.waiting||busy)return;busy=true;button.disabled=true;
try{const r=await fetch(location.pathname,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-secretary-menu':'1'},
body:JSON.stringify({digits:document.getElementById('digits').value,menuHash:current.menuHash})});
if(!r.ok)throw Error('Команда не подтверждена: меню могло измениться или звонок завершился. Автоматического повтора нет.');
result.textContent='Команда отправлена. Ожидаем ответ меню; принятие тонов пока не подтверждено.';
}catch(e){result.textContent=e.message;}finally{busy=false;await refresh();}};
refresh();setInterval(refresh,3000);
</script></html>`;

export function registerSecretaryIvrRoutes(app: Express) {
  app.get("/api/secretary/ivr", authMiddleware, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const owner = (req as any).user?.id;
      if (!owner) return res.sendStatus(401);
      const [task] = await db.select({ id: secretaryTasks.id }).from(secretaryTasks).where(and(
        eq(secretaryTasks.userId, owner), eq(secretaryTasks.voiceProvider, "retell"),
        inArray(secretaryTasks.status, ["starting", "ringing", "connected"]),
      )).limit(1);
      if (!task) return res.status(404).type("text").send("Активного звонка Кати с меню сейчас нет.");
      return res.redirect(`/api/secretary/tasks/${encodeURIComponent(task.id)}/ivr`);
    } catch { return res.status(503).type("text").send("Не удалось проверить активный звонок. Повтора команды не было."); }
  });
  const path = "/api/secretary/tasks/:id/ivr";
  app.get(path, authMiddleware, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const owner = (req as any).user?.id;
      if (!owner) return res.sendStatus(401);
      const controller = await ownerIvr(String(req.params.id), owner);
      if (req.query.format === "json") return res.json(controller.status());
      return res.type("html").send(page);
    } catch { return res.status(404).json({ error: "Active owner menu unavailable" }); }
  });
  app.post(path, authMiddleware, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.get("origin") !== `https://${req.get("host")}` || req.get("x-secretary-menu") !== "1")
      return res.sendStatus(403);
    try {
      const owner = (req as any).user?.id;
      if (!owner) return res.sendStatus(401);
      if (Object.keys(req.body ?? {}).some(k => !["digits", "menuHash"].includes(k)) ||
        typeof req.body?.menuHash !== "string") return res.sendStatus(400);
      const controller = await ownerIvr(String(req.params.id), owner);
      return res.json(await controller.press(req.body.digits, req.body.menuHash, new AbortController().signal, true));
    } catch { return res.status(409).json({ error: "Menu action not confirmed; no automatic retry" }); }
  });
}
