# ChatGPT Secretary: approval → call → saved result

Prepared 2026-10-24 in Dev. No production publish, GitHub push, real calls,
calendar changes or notifications were performed.

## Current client build

The supplied Mac report confirms efc829f: 450 personality UI iterations passed;
203/203 native tests passed without skips; app built, installed and launched.
The launch explicitly uses the Dev URL. This is correct for the previous task,
but does not prove an end-to-end production telephone conversation.

The existing installed build already supports explicit Retell / Katya / line
selection. Merely changing the Debug server does not require a new code branch:
after the coordinated server changes are published, Claude should relaunch
the app from Xcode with `TALKHINT_API_BASE_URL=https://talkhint.app`, verify
the effective address and let the owner log in and choose the personal line,
Retell + Engine and Katya v2. Do not automatically start a call.

The additional Swift account-default fallback in the working tree is newer
than efc829f and has not been transferred to the Xcode branch. Installing that
automatic-default behavior DOES require transferring the Swift source and
rebuilding. It is not required to select the supported settings manually.
Use the same existing Xcode branch after a separately approved transfer;
do not make another project, merge main, or assume an old pull contains new work.

## Changed plugin

- One exact-recipient/number/task review and owner button remain. The signed
  UI-only capability and idempotent server lease still protect one call.
- Served widget v6 has no audio player, listening, live text, reconnect,
  monitoring transport, automatic polling or external report-screen link.
- Removed `open_call_monitor` and `read_call_turns` from the plugin surface;
  the old plugin player transport is no longer registered.
- Native Secretary monitoring, Twilio routing and phone audio are untouched.
- After start there is one button, **Получить итог звонка**. It calls read-only
  `get_call_result` for this task, with owner and transcript-scope checks.
- Final result contains actual status, saved summary (or explicitly absent),
  and complete saved dialogue in original order with participants. No
  additional model invents a successful outcome, missing words or a summary.
- An active task returns only not-ready information; no partial live text.
  Failed/interrupted terminal calls return their actual saved partial speech.
- Lost start response can use the exact original clientRequestId to find an
  existing task. Reading never invokes preparation, dialing or retry.
- Widget state contains only task/request locators, not approval capabilities.
  Restored historical output is not authority to start or listen.
- The separate Actions read API also exposes `/tasks/{id}/result`. Its existing
  output-size limit still errors explicitly rather than silently truncating.
  The MCP result reader does not use that Actions-specific output-size limit.

## Automatic delivery: verified platform limitation

Official documentation checked 2026-10-24:
https://developers.openai.com/plugins/build/mcp-events
https://developers.openai.com/apps-sdk/build/chatgpt-ui/

MCP Events now exists, but requires MCP 2.0 (`2026-07-28`), persistent verified
webhook subscriptions and supported Work chats (web or desktop Cloud/dots).
This integration has not implemented or advertised those subscriptions. This
does not establish automatic report delivery into an ordinary ChatGPT iPhone
chat. Do not claim the platform can never support it; do not claim it is enabled.
The implemented supported fallback is the one user-operated result button.
The summary and full transcript render inline in the same card/chat; no player
or separate report page is involved.

## Refresh and release

Publish backend only after the owner chooses to do so. Then rescan/refresh the
existing ChatGPT TalkHint connection/plugin: package 0.5.0, MCP version 1.7.0, widget v6,
new read tool, removal of live tools and updated packaged instructions.
For a packaged installed plugin update its package/skill artifacts too; changing
the server does not prove the host has refreshed cached plugin instructions.
OAuth remains existing owner binding. Full results require calls:read and
calls:transcript; missing permission needs owner consent, not silent bypass.

Automated tests use fictional owners and fake telephony only. The owner must
still verify actual card rendering/permissions and result retrieval in official
ChatGPT on iPhone. Mac/Xcode tests of new Swift source have not run on Linux.
