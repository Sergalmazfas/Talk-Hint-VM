# ElevenLabs + Engine — private Dev browser comparison

Open `/admin/secretary-lab?stand=eleven-engine`. GPT, Retell and Retell + Engine
remain available. Retell + Engine and this stand instantiate the same unchanged
`SecretaryConversationEngine`; the assignment and fictional fixture are shared.
GPT/standalone Retell keep their actual separate internals, labelled in reports.

## Actual provider and the clone blocker

- TalkHint generation: our OpenAI account, `gpt-6.1-sol`, Responses API, existing
  Secretary identity/policy/permission checks and sandbox tools.
- Audio: ElevenLabs Agents Platform **custom-llm**, ASR `scribe_realtime`,
  TTS `eleven_multilingual_v2`, PCM 16 kHz. Initial language EN. The model supports
  RU/EN/ES text; audible quality and spontaneous language switching remain live
  acceptance items, not a consequence of a successful configuration check.
- Catalog: **Sarah**, `EXAVITQu4vr4xnSDxMaL`, existing premade female American voice.
- Existing owner clone is looked up per owner from the existing Voice Lab row.
  No new cloning or automatic replacement is performed.
- **Verified restriction:** ElevenLabs rejected the existing Instant Voice Clone
  with `custom_llm_not_allowed_in_with_agent_with_ivc_voice`: “Custom LLM is not
  allowed when using agents with Instant Voice Clones.”
  Voices API access/TTS readiness does NOT mean Custom LLM eligibility.
  The clone choice is disabled with this reason; a catalog choice must be explicit.
  Do not switch the Engine to an ElevenLabs-managed LLM to evade the restriction.

Per-session private audio-only agents have no RAG/business tools/fallback LLM.
They use a capability URL to our streaming HTTP adapter, not our OpenAI key.
The adapter ignores provider system/developer/tool instructions and supplies
the trusted assignment/context to our Engine. It returns OpenAI-compatible SSE.
All TEST tools execute inside TalkHint. No actual calendar/delivery client exists.

## Same report repository

No second table or JSON result store. Stable task ID is the idempotent
`clientRequestId`, also the comparison ID in `secretary_lab_comparisons`.
The shared `PgComparisonRepository.checkpoint` saves committed snapshots under that
ID; it cannot change owner, consent timestamp, original expiry or archive rating.
Explicit consent on Start includes paid processing and 30-day report storage.

The model-stream adapter checkpoints the Engine ledger BEFORE a follow-up model
request can confirm a tool result. DB failure has no memory fallback: no fabricated
confirmation; the session is stopped. Polling returns committed repository data.
Completed response retries reuse the result; Engine action fingerprints suppress
duplicates across different response IDs. Stop revokes capabilities, aborts SSE,
closes both audio sockets and deletes only the private agent created by this session.
If deletion/save is unconfirmed, another admission is blocked pending retry.

The browser gets a one-use same-origin audio-proxy ticket, NOT an ElevenLabs
signed URL or API key. The proxy holds provider credentials and can terminate the
upstream even after browser disconnection. An interruption closes old generation;
it does not undo a committed TEST action. Later user messages receive a fresh turn.
Provider audio goes through the official ElevenLabs client SDK, which owns browser
playback interruption. Cancel during permission/setup closes a late session too.
Archive reads/reload never reacquire the microphone or restart audio.

Settings: normal turn eagerness, 15s turn timeout, no speculative turns,
soft timeout disabled, silence does not auto-end, five-minute maximum,
record_voice=false, delete_audio=true, delete_transcript_and_pii=true,
provider retention one day. These are distinct from our opted-in 30-day snapshots.

## Acceptance and verification

Shared UI fixtures cover RU/EN/ES and language switching, interruption at start/
middle/end of speech, pauses/hesitation, corrected name/place/time and a repeated
TEST message. Both Engine stands show the same scenarios.

Reports distinguish server request/first text/provider audio/interruption events,
client playback-state timestamps and separate user audibility/naturalness/device
ratings. None is an automatic physical acoustic measurement.

Automated checks exercise:
- admin/Dev/capability boundaries and no managed model fallback;
- explicit voice eligibility, no cloning and no silent substitution;
- streaming SSE, replay/new request deduplication and tool persistence before speech;
- provider interruption/stale output suppression, setup cancellation and socket stop;
- shared store checkpoints, repeat reads after losing live state, original expiry;
- four mode URL choices and frontend cancellation helpers.

Opt-in real check:
`NODE_ENV=development npx tsx scripts/probe-eleven-engine.ts --paid-text`
creates/deletes a private Sarah configuration, uses actual OpenAI generation and
TEST tools, verifies the single result in the same Dev DB from a separate process,
and deliberately NEVER connects a voice socket or microphone. It retains the
explicitly requested TEST result under the reported ID. This is not an audible
browser, headphone, iPhone, RU/ES pronunciation or barge-in-quality test.

The existing clone cannot participate in the native Agents Custom LLM comparison.
Using it via ordinary TTS plus another STT/VAD/playback transport is a different
architecture and requires separate approval. It is not implemented as a fallback.

Official references checked 2026-10-24:
- https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm
- https://elevenlabs.io/docs/eleven-agents/libraries/java-script
- https://elevenlabs.io/docs/agents-platform/customization/conversation-flow
- https://elevenlabs.io/docs/eleven-agents/api-reference/agents/create.md

### Startup transport verification

The installed SDK adds `source=js_sdk&version=...` to its supplied signed URL.
The audio upgrade gate allows these bounded, nonduplicate metadata fields while
rejecting unknown query keys, malformed capabilities and production admission.
The proxy negotiates the provider's `convai` WebSocket subprotocol.
Reports distinguish browser socket, provider socket, provider conversation
metadata and errors/close codes, without retaining URLs or capability secrets.

`NODE_ENV=development npx tsx scripts/probe-eleven-engine.ts --audio-connect`
uses the installed SDK WebSocket implementation, our actual upgrade gate/audio
proxy and a private ElevenLabs Sarah session. On 2026-10-24 it successfully
received real provider metadata with PCM 16 kHz input/output. It opens no
microphone, plays no audio and places no phone call. SDK/proxy transport tests
also run against a local provider fixture. This proves connection startup, not
audible quality, recognition, pronunciation or physical barge-in latency.

### Real provider callback / speech round-trip

ElevenLabs appends `/chat/completions` to the configured Custom LLM URL.
Supply our capability-scoped OpenAI **base URL**, ending in `/v1`, not the full
endpoint. The full endpoint produced a doubled path, no Engine request, and
provider close code 1002 (`Brain returned no response`), despite metadata success.
The regression test resolves that suffix through the real route registration.

`--audio-roundtrip` additionally checks a real ElevenLabs request through the
public Dev domain to our Engine, streamed text and received synthesized PCM
audio via the installed SDK. It temporarily listens on port 5000; stop only the
Dev workflow before this one-off probe and restart it afterwards. On 2026-10-24
this reproduced the doubled path, then passed with the corrected base URL.
It uses synthetic text input and no microphone/playback; it does not establish
browser microphone capture, physical audibility, STT or interruption quality.

No production, telephone, notification, working calendar, native Xcode or default
Secretary voice changes. No publishing.
