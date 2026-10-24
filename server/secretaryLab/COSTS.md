# Dev Secretary Lab pricing audit

Checked **2026-10-24**, USD before taxes. Public pricing is not a statement of
this account's negotiated terms, subscription allowance, credits or final invoice.
No paid voice session or billing-account mutation is needed for this calculation.

## Official sources and audited rates

- [ElevenLabs Agents](https://elevenlabs.io/pricing/agents): additional call
  minutes $0.08/min; burst $0.16/min. STT and TTS are included. External LLM
  usage is separate. The current subscription/remaining minutes and any
  voice-specific conditions are not confirmed by admission, so we show the
  additional-minute scenario and an unknown account adjustment, not a complete
  bill. Flash API character discounts do **not** apply to Agents minutes.
- [Retell](https://www.retellai.com/pricing): Voice Infra $0.055/min (STT
  included); Retell Platform Voices $0.015/min, used only for the verified
  `retell-Merritt` choice. Managed `gpt-6.1-sol` standard $0.064/min. With Custom
  LLM this managed-model line is absent; actual TalkHint Engine tokens are extra.
  Other models/voices have unknown rates rather than a generic fallback.
- [OpenAI detailed pricing](https://developers.openai.com/api/docs/pricing):
  `gpt-6.1-sol` standard input/cached input/output $2/$0.10/$10 per million
  tokens; `gpt-live-1` $0.05/min, charged per second with backend/tool usage extra.
  `gpt-realtime-2.1`: text input/cache/output $4/$0.40/$24, audio
  $32/$0.40/$64 per million tokens. These are distinct billing models.

The existing GPT bench has a declared model at admission and a separately
verified sideband model. Pricing follows the report's actual runtime model,
never the tab label. Optional display transcription is separately identified;
missing transcription usage is not zero. No voice/model/reasoning/transport
setting is changed for pricing.

## Accounting and persistence

Each new run captures its public tariff **before** paid admission. Estimates
use this snapshot, actual model/voice/TTS/profile, observed connected duration,
and provider token usage. Engine output includes reasoning; cached input is
subtracted from ordinary input. All tool rounds count. Requests interrupted
without terminal usage remain unmeasured (no character-based token guessing).
Realtime usage is split by text/audio/cache and deduplicated by response ID.

Local duration excludes setup before connection. Retell's validated final
`duration_ms`, when present in the existing status request, takes precedence.
Neither local duration nor provider usage is a payment receipt. An unconfirmed
stop keeps duration-dependent amounts unknown. Missing rates/usage make the
total unknown, with only a **known subtotal** displayed.

The existing `secretary_lab_comparisons.runs` JSON contains the complete `cost`
snapshot, including official sources and verification date. No new table,
second repository, migration, production query or telephone path is introduced.
Reads, exports and rating edits do not recalculate saved prices. Historical
reports without a snapshot remain explicitly unmeasured.

`confirmedChargeUsd` is null: this Lab has no verified invoice/payment evidence.
Do not fill it from an estimate, token counts, credits or a provider's provisional
usage cost. Invoice reconciliation is a separate capability, not an implicit
provider request when opening a saved report.

Checks: `npm run check`; `npx vitest run server/secretaryLab
client/src/components/secretary-lab/run-cost.test.tsx`.
