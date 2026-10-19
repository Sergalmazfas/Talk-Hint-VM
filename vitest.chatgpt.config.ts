import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Separate, repeatable stage-one environment. No database or provider credential
// is inherited by these tests. Fixtures inject fake owners, persistence and dialer.
const config = mergeConfig(base, defineConfig({
  test: {
    include: ["server/chatgpt/**/*.test.ts", "server/secretary/legacyRoute.test.ts"],
    env: {
      DATABASE_URL: "", PROD_DATABASE_URL: "",
      OPENAI_API_KEY: "", ELEVENLABS_API_KEY: "", CARTESIA_API_KEY: "",
      TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_API_KEY: "",
      TWILIO_API_SECRET: "", TWILIO_PHONE_NUMBER: "", TWILIO_TWIML_APP_SID: "",
      CHATGPT_SECRETARY_ENABLED: "false",
    },
  },
}));
// Vite's mergeConfig concatenates arrays; do not inherit the full-suite include.
config.test!.include = ["server/chatgpt/**/*.test.ts", "server/secretary/legacyRoute.test.ts"];
export default config;
