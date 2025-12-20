import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, cp } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.js",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
    banner: {
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
    },
  });

  // Copy TalkHint UI files to dist (both locations for compatibility)
  console.log("Copying TalkHint UI files...");
  await cp("talkhint/ui", "dist/talkhint/ui", { recursive: true });
  await cp("talkhint/ui", "dist/public/app", { recursive: true });
  console.log("TalkHint UI files copied to dist/talkhint/ui and dist/public/app");

  // Create CJS wrapper for package.json start script (which expects index.cjs)
  const cjsWrapper = `// ESM loader - redirects to pure ESM build
(async () => { await import('./index.js'); })();
`;
  await writeFile("dist/index.cjs", cjsWrapper);

  console.log("\n✅ Build complete:");
  console.log("   - dist/index.js (pure ESM server)");
  console.log("   - dist/index.cjs (loader wrapper)");
  console.log("   - dist/public/ (React client)");
  console.log("   - dist/talkhint/ui/ (TalkHint UI)");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
