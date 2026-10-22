import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { registerPublicSite, publicSiteCapabilities } from "../publicSite";

function site() {
  const app = express();
  registerPublicSite(app);
  return app;
}

describe("public Secretary presentation, not a second customer runtime", () => {
  it.each(["/", "/start", "/account", "/privacy", "/terms", "/support"])(
    "serves %s without opening admin or requiring an account", async pathname => {
      const r = await request(site()).get(pathname);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toContain("text/html");
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["permissions-policy"]).toContain("microphone=()");
      expect(r.headers["content-security-policy"]).toContain("frame-src 'none'");
      expect(r.text).not.toContain('href="/admin');
      expect(r.text).not.toContain('src="/src/');
      expect(r.text).not.toMatch(/\$29|\$0\.25|autoplay/i);
    },
  );

  it("serves only the explicit public asset allowlist", async () => {
    for (const file of ["styles.css", "app.js", "capabilities.json"]) {
      expect((await request(site()).get("/site/" + file)).status).toBe(200);
    }
    for (const file of ["index.html", "server.ts", "ui/script.js", ".env", "recording.wav"]) {
      expect((await request(site()).get("/site/" + file)).status).toBe(404);
    }
  });

  it("exposes no fabricated audio, personal data or activated customer capabilities", async () => {
    const r = await request(site()).get("/site/capabilities.json");
    expect(r.body).toEqual(publicSiteCapabilities);
    expect(r.body.demos).toEqual({ approvedRecordings: [], audioAvailable: false });
    expect(r.body.customer).toMatchObject({
      webLoginAvailable: false,
      chatgptCardEditingAvailable: false,
      microphoneTestAvailable: false,
      numberActivationAvailable: false,
      chatgptFreePlanSupport: "unconfirmed",
    });
    for (const flag of ["sendsCalls", "sendsSms", "sendsCustomerEmail", "booksCalendar"]) {
      expect(r.body[flag]).toBe(false);
    }
    expect(r.body.legal).toEqual({
      approvedPrivacyAvailable: false, approvedTermsAvailable: false, supportContactVerified: false,
    });
  });

  it("describes the implemented voice identity rather than silently inventing alternatives", () => {
    const transport = readFileSync("server/incomingSecretary/liveAudio.ts", "utf8");
    for (const identity of ["gpt-live-1", "marin", "gpt-6.1-sol"]) {
      expect(transport).toContain(`"${identity}"`);
    }
    expect(publicSiteCapabilities.secretary).toMatchObject({
      provider: "OpenAI", model: "gpt-live-1", configuredVoice: "marin",
      languageSwitching: "requires-controlled-live-verification",
    });
    expect(publicSiteCapabilities.secretary.voices).toHaveLength(1);
    expect(publicSiteCapabilities.secretary.voices[0].gender).toBe("unspecified");
  });

  it("adds no public sending, booking, microphone or account-changing endpoints", async () => {
    for (const pathname of ["/start", "/account", "/site/capabilities.json", "/site/start-call"]) {
      expect((await request(site()).post(pathname).send({ confirmed: true })).status).toBe(404);
    }
    const script = readFileSync("talkhint/public-site/app.js", "utf8");
    expect(script).not.toMatch(/getUserMedia|new WebSocket|new Audio|speechSynthesis/);
    expect(script).not.toMatch(/fetch\(["'`]\/api\/|\/api\/login|\/admin\//);
  });
});
