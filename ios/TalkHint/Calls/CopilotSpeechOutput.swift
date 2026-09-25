import AVFoundation
import Foundation

private let copilotMaximumPCM16Samples = 5_760_000

/// All mutable synthesis samples are confined to the per-utterance serial queue.
private final class CopilotSpeechPCMAccumulator: @unchecked Sendable {
    var samples: [Int16] = []
    var sourceRate: Double?
    var conversionFailed = false
    private let reservationLock = NSLock()
    private var reservedSamples = 0

    // Buffers are copied before they are queued, so reserve their space first
    // to keep queued plus collected synthesis memory within the same bound.
    func reserve(_ count: Int) -> Bool {
        reservationLock.lock()
        defer { reservationLock.unlock() }
        guard count >= 0, reservedSamples <= copilotMaximumPCM16Samples - count else {
            return false
        }
        reservedSamples += count
        return true
    }
}

/// Copies the ephemeral AVSpeechSynthesizer buffer into owned PCM synchronously
/// inside its callback. This is deliberately off the audio realtime path.
private func copilotPCM16Samples(from pcm: AVAudioPCMBuffer) -> [Int16]? {
    let frames = Int(pcm.frameLength)
    guard frames > 0 else { return [] }
    guard frames <= copilotMaximumPCM16Samples else { return nil }
    let channels = Int(pcm.format.channelCount)
    guard channels > 0 else { return nil }
    // The channel-data access below assumes planar samples. Fail explicitly
    // rather than misreading interleaved multi-channel AVAudioBuffer storage.
    if channels > 1 && pcm.format.isInterleaved { return nil }

    var samples: [Int16] = []
    samples.reserveCapacity(frames)
    for frame in 0..<frames {
        var sum: Double = 0
        switch pcm.format.commonFormat {
        case .pcmFormatFloat32:
            guard let data = pcm.floatChannelData else { return nil }
            for channel in 0..<channels { sum += Double(data[channel][frame]) }
        case .pcmFormatInt16:
            guard let data = pcm.int16ChannelData else { return nil }
            for channel in 0..<channels { sum += Double(data[channel][frame]) / 32768.0 }
        case .pcmFormatInt32:
            guard let data = pcm.int32ChannelData else { return nil }
            for channel in 0..<channels { sum += Double(data[channel][frame]) / 2147483648.0 }
        default:
            return nil
        }
        let mono = max(-1.0, min(1.0, sum / Double(channels)))
        samples.append(Int16(mono * 32767.0))
    }
    return samples
}

/// Synthesizes the whole utterance before it is submitted to Twilio. Audio
/// conversion happens on a worker queue; the device's realtime callback only
/// copies already-converted PCM samples.
@MainActor
final class CopilotSpeechOutput {
    private let device: CopilotAudioDevice
    private let synthesizer = AVSpeechSynthesizer()
    private var generation: UInt64 = 0
    private var activeCompletion: ((Bool) -> Void)?
    private var synthesisTimeout: Task<Void, Never>?
    private var playbackWatchdog: Task<Void, Never>?

    init(device: CopilotAudioDevice) {
        self.device = device
    }

    func speak(_ text: String, firstAudio: @escaping () -> Void, completion: @escaping (Bool) -> Void) {
        cancel()
        generation &+= 1
        let attempt = generation
        activeCompletion = completion

        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let voice = AVSpeechSynthesisVoice(language: "en-US") else {
            failSynthesis(attempt)
            return
        }

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        // write has no synthesis error result; an empty stream or unsupported
        // PCM format is treated as failure before any audio is sent.
        let collector = DispatchQueue(label: "app.talkhint.copilot-speech-pcm")
        let accumulator = CopilotSpeechPCMAccumulator()

        // Bound attempts even if AVSpeechSynthesizer never calls its buffer
        // callback. Invalidating the generation prevents a late callback from
        // starting playback after this timeout.
        synthesisTimeout = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(nanoseconds: 60_000_000_000)
            } catch {
                return
            }
            guard let self, self.generation == attempt else { return }
            self.failSynthesis(attempt)
        }

        synthesizer.write(utterance) { [weak self] buffer in
            guard let pcm = buffer as? AVAudioPCMBuffer else {
                collector.async {
                    accumulator.conversionFailed = true
                    Task { @MainActor [weak self] in self?.failSynthesis(attempt) }
                }
                return
            }

            // The PCM buffer is valid only for this callback. Convert/copy it
            // now; the serial collector receives only owned Swift samples.
            let frames = Int(pcm.frameLength)
            let rate = pcm.format.sampleRate
            let copiedSamples = copilotPCM16Samples(from: pcm)
            let withinMemoryBound = frames == 0 ||
                (copiedSamples.map { accumulator.reserve($0.count) } ?? false)
            collector.async {
                guard !accumulator.conversionFailed else { return }
                guard rate.isFinite, rate > 0,
                      accumulator.sourceRate == nil || abs(accumulator.sourceRate! - rate) < 1,
                      let copiedSamples, withinMemoryBound else {
                    accumulator.conversionFailed = true
                    Task { @MainActor [weak self] in self?.failSynthesis(attempt) }
                    return
                }

                if frames == 0 {
                    let output = accumulator.samples
                    let finalRate = accumulator.sourceRate
                    let failed = output.isEmpty || finalRate == nil
                    Task { @MainActor [weak self] in
                        guard let self, self.generation == attempt else { return }
                        self.synthesisTimeout?.cancel()
                        self.synthesisTimeout = nil
                        guard !failed, let finalRate else {
                            self.failSynthesis(attempt)
                            return
                        }
                        let data = output.withUnsafeBufferPointer {
                            Data(bytes: $0.baseAddress!, count: $0.count * MemoryLayout<Int16>.size)
                        }
                        guard self.device.startCopilotPlayback(data, sampleRate: finalRate,
                                                               firstAudio: {
                            Task { @MainActor [weak self] in
                                guard let self, self.generation == attempt else { return }
                                firstAudio()
                            }
                        }, completion: { [weak self] succeeded in
                            Task { @MainActor [weak self] in
                                self?.finish(attempt, success: succeeded)
                            }
                        }) else {
                            self.finish(attempt, success: false)
                            return
                        }
                        // The device's capture callback normally completes this
                        // attempt. Bound the rare case where that callback
                        // stops arriving without a lifecycle stop notification.
                        let expectedDuration = Double(output.count) / finalRate
                        let watchdogDelay = min(180.0, expectedDuration + 10.0)
                        self.playbackWatchdog = Task { @MainActor [weak self] in
                            do {
                                try await Task.sleep(
                                    nanoseconds: UInt64(watchdogDelay * 1_000_000_000)
                                )
                            } catch {
                                return
                            }
                            guard let self, self.generation == attempt else { return }
                            self.device.stopCopilotPlayback()
                            self.finish(attempt, success: false)
                        }
                    }
                    return
                }

                // Bound memory before accumulating; the device separately
                // enforces its post-resampling two-minute limit.
                guard accumulator.samples.count <=
                        copilotMaximumPCM16Samples - copiedSamples.count else {
                    accumulator.conversionFailed = true
                    Task { @MainActor [weak self] in self?.failSynthesis(attempt) }
                    return
                }
                accumulator.sourceRate = rate
                accumulator.samples.append(contentsOf: copiedSamples)
            }
        }
    }

    func cancel() {
        generation &+= 1
        synthesisTimeout?.cancel()
        synthesisTimeout = nil
        playbackWatchdog?.cancel()
        playbackWatchdog = nil
        synthesizer.stopSpeaking(at: .immediate)
        device.stopCopilotPlayback()
        let callback = activeCompletion
        activeCompletion = nil
        callback?(false)
    }

    private func failSynthesis(_ attempt: UInt64) {
        guard generation == attempt else { return }
        synthesizer.stopSpeaking(at: .immediate)
        finish(attempt, success: false)
    }

    private func finish(_ attempt: UInt64, success: Bool) {
        guard generation == attempt else { return }
        synthesisTimeout?.cancel()
        synthesisTimeout = nil
        playbackWatchdog?.cancel()
        playbackWatchdog = nil
        // Invalidate pending first-audio work when playback/synthesis fails.
        if !success { generation &+= 1 }
        let callback = activeCompletion
        activeCompletion = nil
        callback?(success)
    }
}