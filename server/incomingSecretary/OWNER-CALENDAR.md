# Per-owner Work calendar

The workspace Google Calendar connector is **not** a customer integration.
The existing admin-only development probe stays separate, with its original
Google-owner check. No general calendar route calls it or accepts a connection ID.

## Setup (not performed automatically)

Register a dedicated **Web application** OAuth client in Google Cloud, enable
Calendar API, configure the consent screen and complete Google's verification
requirements before offering it broadly. During Google's testing phase only
explicit test users can consent; refresh tokens may be short-lived.

Use the secure Secrets interface for `GOOGLE_CALENDAR_CLIENT_SECRET` and
`CALENDAR_TOKEN_ENCRYPTION_KEY` (a cryptographically random 32-byte key encoded
as 64 hexadecimal characters; keep it stable across restarts).
Configure `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_REDIRECT_URI`.
The redirect must be an exact registered HTTPS URL ending in
`/api/incoming-secretary/calendar/oauth/callback`, without query/fragment.
Do not derive a production URL from the development domain. Development and
production need their own registered redirects and appropriate configuration.
Missing/invalid configuration shows `setup_required`, never a workspace fallback.
Changing the encryption key requires users to reconnect.

Requested Google scopes:
- `calendar.calendarlist.readonly`: validate the consenting Google account and
  enumerate owned, separate non-primary calendars.
- `calendar.events.freebusy`: future read-only occupancy capability, not event
  contents or event writes. This task does not expose an occupancy/booking tool
  to the voice agent.

Reference: https://developers.google.com/workspace/calendar/api/auth

## Owner flow and boundaries

From existing Secretary settings, connect Google explicitly, then explicitly
select an **owned non-primary** calendar. No calendar creation, name-based guess,
primary fallback, event creation, number activation, phone call or booking occurs.
The Google account can differ from the app's login email; ownership is established
by the authenticated app user starting OAuth, browser-bound state, provider token
exchange, and Google primary-owner identity validation. A shared/writer calendar
cannot be selected. Calendar titles are presentation only, never business facts.

The iPhone settings show the owner-scoped connection status and open the same
web settings in the external browser for management. That browser must sign into
the same TalkHint account separately. No app session token is put into a link or
transferred to Google. Refresh the native settings after returning.

Only current, explicitly permitted Work cards supply business facts, hours,
timezone rules and conditions to Secretary. Calendar timezone is technical
metadata, **not** business opening hours. Legacy settings are not a source for
this connection. No free/busy result is claimed as an available appointment.
The existing Dev occupancy probe is not integrated into this owner flow.

State is single-use, ten-minute, PKCE S256, hashed in storage and bound to an
HttpOnly Secure SameSite=Lax callback-only cookie. This requires the initiating
browser to complete the Google roundtrip. Starting a newer attempt or
disconnecting invalidates an older callback. Grants/verifiers are AES-256-GCM
encrypted with purpose/owner/profile AAD. Reads revalidate Google ownership;
lost grants/permissions show reconnect, outages fail explicitly.

Disconnect deletes local credentials and pending state before returning.
It does not call Google's client-wide revoke endpoint, which can also revoke
other Work-profile grants. The owner can additionally remove the app's permission
in their Google account. Account/number deletion cascades the stored grant.

## Schema and verification

`shared/schema.ts` declares both tables. `calendar-schema.sql` is additive,
development-only setup, run by `scripts/ensure-owner-calendar-schema.ts` after
merge; do not run an interactive schema push. Production schema changes go
through the normal Publish review, not the setup script. No publish is performed
as part of this work.

Offline tests exercise authentication, cross-owner/profile denial, strict JSON,
CSRF, state replay and expiry, cancellation, encryption, owner-only selection,
refresh/reconnect, pagination and local disconnect. Real Google consent still
requires the configured OAuth client; native rendering/build requires Xcode.
