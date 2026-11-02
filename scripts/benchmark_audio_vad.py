"""Internal lab only: channel-local Silero VAD on existing, hash-checked WAVs.

No ASR, model API, call, transcript edits, DB writes or human-verified claims.
Audio lives in memory only. Inputs contain fixture metadata, never credentials.
Dependencies already provisioned in this workspace: numpy, onnxruntime, Pillow.
"""
import argparse
import base64
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import urllib.error
import urllib.request
import wave

import numpy as np
import onnxruntime as ort

MODEL_SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
MODEL_COMMIT = "066409f3d9db45a30d21dfcbf9147826ffdd7052"
SR = 8000
WINDOW = 256


def speech_segments(probabilities, samples, threshold=.5, end_threshold=.35,
                    min_speech_ms=250, min_silence_ms=350):
    """Causal VAD boundaries without clip padding; padding must not bias latency."""
    result = []
    start = None
    pending_end = None
    for i, p in enumerate(probabilities):
        offset = i * WINDOW
        if p >= threshold:
            if start is None:
                start = offset
            pending_end = None
        elif p < end_threshold and start is not None:
            if pending_end is None:
                pending_end = offset
            if offset - pending_end >= min_silence_ms * SR / 1000:
                if pending_end - start >= min_speech_ms * SR / 1000:
                    result.append((start, pending_end))
                start = pending_end = None
    if start is not None:
        end = pending_end if pending_end is not None else samples
        if end - start >= min_speech_ms * SR / 1000:
            result.append((start, min(end, samples)))
    return [{"startMs": round(a * 1000 / SR), "endMs": round(b * 1000 / SR),
             "clipStartMs": max(0, round(a * 1000 / SR) - 80),
             "clipEndMs": min(round(samples * 1000 / SR), round(b * 1000 / SR) + 80)}
            for a, b in result]


class Vad:
    def __init__(self, path):
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == MODEL_SHA256, "MODEL_HASH_MISMATCH"
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])

    def probabilities(self, pcm):
        # Fresh state/context for EVERY channel and recording.
        state = np.zeros((2, 1, 128), np.float32)
        context = np.zeros((1, 32), np.float32)
        probabilities = []
        audio = pcm.astype(np.float32) / 32768
        for off in range(0, len(audio), WINDOW):
            frame = audio[off:off + WINDOW]
            if len(frame) < WINDOW:
                frame = np.pad(frame, (0, WINDOW - len(frame)))
            chunk = np.concatenate((context, frame.reshape(1, -1)), axis=1)
            score, state = self.session.run(None, {
                "input": chunk, "state": state, "sr": np.array(SR, np.int64)})
            context = chunk[:, -32:]
            probabilities.append(float(score[0, 0]))
        return probabilities


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("RECORDING_REDIRECT_REFUSED")


def read_fixture_audio(row):
    import re
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    recording = row["recording_sid"]
    if not re.fullmatch(r"AC[0-9a-fA-F]{32}", sid) or not token:
        raise RuntimeError("TWILIO_CREDENTIALS_UNAVAILABLE")
    if not re.fullmatch(r"RE[0-9a-fA-F]{32}", recording):
        raise RuntimeError("INVALID_RECORDING_ID")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Recordings/{recording}.wav?RequestedChannels=2"
    auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as response:
        raw = response.read()
    if hashlib.md5(raw).hexdigest() != row["wav_md5"]:
        raise RuntimeError("AUDIO_HASH_MISMATCH: not the frozen fixture; no substitution")
    with wave.open(io.BytesIO(raw)) as wav:
        if wav.getframerate() != SR or wav.getnchannels() != 2 or wav.getsampwidth() != 2:
            raise RuntimeError("REQUIRE_ORIGINAL_DUAL_PCM16_8KHZ")
        pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").reshape(-1, 2)
    return pcm, hashlib.sha256(raw).hexdigest()


def energy_bins(pcm, bin_samples=800):
    return [round(float(np.sqrt(np.mean(pcm[i:i + bin_samples].astype(np.float64) ** 2))) / 32768, 5)
            for i in range(0, len(pcm), bin_samples)]


def check_boundaries(pcm, segments):
    checks = []
    for segment in segments:
        end = segment["endMs"] * SR // 1000
        before = pcm[max(0, end - 2400):end].astype(np.float64)
        after = pcm[end:min(len(pcm), end + 2400)].astype(np.float64)
        if not len(before) or not len(after):
            checks.append({"endMs": segment["endMs"], "energyDrop": None})
            continue
        a, b = float(np.mean(before ** 2)), float(np.mean(after ** 2))
        checks.append({"endMs": segment["endMs"], "energyDrop": b < max(1, a * .5),
                       "afterBeforePowerRatio": round(b / max(a, 1), 3)})
    return checks


def plot_sample(row, destination):
    # Numeric-only charts, no audio or transcript in the report.
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1400, 490), "white")
    d = ImageDraw.Draw(im)
    d.text((20, 10), f"Fixture {row['fixtureId']} | auto Silero VAD | {row['durationMs']/1000:.1f}s", fill="black")
    for c, channel in enumerate(row["channels"]):
        top = 65 + c * 205
        left, width = 70, 1280
        d.text((20, top - 24), f"{channel['role']}: energy (blue), speech probability (red), segments (green)", fill="black")
        bins = channel["energy100ms"]
        peak = max(max(bins, default=1), .001)
        for segment in channel["segments"]:
            x1 = left + width * segment["startMs"] / row["durationMs"]
            x2 = left + width * segment["endMs"] / row["durationMs"]
            d.rectangle((x1, top + 125, x2, top + 146), fill="#67bb85")
        for values, color, scale in [(bins, "#3976ba", peak), (channel["probabilities"], "#c76060", 1)]:
            # Pixel averaging, not decimation: short events remain visible.
            n = len(values)
            points = []
            for x in range(width):
                a, b = x * n // width, max(x * n // width + 1, (x + 1) * n // width)
                value = max(values[a:b], default=0)
                points.append((left + x, top + 120 - min(1, value / scale) * 115))
            d.line(points, fill=color, width=1)
        d.line((left, top + 150, left + width, top + 150), fill="black")
    im.save(destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provenance", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader(io.StringIO(json.loads(Path(args.provenance).read_text())["output"])))
    assert len({r["id"] for r in rows}) == len(rows)
    detector = Vad(args.model)
    summaries, failures = [], []
    for row in rows[:args.limit]:
        target = root / (row["id"] + ".json")
        # A rerun reuses successful, hash-pinned analyses; never redownloads them.
        if target.exists():
            result = json.loads(target.read_text())
            assert result["fixtureWavMd5"] == row["wav_md5"] and result["modelSha256"] == MODEL_SHA256
        else:
            try:
                roles = json.loads(row["channel_roles"])
                assert sorted(roles) == ["guest", "owner"]
                pcm, sha = read_fixture_audio(row)
                result = {"format": "talkhint.audio-vad.v1", "fixtureId": row["id"],
                          "fixtureWavMd5": row["wav_md5"], "audioSha256": sha,
                          "modelSha256": MODEL_SHA256, "modelCommit": MODEL_COMMIT,
                          "source": "hash-identical frozen fixture audio; original 8kHz",
                          "method": "Silero VAD, per-channel state; threshold=.5/.35, speech>=250ms, silence>=350ms",
                          "automaticallyGenerated": True, "humanVerified": False,
                          "referenceTextChanged": False, "durationMs": round(len(pcm) * 1000 / SR),
                          "parameters": {"threshold": .5, "endThreshold": .35, "minSpeechMs": 250,
                                         "minSilenceMs": 350, "frameMs": 32, "latencyUsesPadding": False},
                          "channels": []}
                for i, role in enumerate(roles):
                    probabilities = detector.probabilities(pcm[:, i])
                    segments = speech_segments(probabilities, len(pcm))
                    speech_ms = sum(s["endMs"] - s["startMs"] for s in segments)
                    flags = []
                    if not segments: flags.append("NO_SPEECH_DETECTED")
                    if any(s["endMs"] - s["startMs"] > 30000 for s in segments):
                        flags.append("LONG_CONTINUOUS_REGION: inspect menu/music")
                    if speech_ms > result["durationMs"] * .9:
                        flags.append("NEAR_CONTINUOUS_SPEECH: inspect menu/music")
                    result["channels"].append({"channel": i, "role": role, "segments": segments,
                        "speechMs": speech_ms, "flags": flags,
                        "boundaryEnergyChecks": check_boundaries(pcm[:, i], segments),
                        "energy100ms": energy_bins(pcm[:, i]), "probabilities": probabilities})
                # No audio file, transcript, name, phone or recording SID is persisted.
                del pcm
                target.write_text(json.dumps(result, separators=(",", ":")))
            except Exception as e:
                reason = f"HTTP_{e.code}" if isinstance(e, urllib.error.HTTPError) else str(e)
                # Only allowlisted diagnostics; never emit URL/auth/header exception dumps.
                if not re_safe_reason(reason):
                    reason = type(e).__name__
                failures.append({"fixtureId": row["id"], "error": reason})
                print(json.dumps({"fixtureId": row["id"], "status": "blocked", "error": reason}), flush=True)
                continue
        summaries.append({"fixtureId": row["id"], "durationMs": result["durationMs"],
                          "channels": [{"role": c["role"], "segments": len(c["segments"]),
                                        "speechMs": c["speechMs"], "flags": c["flags"]} for c in result["channels"]]})
        print(json.dumps({"fixtureId": row["id"], "status": "analysed",
                          "seconds": result["durationMs"] / 1000,
                          "segments": [c["segments"] for c in summaries[-1]["channels"]]}), flush=True)
    samples = []
    if summaries:
        ordered = sorted(summaries, key=lambda x: x["durationMs"])
        for pos in sorted({len(ordered)//4, len(ordered)//2, 3*len(ordered)//4}):
            summary = ordered[pos]
            data = json.loads((root / (summary["fixtureId"] + ".json")).read_text())
            plot_sample(data, root / ("sample-" + summary["fixtureId"] + ".png"))
            samples.append({"fixtureId": summary["fixtureId"], "humanVerified": False,
                            "checks": [{"role": c["role"], "flags": c["flags"],
                                "endings": len(c["boundaryEnergyChecks"]),
                                "energyDrops": sum(v["energyDrop"] is True for v in c["boundaryEnergyChecks"])}
                                for c in data["channels"]]})
    report = {"sourceCount": len(rows[:args.limit]), "analysed": len(summaries), "failures": failures,
              "apiModelCostUsd": 0, "newCalls": 0, "productionWrites": 0, "referenceTextEdits": 0,
              "modelSha256": MODEL_SHA256, "summaries": summaries, "sampleChecks": samples,
              "important": "VAD regions are NOT transcript turn alignment. No sequential guessed mapping. Original verified flags untouched."}
    (root / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k: report[k] for k in ["analysed", "sourceCount", "apiModelCostUsd", "failures"]}), flush=True)


def re_safe_reason(text):
    import re
    return bool(re.fullmatch(r"[A-Z_0-9 :;a-z.-]{1,150}", text))


if __name__ == "__main__":
    main()
