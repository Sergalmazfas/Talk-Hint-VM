"""Source contracts only: these checks are NOT Swift compilation or XCTest."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
CHAT = ROOT / "ios/TalkHint/Chat"


class AgataTrickleSourceTests(unittest.TestCase):
    def text(self, name):
        return (CHAT / name).read_text()

    def test_offer_does_not_wait_for_complete_ice_gathering(self):
        peer = self.text("ChatAgataPeer.swift")
        offer = peer.split("func offer(")[1].split("func setAnswer(")[0]
        self.assertNotIn("0..<80", offer)
        self.assertNotIn("iceGatheringState == .complete", offer)
        self.assertIn("pc.localDescription?.sdp", offer)
        self.assertIn("for _ in 0..<120", peer)  # bounded actual connection, not gathering

    def test_rtc_candidates_cross_delegate_as_sendable_values(self):
        peer = self.text("ChatAgataPeer.swift")
        self.assertIn("candidate(ChatAgataIceCandidate(candidate: c.sdp", peer)
        self.assertIn("@Sendable (ChatAgataIceCandidate)", peer)
        self.assertIn("Task { @MainActor", peer)
        self.assertIn("Codable, Hashable, Sendable", self.text("ChatAgataTrickle.swift"))

    def test_join_and_microphone_remain_after_remote_answer_trickle_and_connection(self):
        session = self.text("ChatAgataSession.swift")
        steps = ["peer.offer(", "network.data(for: request)", "peer.setAnswer(",
                 "trickle.activate", "peer.waitUntilConnected()", 'chatAgataOperation("joined"',
                 "peer.microphone(true)"]
        positions = [session.index(step) for step in steps]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(session.count("createChatAgata("), 1)

    def test_patch_uses_existing_ephemeral_auth_url_and_typed_envelope(self):
        api = self.text("ChatAgataAPI.swift")
        candidate = api.split("static func candidateRequest(")[1].split("static func request(")[0]
        self.assertIn('r.httpMethod = "PATCH"', candidate)
        self.assertIn("request(ticket: ticket", candidate)
        self.assertIn("JSONEncoder().encode(Envelope(candidate: candidate))", candidate)
        self.assertIn("r.timeoutInterval = 5", candidate)
        self.assertIn("https://api.retellai.com/webrtc-proxy/", api)

    def test_stop_cancels_queue_before_remote_cleanup(self):
        session = self.text("ChatAgataSession.swift")
        stop = session.split("func stop()")[1]
        self.assertLess(stop.index("trickle.stop()"), stop.index("cleanRemote("))
        queue = self.text("ChatAgataTrickle.swift")
        self.assertIn("seen.count < 128", queue)
        self.assertIn("sending?.cancel()", queue)
        self.assertIn("pending.removeAll()", queue)
        self.assertIn("guard !self.stopped, !Task.isCancelled", queue)

    def test_diagnostics_never_format_sensitive_objects(self):
        queue = self.text("ChatAgataTrickle.swift")
        logger = queue.split("Self.logger.info(")[1]
        for sensitive in ["localizedDescription", "candidate.candidate", "accessToken", "sdpMid"]:
            self.assertNotIn(sensitive, logger)
        self.assertIn('category: "AgataRTC"', queue)
        session = self.text("ChatAgataSession.swift")
        for phase in ["sdp_post_response", "connect_failed", "joined_complete"]:
            self.assertIn("diagnostic.record(." + phase, session)
        self.assertIn("completionHandler(nil)", session)
        self.assertIn("URLSessionConfiguration.ephemeral", session)

    def test_phone_audio_order_dependencies_and_ios_minimum_stay_unchanged(self):
        peer = self.text("ChatAgataPeer.swift")
        self.assertLess(peer.index("try audio.setMode"), peer.index("factory = RTCPeerConnectionFactory"))
        self.assertIn("!CallManager.shared.hasPhoneAudioSession", peer)
        self.assertNotIn("audio.setActive", peer)
        project = (ROOT / "ios/project.yml").read_text()
        self.assertIn('iOS: "15.0"', project)
        self.assertIn('exactVersion: "156.0.0"', project)


if __name__ == "__main__":
    unittest.main()
