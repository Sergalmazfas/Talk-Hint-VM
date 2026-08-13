---
name: Publish gating via build script
description: How to make a check block Publish on this Reserved VM deployment
---
There is no separate publish/pre-deploy hook: the only enforceable gate is the deployment build command (`npm run build` → `script/build.ts`). To block Publish on a check, run it at the top of the build script and `process.exit(1)` on failure.

**Why:** a "manual pre-publish checklist" or a named validation step alone does not prevent a Publish; the completion reviewer rejected doc-only gating for the Tutor Engine contract probe.

**How to apply:** the live Tutor Engine contract probe runs first in `script/build.ts` (escape hatch `SKIP_TUTOR_ENGINE_CONTRACT_PROBE=true`, audited emergencies only). Add future mandatory pre-publish checks the same way; keep them time-bounded so builds cannot hang.
