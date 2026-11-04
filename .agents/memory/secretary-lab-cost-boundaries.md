---
name: Secretary Lab cost boundaries
description: Pricing assumptions and scope agreed for the private Dev voice comparison bench.
---

The owner approved interruption-buffer experiments ONLY in Dev variant C,
raising the existing series ceiling to $10, without resetting historical costs.
Voice, language, greeting and Retell's normal yielding to interruptions stay
unchanged. Ambiguity must not leak a stale answer, but can require a silent
regeneration rather than a voiced announcement. Production transfer needs a
separate explicit owner decision.

**Why:** the owner wants to avoid throwing away an answer on acknowledgements,
but considers speaking stale facts worse than a conservative regeneration.

**How to apply:** keep old/new runs distinguishable, preserve unknown-request
reserves, and never describe a passed event simulation as proof of audible
resumption or production readiness.

Valid PCM is not evidence that Retell understood a synthetic caller. Local
robotic speech can become “unintelligible”; a short ASR fragment can also look
like a language switch.

**Why:** the interruption trial exposed fixture and transcript-normalization
effects that otherwise looked like failed response reuse.

**How to apply:** use the same validated question audio for before/after,
separate ASR failures and overlapping sound from clean latency samples, and
retain failed attempts rather than silently replacing them with successful ones.

Separate “the answer must be regenerated” from “the caller needs a spoken
bridge”. Budget/rate limits for bridges belong to caller phrases and substantive
secretary turns, not Retell response IDs.

**Why:** the owner's real conversation exposed repeated ASR requests within the
same phrase, creating unwanted filler speech and exhausting cancellation holds.

**How to apply:** a benign ASR extension may invalidate generated text silently;
never make every safe-side cancellation announce itself. The owner approved a
$2 model envelope for Dev C only, inside the unchanged $10 series ceiling.

The owner explicitly requested automatic permanent Dev C reports in the Dev
database so phone-based review no longer requires downloading JSON.

**Why:** manually exporting each conversation prevented practical analysis.

**How to apply:** preserve owner isolation and existing production boundaries;
do not silently change the separate opt-in comparison archive's 30-day retention.

Retell may connect a custom LLM and generate its greeting while the web call is still `registered`, before the browser joins.

**Why:** a browser import failed behind the owner-only web boundary, but the already admitted session still consumed an OpenAI greeting request. Provider audio cost was zero at readback; model cost was not.

**How to apply:** authenticate and preflight browser modules/audio before paid admission. `registered` is not evidence of zero spend. Reconcile both provider and external model usage; an unconfirmed stop keeps its reservation and blocks a blind repeat.

One human turn can produce multiple Retell response requests as the caller pauses
and resumes. Local budget-guard rejections are not paid provider requests.

**Why:** a normal multi-turn owner conversation exhausted a short-session request
guard although the model kept returning successful responses; the generic error
made this look like a model failure.

**How to apply:** distinguish response events, actual provider admissions,
cancellations and locally rejected requests. Exercise realistic multi-turn speech
before declaring a bounded voice bench usable; report budget exhaustion clearly,
without silently raising the monetary ceiling or treating missing usage as free.

Only extend pricing inside the existing Dev Secretary Lab and its common reports
archive. Do not change voice settings, add Cartesia, touch production/telephony/
Xcode or publish as part of this work.

**Why:** The owner explicitly separated the postponed pricing stage from the
working voice experiments and production rollout.

**How to apply:** Preserve that scope for pricing follow-ups unless explicitly
expanded by the owner.

ElevenLabs Agents minute pricing is not standalone TTS character pricing.
Changing a profile to Flash does not establish a lower Agents minute rate.
An unknown subscription/voice adjustment is not free. Provider usage and a
computed amount are not confirmed payment; never label an estimate as a charge.

**Why:** The public products use different billing units, and the Lab has no
invoice reconciliation evidence. Substituting TTS prices or assuming package
minutes are free would create misleading comparisons.

**How to apply:** Verify the exact product and runtime model against official
sources, preserve tariff snapshots for historical reports, and leave missing
evidence explicitly unknown instead of silently substituting rates.
