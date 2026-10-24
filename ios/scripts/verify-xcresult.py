#!/usr/bin/env python3
"""Require successful native XCTest execution, including real URL regression tests."""
import json
import subprocess
import sys

REQUIRED_TESTS = {
    "SecretaryVoicePreferenceTests": (
        "testDefaultDoesNotInheritTranslatorProvider",
        "testOldPersistedDraftStillDecodesItsExplicitProvider",
    ),
    "CallProfilesTests": (
        "testNativeValidationUsesAnIsolatedBackend",
        "testCardProfileIsAQueryAndNotAnEncodedPath",
        "testNonQueryPathsKeepTheirExistingDestination",
    ),
    "KnowledgeCardsTests": (
        "testScopedCRUDUsesExactURLsBearerAndJSON",
        "testMissingTokenNeverReachesTransport",
        "testHTTPFailuresRemainExplicitForEveryCardOperation",
        "testBadPayloadAndCrossScopeResponseFailClosed",
        "testListShowsHTTPErrorsAndRecoversAfterDisconnect",
        "testLateReadCannotOverwriteNewerReadOrResurrectDeletedCard",
        "testLateSuccessCannotHideNewerError",
        "testDelayedPersonalResponseCannotChangeWorkOrSharedScreen",
        "testEditorKeepsDraftAndAllowsRetryAfterFailure",
        "testDeleteFailurePreservesRowAndOffersRetry",
        "testNativeNavigationCreateEditDeleteAndReopenKeepsScope",
    ),
    "SecretaryTranscriptRenderingTests": (
        "testFirstLiveSecretaryAndGuestTurnsHaveAttachedConstraints",
        "testRecoveredSnapshotAndReplayDoNotCrashOrDuplicateTurns",
        "testLegacyTranscriptSnapshotRestoresWithoutDuplicates",
        "testLiveUpdateAfterRecoveryReusesTheExistingCard",
        "testEmptyTurnsDoNotCreateCards",
    ),
    "CallAudioDeviceRouterTests": (
        "testOrdinaryCallsUseOnlyStandardDeviceAndWaitForCallKit",
        "testCopilotKeepsItsCustomDeviceAndPrivatePreparation",
        "testNeverSwapsDuringActiveOrDisconnectingCalls",
        "testNextOrdinaryCallDoesNotInheritCopilotDevice",
    ),
}


def read_result(bundle, ref=None):
    command = ["xcrun", "xcresulttool", "get", "object", "--legacy",
               "--format", "json", "--path", bundle]
    if ref:
        command += ["--id", ref]
    return json.loads(subprocess.check_output(command, text=True))


def successful_tests(node, ancestors=()):
    found = set()
    if isinstance(node, dict):
        name = node.get("identifier", {}).get("_value") or node.get("name", {}).get("_value")
        path = ancestors + ((name,) if name else ())
        if node.get("testStatus", {}).get("_value") == "Success":
            found.add("/".join(path))
        for value in node.values():
            found.update(successful_tests(value, path))
    elif isinstance(node, list):
        for value in node:
            found.update(successful_tests(value, ancestors))
    return found


def verify(bundle):
    root = read_result(bundle)
    passed = set()
    for action in root["actions"]["_values"]:
        result = action["actionResult"]
        if result.get("status", {}).get("_value") != "succeeded":
            raise ValueError("An XCTest action did not succeed")
        ref = result.get("testsRef", {}).get("id", {}).get("_value")
        if ref:
            passed.update(successful_tests(read_result(bundle, ref)))
    for suite, methods in REQUIRED_TESTS.items():
        for method in methods:
            if not any(suite in p and method + "()" in p for p in passed):
                raise ValueError(f"Missing successful {suite}/{method}()")
    print(f"Native XCTest evidence: {len(passed)} passed tests, required URL/isolation/cards/Secretary/audio tests passed")


if __name__ == "__main__":
    verify(sys.argv[1])
