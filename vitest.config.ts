import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    // The /twilio/voice handler is signature-protected. Tests bypass that check
    // the same way local dev does (never honored in production by routes.ts).
    env: {
      NODE_ENV: "test",
      DISABLE_TWILIO_SIGNATURE_CHECK: "true",
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(rootDir, "shared"),
      "@": path.resolve(rootDir, "client/src"),
    },
  },
});
