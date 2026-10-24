#!/bin/bash
# No signing, device installation, publishing, credentials, or live backend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "ERROR: Native iOS validation requires a macOS runner with Xcode; no native build was run." >&2
  exit 2
fi
for tool in xcodegen xcodebuild xcrun python3; do
  command -v "$tool" >/dev/null || { echo "ERROR: Missing $tool" >&2; exit 2; }
done
mkdir -p "$ROOT/generated-artifacts"
OUT="$(mktemp -d "$ROOT/generated-artifacts/ios-native.XXXXXX")"
SIM=""
cleanup() {
  if [[ -n "$SIM" ]]; then
    xcrun simctl shutdown "$SIM" >/dev/null 2>&1 || true
    xcrun simctl delete "$SIM" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
echo "Native validation output: $OUT"
xcodebuild -version | tee "$OUT/xcode-version.txt"
xcodegen --version | tee "$OUT/xcodegen-version.txt"
cd "$ROOT/ios"
# Always regenerate; never trust a stale Compile Sources list.
xcodegen generate --spec project.yml
plutil -convert json -o "$OUT/project.json" TalkHint.xcodeproj/project.pbxproj
python3 scripts/verify-project-sources.py "$OUT/project.json" "$ROOT/ios"

xcrun simctl list -j > "$OUT/simulators.json"
python3 - "$OUT/simulators.json" > "$OUT/simulator-choice.txt" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
runtimes = [r for r in data["runtimes"]
            if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]
if not runtimes:
    sys.exit("ERROR: Install an iOS Simulator runtime in Xcode Settings > Components")
runtime = max(runtimes, key=lambda r: tuple(map(int, r["version"].split("."))))
devices = [d for d in data["devicetypes"] if d["name"].startswith("iPhone")]
version = [int(v) for v in runtime["version"].split(".")]
version += [0] * (3 - len(version))
packed_version = version[0] * 65536 + version[1] * 256 + version[2]
devices = [d for d in devices if d.get("minRuntimeVersion", 0) <= packed_version
           and d.get("maxRuntimeVersion", 0xFFFFFFFF) >= packed_version]
if not devices:
    sys.exit("ERROR: No compatible iPhone Simulator device type installed")
print(runtime["identifier"])
print(devices[-1]["identifier"])
PY
RUNTIME="$(sed -n '1p' "$OUT/simulator-choice.txt")"
DEVICE="$(sed -n '2p' "$OUT/simulator-choice.txt")"
SIM="$(xcrun simctl create "TalkHint-native-validation" "$DEVICE" "$RUNTIME")"
xcrun simctl boot "$SIM"
xcrun simctl bootstatus "$SIM" -b
COMMON=(-project TalkHint.xcodeproj -scheme TalkHintValidation -configuration NativeValidation
  -destination "platform=iOS Simulator,id=$SIM" -destination-timeout 120
  -derivedDataPath "$OUT/DerivedData" CODE_SIGNING_ALLOWED=NO)
# Compiles every app/test source: duplicate type declarations are compiler errors.
xcodebuild "${COMMON[@]}" build-for-testing 2>&1 | tee "$OUT/build.log"
# No filters: run the entire TalkHintTests target, not just CallProfilesTests.
xcodebuild "${COMMON[@]}" test-without-building -parallel-testing-enabled NO \
  -testLanguage en -testRegion US \
  -resultBundlePath "$OUT/TalkHintTests.xcresult" 2>&1 | tee "$OUT/tests.log"
python3 scripts/verify-xcresult.py "$OUT/TalkHintTests.xcresult"
echo "PASS: native app/test compilation and XCTest execution (see $OUT)"
