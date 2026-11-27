"""Source guardrails only. These are NOT Swift compilation, XCTest or audible playback."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCREEN = (ROOT / "ios/TalkHint/UI/SecretaryLiveCallViewController.swift").read_text()
PLAYER = (ROOT / "ios/TalkHint/Calls/SecretaryAudioPlayer.swift").read_text()
STATE = (ROOT / "ios/TalkHint/Calls/SecretaryMonitorState.swift").read_text()


def section(source, start, end):
    return source.split(start, 1)[1].split(end, 1)[0]


class SecretaryMonitorRecoverySourceContract(unittest.TestCase):
    def test_recovery_is_bounded_and_monotonic(self):
        self.assertIn("attempts < 3", STATE)
        self.assertIn("now - $0 >= 2", STATE)
        recovery = section(SCREEN, "private func attemptLocalAudioRecovery()", "private func refreshMonitorStatus")
        for guard in ["isMonitorVisible", "!didEnd", "canPlaySourceAudio",
                      "!isAudioInterrupted", "!manualAudioResumeRequired",
                      "!CallManager.shared.hasPhoneAudioSession",
                      "ProcessInfo.processInfo.systemUptime"]:
            self.assertIn(guard, recovery)
        for forbidden in ["connectStream(", "APIClient", "hangup", "startCall", "URLSession"]:
            self.assertNotIn(forbidden, recovery)

    def test_only_rendering_replenishes_retry_budget(self):
        configure = section(SCREEN, "private func configureAudioPlayback()", "private func startAudioWatchdog")
        self.assertNotIn("audioRecovery.rendered()", configure)
        rendered = section(SCREEN, "func recordAudioPlayback()", "/// Server track receipt")
        self.assertIn("if monitorState.played", rendered)
        self.assertIn("audioRecovery.rendered()", rendered)
        self.assertIn("monitorError = nil", rendered)
        audio = section(SCREEN, 'case "audio":', 'case "status":')
        self.assertNotIn("monitorError = nil", audio)

    def test_socket_reset_does_not_erase_audio_failure(self):
        reset = section(SCREEN, "func resetFeedObservation()", "func reportAudioFailure")
        self.assertIn("if audioRecovery.failure == nil { monitorError = nil }", reset)
        self.assertIn("resetFeedObservation()", section(SCREEN, "private func connectStream()", "func receive("))

    def test_diagnostics_never_include_private_call_content(self):
        diagnostic = section(SCREEN, "func reportAudioFailure(", "private func attemptLocalAudioRecovery")
        for value in ["failure", "receivedFrames", "playedBuffers", "CFBundleVersion", "sampleRate", "outputVolume"]:
            self.assertIn(value, diagnostic)
        for value in ["task.phoneNumber", "task.instruction", "task.id", "token", "payload", "userInfo", "localizedDescription"]:
            # Comments may document the excluded data; examine executable lines.
            executable = "\n".join(line for line in diagnostic.splitlines() if not line.strip().startswith("//"))
            self.assertNotIn(value, executable)
        safe_error = section(PLAYER, "static func safeErrorCode(", "\n}")
        self.assertIn('allowed.contains(error.domain) ? error.domain : "Other"', safe_error)
        self.assertNotIn("localizedDescription", safe_error)

    def test_audio_readiness_checks_actual_engine_and_both_players(self):
        self.assertIn("prepared && engine.isRunning", PLAYER)
        self.assertIn("players.values.allSatisfy { $0.isPlaying }", PLAYER)
        self.assertIn('["guest": AVAudioPlayerNode(), "secretary": AVAudioPlayerNode()]', PLAYER)
        self.assertIn("completionCallbackType: .dataPlayedBack", PLAYER)

    def test_frames_validate_size_role_and_do_not_override_interruption(self):
        audio = section(SCREEN, 'case "audio":', 'case "status":')
        for guard in ['["guest", "secretary"].contains(role)', "payload.count <= 32_000",
                      "data.count <= 24_000", "!isAudioInterrupted",
                      "!manualAudioResumeRequired", "!CallManager.shared.hasPhoneAudioSession"]:
            self.assertIn(guard, audio)
        self.assertIn('reportAudioFailure(audioRecovery.failure ?? "player_not_ready")', audio)

    def test_native_regressions_are_required_by_xcresult_checker(self):
        checker = (ROOT / "ios/scripts/verify-xcresult.py").read_text()
        for suite in ["SecretaryMonitorAudioTests", "SecretaryTranscriptRenderingTests"]:
            tests = (ROOT / f"ios/TalkHintTests/{suite}.swift").read_text()
            import re
            for test in re.findall(r"func (test\w+)\(", tests):
                self.assertIn(f'"{test}"', checker)


if __name__ == "__main__":
    unittest.main()
