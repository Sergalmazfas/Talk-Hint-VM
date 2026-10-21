# Personal and Work: first-stage setup

One TalkHint app, one owner identity, two logical profiles. A profile is the
owner + `personal`/`work` key, not a physical number. Replacing a number does not
delete or transfer its cards.

## Included

- Owner-authenticated `/settings/call-profiles` in the existing web app, linked
  from Dashboard.
- The personal number is retained. Default outgoing caller ID prefers personal
  regardless of database row order. Existing work-only accounts retain their
  previous single-number behavior.
- The owner chose their existing CDL line as Work, rejecting the initially
  suggested trial line. Return the trial line to the pool, never cancel it at
  the provider. The dedicated action never buys numbers, restocks, changes
  provider webhooks or dials.
- Only the owner's explicitly confirmed former CDL binding may move to the
  main account. The exact previous account and binding are checked; unexpected
  ownership blocks the operation. Preserve historical calls/reports under their
  existing owners and detach old private prompts without deleting their contents.
- Provider ownership, voice capability and existing TalkHint voice/status
  routing are verified before attachment. An unavailable provider or foreign
  route blocks setup instead of silently changing routing.
- A transaction locks the owner and pool row. Concurrent setup requests return
  the same binding; arbitrary other accounts' assignments cannot be taken.
  Active calls block number changes.
- Cards have `personal`, `work` or explicitly `shared` scope. Existing cards
  remain personal. The existing owner-only live-hint card loader derives the
  profile from the actual call and assigned number; unresolvable or foreign
  calls receive no private cards.

## Not included or enabled

- Autonomous incoming Secretary answering or carrier forwarding.
- Work-profile selection/knowledge in the outgoing Secretary approval contract.
  Existing Secretary behavior remains, using the owner's personal default.
- Complete profile isolation of legacy contact memory, user context, tasks and
  historical results. These are not yet business-call knowledge sources.
- Calendar integration, appointment booking, shared free/busy or notifications
  for appointments. Do not promise that an appointment has been saved.
- Automatic migration/copying of existing personal cards or customer data.

## Release and owner action

1. Review changes and publish through the standard flow. The schema change is
   additive: `knowledge_cards.profile_scope`, default `personal`. Do not choose
   **overwrite production data with development data**.
2. Development and production number assignments are independent. Publishing
   code/schema does not copy a Dev number binding into production.
3. Sign in to the existing TalkHint account, open `/settings/call-profiles`, and
   explicitly confirm the proposed Work number. The server checks actual
   availability again. The confirmation explains that new incoming CDL calls
   move to this account while old history stays in the previous account.
   Only the specifically approved previous CDL binding may move; any changed
   ownership blocks the action. There is no automatic substitution.
4. Add Work cards explicitly. Shared cards should contain only facts intended
   for both contexts. Do not place passwords, payment credentials or sensitive
   private data in shared cards.
5. A real call or iPhone UI test needs a separately agreed test. Provider
   capability checks and simulated tests do not prove ringing or audio.

The production pool is authoritative for production availability. A number
shown free in Dev can still be assigned to another account in production.
