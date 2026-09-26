import type { RequestHandler } from "express";

type RequestLogger = (message: string, source?: string) => void;

/**
 * Logs request metadata only. Response bodies, request headers, and client IPs
 * may contain private utterances, OCR, credentials, or other personal data.
 */
export function createRequestLoggingMiddleware(log: RequestLogger): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    const isTwilioOrMedia = reqPath.includes("twilio") || reqPath.includes("media");

    if (isTwilioOrMedia) {
      log(`>>> INCOMING: ${req.method} ${reqPath}`, "request");
    }

    res.on("finish", () => {
      if (reqPath.startsWith("/api") || isTwilioOrMedia) {
        const duration = Date.now() - start;
        log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
      }
    });

    next();
  };
}