"""Source-boundary checks, not a substitute for native audio/device tests."""
from pathlib import Path
import unittest

IOS = Path(__file__).resolve().parents[2]


def body(source, signature):
    return source.split(signature, 1)[1].split("\n    }", 1)[0]


class AudioBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.monitor = (IOS / "TalkHint/UI/SecretaryLiveCallViewController.swift").read_text()
        self.calls = (IOS / "TalkHint/Calls/CallManager.swift").read_text()

    def test_monitor_starts_after_appearance_not_during_view_loading(self):
        loading = body(self.monitor, "override func viewDidLoad()")
        self.assertNotIn("configureAudioPlayback()", loading)
        self.assertNotIn("connectStream()", loading)
        appearing = body(self.monitor, "override func viewDidAppear(")
        self.assertIn("isMonitorVisible = true", appearing)
        self.assertIn("configureAudioPlayback()", appearing)

    def test_leaving_monitor_releases_local_resources_without_hangup(self):
        leaving = body(self.monitor, "override func viewWillDisappear(")
        for required in ["isMonitorVisible = false", "connectionTimeout?.cancel()",
                         "reconnectWork?.cancel()", "stream?.disconnect()", "stopPlayback()"]:
            self.assertIn(required, leaving)
        self.assertNotIn("hangup", leaving.lower())
        self.assertNotIn("APIClient", leaving)
        for signature in ["private func configureAudioPlayback()", "private func connectStream()",
                          "@objc private func appDidBecomeActive()", "private func handleDisconnect("]:
            self.assertIn("guard isMonitorVisible", body(self.monitor, signature))

    def test_audio_failure_is_not_replaced_with_connecting_status(self):
        for signature in ["override func viewDidAppear(", "@objc private func retryConnection()",
                          "@objc private func appDidBecomeActive()"]:
            starting = body(self.monitor, signature)
            self.assertLess(starting.index("guard configureAudioPlayback() else { return }"),
                            starting.index("connectStream()"))
        configuring = body(self.monitor, "private func configureAudioPlayback()")
        self.assertIn("-> Bool", configuring)
        self.assertIn("setConnectionFailure", configuring)
        self.assertIn("return false", configuring)

    def test_stale_monitor_cleanup_cannot_stop_new_player_or_callkit_session(self):
        stopping = body(self.monitor, "private func stopPlayback()")
        self.assertLess(stopping.index("guard audioSessionActive"),
                        stopping.index("SecretaryAudioPlayer.shared.stop()"))
        self.assertLess(stopping.index("guard !CallManager.shared.hasPhoneAudioSession"),
                        stopping.index("setActive(false"))

    def test_callkit_controls_selected_device_and_modes_choose_before_connecting(self):
        self.assertIn("prepareAudioDevice(for: selectedMode)", self.calls)
        self.assertIn("prepareAudioDevice(for: mode)", self.calls)
        self.assertIn("copilot: mode == .copilot", self.calls)
        self.assertIn("audioRouter.setEnabled(true)", body(self.calls, "didActivate audioSession:"))
        self.assertIn("audioRouter.setEnabled(false)", body(self.calls, "didDeactivate audioSession:"))


if __name__ == "__main__":
    unittest.main()
