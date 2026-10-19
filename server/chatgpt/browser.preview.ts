/**
 * Standalone visual fixture only. Does not import auth, storage, main routes,
 * telephony or credentials. Never mount in the application; POST always fails.
 */
import express from "express";
import { renderBrowserPage, type BrowserPage } from "./browserViews";
const app = express();
const form = { csrf: "nonfunctional-visual-fixture", flow: "nonfunctional-visual-fixture" };
const pages: Record<string, BrowserPage> = {
  login: { kind: "login", ...form },
  consent: { kind: "consent", ...form, account: "owner@example.test",
    scopes: ["calls:read", "calls:transcript", "offline_access"] },
  approval: { kind: "approval", ...form, account: "owner@example.test",
    phoneNumber: "+12025550123", instruction: "Уточнить статус возврата депозита.\nНе сообщать платёжные данные и не соглашаться на новые расходы.",
    expiresAt: "2026-10-19T22:10:00Z", approved: false },
  history: { kind: "secretary-history", ...form, account: "owner@example.test",
    tasks: [{ id: "demo-task", status: "completed", phoneNumber: "+12025550123",
      summary: "Демонстрационный сохранённый отчёт. Возврат депозита подтверждён.",
      createdAt: "2026-10-19T19:00:00Z", updatedAt: "2026-10-19T19:03:00Z" }], calls: [] },
};
app.get("/preview/:state", (req, res) => {
  const page = pages[req.params.state];
  if (!page) return void res.sendStatus(404);
  res.set({ "Cache-Control": "no-store", "Content-Security-Policy":
    "default-src 'none'; style-src 'nonce-visual-fixture'; script-src 'none'; form-action 'none'; frame-ancestors 'none'" });
  res.type("html").send(renderBrowserPage(page, "visual-fixture"));
});
app.use((_req, res) => res.status(405).send("Visual fixture only. No login, permissions or calls."));
const port = Number(process.argv[2] ?? 5000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port");
app.listen(port, "0.0.0.0", () => console.log(`Isolated visual fixture on port ${port}; no backend or dialing.`));
