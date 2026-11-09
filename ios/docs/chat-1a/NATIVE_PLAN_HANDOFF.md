# Chat 1A — native call-plan handoff

The native Chat now decodes optional `ChatMessage.action` plans from fetched
history, shows the complete human-readable plan beneath completed assistant
messages, and requires an explicit confirmation alert before posting the same
message ID and plan hash to `confirm-plan`. A successful Hint confirmation
updates its card; it is not saved a second time. Secretary review data is kept
only in the in-memory response and passed directly to the existing
`SecretaryTaskReviewViewController`. That screen retains its separate explicit
Start call action. No call is initiated from Chat.

Retry uses the same persisted assistant message and hash; no request UUID or
confirmation token is written to the outbox, defaults, or chat model. The plan
confirmation endpoint and response shape must be available in the backend:
`POST /api/chat-v1/conversations/:conversationId/messages/:messageId/confirm-plan`
with `{planHash: String}`, returning `{message, dialed: false, review?}`. The
backend remains responsible for rejecting stale plan hashes.

The Secretary review card uses a localized human-readable display string. The
canonical `review.instruction` is retained unchanged for confirmation, draft
recovery, and the start request. Only the review card's UILabel uses the display
override.

Offline fixture and source-contract coverage was added. This environment has
no Xcode, so the XCTest target could not be built or run here. On a Mac, from
the repository root, install XcodeGen if needed (`brew install xcodegen`) and
run the existing native gate:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

That script selects an installed iPhone Simulator dynamically and runs
`ios/scripts/verify-xcresult.py` against the XCTest result bundle. The Python
source contract can be run with
`python3 -m unittest ios.tests.test_chat_plan_source_contract` from the repo root.
