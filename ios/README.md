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

```bash
cd ios
xcodegen generate
xcodebuild test -scheme TalkHint \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

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
