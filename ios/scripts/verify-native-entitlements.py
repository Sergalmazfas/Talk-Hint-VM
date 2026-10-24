#!/usr/bin/env python3
"""Check simulator runtime Mach-O entitlements before real Keychain XCTest."""
from pathlib import Path
import plistlib
import sys


def verify(path):
    raw = Path(path).read_bytes()
    # XML sections may include trailing NUL alignment bytes. Do not trim a
    # binary plist trailer or relax any entitlement checks.
    if raw.lstrip().startswith(b"<?xml"):
        raw = raw.rstrip(b"\x00")
    entitlements = plistlib.loads(raw)
    expected = "talkhint-native-validation.app.talkhint"
    if entitlements.get("application-identifier") != expected:
        raise ValueError("Simulator application-identifier is absent or outside the local validation namespace")
    if entitlements.get("keychain-access-groups") != [expected]:
        raise ValueError("Simulator must use exactly its isolated validation keychain-access-groups")
    if entitlements.get("get-task-allow") is not True:
        raise ValueError("Simulator XCTest host must allow local test debugging")
    forbidden = [
        key for key in entitlements
        if key in {"aps-environment", "com.apple.developer.aps-environment",
                   "com.apple.security.application-groups",
                   "com.apple.developer.associated-domains"}
        or key.startswith("com.apple.developer.icloud")
        or key.startswith("com.apple.developer.ubiquity")
    ]
    if forbidden:
        raise ValueError(f"External-service entitlements are forbidden in native validation: {forbidden}")
    print("Simulator runtime evidence: isolated Keychain entitlements present; real OS storage still requires XCTest")


if __name__ == "__main__":
    verify(sys.argv[1])
