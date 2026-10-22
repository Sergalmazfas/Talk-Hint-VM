import type { Express, Response } from "express";
import path from "node:path";

/** Deliberately no account, provider, database or admin imports. These are
 * public presentation facts, not an activation or customer-test API. */
export const publicSiteCapabilities = {
  release: "development-draft",
  secretary: {
    provider: "OpenAI",
    model: "gpt-live-1",
    reasoningModel: "gpt-6.1-sol",
    configuredVoice: "marin",
    voices: [{ id: "marin", label: "Marin", gender: "unspecified", demoAudio: null }],
    languages: ["en", "ru", "es"],
    languageSwitching: "requires-controlled-live-verification",
  },
  demos: { approvedRecordings: [], audioAvailable: false },
  customer: {
    webLoginAvailable: false,
    chatgptCardEditingAvailable: false,
    microphoneTestAvailable: false,
    numberActivationAvailable: false,
    chatgptMcpUrl: "https://talkhint.app/api/chatgpt/mcp",
    chatgptRequiresExistingTalkHintAccount: true,
    chatgptFreePlanSupport: "unconfirmed",
  },
  legal: { approvedPrivacyAvailable: false, approvedTermsAvailable: false, supportContactVerified: false },
  sendsCalls: false,
  sendsSms: false,
  sendsCustomerEmail: false,
  booksCalendar: false,
} as const;

function headers(res: Response) {
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "microphone=(), camera=(), geolocation=()",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
}

export function registerPublicSite(app: Express) {
  const directory = path.resolve(process.cwd(),
    process.env.NODE_ENV === "production" ? "dist/talkhint/public-site" : "talkhint/public-site");
  app.get(["/", "/start", "/account", "/privacy", "/terms", "/support"], (_req, res) => {
    headers(res);
    res.sendFile(path.join(directory, "index.html"));
  });
  app.get("/site/capabilities.json", (_req, res) => {
    headers(res);
    res.json(publicSiteCapabilities);
  });
  for (const file of ["styles.css", "app.js"]) {
    app.get(`/site/${file}`, (_req, res) => {
      headers(res);
      res.sendFile(path.join(directory, file));
    });
  }
  // No static directory mount: unknown public paths must never expose source,
  // recordings, the legacy UI or its protected modules.
  app.use("/site", (_req, res) => res.status(404).json({ error: "Public asset not found" }));
}
