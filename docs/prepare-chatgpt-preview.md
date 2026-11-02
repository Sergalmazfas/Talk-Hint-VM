# Read-only ChatGPT plan preview in native Prepare

Owner approved displaying saved Hint plans, not changing plan selection or dialing.

## Server

`GET /api/prepare/hint-plans` uses the existing app session/Bearer authentication.
The owner comes only from `req.user.id`; query/body IDs cannot change it.
Response: `{ plans: [{ id, planHash, createdAt, expiresAt, plan }], serverTime }`.
It returns up to 50 recent own pending, unexpired Hint plans. The shared strict
plan schema and canonical hash are verified before returning content.
Responses are `Cache-Control: no-store`; the existing request logger records
method/path/status/timing, not bodies or auth. No initialization DDL, new table,
scope, key, provider or production mutation is added.

401 = no app authentication; 503 = unavailable data/service, not an empty list.
Opening this endpoint does not consume or extend plans, set goals or change calls.
The existing call-time matching and one-call/24-hour rules are unchanged.

## Native

Only Hint Prepare mounts `PreparedHintPlansView`. It loads on appearance and
explicit Refresh, cancels superseded/hidden-screen requests, rejects late
responses, and removes expired content with a local timer using the server clock.
Manual dialog reset preserves/reloads the saved-plan section without deleting
server plans. No new select/activate/confirm/dial control exists.

The native branch contains only the native delta and Mac instructions, based on
the verified remote baseline. Backend code remains in the Replit Dev worktree
for owner Publish. There is no merge or force-push.

## Verification and delivery

Server route/store tests include real PostgreSQL temporary-table tests for own
data, unchanged expiry/state, consumed/superseded exclusion and hash rejection.
Native source/localization checks are not a Swift compilation.
Nine offline XCTest cases were added and made mandatory in the xcresult gate.
Their execution and signed-in/native UI verification await Claude on Mac.

Full server test shard reports and the targeted report are in the review ZIP.
No production data, real call or paid model request is used.
