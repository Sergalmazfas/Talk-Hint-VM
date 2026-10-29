import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, cp, access } from "fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { verifyMcpBuild } from "./mcp-build-verification";
import { checkHintLabRuntime } from "../server/callLab/process";

// Publishing no longer depends on the retired external Tutor Engine.
// Local application/MCP bundle checks remain required below.

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
  // Check import + exact pin, without model requests or starting the application.
  await checkHintLabRuntime();
  const prepareOnly = process.argv.includes("--prepare-only");
  // A candidate never replaces dist used by the running phone/UI server.
  // Neither build mode contacts the retired external Tutor Engine.
  const reviewOutput = process.argv.find(arg => arg.startsWith("--review-output="))?.slice("--review-output=".length);
  if (reviewOutput && (!prepareOnly || !/^generated-artifacts\/[a-zA-Z0-9/_.-]+$/.test(reviewOutput) ||
      reviewOutput.split("/").some(part => part === ".." || part === ".")))
    throw new Error("Review output must be a new generated-artifacts directory in prepare-only mode");
  const out = reviewOutput ?? (prepareOnly ? "generated-artifacts/talkhint-release-candidate/dist" : "dist");
  if (prepareOnly) console.log("OFFLINE PREPARATION ONLY: no app boot, live Tutor probe or publication.");
  else console.log("External Tutor Engine disconnected; building TalkHint locally.");

  if (reviewOutput) {
    try {
      await access(out);
      throw new Error("Refuse replacing an existing review build");
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  } else await rm(out, { recursive: true, force: true });

  console.log("building client...");
  await viteBuild({ build: { outDir: resolve(out, "public") } });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  const compiled = await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: join(out, "index.js"),
    metafile: true,
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

  const bundle = await readFile(join(out, "index.js"), "utf8");
  // Compile only. Never execute/import data or register an approved grant here.
  await esbuild({
    entryPoints: ["server/companyData/v3/importWorker.ts"],
    platform: "node", bundle: true, format: "esm",
    outfile: join(out, "company-import-worker.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    external: externals, minify: true, logLevel: "info",
    banner: { js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` },
  });
  const mcp = verifyMcpBuild(compiled.metafile!, bundle);
  await writeFile(join(out, "mcp-build-receipt.json"), JSON.stringify({
    ...mcp, preparedAt: new Date().toISOString(), prepareOnly,
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  }, null, 2) + "\n");
  console.log("MCP runtime inclusion gate PASSED.");
  await writeFile(join(out, "index.cjs"), "import('./index.js');\n");
  console.log(`created ESM wrapper at ${out}/index.cjs`);

  console.log("copying TalkHint UI...");
  await cp("talkhint/ui", join(out, "talkhint/ui"), { recursive: true });
  console.log(`copied TalkHint UI to ${out}/talkhint/ui`);
  await cp("talkhint/public-site", join(out, "talkhint/public-site"), { recursive: true });
  await cp("workers/hint_lab", join(out, "workers/hint_lab"), {
    recursive: true, filter: source => !source.includes("__pycache__") && !source.endsWith(".pyc"),
  });
  console.log(`copied public Secretary website to ${out}/talkhint/public-site`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
