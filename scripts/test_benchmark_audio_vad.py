"""Free tests: no model API, no recording downloads, no real speech."""
import unittest
import numpy as np
from benchmark_audio_vad import speech_segments, check_boundaries, Vad, WINDOW


class Segments(unittest.TestCase):
    def test_silence_is_not_speech(self):
        self.assertEqual(speech_segments([0.] * 100, WINDOW * 100), [])

    def test_short_click_is_not_an_utterance(self):
        self.assertEqual(speech_segments([0.] * 5 + [.99] * 2 + [0.] * 30, WINDOW * 37), [])

    def test_latency_boundaries_are_not_padded(self):
        result = speech_segments([0.] * 10 + [.9] * 20 + [0.] * 20, WINDOW * 50)
        self.assertEqual(result[0]["startMs"], 320)
        self.assertEqual(result[0]["endMs"], 960)
        self.assertEqual(result[0]["clipEndMs"], 1040)

    def test_short_pause_does_not_split_an_utterance(self):
        result = speech_segments([.9] * 20 + [0.] * 5 + [.9] * 20 + [0.] * 20, WINDOW * 65)
        self.assertEqual(len(result), 1)

    def test_long_silence_separates_regions(self):
        result = speech_segments([.9] * 20 + [0.] * 20 + [.9] * 20 + [0.] * 20, WINDOW * 80)
        self.assertEqual(len(result), 2)
        self.assertLess(result[0]["endMs"], result[1]["startMs"])

    def test_tail_is_clipped_to_actual_audio_duration(self):
        n = WINDOW * 20 - 20
        result = speech_segments([.9] * 20, n)
        self.assertLessEqual(result[-1]["endMs"], n * 1000 / 8000 + .5)
        self.assertEqual(result[-1]["endMs"], result[-1]["clipEndMs"])

    def test_independent_energy_check(self):
        pcm = np.concatenate([np.ones(8000, dtype=np.int16) * 1000, np.zeros(8000, dtype=np.int16)])
        self.assertTrue(check_boundaries(pcm, [{"endMs": 1000}])[0]["energyDrop"])
        self.assertFalse(check_boundaries(np.ones(16000, dtype=np.int16) * 1000, [{"endMs": 1000}])[0]["energyDrop"])

    def test_channel_state_resets_not_shared_between_owner_and_guest(self):
        class Session:
            def run(self, _, inputs):
                self.inputs.append(inputs["state"].copy())
                return [np.array([[.9]], np.float32), inputs["state"] + 1]
        detector = object.__new__(Vad)
        detector.session = Session()
        detector.session.inputs = []
        for _ in range(2):
            detector.probabilities(np.ones(WINDOW * 2, dtype=np.int16))
        self.assertTrue(np.all(detector.session.inputs[0] == 0))
        self.assertTrue(np.all(detector.session.inputs[1] == 1))
        self.assertTrue(np.all(detector.session.inputs[2] == 0))


if __name__ == "__main__":
    unittest.main()
