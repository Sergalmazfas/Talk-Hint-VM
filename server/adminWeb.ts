import type { Express, RequestHandler } from "express";
import { requireBenchmarkAdmin } from "./benchmark/adminGate";
import { issueAdminWebTicket } from "./adminWebTickets";
import { registerPublicSite } from "./publicSite";

const html = (title: string, body: string) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} · TalkHint</title>
<style>body{margin:0;background:#f5f7fa;color:#172033;font:17px/1.6 system-ui,sans-serif}
main{max-width:620px;margin:12vh auto;padding:32px}h1{font-size:36px;letter-spacing:-1px}
a{display:inline-block;color:#fff;background:#183955;padding:12px 20px;border-radius:12px;text-decoration:none}
p{color:#526175}</style></head><body><main>${body}</main></body></html>`;

export const ADMIN_LOGIN = html("Administrator sign-in",
  `<h1>TalkHint workspace</h1><p>Sign in with the existing project administrator account.
  Signing in with another Google account does not grant access.</p>
  <a href="/api/login">Continue with Google</a><p><small>If access is denied, use the previously authorized
  administrator account. No registration or phone activation is performed here.</small></p>`);

/** Enforced before static/Vite handlers. The allowlist is the existing owner rule,
 * not a name, a new signup, or ADMIN_PROVISION_USER. Native APIs keep their auth. */
export const adminWebAccess: RequestHandler = (req, res, next) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Authorization" });
  // JSON errors are used for API callers; documents get a useful Google entry.
  if (!req.user && !req.get("authorization")) {
    return res.status(401).type("html").send(ADMIN_LOGIN);
  }
  requireBenchmarkAdmin(req, res, () => {
    res.locals.adminWeb = true;
    next();
  });
};

export const adminActionOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  try {
    if (req.get("sec-fetch-site") === "cross-site" ||
      (origin && new URL(origin).origin !== `${req.protocol}://${req.get("host")}`) ||
      (!origin && !req.get("authorization")?.startsWith("Bearer "))) {
      return res.status(403).json({ error: "Same-origin administrator action required" });
    }
  } catch { return res.status(403).json({ error: "Invalid origin" }); }
  next();
};

export function registerAdminWebBoundary(app: Express) {
  registerPublicSite(app);
  app.get("/index.html", (_req, res) => res.redirect("/"));
  app.get("/admin/login", (_req, res) => res.set("Cache-Control", "no-store").type("html").send(ADMIN_LOGIN));
  app.use("/api/admin", requireBenchmarkAdmin, adminActionOrigin);
  app.post("/api/admin/websocket-ticket", (req, res) => {
    const ticket = issueAdminWebTicket(req.user!.email);
    if (!ticket) return res.status(503).json({ error: "Administrator transport unavailable" });
    res.set("Cache-Control", "no-store").json({ ticket });
  });
  app.use(["/api/health", "/api/expo-url", "/api/events", "/api/chat", "/api/speak",
    "/api/generate-initial-hint"], requireBenchmarkAdmin, adminActionOrigin);

  const legacy = ["/app", "/dashboard", "/login", "/onboarding", "/pricing", "/settings",
    "/select-number", "/voice-lab", "/secretary-lab", "/incoming-secretary",
    "/incoming-secretary-preview", "/health", "/expo", "/tutor/preview", "/translator-spike"];
  app.use(legacy, adminWebAccess, (req, res) => {
    // Only an authorized owner gets a migration redirect, never a public alias.
    const target = req.originalUrl.split("?")[0];
    const search = req.originalUrl.includes("?") ? "?" + req.originalUrl.split("?").slice(1).join("?") : "";
    res.redirect(307, "/admin" + (target === "/login" ? "" : target) + search);
  });
  app.use("/admin", adminWebAccess, adminActionOrigin);
  app.use((req, res, next) => {
    if (req.path === "/admin/health") req.url = "/health" + (req.url.includes("?") ? "?" + req.url.split("?").slice(1).join("?") : "");
    else if (req.path === "/admin/expo") req.url = "/expo";
    else if (req.path === "/admin/tutor/preview") req.url = "/tutor/preview";
    // /tutor is the native WKWebView document: leave it and its API unchanged.
    else if (req.path === "/admin/tutor") req.url = "/tutor";
    else if (req.path === "/admin/translator-spike" || req.path.startsWith("/admin/translator-spike/"))
      req.url = req.url.slice("/admin".length);
    next();
  });
  // No alternate HTML/module URL may bypass the web boundary in Dev or a build.
  app.use(["/src", "/@vite", "/@fs", "/@id", "/node_modules", "/assets"], adminWebAccess);
}
