import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface VoiceClone {
  voiceId: string;
  status: string;
  durationMs: number;
  createdAt: string;
}

interface CartesiaClone {
  voiceId: string;
  status: string;
  durationMs: number;
  createdAt: string;
}

interface VoiceLabRun {
  id: string;
  transcript: string;
  english: string;
  voiceId: string;
  provider: string;
  timings: {
    micRelease: number;
    transcriptionComplete: number;
    englishReady: number;
    elevenlabsRequest?: number | null;
    firstAudio?: number | null;
  };
  firstAudioMs?: number | null;
  playResult?: string;
  createdAt?: string;
}

const API = "/api/admin/voice-lab";
const MAX_SAMPLE_DURATION_MS = 180_000;

interface RunLatency {
  releaseTranscript: number;
  transcriptEnglish: number;
  englishRequest: number | null;
  requestFirstAudio: number | null;
  releaseFirstAudio: number | null;
}

interface CartesiaPlaybackMeasurement {
  requestToFirstAudibleMs: number | null;
  status: string;
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function audioBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Не удалось прочитать аудиозапись."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать аудиозапись."));
    reader.readAsDataURL(blob);
  });
}

async function cartesiaCompatibleSample(blob: Blob): Promise<Blob> {
  const mime = blob.type.split(";")[0].toLowerCase();
  if (["audio/webm", "audio/wav", "audio/mpeg", "audio/ogg"].includes(mime)) return blob;
  // Safari records MP4/AAC. Decode only after consent, then upload a mono WAV
  // without ever persisting a converted copy or sending MP4 to the clone API.
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const byteLength = 44 + decoded.length * 2;
    if (byteLength > 10 * 1024 * 1024) throw new Error("Запись слишком велика после преобразования в WAV. Сделайте образец короче.");
    const buffer = new ArrayBuffer(byteLength);
    const view = new DataView(buffer);
    const writeText = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeText(0, "RIFF");
    view.setUint32(4, byteLength - 8, true);
    writeText(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, decoded.sampleRate, true);
    view.setUint32(28, decoded.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, byteLength - 44, true);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    for (let i = 0; i < decoded.length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      value = Math.max(-1, Math.min(1, value / channels.length));
      view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

export default function VoiceLab() {
  const [, setLocation] = useLocation();
  const { user, token, isLoading } = useAuth();
  const [clone, setClone] = useState<VoiceClone | null>(null);
  const [cartesiaClone, setCartesiaClone] = useState<CartesiaClone | null>(null);
  const [cartesiaError, setCartesiaError] = useState("");
  const [runs, setRuns] = useState<VoiceLabRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusRefreshError, setStatusRefreshError] = useState("");
  const [consent, setConsent] = useState(false);
  const [cartesiaConsent, setCartesiaConsent] = useState(false);
  const [creatingCartesiaClone, setCreatingCartesiaClone] = useState(false);
  const [cartesiaAttemptUncertain, setCartesiaAttemptUncertain] = useState(false);
  const [cartesiaFailure, setCartesiaFailure] = useState("");
  const [linkVoiceId, setLinkVoiceId] = useState("");
  const [linkConsent, setLinkConsent] = useState(false);
  const [linkingVoice, setLinkingVoice] = useState(false);
  const [sample, setSample] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState("");
  const [sampleDuration, setSampleDuration] = useState(0);
  const [sampleElapsedMs, setSampleElapsedMs] = useState(0);
  const [sampleOverLimit, setSampleOverLimit] = useState(false);
  const [recordingSample, setRecordingSample] = useState(false);
  const [creatingClone, setCreatingClone] = useState(false);
  const [cloneAttemptUncertain, setCloneAttemptUncertain] = useState(false);
  const [recordingSpeech, setRecordingSpeech] = useState(false);
  const [working, setWorking] = useState(false);
  const [currentRun, setCurrentRun] = useState<VoiceLabRun | null>(null);
  const [latency, setLatency] = useState<RunLatency | null>(null);
  const [cartesiaPlayback, setCartesiaPlayback] = useState<Record<string, CartesiaPlaybackMeasurement>>({});
  const [playing, setPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"streaming" | "buffered" | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const sampleUrlRef = useRef("");
  const pointerHeldRef = useRef(false);
  const releaseAtRef = useRef<number | null>(null);
  const sampleLimitHitRef = useRef(false);
  const mountedRef = useRef(true);

  const stopTracks = useCallback(() => {
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    mediaStream.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pointerHeldRef.current = false;
      if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
      stopTracks();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
      window.speechSynthesis?.cancel();
    };
  }, [stopTracks]);

  useEffect(() => {
    if (!isLoading && !user) setLocation("/");
  }, [isLoading, user, setLocation]);

  const loadLab = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(API, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Не удалось загрузить Voice Lab (${response.status}).`);
      setClone(data.clone || null);
      setCartesiaClone(data.cartesiaClone || null);
      setCartesiaError(data.cartesiaError || "");
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить Voice Lab.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  async function refreshCloneStatus() {
    if (!token) return;
    setStatusRefreshError("");
    try {
      const response = await fetch(API, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Не удалось обновить статус (${response.status}).`);
      setClone(data.clone || null);
      setCartesiaClone(data.cartesiaClone || null);
      setCartesiaError(data.cartesiaError || "");
      if (Array.isArray(data.runs)) setRuns(data.runs);
    } catch (err) {
      setStatusRefreshError(err instanceof Error ? err.message : "Не удалось обновить статус клона.");
    }
  }

  useEffect(() => {
    if (!isLoading && user?.isAdmin && token) void loadLab();
  }, [isLoading, user?.isAdmin, token, loadLab]);

  useEffect(() => {
    if (!recordingSample) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - recordingStartedAt.current;
      setSampleElapsedMs(elapsed);
      if (elapsed >= MAX_SAMPLE_DURATION_MS && !sampleLimitHitRef.current) {
        sampleLimitHitRef.current = true;
        setSampleOverLimit(true);
        setError("Запись образца превысила лимит 3 минуты и не будет загружена. Запишите более короткий образец.");
        stopRecorder();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [recordingSample]);

  useEffect(() => {
    const releaseOnBlur = () => {
      if (pointerHeldRef.current) endSpeech();
    };
    const releaseWhenHidden = () => {
      if (document.visibilityState === "hidden") releaseOnBlur();
    };
    window.addEventListener("blur", releaseOnBlur);
    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      window.removeEventListener("blur", releaseOnBlur);
      document.removeEventListener("visibilitychange", releaseWhenHidden);
    };
  }, []);

  function setAudioSource(url: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url.startsWith("blob:") ? url : null;
    audio.src = url;
    audio.load();
  }

  function startRecorder(onComplete: (blob: Blob, durationMs: number) => void, onState: (recording: boolean) => void, stopIfPointerReleased = false) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Запись звука не поддерживается этим браузером.");
      return;
    }
    setError("");
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStream.current = stream;
      chunks.current = [];
      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : undefined;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      recorder.onerror = () => {
        if (mountedRef.current) setError("Ошибка записи. Проверьте доступ к микрофону и попробуйте снова.");
        stopTracks();
        if (mountedRef.current) onState(false);
      };
      recorder.onstop = () => {
        const durationMs = Math.max(0, Date.now() - recordingStartedAt.current);
        const blob = new Blob(chunks.current, { type: recorder.mimeType || "audio/webm" });
        chunks.current = [];
        stopTracks();
        if (mountedRef.current) {
          onState(false);
          if (blob.size) onComplete(blob, durationMs);
        }
      };
      recordingStartedAt.current = Date.now();
      recorder.start(250);
      onState(true);
      if (stopIfPointerReleased && !pointerHeldRef.current) {
        releaseAtRef.current = releaseAtRef.current || Date.now();
        window.setTimeout(stopRecorder, 0);
      }
    }).catch((err: unknown) => {
      setError(err instanceof Error ? `Не удалось получить доступ к микрофону: ${err.message}` : "Не удалось получить доступ к микрофону.");
      stopTracks();
      onState(false);
    });
  }

  function stopRecorder() {
    if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
  }

  function recordSample() {
    setCartesiaConsent(false);
    setSampleElapsedMs(0);
    setSampleOverLimit(false);
    sampleLimitHitRef.current = false;
    startRecorder((blob, durationMs) => {
      if (sampleLimitHitRef.current || durationMs >= MAX_SAMPLE_DURATION_MS) {
        setSampleOverLimit(true);
        setError("Запись образца превысила лимит 3 минуты и не будет загружена. Запишите более короткий образец.");
        return;
      }
      setSample(blob);
      setSampleDuration(durationMs);
      setSampleElapsedMs(durationMs);
      const url = URL.createObjectURL(blob);
      sampleUrlRef.current = url;
      setSampleUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
    }, (recording) => {
      if (recording) sampleLimitHitRef.current = false;
      setRecordingSample(recording);
    });
  }

  function deleteSample() {
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    sampleUrlRef.current = "";
    setSample(null);
    setSampleUrl("");
    setSampleDuration(0);
    setSampleElapsedMs(0);
    setSampleOverLimit(false);
    sampleLimitHitRef.current = false;
    setConsent(false);
    setCartesiaConsent(false);
  }

  async function createClone() {
    if (!sample || !consent || !token || recordingSample || sampleOverLimit || sampleDuration >= MAX_SAMPLE_DURATION_MS || (cloneAttemptUncertain && !/retryable/i.test(clone?.status || ""))) return;
    setCreatingClone(true);
    setError("");
    try {
      const response = await fetch(`${API}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ audioBase64: await audioBase64(sample), mimeType: sample.type || "audio/webm", durationMs: sampleDuration, consent: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Не удалось создать голос (${response.status}).`);
      setClone(data.clone);
      setCloneAttemptUncertain(false);
      await loadLab();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать голос.");
      setCloneAttemptUncertain(true);
      await refreshCloneStatus();
    } finally {
      setCreatingClone(false);
    }
  }

  async function linkExistingVoice() {
    if (!linkVoiceId.trim() || !linkConsent || !token || linkingVoice ||
        (clone && ["ready", "creating", "uncertain"].includes(clone.status))) return;
    setLinkingVoice(true);
    setError("");
    try {
      const response = await fetch(`${API}/link-existing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ voiceId: linkVoiceId.trim(), consent: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Не удалось привязать голос (${response.status}).`);
      setClone(data.clone);
      setCloneAttemptUncertain(false);
      await loadLab();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось привязать существующий голос.");
      await refreshCloneStatus();
    } finally {
      setLinkingVoice(false);
    }
  }

  async function createCartesiaClone() {
    if (!sample || !cartesiaConsent || !token || cartesiaError || recordingSample || sampleOverLimit ||
        sampleDuration < 10_000 || sampleDuration > 60_000 ||
        (cartesiaClone && cartesiaClone.status !== "retryable") ||
        (cartesiaAttemptUncertain && !/retryable/i.test(cartesiaClone?.status || ""))) return;
    setCreatingCartesiaClone(true);
    setError("");
    setCartesiaFailure("");
    let sent = false;
    try {
      const prepared = await cartesiaCompatibleSample(sample);
      sent = true;
      const response = await fetch(`${API}/cartesia/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          audioBase64: await audioBase64(prepared),
          mimeType: prepared.type || "audio/webm",
          durationMs: sampleDuration,
          consent: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Не удалось создать голос Cartesia (${response.status}).`);
      setCartesiaClone(data.cartesiaClone);
      setCartesiaAttemptUncertain(false);
      setCartesiaFailure("");
      await loadLab();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать голос Cartesia.";
      setError(message);
      setCartesiaFailure(message);
      if (sent) {
        setCartesiaAttemptUncertain(true);
        await refreshCloneStatus();
      }
    } finally {
      setCreatingCartesiaClone(false);
    }
  }

  async function notePlayback(run: VoiceLabRun, elevenlabsRequestMs: number, firstAudioMs: number | null, playResult: string) {
    const runId = run.id;
    const updatedRun: VoiceLabRun = {
      ...run,
      timings: {
        ...run.timings,
        elevenlabsRequest: run.timings.micRelease + elevenlabsRequestMs,
        firstAudio: firstAudioMs === null ? null : run.timings.micRelease + firstAudioMs,
      },
      firstAudioMs,
      playResult,
    };
    setRuns((previous) => previous.map((item) => item.id === runId ? updatedRun : item));
    setCurrentRun((previous) => previous?.id === runId ? updatedRun : previous);
    if (!token) return;
    try {
      const response = await fetch(`${API}/runs/${encodeURIComponent(runId)}/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ elevenlabsRequestMs, firstAudioMs, playResult }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.run) {
        const mergedRun = { ...updatedRun, ...data.run, timings: { ...updatedRun.timings, ...data.run.timings } };
        setRuns((previous) => previous.map((item) => item.id === runId ? mergedRun : item));
        setCurrentRun((previous) => previous?.id === runId ? mergedRun : previous);
      }
    } catch {
      // Playback remains useful even if telemetry cannot be saved.
    }
  }

  async function streamAudio(run: VoiceLabRun, voiceProvider: "elevenlabs" | "cartesia" = "elevenlabs") {
    if (!token) throw new Error("Сессия завершена. Войдите снова.");
    if (voiceProvider === "cartesia" && cartesiaClone?.status !== "ready") {
      throw new Error("Сначала создайте клон Cartesia из образца голоса.");
    }
    const releaseAt = run.timings?.micRelease || Date.now();
    const path = `${API}/runs/${encodeURIComponent(run.id)}/audio${voiceProvider === "cartesia" ? "?provider=cartesia" : ""}`;
    setAutoplayBlocked(false);
    setPlaybackMode(null);
    if (voiceProvider === "cartesia") {
      setCartesiaPlayback((previous) => ({
        ...previous,
        [run.id]: { requestToFirstAudibleMs: null, status: "Генерация…" },
      }));
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onplaying = null;
    }
    const requestAt = Date.now();
    const elevenlabsRequestMs = Math.max(0, requestAt - releaseAt);
    if (voiceProvider === "elevenlabs") {
      setLatency((previous) => previous ? {
        ...previous,
        englishRequest: Math.max(0, requestAt - run.timings.englishReady),
      } : previous);
    }
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = data.error || `Не удалось загрузить аудио (${response.status}).`;
      if (voiceProvider === "elevenlabs") {
        void notePlayback(run, elevenlabsRequestMs, null, `failed: ${message}`);
      } else {
        setCartesiaPlayback((previous) => ({
          ...previous,
          [run.id]: { requestToFirstAudibleMs: null, status: "Ошибка генерации" },
        }));
      }
      throw new Error(message);
    }
    const audio = audioRef.current;
    if (!audio) throw new Error("Аудиоплеер недоступен.");
    let audibleAt: number | null = null;
    let failureHandled = false;
    let resolveStarted!: () => void;
    let rejectStarted!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    let startSettled = false;
    const failPlayback = (error: Error) => {
      if (failureHandled) return;
      failureHandled = true;
      setPlaying(false);
      if (audibleAt === null) {
        const blocked = error.name === "NotAllowedError";
        if (blocked) {
          setAutoplayBlocked(true);
          setError("Автовоспроизведение заблокировано браузером. Запустите звук кнопкой аудиоплеера.");
        }
        if (voiceProvider === "elevenlabs") {
          void notePlayback(run, elevenlabsRequestMs, null, blocked ? "autoplay_blocked" : `failed: ${error.message}`);
        } else {
          setCartesiaPlayback((previous) => ({
            ...previous,
            [run.id]: { requestToFirstAudibleMs: null, status: blocked ? "Нужно нажать Play в аудиоплеере" : "Ошибка воспроизведения" },
          }));
        }
      } else {
        if (voiceProvider === "elevenlabs") {
          void notePlayback(run, elevenlabsRequestMs, audibleAt - releaseAt, `interrupted: ${error.message}`);
        } else {
          setCartesiaPlayback((previous) => ({
            ...previous,
            [run.id]: {
              requestToFirstAudibleMs: Math.max(0, audibleAt! - requestAt),
              status: "Воспроизведение прервано",
            },
          }));
        }
      }
      if (!startSettled) {
        startSettled = true;
        rejectStarted(error);
      } else {
        setError(error.message);
      }
    };
    audio.onplaying = () => {
      setPlaying(true);
      if (audibleAt === null) {
        audibleAt = Date.now();
        const firstAudioMs = Math.max(0, audibleAt - releaseAt);
        if (voiceProvider === "elevenlabs") {
          setLatency((previous) => previous ? {
            ...previous,
            requestFirstAudio: Math.max(0, audibleAt! - requestAt),
            releaseFirstAudio: firstAudioMs,
          } : previous);
          void notePlayback(run, elevenlabsRequestMs, firstAudioMs, "played");
        } else {
          setCartesiaPlayback((previous) => ({
            ...previous,
            [run.id]: { requestToFirstAudibleMs: Math.max(0, audibleAt! - requestAt), status: "Готово" },
          }));
        }
      }
      if (!startSettled) {
        startSettled = true;
        resolveStarted();
      }
    };
    audio.onended = () => setPlaying(false);
    audio.onerror = () => failPlayback(new Error("Не удалось воспроизвести аудио."));
    const beginPlayback = () => {
      void audio.play().catch((reason: unknown) => {
        const error = reason instanceof Error ? reason : new Error("Не удалось начать воспроизведение.");
        failPlayback(error);
      });
    };
    setPlaying(false);

    const canStream = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg") && !!response.body;
    setPlaybackMode(canStream ? "streaming" : "buffered");
    if (canStream) {
      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      setAudioSource(url);
      void new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener("sourceopen", async () => {
          try {
            const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
            const reader = response.body!.getReader();
            let firstChunk = true;
            const append = (buffer: SourceBuffer, chunk: Uint8Array) => new Promise<void>((done, fail) => {
              const ended = () => { buffer.removeEventListener("updateend", ended); buffer.removeEventListener("error", failed); done(); };
              const failed = () => { buffer.removeEventListener("updateend", ended); buffer.removeEventListener("error", failed); fail(new Error("Ошибка потокового воспроизведения.")); };
              buffer.addEventListener("updateend", ended, { once: true });
              buffer.addEventListener("error", failed, { once: true });
              buffer.appendBuffer(chunk);
            });
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              await append(sourceBuffer, value);
              if (firstChunk) {
                firstChunk = false;
                beginPlayback();
              }
            }
            if (mediaSource.readyState === "open") mediaSource.endOfStream();
            resolve();
          } catch (err) {
            reject(err);
          }
        }, { once: true });
      }).catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error("Ошибка потокового воспроизведения.");
        failPlayback(error);
      });
    } else {
      try {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setAudioSource(url);
        beginPlayback();
      } catch (err) {
        failPlayback(err instanceof Error ? err : new Error("Не удалось загрузить аудио."));
      }
    }
    await started;
  }

  async function playRun(run: VoiceLabRun) {
    try {
      setLatency({
        releaseTranscript: Math.max(0, run.timings.transcriptionComplete - run.timings.micRelease),
        transcriptEnglish: Math.max(0, run.timings.englishReady - run.timings.transcriptionComplete),
        englishRequest: run.timings.elevenlabsRequest == null ? null : Math.max(0, run.timings.elevenlabsRequest - run.timings.englishReady),
        requestFirstAudio: null,
        releaseFirstAudio: run.timings.firstAudio == null ? null : Math.max(0, run.timings.firstAudio - run.timings.micRelease),
      });
      await streamAudio(run);
    } catch (err) {
      setPlaying(false);
      const message = err instanceof Error ? err.message : "Не удалось воспроизвести ElevenLabs.";
      setError(err instanceof Error && err.name === "NotAllowedError"
        ? "Автовоспроизведение заблокировано браузером. Запустите звук кнопкой аудиоплеера."
        : message);
    }
  }

  async function playCartesiaRun(run: VoiceLabRun) {
    setError("");
    try {
      await streamAudio(run, "cartesia");
    } catch (err) {
      setPlaying(false);
      const message = err instanceof Error ? err.message : "Не удалось воспроизвести Cartesia.";
      setCartesiaPlayback((previous) => ({
        ...previous,
        [run.id]: {
          requestToFirstAudibleMs: null,
          status: message.includes("клон Cartesia") ? "Сначала создайте клон" : "Не удалось воспроизвести",
        },
      }));
      setError(message);
    }
  }

  async function submitSpeech(blob: Blob, durationMs: number, releasedAt: number) {
    if (!token) return;
    setWorking(true);
    setError("");
    setLatency(null);
    setCurrentRun(null);
    try {
      const response = await fetch(`${API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ audioBase64: await audioBase64(blob), mimeType: blob.type || "audio/webm", durationMs, releasedAtMs: releasedAt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Не удалось обработать речь (${response.status}).`);
      const run: VoiceLabRun = data.run;
      setCurrentRun(run);
      const timings = run.timings || { micRelease: releasedAt, transcriptionComplete: releasedAt, englishReady: releasedAt };
      const metrics = {
        releaseTranscript: Math.max(0, timings.transcriptionComplete - timings.micRelease),
        transcriptEnglish: Math.max(0, timings.englishReady - timings.transcriptionComplete),
        englishRequest: null as number | null,
        requestFirstAudio: null as number | null,
        releaseFirstAudio: null as number | null,
      };
      setLatency(metrics);
      setRuns((previous) => [run, ...previous.filter((item) => item.id !== run.id)].slice(0, 20));
      await streamAudio(run);
    } catch (err) {
      setPlaying(false);
      setError(err instanceof Error && err.name === "NotAllowedError"
        ? "Автовоспроизведение заблокировано браузером. Запустите звук кнопкой аудиоплеера."
        : err instanceof Error ? err.message : "Не удалось выполнить Voice Lab.");
    } finally {
      setWorking(false);
    }
  }

  function beginSpeech(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (recordingSpeech || working || pointerHeldRef.current) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window blur and pointer-up handlers still release the mic if capture is unavailable.
    }
    pointerHeldRef.current = true;
    releaseAtRef.current = null;
    startRecorder((blob, durationMs) => {
      const release = releaseAtRef.current || Date.now();
      void submitSpeech(blob, durationMs, release);
    }, setRecordingSpeech, true);
  }

  function endSpeech() {
    pointerHeldRef.current = false;
    if (releaseAtRef.current === null) releaseAtRef.current = Date.now();
    stopRecorder();
  }

  function playDefaultVoice(text: string) {
    if (!window.speechSynthesis) {
      setError("Браузер не поддерживает синтез речи.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.onstart = () => setPlaying(true);
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utterance);
  }

  function intervalLabel(ms: number | null | undefined) {
    return ms == null ? "—" : `${Math.max(0, ms)} ms`;
  }

  function playbackComparison(run: VoiceLabRun) {
    const elevenLabsRequest = run.timings.elevenlabsRequest;
    const elevenLabsFirstAudio = run.timings.firstAudio;
    const elevenLabsMs = elevenLabsRequest != null && elevenLabsFirstAudio != null
      ? Math.max(0, elevenLabsFirstAudio - elevenLabsRequest)
      : currentRun?.id === run.id ? latency?.requestFirstAudio ?? null : null;
    const cartesia = cartesiaPlayback[run.id];
    return (
      <div className="mt-3 rounded-md border border-gray-700 bg-gray-900/60 p-3 text-xs sm:text-sm">
        <p className="text-gray-400">Запрос → первое слышимое аудио в этом браузере</p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <p className="text-gray-300">ElevenLabs: <span className="text-cyan-300">{intervalLabel(elevenLabsMs)}</span></p>
          <p className="text-gray-300">Cartesia: <span className="text-purple-300">{cartesia?.requestToFirstAudibleMs == null ? cartesia?.status || "ещё не проверено" : intervalLabel(cartesia.requestToFirstAudibleMs)}</span></p>
        </div>
        <p className="mt-2 text-gray-500">Это клиентский замер до начала воспроизведения, а не только время генерации провайдера. Фразы и перевод для обеих кнопок одинаковы.</p>
      </div>
    );
  }

  if (isLoading || (user?.isAdmin && loading)) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-900"><div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" /></div>;
  }
  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <Card className="bg-gray-800/60 border-red-700 max-w-md w-full"><CardContent className="py-10 text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-2">403 — admin only</h1>
          <p className="text-gray-400 mb-6">Voice Lab доступен только администраторам.</p>
          <Button variant="outline" onClick={() => setLocation("/")}>На главную</Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-900/50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div><h1 className="text-2xl font-bold text-cyan-400">Voice Lab</h1><p className="text-sm text-gray-400">Административная лаборатория голоса</p></div>
          <Button variant="outline" onClick={() => setLocation("/dashboard")}>← Dashboard</Button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {error && <div role="alert" className="rounded-md border border-red-700 bg-red-950/40 px-4 py-3 text-red-300">{error}<button className="float-right" onClick={() => setError("")} aria-label="Закрыть">×</button></div>}

        <Card className="bg-gray-800/50 border-gray-700"><CardContent className="p-5 sm:p-6 space-y-5">
          <div><h2 className="text-xl font-semibold">1. Образец голоса</h2>
            <p className="text-sm text-gray-400 mt-1">Для клона ElevenLabs подойдёт запись до 3 минут. Для Cartesia требуется образец 10–60 секунд. Для честного сравнения используйте один и тот же короткий образец для обоих клонов.</p>
          </div>
          <div className="rounded-md bg-gray-900/70 p-4 space-y-2 text-sm">
            <p className="text-gray-300"><strong className="text-cyan-300">Текст для чтения:</strong> «Привет! Сегодня я хочу рассказать о том, как проходит мой обычный день. Утром я просыпаюсь, готовлю кофе и планирую дела. Иногда день бывает спокойным, а иногда всё меняется в последнюю минуту. Мне нравится встречаться с друзьями, обсуждать новости и делиться интересными историями. Самое важное — говорить естественно, как в обычном разговоре, не торопиться и делать небольшие паузы».</p>
            <p className="text-gray-400">Записывайтесь в тихом помещении, близко к микрофону; избегайте музыки, эха, шума и обработки звука.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!recordingSample ? <Button onClick={recordSample} className="bg-cyan-600 hover:bg-cyan-700">{sample ? "Записать снова" : "Record"}</Button> : <Button onClick={stopRecorder} className="bg-red-600 hover:bg-red-700">Stop</Button>}
            {sampleUrl && <Button variant="outline" onClick={() => { if (audioRef.current) { audioRef.current.src = sampleUrl; void audioRef.current.play(); } }}>Play</Button>}
            {sample && <Button variant="outline" onClick={deleteSample}>Delete</Button>}
            {(sample || recordingSample) && <span className="text-sm text-gray-300">{recordingSample ? "Записано:" : "Длительность:"} {formatDuration(recordingSample ? sampleElapsedMs : sampleDuration)}</span>}
            {recordingSample && <span className="text-sm text-red-300 animate-pulse">Идёт запись…</span>}
          </div>
          {sampleOverLimit && <p role="alert" className="text-sm text-red-300">Образец превысил лимит 3 минуты и не может быть загружен. Запишите новый короткий образец.</p>}
        </CardContent></Card>

        <Card className="bg-gray-800/50 border-gray-700"><CardContent className="p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold">2. Клон голоса ElevenLabs</h2>
            <p className="text-sm text-gray-400 mt-1">Создайте клон из записанного выше образца. Голос доступен только в этой административной лаборатории.</p>
          </div>
          <label className="flex items-start gap-3 text-sm text-gray-300">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-cyan-500" />
            <span>Я подтверждаю, что это мой голос или у меня есть разрешение на его использование и клонирование.</span>
          </label>
          <Button disabled={!sample || !consent || creatingClone || recordingSample || sampleOverLimit || sampleDuration >= MAX_SAMPLE_DURATION_MS || (clone && clone.status !== "retryable") || (cloneAttemptUncertain && !/retryable/i.test(clone?.status || ""))} onClick={createClone} className="bg-gradient-to-r from-cyan-600 to-purple-600">
            {creatingClone ? "Создание голоса…" : "Create ElevenLabs Voice"}
          </Button>
          <div className="border-t border-gray-700 pt-4 space-y-3">
            <div>
              <h3 className="font-medium text-gray-200">Уже есть голос ElevenLabs?</h3>
              <p className="mt-1 text-sm text-amber-300">Это привяжет уже существующий голос ElevenLabs и не создаст второй платный клон. Привязка применяется только к текущему окружению приложения; база данных между development и production не копируется.</p>
            </div>
            <label className="block text-sm text-gray-300">
              Voice ID
              <input value={linkVoiceId} onChange={(event) => setLinkVoiceId(event.target.value)} autoComplete="off"
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                placeholder="ElevenLabs Voice ID" />
            </label>
            <label className="flex items-start gap-3 text-sm text-gray-300">
              <input type="checkbox" checked={linkConsent} onChange={(event) => setLinkConsent(event.target.checked)} className="mt-1 accent-cyan-500" />
              <span>Я подтверждаю, что имею право использовать этот существующий голос в текущем окружении приложения.</span>
            </label>
            <Button disabled={!linkVoiceId.trim() || !linkConsent || linkingVoice || creatingClone || recordingSample || Boolean(clone && ["ready", "creating", "uncertain"].includes(clone.status))}
              onClick={linkExistingVoice} variant="outline">
              {linkingVoice ? "Проверка и привязка…" : "Привязать существующий Voice ID"}
            </Button>
          </div>
          {cloneAttemptUncertain && <div className="rounded-md border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">
            <p>Статус предыдущего запроса: {clone?.status || "неизвестен"}. Повторная отправка отключена, пока статус не станет retryable.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refreshCloneStatus()}>Обновить статус</Button>
            {statusRefreshError && <p role="alert" className="mt-2 text-red-300">{statusRefreshError}</p>}
          </div>}
          {clone && <div className="rounded-md border border-gray-700 bg-gray-900/60 p-4 text-sm">
            <p className="text-green-300 font-medium">Клон: {clone.status}</p>
            <p className="text-gray-300 break-all">Voice ID: {clone.voiceId}</p>
            <p className="text-gray-400">Длительность: {clone.durationMs === 0 ? "неизвестна (голос уже создан в ElevenLabs)" : formatDuration(clone.durationMs)} · Создан: {new Date(clone.createdAt).toLocaleString()}</p>
          </div>}
        </CardContent></Card>

        <Card className="bg-gray-800/50 border-purple-800/70"><CardContent className="p-5 sm:p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold">3. Отдельный клон Cartesia</h2>
            <p className="mt-1 text-sm text-gray-400">Создаётся отдельно от ElevenLabs. Будет использован тот же сохранённый образец, который вы выбрали выше; голос ElevenLabs не заменяется.</p>
          </div>
          <div className="rounded-md border border-purple-900/70 bg-purple-950/20 p-3 text-sm text-gray-300">
            <p>Запись будет отправлена Cartesia только после отдельного согласия и нажатия кнопки ниже. Она не отправляется автоматически ни при записи, ни при загрузке страницы.</p>
            <p className="mt-2 text-gray-400">Cartesia принимает образец от 10 до 60 секунд. Если текущий образец длиннее, перезапишите короткий; для наиболее честного сравнения используйте одну и ту же запись при создании обоих голосов.</p>
            <p className="mt-2 text-gray-400">Cartesia разрешает клонирование только на тарифе Pro или выше. Бесплатный тариф позволяет проверять API и синтез речи, но не создавать клон. <a className="text-purple-300 underline" href="https://play.cartesia.ai/subscription" target="_blank" rel="noopener noreferrer">Проверить тариф Cartesia</a></p>
            <p className="mt-2 text-gray-400">Запись iPhone в MP4 перед отправкой преобразуется в WAV прямо в браузере.</p>
            <p className="mt-2 text-gray-400">Образец на русском: при озвучивании английского может сохраниться акцент. Оцените его на слух рядом с ElevenLabs.</p>
          </div>
          {cartesiaError && <div role="alert" className="rounded-md border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">
            <p>Данные клона Cartesia сейчас недоступны. ElevenLabs продолжает работать.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refreshCloneStatus()}>Обновить статус</Button>
          </div>}
          <label className="flex items-start gap-3 text-sm text-gray-300">
            <input type="checkbox" checked={cartesiaConsent} onChange={(event) => setCartesiaConsent(event.target.checked)} className="mt-1 accent-purple-500" />
            <span>Я подтверждаю, что это мой голос или у меня есть разрешение на его использование, и отдельно разрешаю отправить этот образец Cartesia для создания частного клона.</span>
          </label>
          <Button
            disabled={!sample || !cartesiaConsent || cartesiaError !== "" || creatingCartesiaClone || recordingSample || sampleOverLimit ||
              sampleDuration < 10_000 || sampleDuration > 60_000 ||
              Boolean(cartesiaClone && cartesiaClone.status !== "retryable") ||
              (cartesiaAttemptUncertain && !/retryable/i.test(cartesiaClone?.status || ""))}
            onClick={() => void createCartesiaClone()}
            className="bg-purple-700 hover:bg-purple-800"
          >
            {creatingCartesiaClone ? "Создание клона Cartesia…" : cartesiaClone?.status === "ready" ? "Клон Cartesia создан" : "Отправить этот образец в Cartesia"}
          </Button>
          {(!sample || sampleDuration < 10_000 || sampleDuration > 60_000) && (
            <p className="text-sm text-amber-300">Запишите и прослушайте образец длительностью 10–60 секунд, затем установите отдельное согласие. Текущий лимит исходной записи Voice Lab — 3 минуты.</p>
          )}
          {cartesiaClone && <div className="rounded-md border border-gray-700 bg-gray-900/60 p-4 text-sm">
            <p className={cartesiaClone.status === "ready" ? "font-medium text-green-300" : "font-medium text-amber-300"}>Cartesia: {{
              ready: "клон готов", retryable: "запрос отклонён", creating: "создаётся", uncertain: "результат неизвестен",
            }[cartesiaClone.status] || cartesiaClone.status}</p>
            {cartesiaClone.voiceId && <p className="break-all text-gray-300">Voice ID: {cartesiaClone.voiceId}</p>}
            <p className="text-gray-400">Длительность образца: {cartesiaClone.durationMs ? formatDuration(cartesiaClone.durationMs) : "—"}{cartesiaClone.createdAt ? ` · Создан: ${new Date(cartesiaClone.createdAt).toLocaleString()}` : ""}</p>
          </div>}
          {cartesiaAttemptUncertain && <div className="rounded-md border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">
            <p>{cartesiaClone?.status === "retryable"
              ? "Cartesia отклонила запрос. Причиной может быть тариф, лимит аккаунта или формат записи. Не перезаписывайте образец, пока не выяснена причина."
              : "Результат запроса клонирования пока неизвестен. Повторная отправка отключена, чтобы не создавать платный дубликат."}</p>
            {cartesiaFailure && <p className="mt-2 break-words">Ответ: {cartesiaFailure}</p>}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void refreshCloneStatus()}>Обновить статус</Button>
            {statusRefreshError && <p role="alert" className="mt-2 text-red-300">{statusRefreshError}</p>}
          </div>}
          <p className="text-xs text-gray-500">Этот стенд сравнивает озвучивание текста и задержку. Он не отправляет аудио автоматически в живой звонок.</p>
        </CardContent></Card>

        <Card className="bg-gray-800/50 border-gray-700"><CardContent className="p-5 sm:p-6 space-y-4">
          <div><h2 className="text-xl font-semibold">4. Русский → английский</h2>
            <p className="text-sm text-gray-400 mt-1">Нажмите и удерживайте кнопку, произнесите фразу по-русски и отпустите.</p>
          </div>
          <Button
            disabled={working || clone?.status !== "ready"}
            onPointerDown={beginSpeech}
            onPointerUp={endSpeech}
            onPointerCancel={endSpeech}
            onLostPointerCapture={endSpeech}
            className={`w-full sm:w-auto min-w-56 h-14 text-base touch-none ${recordingSpeech ? "bg-red-600 hover:bg-red-700" : "bg-cyan-600 hover:bg-cyan-700"}`}
          >
            {working ? "Обработка…" : recordingSpeech ? "● Идёт запись — отпустите для отправки" : "Удерживайте и говорите"}
          </Button>
          {clone?.status !== "ready" && <p className="text-amber-300 text-sm">Сначала создайте ElevenLabs Voice.</p>}
          {currentRun && <div className="space-y-4 rounded-md bg-gray-900/60 p-4">
            <div><p className="text-xs uppercase tracking-wide text-gray-500">Распознано · русский</p><p className="text-gray-100">{currentRun.transcript}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-gray-500">Перевод · English</p><p className="text-gray-100">{currentRun.english}</p></div>
            <div className="flex flex-wrap gap-2">
            <Button onClick={() => void playRun(currentRun)} disabled={playing} variant="outline">Play ElevenLabs</Button>
            <Button onClick={() => void playCartesiaRun(currentRun)} disabled={playing || cartesiaClone?.status !== "ready"} variant="outline">
              Play Cartesia
            </Button>
              <Button onClick={() => playDefaultVoice(currentRun.english)} variant="outline">Play browser default voice</Button>
            </div>
          {cartesiaClone?.status !== "ready" && <p className="text-sm text-amber-300">Кнопка Cartesia включится после создания отдельного клона в карточке выше. ElevenLabs продолжает работать независимо.</p>}
          {playbackComparison(currentRun)}
            <p className="text-xs text-gray-500">Browser default voice uses this device’s speech engine and may sound different from the iOS default voice.</p>
          </div>}
          {latency && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div className="rounded bg-gray-900/60 p-3"><span className="text-gray-400">Release → transcript</span><p className="text-cyan-300 font-semibold">{intervalLabel(latency.releaseTranscript)}</p></div>
            <div className="rounded bg-gray-900/60 p-3"><span className="text-gray-400">Transcript → English</span><p className="text-cyan-300 font-semibold">{intervalLabel(latency.transcriptEnglish)}</p></div>
            <div className="rounded bg-gray-900/60 p-3"><span className="text-gray-400">English → ElevenLabs request</span><p className="text-cyan-300 font-semibold">{intervalLabel(latency.englishRequest)}</p></div>
            <div className="rounded bg-gray-900/60 p-3"><span className="text-gray-400">Request → first audible audio</span><p className="text-cyan-300 font-semibold">{intervalLabel(latency.requestFirstAudio)}</p></div>
            <div className="rounded bg-gray-900/60 p-3"><span className="text-gray-400">Release → first audible audio</span><p className="text-cyan-300 font-semibold">{intervalLabel(latency.releaseFirstAudio)}</p></div>
          </div>}
          {playbackMode === "buffered" && <p className="text-sm text-amber-300">Потоковое воспроизведение недоступно в этом браузере. Здесь MP3 сначала загружается целиком, поэтому Request → first audible audio включает полное время загрузки; для настоящего потокового воспроизведения нужен браузер с поддержкой MediaSource и audio/mpeg.</p>}
        </CardContent></Card>

        <Card className="bg-gray-800/50 border-gray-700"><CardContent className="p-5 sm:p-6">
          <h2 className="text-xl font-semibold mb-4">Недавние прогоны</h2>
          {runs.length === 0 ? <p className="text-gray-400 text-sm">Сохранённых прогонов пока нет.</p> : <div className="space-y-3">
            {runs.slice(0, 10).map((run) => <div key={run.id} className="border-t border-gray-700 pt-3">
              <p className="text-gray-200">{run.transcript}</p>
              <p className="text-gray-400 text-sm">{run.english}</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>voice_id: {run.voiceId || "—"}</span>
                <span>Play result: {run.playResult || "not played"}</span>
                <span>Release → transcript: {intervalLabel(run.timings.transcriptionComplete - run.timings.micRelease)}</span>
                <span>Transcript → English: {intervalLabel(run.timings.englishReady - run.timings.transcriptionComplete)}</span>
                <span>English → request: {intervalLabel(run.timings.elevenlabsRequest == null ? null : run.timings.elevenlabsRequest - run.timings.englishReady)}</span>
                <span>Request → first audio: {intervalLabel(run.timings.firstAudio == null || run.timings.elevenlabsRequest == null ? null : run.timings.firstAudio - run.timings.elevenlabsRequest)}</span>
                <span>Release → first audio: {intervalLabel(run.timings.firstAudio == null ? null : run.timings.firstAudio - run.timings.micRelease)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => void playRun(run)} disabled={playing}>Play ElevenLabs</Button>
              <Button variant="outline" size="sm" onClick={() => void playCartesiaRun(run)} disabled={playing || cartesiaClone?.status !== "ready"}>Play Cartesia</Button>
                <Button variant="outline" size="sm" onClick={() => playDefaultVoice(run.english)} disabled={playing}>Play browser default voice</Button>
                <span className="text-xs text-gray-500">{run.provider}{run.createdAt ? ` · ${new Date(run.createdAt).toLocaleString()}` : ""}</span>
              </div>
              {playbackComparison(run)}
            </div>)}
          </div>}
        </CardContent></Card>
        {loading && <p className="text-gray-500 text-sm">Обновление…</p>}
      </main>
      <audio ref={audioRef} controls={autoplayBlocked} className={autoplayBlocked ? "w-full max-w-4xl mx-auto px-4 pb-4" : "hidden"} />
    </div>
  );
}