import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, cp } from "fs/promises";
import { spawnSync } from "child_process";

// -----------------------------------------------------------------------------
// MANDATORY pre-publish gate: the LIVE Tutor Engine contract probe runs before
// every production build (Publish executes `npm run build`, so a probe failure
// blocks deployment with a non-zero exit). The probe is time-bounded and
// cleans up its own sessions. Escape hatch (audited, e.g. Engine planned
// downtime): SKIP_TUTOR_ENGINE_CONTRACT_PROBE=true.
// -----------------------------------------------------------------------------
function runTutorEngineContractProbe() {
  if (process.env.SKIP_TUTOR_ENGINE_CONTRACT_PROBE === "true") {
    console.warn(
      "WARNING: Tutor Engine contract probe SKIPPED via SKIP_TUTOR_ENGINE_CONTRACT_PROBE=true — publishing without live contract verification.",
    );
    return;
  }
  console.log("running Tutor Engine contract probe (pre-publish gate)...");
  const r = spawnSync("npx", ["tsx", "scripts/tutor-engine-contract-probe.ts"], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(
      `Tutor Engine contract probe FAILED (exit ${r.status ?? "signal"}) — build aborted to prevent publishing an incompatible client. ` +
        "Fix the contract mismatch (see report above) or, for audited emergencies only, set SKIP_TUTOR_ENGINE_CONTRACT_PROBE=true.",
    );
    process.exit(1);
  }
  console.log("Tutor Engine contract probe PASSED.\n");
}

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
  runTutorEngineContractProbe();

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

  await writeFile("dist/index.cjs", "import('./index.js');\n");
  console.log("created ESM wrapper at dist/index.cjs");

  console.log("copying TalkHint UI...");
  await cp("talkhint/ui", "dist/talkhint/ui", { recursive: true });
  console.log("copied TalkHint UI to dist/talkhint/ui");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
