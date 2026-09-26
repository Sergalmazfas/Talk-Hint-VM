import AVFoundation
import Foundation

private let cloneSpeechMaximumBytes = 8 * 1024 * 1024
private let cloneSpeechMaximumDuration: Double = 120

private struct CopilotDecodedSpeech {
    let pcm16: Data
    let sampleRate: Double
}

enum CopilotCloneSpeechOutcome: Equatable {
    case success
    case failed
    case retryableFailure
    case cloneNotReady
    case cancelled
}

/// Downloads and decodes the cloned response away from the Twilio audio
/// callback, then submits only prepared PCM to the call's audio device.
@MainActor
final class CopilotCloneSpeechOutput {
    private let device: CopilotAudioDevice
    private var generation: UInt64 = 0
    private var requestTask: Task<Void, Never>?
    private var playbackWatchdog: Task<Void, Never>?
    private var activeCompletion: ((CopilotCloneSpeechOutcome) -> Void)?
    private var activeReplyKey: (holdId: String, responseId: String)?
    private var cachedReply: (holdId: String, responseId: String, audio: CopilotDecodedSpeech)?

    init(device: CopilotAudioDevice) {
        self.device = device
    }

    func play(callSid: String, holdId: String, responseId: String, text: String,
              completion: @escaping (CopilotCloneSpeechOutcome) -> Void) {
        cancel()
        generation &+= 1
        let attempt = generation
        activeCompletion = completion
        activeReplyKey = (holdId, responseId)
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            finish(attempt, outcome: .failed)
            return
        }
        if let cachedReply, cachedReply.holdId == holdId, cachedReply.responseId == responseId {
            startPlayback(cachedReply.audio, attempt: attempt)
            return
        }
        requestTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let mp3 = try await APIClient.shared.copilotCloneSpeech(
                    callSid: callSid, holdId: holdId, responseId: responseId, text: text)
                guard self.generation == attempt, !Task.isCancelled else { return }
                guard mp3.count <= cloneSpeechMaximumBytes else {
                    self.finish(attempt, outcome: .failed)
                    return
                }
                let decoded = try await Task.detached(priority: .userInitiated) {
                    try Self.decodeMP3(mp3)
                }.value
                guard self.generation == attempt, !Task.isCancelled else { return }
                self.cachedReply = (holdId, responseId, decoded)
                self.startPlayback(decoded, attempt: attempt)
            } catch {
                guard self.generation == attempt else { return }
                if let apiError = error as? APIError, case .http(409, _) = apiError {
                    self.finish(attempt, outcome: .cloneNotReady)
                } else {
                    self.finish(attempt, outcome: .failed)
                }
            }
        }
    }

    func discardCachedReply() {
        cachedReply = nil
    }

    func cancel() {
        generation &+= 1
        requestTask?.cancel()
        requestTask = nil
        playbackWatchdog?.cancel()
        playbackWatchdog = nil
        device.stopCopilotPlayback()
        let completion = activeCompletion
        let retryFromCache = activeReplyKey.flatMap { key in
            cachedReply.map { $0.holdId == key.holdId && $0.responseId == key.responseId }
        } ?? false
        activeCompletion = nil
        activeReplyKey = nil
        completion?(retryFromCache ? .cancelled : .failed)
    }

    private func startPlayback(_ audio: CopilotDecodedSpeech, attempt: UInt64) {
        guard device.startCopilotPlayback(audio.pcm16,
                                          sampleRate: audio.sampleRate,
                                          firstAudio: {},
                                          completion: { [weak self] succeeded in
            Task { @MainActor [weak self] in
                self?.finish(attempt, outcome: succeeded ? .success : .retryableFailure)
            }
        }) else {
            finish(attempt, outcome: .retryableFailure)
            return
        }
        let frames = audio.pcm16.count / MemoryLayout<Int16>.size
        let duration = Double(frames) / audio.sampleRate
        playbackWatchdog = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(nanoseconds: UInt64((duration + 10) * 1_000_000_000))
            } catch {
                return
            }
            guard let self, self.generation == attempt else { return }
            self.device.stopCopilotPlayback()
            self.finish(attempt, outcome: .retryableFailure)
        }
    }

    private func finish(_ attempt: UInt64, outcome: CopilotCloneSpeechOutcome) {
        guard generation == attempt else { return }
        requestTask = nil
        playbackWatchdog?.cancel()
        playbackWatchdog = nil
        if outcome != .success { generation &+= 1 }
        let completion = activeCompletion
        activeCompletion = nil
        activeReplyKey = nil
        completion?(outcome)
    }

    nonisolated private static func decodeMP3(_ data: Data) throws -> CopilotDecodedSpeech {
        guard !data.isEmpty, data.count <= cloneSpeechMaximumBytes else {
            throw APIError.decoding
        }
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("copilot-clone-\(UUID().uuidString).mp3")
        defer { try? FileManager.default.removeItem(at: fileURL) }
        try data.write(to: fileURL, options: .atomic)

        let file = try AVAudioFile(forReading: fileURL)
        let format = file.processingFormat
        let sampleRate = format.sampleRate
        let duration = Double(file.length) / sampleRate
        guard sampleRate.isFinite, sampleRate > 0,
              format.channelCount > 0, duration.isFinite,
              duration > 0, duration <= cloneSpeechMaximumDuration else {
            throw APIError.decoding
        }
        let maximumSamples = 5_760_000
        var output = [Int16]()
        guard file.length <= Int64(Int.max) else { throw APIError.decoding }
        output.reserveCapacity(min(Int(file.length), maximumSamples))
        let chunkFrames: AVAudioFrameCount = 4096
        while file.framePosition < file.length {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunkFrames) else {
                throw APIError.decoding
            }
            try file.read(into: buffer, frameCount: chunkFrames)
            let frames = Int(buffer.frameLength)
            guard frames > 0 else { break }
            guard frames <= maximumSamples,
                  output.count <= maximumSamples - frames else { throw APIError.decoding }
            let channels = Int(format.channelCount)
            if channels > 1 && format.isInterleaved { throw APIError.decoding }
            for frame in 0..<frames {
                var sum = 0.0
                switch format.commonFormat {
                case .pcmFormatFloat32:
                    guard let channelsData = buffer.floatChannelData else { throw APIError.decoding }
                    for channel in 0..<channels { sum += Double(channelsData[channel][frame]) }
                case .pcmFormatInt16:
                    guard let channelsData = buffer.int16ChannelData else { throw APIError.decoding }
                    for channel in 0..<channels { sum += Double(channelsData[channel][frame]) / 32768 }
                case .pcmFormatInt32:
                    guard let channelsData = buffer.int32ChannelData else { throw APIError.decoding }
                    for channel in 0..<channels { sum += Double(channelsData[channel][frame]) / 2147483648 }
                default:
                    throw APIError.decoding
                }
                guard sum.isFinite else { throw APIError.decoding }
                let mono = max(-1.0, min(1.0, sum / Double(channels)))
                output.append(Int16(mono * 32767))
            }
        }
        guard !output.isEmpty else { throw APIError.decoding }
        let pcm = output.withUnsafeBufferPointer {
            Data(bytes: $0.baseAddress!, count: $0.count * MemoryLayout<Int16>.size)
        }
        return CopilotDecodedSpeech(pcm16: pcm, sampleRate: sampleRate)
    }
}