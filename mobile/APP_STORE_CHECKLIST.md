# TalkHint — App Store / TestFlight Checklist

## Step 1: Accounts (Do Once)

- [ ] Apple Developer Program enrolled at developer.apple.com ($99/year)
      Status: **Enrollment Pending** ← you are here
- [ ] Expo account created at expo.dev (free)
- [ ] EAS CLI installed: `npm install -g eas-cli`

---

## Step 2: EAS Project Init (Do Once, in /mobile)

```bash
cd mobile
npm install
eas login              # Login with expo.dev account
eas init               # Creates projectId, updates app.json automatically
```

After `eas init`, replace in `app.json`:
- `"REPLACE_WITH_YOUR_EAS_PROJECT_ID"` → actual projectId (shown after eas init)
- Same in `updates.url`

---

## Step 3: Expo Go Preview (Test Now)

```bash
cd mobile
npx expo start --tunnel
```

Scan QR with iPhone camera → opens in **Expo Go** app.

✅ No red screen  
✅ Settings → enter server URL → Connected  
✅ Transcript appears  
✅ Hint cards appear  
✅ Microphone permission requested  

---

## Step 4: iOS Preview Build (Internal TestFlight)

```bash
cd mobile
eas build --platform ios --profile preview
```

- EAS will ask for Apple ID credentials
- EAS handles certificates and provisioning automatically
- Build takes ~15-20 min on EAS cloud servers
- Download link appears in expo.dev dashboard

---

## Step 5: TestFlight Upload

```bash
cd mobile
eas submit --platform ios --profile production
```

OR manually upload the .ipa from expo.dev to App Store Connect.

**In App Store Connect:**
- [ ] Add internal testers (email invite)
- [ ] Submit for TestFlight review (1-3 days)
- [ ] Distribute to testers via TestFlight app

---

## Step 6: App Store Submission

### Required Metadata (fill in App Store Connect)

**App Information:**
- [ ] App name: `TalkHint`
- [ ] Subtitle: `AI Call Assistant` (max 30 chars)
- [ ] Category: `Productivity` (primary), `Business` (secondary)
- [ ] Bundle ID: `com.talkhint.app`
- [ ] SKU: `com.talkhint.app`

**Description (up to 4000 chars):**
```
TalkHint is a real-time AI assistant for phone calls.

During any phone call, TalkHint listens and provides:
• Live transcription of both sides of the conversation
• AI-powered reply suggestions in English
• Instant translations into Russian or Spanish
• Goal tracking to keep conversations on track

Perfect for business calls, negotiations, appointments, 
and any situation where you need communication support.

TalkHint connects to your personal backend for complete 
privacy — your conversations never go to third parties.
```

**Keywords (100 chars max, comma-separated):**
```
call assistant,AI transcription,phone helper,translation,business calls,voice AI,real-time hints
```

**Support URL:** `https://talkhint.app/support`  
**Privacy Policy URL:** `https://talkhint.app/privacy`  
**Marketing URL:** `https://talkhint.app` (optional)

### Screenshots Required (per device):
- [ ] iPhone 6.9" (iPhone 16 Pro Max) — 1320×2868px — **3-10 screenshots**
- [ ] iPhone 6.7" (iPhone 15 Plus) — 1290×2796px — **3-10 screenshots**
- [ ] iPad 13" — if supportsTablet=true (currently false, skip)

### App Review Information:
- [ ] Demo account (if login required) — provide test credentials
- [ ] Notes for reviewer: "App requires microphone permission to function. Please grant microphone access when prompted."

---

## Step 7: App Review

Apple reviews within **1-3 business days**.

**Common rejection reasons to avoid:**
- ❌ Missing privacy policy URL → ✅ add to app.json `extra.privacyPolicyUrl`
- ❌ Vague microphone permission text → ✅ already fixed in app.json
- ❌ Encryption declaration missing → ✅ `ITSAppUsesNonExemptEncryption: false` added
- ❌ App crashes on launch → ✅ test thoroughly in Expo Go first
- ❌ Placeholder content → ✅ use real server URL before submitting

---

## Files Status

| File | Status |
|------|--------|
| `app.json` | ✅ Ready (replace EAS projectId after `eas init`) |
| `eas.json` | ✅ Ready (replace Apple credentials) |
| `assets/icon.png` | ✅ 1024×1024 PNG |
| `assets/splash.png` | ✅ 1284×2778 PNG |
| `assets/adaptive-icon.png` | ✅ 1024×1024 PNG |
| `metro.config.js` | ✅ Present |
| `babel.config.js` | ✅ Present |
| `tsconfig.json` | ✅ Expo SDK 52 config |
| Bundle identifier | ✅ `com.talkhint.app` |
| Microphone permission | ✅ Descriptive text set |
| Encryption declaration | ✅ `ITSAppUsesNonExemptEncryption: false` |
| Background modes | ✅ `audio`, `voip` |

---

## Values to Replace Before Submitting

Search `REPLACE_WITH` in `app.json` and `eas.json`:

| Placeholder | Where to get it |
|-------------|-----------------|
| `REPLACE_WITH_YOUR_EAS_PROJECT_ID` | Run `eas init` in /mobile |
| `REPLACE_WITH_YOUR_APPLE_ID` | Your Apple ID email |
| `REPLACE_WITH_APP_STORE_CONNECT_APP_ID` | App Store Connect → App → App Information → Apple ID |
| `REPLACE_WITH_YOUR_TEAM_ID` | developer.apple.com → Account → Membership |
