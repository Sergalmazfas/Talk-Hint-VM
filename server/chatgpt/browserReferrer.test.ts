import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { BROWSER_REFERRER_POLICY, browserFormAction } from "./browserSecurity";

const chromium = "/repl/tools/bin/chromium";
const run = promisify(execFile);

/** Real browser transport regression, no accounts, DB, provider or internet. */
describe.skipIf(!existsSync(chromium))("HTML form Origin under the OAuth page referrer policy", () => {
  it("reproduces null under no-referrer and preserves same-origin POST without leaking URL parameters", async () => {
    const posts = new Map<string, { origin?: string; referer?: string }>();
    const server = createServer((req, res) => {
      const url = new URL(req.url!, "http://fixture.test");
      if (req.method === "POST") {
        posts.set(url.pathname, { origin: req.headers.origin, referer: req.headers.referer });
        res.setHeader("Content-Type", "text/html");
        return res.end("<html><body>Fixture form received. No action performed.</body></html>");
      }
      res.setHeader("Referrer-Policy", url.pathname === "/old" ? "no-referrer" : BROWSER_REFERRER_POLICY);
      res.setHeader("Content-Type", "text/html");
      res.end(`<form method="post" action="/submit${url.pathname}"><button>Continue</button></form>
        <script>document.forms[0].submit()</script>`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      for (const path of ["/old", "/fixed"]) {
        await run(chromium, ["--headless", "--no-sandbox", "--disable-gpu",
          "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
          "--dump-dom", "--virtual-time-budget=1500", `${origin}${path}?flow=synthetic-must-not-leak`],
        { timeout: 20000, maxBuffer: 1024 * 1024 });
      }
      expect(posts.get("/submit/old")?.origin).toBe("null");
      expect(posts.get("/submit/fixed")?.origin).toBe(origin);
      expect(posts.get("/submit/fixed")?.referer).toBe(`${origin}/`);
      expect(posts.get("/submit/fixed")?.referer).not.toContain("flow");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 45000);
  it("allows only the registered OAuth callback on consent, not on other forms", () => {
    expect(browserFormAction()).toBe("'self'");
    expect(browserFormAction("https://chatgpt.com/connector_platform_oauth_redirect"))
      .toBe("'self' https://chatgpt.com/connector_platform_oauth_redirect");
    expect(browserFormAction("https://chatgpt.com/connector_platform_oauth_redirect?fixture=not-in-csp"))
      .not.toContain("fixture");
    expect(() => browserFormAction("http://attacker.test/callback")).toThrow();
  });
  it("reproduces a blocked post-consent redirect and permits the exact callback with an explicit CSP source", async () => {
    let arrived = false;
    const callback = createServer((req, res) => {
      if (req.url === "/callback") arrived = true;
      res.setHeader("Content-Type", "text/html");
      res.end("<body>Callback fixture received. No real authorization.</body>");
    });
    await new Promise<void>(resolve => callback.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(callback.address() as any).port}/callback`;
    // Local HTTP is a fixture only; production's helper rejects non-HTTPS callbacks.
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      if (req.method === "POST") { res.writeHead(303, { Location: target }); return res.end(); }
      const allow = req.url === "/fixed";
      res.setHeader("Referrer-Policy", BROWSER_REFERRER_POLICY);
      res.setHeader("Content-Security-Policy",
        `script-src 'unsafe-inline'; form-action 'self'${allow ? ` ${target}` : ""}`);
      res.end('<form method="POST" action="/submit"></form><script>document.forms[0].submit()</script>');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      for (const path of ["/old", "/fixed"]) {
        arrived = false;
        await run(chromium, ["--headless", "--no-sandbox", "--disable-gpu",
          "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
          "--dump-dom", "--virtual-time-budget=1500",
          `http://127.0.0.1:${(server.address() as any).port}${path}`],
        { timeout: 20000, maxBuffer: 1024 * 1024 });
        expect(arrived).toBe(path === "/fixed");
      }
    } finally {
      await Promise.all([server, callback].map(s => new Promise<void>(resolve => s.close(() => resolve()))));
    }
  }, 45000);
});
