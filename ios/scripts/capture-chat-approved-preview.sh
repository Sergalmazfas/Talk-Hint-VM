#!/bin/bash
# Capture what the owner has opened in Simulator, including the system keyboard.
# Does not launch calls, models, STT or the app itself.
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo "Requires macOS/Xcode; no screenshot taken." >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SIM="${1:-booted}"
REF="${2:-$ROOT/attached_assets/0_IMG_4200_1793933763767.jpeg}"
if [[ ! -f "$REF" && -f "$ROOT/reference/approved-chat-original.jpeg" ]]; then
  REF="$ROOT/reference/approved-chat-original.jpeg"
fi
[[ -f "$REF" ]] || { echo "Approved source JPEG missing; pass its path as the second argument." >&2; exit 2; }
OUT="$ROOT/generated-artifacts/chat-approved-native/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
xcrun simctl io "$SIM" screenshot "$OUT/native-original.png"
swift "$ROOT/ios/scripts/compare-chat-reference.swift" "$REF" "$OUT/native-original.png" "$OUT"
echo "Native screenshot and same-width pair: $OUT"
