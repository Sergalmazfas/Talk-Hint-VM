/**
 * Isolated, visual-only fixture harness for the REAL Secretary Lab component.
 * No app server, credentials, database, microphone or AI providers are connected.
 * Never mounted by production. Start manually for screenshots; port 8099.
 */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const root = process.cwd();
const authPath = path.join(root, "client/src/lib/auth.tsx");
const fixture = {
  providers: {
    elevenlabs: { ready: true, source: "linked_existing" },
    cartesia: { ready: true, source: "linked_existing" },
    openai: { ready: true, source: "builtin", model: "gpt-realtime-2.1", voice: "marin" },
  },
  models: { realtime: "gpt-realtime", stt: "gpt-4o-mini-transcribe" },
  sessions: [],
  limits: { durationSeconds: 300, historyMinutes: 60 },
  note: "Isolated visual fixture only: no phone or AI/audio provider.",
};
const preview = await createServer({
  configFile: false,
  root: path.join(root, "client"),
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  plugins: [
    { name: "isolated-lab-fixture", enforce: "pre",
      load(id) {
        if (id.split("?")[0] === authPath) return `export function useAuth(){return {
          user:{id:"fixture-only",isAdmin:true},token:"fixture-not-a-session",isLoading:false};}`;
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/secretary-lab" && req.url !== "/") return next();
          const html = await server.transformIndexHtml("/secretary-lab", `<!doctype html><html lang="ru">
          <head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
          <div style="background:#173f39;color:white;padding:10px;font:14px system-ui">
          ИЗОЛИРОВАННЫЙ МАКЕТ · данные вымышлены · звонки и AI отключены</div><div id="root"></div>
          <script>window.fetch=async(url,options)=>new Response(JSON.stringify(
            String(url)==="/api/admin/secretary-lab"&&!options?.method?${JSON.stringify(fixture)}:
            {error:"This visual fixture cannot start sessions"}),{status:!options?.method?200:403,
            headers:{"Content-Type":"application/json"}});</script>
          <script type="module">
          import React from "react";import{createRoot}from"react-dom/client";
          import "/src/index.css";import SecretaryLab from"/src/pages/secretary-lab.tsx";
          createRoot(document.getElementById("root")).render(React.createElement(SecretaryLab));
          </script></body></html>`);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store"); res.end(html);
        });
      },
    }, react(), tailwindcss(),
  ],
  css: { postcss: { plugins: [] } },
  server: { host: "0.0.0.0", port: 8099, strictPort: true, allowedHosts: true },
});
await preview.listen();
console.log("Visual-only Secretary Lab fixture on 8099; no providers or phone calls possible");
