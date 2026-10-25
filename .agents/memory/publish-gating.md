---
name: Publish gating via build script
description: How to make a check block Publish on this Reserved VM deployment
---
There is no separate publish/pre-deploy hook: the only enforceable gate is the deployment build command (`npm run build` → `script/build.ts`). To block Publish on a check, run it at the top of the build script and `process.exit(1)` on failure.

**Why:** a "manual pre-publish checklist" or a named validation step alone does not prevent a Publish; earlier contract-gating work established that doc-only checks were insufficient.

**How to apply:** enforce future mandatory checks in the build and keep them time-bounded. The old external Tutor gate is retired under the current product scope in `replit.md`; do not restore it as a generic "deployment fix."
