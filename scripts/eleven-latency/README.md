# ElevenLabs: reproducible Dev comparison

This extends `scripts/probe-eleven-latency.ts`; no production, phone, clone,
microphone, playback, real actions or publishing. GPT and Retell settings stay
unchanged. The catalog voice and actual Eleven + Engine adapter are used.

## Offline plan (no DB or paid provider requests)

```sh
npx tsx scripts/probe-eleven-latency.ts --plan --seed trial-2026 --repetitions 10
```

There are ten measured session pairs by default, plus one separate warmup pair.
Each session runs the same nine scenarios: text, number hesitation/correction,
and address hesitation/correction in English, Russian and Spanish. The seeded
plan shuffles profile order within each pair, measured pair order, and scenario
order. Both profiles in a pair get the same scenario order. Warmup results are
retained but excluded from estimates.

## Paid execution

The script temporarily needs the existing public Dev callback on port 5000.
Do not run alongside the application workflow: a busy port fails before paid
fixture or agent work, without stopping that application. Restore the normal
application workflow afterwards. An existing opted-in lab owner and Dev DB are
required; no new account or production record is created.

Example **ceilings, not a dollar quote** (review the offline plan first):

```sh
NODE_ENV=development npx tsx scripts/probe-eleven-latency.ts --run \
  --seed trial-2026 --repetitions 10 --warmups 1 --retries 0 \
  --max-sessions 22 --max-session-seconds 290 \
  --max-engine-requests 400 --max-fixture-characters 5000 \
  --max-wall-seconds 18000
```

No paid run was required to implement/test this harness. Session count and
Engine request budgets default to **zero**. Fixture character budget defaults
to zero (fully cached content-addressed fixtures can be reused free of new
synthesis). Missing fixture characters are checked as a whole before any TTS.
All paid attempts count, including failures. No hidden harness retries.
`--retries N` reserves session budget for every possible retry; a retry retains
its own ID, ordinal and `retryOf` link and never replaces the initial sample.

The existing adapter allows six starts per rolling hour; the harness waits
rather than increasing/bypassing that limit. The default plan consequently
needs hours, not minutes. Wall-budget exhaustion stops and archives a partial
experiment. `--max-session-seconds` requests a stop starting at admission;
provider configuration still caps each conversation at 300 seconds. Setup,
cleanup, in-flight provider/model work and billing rounding are not
instantaneously preemptible. The manifest separately records the conservative
configured maximum agent seconds. Engine request count bounds Custom LLM HTTP
requests, **not** internal model/tool rounds, tokens or dollars. Account tariffs
and actual billing must be checked separately. The harness sends no action
requests; the unchanged Engine remains test-only.

## Archive and interpretation

The canonical batch manifest, plan, progress, failures, raw observations,
callback fingerprints, per-request timings, fixture texts/hashes, resource
counters and final summary are checkpointed to the **existing comparison
repository**, with its existing ownership/consent/expiry rules. Each normal
session also retains its original Engine report, configuration and test-only
ledger and links back to the batch. Failures before a session archive exists
still belong to the batch. JSON under `generated-artifacts/eleven-latency/` is
only a gitignored convenience copy. A new process can retrieve the batch
through the existing comparison detail/export flow using the logged
`sharedComparisonId`; retrieval never resumes a session. SIGINT/SIGTERM retain
partial results and request cleanup. A cleanup failure stops the experiment
instead of proceeding to another paid session.

The report includes per-language distributions (sample count, min, median,
p90/p95, max, mean), errors, skips, cancellations, retries and ambiguous
correlations. Paired distributions and seeded 95% bootstrap intervals for the
median optimized-minus-baseline delta resample **session pairs**. Only clean
first-attempt, fully successful sessions with single-request, completed,
non-cancelled, non-replayed observations
enter that estimate; exclusions and missing pairs are counted. More samples
are not a guarantee of significance or independence from changing provider load.
There is no automatic winner or subjective score.

Custom LLM callbacks get local unique IDs and transcript fingerprints.
Identical transcripts within one session are labeled possible replay/retry,
not asserted to be a provider-supplied retry ID. Accepted callbacks map to
timings only when the complete sequences have equal counts; otherwise the
session is ambiguous and excluded. A failed/unfinished response stops that
session instead of assigning its late frames to the next scenario.

Internal one-second pauses in **both numbers and addresses, for both profiles
and all three languages**, are separate from final endpoint silence. The raw
report records Engine requests and provider frames arriving inside each pause.
Those are early-entry observations, not subjective judgments of recognition
or conversation quality.

Engine first text, first provider audio frame, and paced synthetic PCM do
**not** measure physically heard sound. Audio association remains explicitly
sequential/best-effort; SDK playback is not tested. Number/address observations
cannot establish real microphone/iPhone behavior. Baseline and optimized are
bundles with different TTS, primary language and checkpoint policy, not an
isolated model-speed experiment.

## Offline regression checks

```sh
npx vitest run server/secretaryLab/elevenLatencyProbe.test.ts
npx tsc --project scripts/eleven-latency/tsconfig.json
```
