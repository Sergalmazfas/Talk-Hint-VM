# Personality selection in the Dev browser Secretary Lab

The existing `/secretary-lab` offers catalog personality selection for
**Retell + Engine** and **ElevenLabs + Engine**. Managed Retell and GPT are unchanged.

## Start

1. Choose either Engine bundle.
2. For ElevenLabs, choose the existing performance profile. Baseline uses the same
   default medium reasoning as Retell; experimental low/brief/optimized profiles
   retain their existing, separately displayed Engine differences.
3. Choose a personality from the shared searchable, paginated catalog, then select
   the TEST-context role: personal or work. This is not a real phone number.
4. Open the full character description if desired. Katya's current catalog
   version is the owner-authored version 2, with all five examples.
5. Use the same TEST assignment in both bundles, accept the existing test-cost
   consent and start. Allow browser microphone access.

“Без личности” remains the default and preserves the previous Engine prompt.
No real number assignments or card permissions are read or changed by selection.

## Server contract and session pinning

Both start endpoints accept only `personality: null` or `{id, version, mode}`.
The server reads the immutable version from the existing catalog, verifies it is
the currently available version, and builds one shared style layer around the
same TalkHint Engine/TEST fixture. No prompt content is accepted from the client.
A stale/retired/nonexistent choice fails before provider admission.

The selected binding is captured for the session. Retrying an admitted request
returns its original version, even after a catalog revision; changing personality
or role with that request ID returns 409, without another session. Settings are
locked during starting, active and uncertain states. A different choice is for
the next conversation.

Existing interruption, tool ledger, stop and microphone cleanup paths are reused.
Personality cannot authorize real delivery, booking, notifications or payments.

## Reports

Live reports, existing saved comparisons and JSON exports contain:

- bundle (`mode` / existing runtime);
- performance `profileId`;
- `personality: {id, name, version, mode}` or explicit `null` for no personality.

Older reports with no field are shown as unknown/legacy, not retroactively
labelled Katya. Active and archived summaries use server report data, not the
current draft selection. The common comparison repository remains the sole
archive; no database migration or parallel report store was added.

## Verification boundary

Mock provider admissions test both actual service constructors, identical
personality/TEST prompt content, pinned retries and duplicate TEST-action
protection. PostgreSQL acceptance reads the real catalog and round-trips both
reports through the existing repository inside a rolled-back transaction.
Frontend SSR tests cover recorded identity/version and legacy summaries.

These checks are not live audio, interruption-latency or subjective personality
evaluations. Live listening is intentionally left to the owner.
