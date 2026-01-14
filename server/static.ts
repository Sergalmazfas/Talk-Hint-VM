import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Handle both ESM (development) and CommonJS (production bundle)
let __dirnameResolved: string;
try {
  __dirnameResolved = path.dirname(fileURLToPath(import.meta.url));
} catch {
  // In production CJS build, use cwd which points to dist/
  __dirnameResolved = process.cwd() + "/dist";
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirnameResolved, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const talkHintPath = path.resolve(__dirnameResolved, "talkhint/ui");
  if (fs.existsSync(talkHintPath)) {
    console.log("[TalkHint] Serving UI from:", talkHintPath);
    app.use("/app", express.static(talkHintPath));
  }

  app.use(express.static(distPath));

  app.use("*", (req, res, next) => {
    const reqPath = req.originalUrl;
    if (reqPath.startsWith("/api/") || reqPath.startsWith("/twilio/") || reqPath.startsWith("/app/") || reqPath === "/app") {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
