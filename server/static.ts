import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const talkHintPath = path.resolve(__dirname, "talkhint/ui");
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
