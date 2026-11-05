/** Local energy detector, not recording and not a music/speaker classifier.
 * Only booleans leave the browser; no audio samples or extra model calls. */
export async function watchWaitingMicrophone(stream: MediaStream,
  publish: (active: boolean) => Promise<unknown>) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser); // Deliberately NOT connected to speakers.
  let stopped = false, pending = false, timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true; clearInterval(timer); source.disconnect();
    stream.getTracks().forEach(t => t.stop()); void context.close();
  };
  try {
    await context.resume();
    if (context.state !== "running") throw Error("Не удалось запустить анализ звуковой активности стенда.");
    const data = new Float32Array(analyser.fftSize);
    let active = false;
    // Observe every 100ms; send a union of recent activity once per second.
    let ticks = 0;
    timer = setInterval(() => {
      if (stopped || context.state !== "running") return;
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
      active ||= rms >= 0.003;
      if (++ticks % 10 || pending) return;
      const value = active; active = false; pending = true;
      void publish(value).catch(() => {
        // Missing/stale signals suppress probes server-side; never infer silence.
      }).finally(() => { pending = false; });
    }, 100);
    return stop;
  } catch (e) { stop(); throw e; }
}
