# TalkHint iOS app

Native iOS client that takes incoming TalkHint calls on an iPhone. It receives a
VoIP push sent directly by the TalkHint Engine (not Twilio), shows the native
CallKit incoming-call screen, and — when answered — joins the per-call Twilio
conference via an outbound Twilio Voice connection.

> These source files cannot be compiled on Replit (Linux). Build them on a Mac
> with Xcode. Everything you need (Swift sources, project spec, Info.plist,
> entitlements, signing config) is here.

## Architecture (Path A)

1. A PSTN call comes in. The Engine puts the caller on hold and sends a **VoIP
   push** (PushKit) straight to this app via certificate-based APNs.
2. The app reports the call to **CallKit** → native ringing UI.
3. **Answer** → `POST /api/call/accept { callSid, clientType:"ios" }` returns the
   conference `call-{callSid}`. Then `GET /api/token` returns a Twilio access
   token (identity `user-{userId}`). The app does an **outbound**
   `TwilioVoiceSDK.connect()` with param `conferenceRoom: "call-{callSid}"`. The
   backend's `/twilio/voice` joins it into the same conference as the held caller.
4. **Decline** → `POST /api/call/reject`.

| Setting | Value |
| --- | --- |
| Bundle id | `app.talkhint` |
| Team | `6G9ZS426J3` |
| VoIP push topic | `app.talkhint.voip` |
| Min iOS | 15.0 |
| Twilio Voice iOS | 6.11+ (Swift Package) |

## 1. Generate the Xcode project

The `.xcodeproj` is generated from `project.yml` with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) so it never needs hand-editing.

```bash
brew install xcodegen
cd ios
xcodegen generate
open TalkHint.xcodeproj
```

### Updating the personal/work screens

Make sure the Mac has the latest **iOS source files**, not just a newly published
backend. The required profile DTOs live in the existing `APIClient.swift`, and
the profile controller lives in the existing `NumbersViewController.swift`.
The similarly named standalone files are compatibility markers only, so both
older and freshly generated Xcode source lists work without duplicate symbols.
Update **all** iOS sources on the Mac, not just `SettingsViewController.swift`.
From the repository root, run `cd ios`, `xcodegen generate`, then
`open TalkHint.xcodeproj` as above. Select scheme **TalkHint**, your connected
iPhone, and **Run**.
Keep the existing signing team and bundle identifier; do not uninstall the app.

For the specific `Cannot find CallProfilesSnapshot / CallProfilesViewController`
failure, confirm the Mac copy contains `struct CallProfilesSnapshot` in
`APIClient.swift` and `final class CallProfilesViewController` in
`NumbersViewController.swift`. These declarations no longer depend on the new
source files being included in Compile Sources. Regenerating the project cannot
replace synchronizing the actual source contents.

In the new build, open **Settings → Phone**. It should show the personal number,
the work number, and **Personal & work cards**. Before explicitly connecting
CDL, an unconfigured work number should say **Not connected**, not claim that
setup succeeded. Open the profiles screen and confirm the server-proposed CDL
number once; old account history is retained. Work cards must be created
explicitly and are not copied from personal cards.

Run the native validation command below on a Mac/Simulator before release.
Source checks in the Linux workspace do not establish that the native binary
compiled or ran.

Xcode resolves the Twilio Voice Swift Package automatically on first open
(File ▸ Packages ▸ Resolve Package Versions if needed).

> Prefer not to use XcodeGen? Create an iOS App target manually (UIKit, no
> storyboard), set the bundle id / team above, drag the `TalkHint/` folder in,
> add the Twilio Voice package
> (`https://github.com/twilio/twilio-voice-ios`), and use the provided
> `Info.plist` and `TalkHint.entitlements`.

## 2. Point the app at your backend

Edit `TalkHint/Config/AppConfig.swift`:

```swift
static let baseURL = URL(string: "https://YOUR-APP.example.com")!
```

Use your published Reserved VM URL (WebSocket/long-lived connections need it).

## 3. Capabilities & signing (Xcode ▸ Signing & Capabilities)

- **Team**: 6G9ZS426J3, **Bundle Identifier**: `app.talkhint`, automatic signing.
- **Push Notifications** capability.
- **Background Modes**: check **Voice over IP** and **Audio, AirPlay, and
  Picture in Picture** (already declared in `Info.plist`).
- `aps-environment` is `development` in `TalkHint.entitlements`; Xcode swaps it to
  `production` for TestFlight/App Store builds.

## 4. Apple Developer setup (one-time)

- App ID `app.talkhint` with **Push Notifications** enabled.
- A **VoIP Services Certificate** for `app.talkhint`. Its public cert + private
  key are what live on the server as `APNS_CERT_PEM` / `APNS_KEY_PEM`. The app's
  signing must match this same App ID so its VoIP token is valid for topic
  `app.talkhint.voip`.

## 5. Run on a real device

PushKit/CallKit do not work in the Simulator — use a physical iPhone.

1. Build & run, log in with a TalkHint account (`/api/auth/login`).
2. On launch the app gets a VoIP token and calls `POST /api/devices/register`
   (`platform:"ios"`, `environment:"sandbox"` for debug builds). Confirm a row
   in `device_tokens`.
3. Place a call to that user's TalkHint number — the iPhone should ring. Answer
   and confirm two-way audio with the caller.

## Files

| File | Purpose |
| --- | --- |
| `project.yml` | XcodeGen spec (target, signing, Twilio SPM dependency) |
| `TalkHint/Info.plist` | VoIP + audio background modes, mic usage, scene manifest |
| `TalkHint/TalkHint.entitlements` | `aps-environment` |
| `App/AppDelegate.swift` | Boots CallKit + PushKit at launch |
| `App/SceneDelegate.swift` | Root: Login vs Home |
| `Config/AppConfig.swift` | Backend base URL, bundle id, APNs environment |
| `Auth/Keychain.swift`, `Auth/SessionStore.swift` | Session token storage |
| `Networking/APIClient.swift` | login / devices / accept / reject / token |
| `Push/PushManager.swift` | PushKit token registration + incoming push routing |
| `Calls/CallManager.swift` | CallKit provider + Twilio Voice connect/disconnect |
| `UI/LoginViewController.swift`, `UI/HomeViewController.swift` | Minimal UI |

## Tests

### Reproducible native gate (before installing on an iPhone)

From the **repository root**, on a Mac:

```bash
# One-time setup: Xcode 16.4, its command-line tools, and an iOS Simulator runtime.
# Xcode Settings → Components: install an iOS Simulator if none is available.
brew install xcodegen
DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer \
  bash ios/scripts/validate-native.sh
```

Python 3 must be available (`python3`; provided by Xcode command-line tools or
install separately). Other Xcode versions may work locally, but CI selects
Xcode 16.4 on `macos-15`. The script logs the actual Xcode/XcodeGen versions.
Swift Package resolution needs access to GitHub for the public Twilio dependency;
no TalkHint service, credentials, signing account, or physical device is needed.

The command fails immediately on Linux; that is **not** a successful iOS check.
On macOS it:

1. Runs `xcodegen generate` from the current checkout (never reuses a stale project).
2. Reads the generated project's actual Compile Sources phases. Every Swift file
   under `TalkHint/` and `TalkHintTests/` must be present exactly once in its own
   target; missing, foreign, or duplicate entries fail the check.
3. Creates a disposable iPhone **Simulator**, selecting an installed compatible
   iOS runtime. It never selects a physical device.
4. Runs `xcodebuild build-for-testing` for the app and test bundle. Swift compilation,
   not a text search, rejects duplicate types and unresolved symbols.
5. Runs **all** `TalkHintTests` with `test-without-building`. It additionally checks
   the `.xcresult` for successful execution of the two real Foundation URL tests
   in `CallProfilesTests`, the test-backend isolation assertion, and all required
   `KnowledgeCardsTests`. Missing or skipped required tests do not count as success.
6. Shuts down and deletes only the Simulator created by this invocation, even on
   failure. Logs and `.xcresult` stay in ignored `generated-artifacts/ios-native.*`.

The dedicated `TalkHintValidation` scheme uses `NativeValidation`, not the
ordinary device configuration. Both app and tests receive
`TALKHINT_NATIVE_VALIDATION`: the backend/WebSocket host becomes a reserved
`.invalid` name, and automatic launch does not initialize phone/push services,
restore a saved login, or route notifications. Test-created controllers still
run the real code. Normal Debug/Release behavior and signing settings are unchanged.
No publishing, archive, device installation, telephone calls, or real secrets are
part of this gate. XCTest installs its host **only in the disposable Simulator**.

`KnowledgeCardsTests` injects a per-client in-memory transport and a fake Bearer
token into the real API client, profiles navigation, card list and editor.
It checks scoped CRUD for personal/work/shared, exact URLs and JSON, missing
auth, explicit 401/403/404/500 failures, malformed/cross-profile responses,
offline retry without losing drafts, reopening the selected profile, and delayed
reads (including reads that could resurrect a deleted card). The transport rejects
every endpoint outside `/api/cards`; number attachment and telephone endpoints
cannot be used by these tests. This is UIKit XCTest coverage, not XCUITest or
proof of an installed iPhone build.

### CI setup and current verification status

No existing CI configuration or accessible Mac runner was present when this gate
was added. The current workspace is Linux: **native compilation and XCTest have
not been run here**. Python helper tests or TypeScript/source checks are not
substitutes for that evidence.

The repository now includes [iOS native validation](../.github/workflows/ios-native.yml)
for GitHub Actions: iOS pull requests, pushes to `main`, and manual runs. It uses
a GitHub-hosted macOS runner with read-only repository permissions, no secrets,
and uploads logs/`.xcresult` even after failure.

**Owner action required:** connect/sync this repository to GitHub and enable
Actions with access to the `macos-15` runner (or provision a Mac runner in your
existing CI and run the same script). Run **iOS native validation** and inspect
the `ios-native-results` artifact. Until a Mac run succeeds, the native build is
**unverified**, not green. To block merges, make this workflow's `native` job a
required status check in branch protection after its first run.

Helper self-tests, usable on Linux or Mac (they test the gate, not the iOS app):

```bash
python3 -m unittest discover -s ios/scripts/tests -v
```

### Test target

`TalkHintTests` is a hosted unit-test target (declared in `project.yml`, sources
in `TalkHintTests/`). `InCallCaptionTests` guards the live-caption logic in
`InCallViewController` so the per-speaker upsert/finalize flow and the pinned
suggestion banner can't silently regress:

- interim transcript events update one card in place, finalize it on `isFinal`,
  and start a fresh card for the next utterance;
- the caller ("CALLER") and owner ("YOU") cards update independently;
- the SUGGESTION banner becomes visible and updates in place without adding any
  feed cards.

The tests drive the controller through its real `CallHintStreamDelegate` entry
point (the same path the `/ui` WebSocket feeds) and inspect the rendered view
hierarchy by `accessibilityIdentifier`, so they exercise production code rather
than a copy of it.

Use `bash ios/scripts/validate-native.sh` from the repository root to run these
tests safely. Avoid running the ordinary hosted-test scheme against a saved
production login.

> Like the rest of the app, these tests build only on a Mac with Xcode — they
> cannot be compiled or run on Replit (Linux).

## Notes & gotchas

- Every received VoIP push **must** report a call to CallKit before the PushKit
  completion handler runs (iOS 13+), or iOS kills the app and throttles future
  pushes. `CallManager.reportIncomingCall` / `reportAndImmediatelyEnd` handle this.
- Debug builds get **sandbox** APNs tokens, release builds get **production** —
  the app reports this via `environment` so the server picks the right APNs host.
- Conference-join authorization on the server requires the pending call to be
  `accepted`, owned by the same `user-{id}`, and `clientType:"ios"`. Keep Twilio
  signature verification **enabled** in production or that trust boundary breaks.
