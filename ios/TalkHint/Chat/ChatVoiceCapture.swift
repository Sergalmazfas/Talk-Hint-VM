import AVFoundation
import Foundation

/// One foreground engine for input AND streamed output. No CallKit/Twilio ownership.
/// Voice-processing I/O provides acoustic echo cancellation; real-device validation required.
@MainActor
final class ChatVoiceCapture {
    var onLevel: ((Double) -> Void)?
    var onOutputLevel: ((Double) -> Void)?
    var onSpeechBegan: (() -> Void)?
    var onSpeechEnded: ((Double) -> Void)?
    var onUtterance: ((Data) -> Void)?
    var onError: (() -> Void)?
    var onFirstRender: ((Double, Double) -> Void)?
    var onPlaybackFinished: (() -> Void)?
    var isAllowed: () -> Bool = { false }

    private var engine: AVAudioEngine?
    private let player = AVAudioPlayerNode()
    private let sink = ChatVoiceRecordingSink()
    private var recordingID: UUID?
    private var file: URL?
    private var started = 0.0
    private var lastSpeech = 0.0
    private var heardSpeech = false
    private var previous: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var playRevision = UUID()
    private var queuedBuffers = 0
    private var outputEnded = false
    private var firstRenderTimer: Timer?
    private var safetyTimer: Timer?
    private var renderedFirst = false
    private var scheduledFrames: AVAudioFramePosition = 0
    private var firstAudibleFrame: AVAudioFramePosition?
    var isRecording: Bool { recordingID != nil }
    var isPlaying: Bool { queuedBuffers > 0 }
    private let outputFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!

    private func ensureEngine() throws {
        guard isAllowed(), !CallManager.shared.hasPhoneAudioSession else { throw APIError.decoding }
        if engine?.isRunning == true { return }
        if engine != nil { stop(); throw APIError.decoding }
        let session = AVAudioSession.sharedInstance()
        guard !session.isOtherAudioPlaying, !session.secondaryAudioShouldBeSilencedHint else { throw APIError.decoding }
        previous = (session.category, session.mode, session.categoryOptions)
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
            try session.setActive(true)
            let audio = AVAudioEngine()
            try audio.inputNode.setVoiceProcessingEnabled(true) // fail closed; no false "AEC enabled"
            audio.attach(player)
            audio.connect(player, to: audio.mainMixerNode, format: outputFormat)
            let recorder = sink
            audio.inputNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, when in
                let at = when.isHostTimeValid ? AVAudioTime.seconds(forHostTime: when.hostTime)
                    : ProcessInfo.processInfo.systemUptime
                recorder.append(buffer, at: at) { id, power, time, failed in
                    Task { @MainActor [weak self] in
                        guard let self, id == self.recordingID else { return }
                        if failed { self.stop(); self.onError?() }
                        else { self.sample(power: power, at: time) }
                    }
                }
            }
            engine = audio
            audio.prepare(); try audio.start()
            safetyTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, self.engine != nil else { return }
                    if CallManager.shared.hasPhoneAudioSession || !self.isAllowed() {
                        self.stop(); self.onError?()
                    }
                }
            }
            if let timer = safetyTimer { RunLoop.main.add(timer, forMode: .common) }
        } catch { stop(); throw error }
    }
    func start() throws {
        if isRecording { return }
        try ensureEngine()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("talkhint-chat-voice-\(UUID().uuidString).wav")
        do {
            recordingID = try sink.begin(url: url, format: engine!.inputNode.outputFormat(forBus: 0))
            file = url; heardSpeech = false
            started = ProcessInfo.processInfo.systemUptime; lastSpeech = started
        } catch { stop(); throw error }
    }
    private func sample(power: Float, at: Double) {
        guard isAllowed(), !CallManager.shared.hasPhoneAudioSession else { stop(); onError?(); return }
        guard isRecording else { return }
        onLevel?(min(1, max(0, Double(power + 60) / 60)))
        if power > -38 {
            lastSpeech = at
            if !heardSpeech { heardSpeech = true; onSpeechBegan?() }
        }
        if heardSpeech && ChatVoicePausePolicy.wouldEnd(silence: at - lastSpeech,
            threshold: ChatVoicePausePolicy.currentSeconds) { finish() }
        else if at - started >= 60 {
            if heardSpeech { finish() } else { stop(); onError?() }
        }
    }
    func finish() {
        guard heardSpeech, let url = file else { stop(); onError?(); return }
        let end = lastSpeech
        sink.end(); recordingID = nil; file = nil
        let bytes = try? Data(contentsOf: url)
        try? FileManager.default.removeItem(at: url)
        guard let bytes, !bytes.isEmpty else { onError?(); return }
        onSpeechEnded?(end)
        onUtterance?(bytes)
    }

    /// Raw provider PCM s16le / 24k mono. It is NEVER buffered until a whole answer.
    func play(_ data: Data) throws {
        try ensureEngine()
        guard data.count % 2 == 0, data.count > 0 else { throw APIError.decoding }
        let frames = data.count / 2
        guard let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(frames)),
              let values = buffer.floatChannelData?[0] else { throw APIError.decoding }
        buffer.frameLength = AVAudioFrameCount(frames)
        let current = player.lastRenderTime.flatMap { player.playerTime(forNodeTime: $0) }?.sampleTime ?? 0
        let base = max(scheduledFrames, current)
        var maximum: Float = 0
        for i in 0..<frames {
            let sample = Int16(bitPattern: UInt16(data[i * 2]) | (UInt16(data[i * 2 + 1]) << 8))
            values[i] = Float(sample) / 32768
            maximum = max(maximum, abs(values[i]))
            if firstAudibleFrame == nil && abs(values[i]) > 0.002 {
                firstAudibleFrame = base + AVAudioFramePosition(i)
            }
        }
        scheduledFrames = base + AVAudioFramePosition(frames)
        onOutputLevel?(Double(maximum))
        let revision = playRevision
        queuedBuffers += 1; outputEnded = false
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.playRevision == revision else { return }
                self.queuedBuffers = max(0, self.queuedBuffers - 1)
                if self.queuedBuffers == 0 && self.outputEnded { self.onPlaybackFinished?() }
            }
        }
        if !player.isPlaying { player.play() }
        if !renderedFirst && firstRenderTimer == nil {
            firstRenderTimer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.checkFirstRender() }
            }
            if let timer = firstRenderTimer { RunLoop.main.add(timer, forMode: .common) }
        }
    }
    private func checkFirstRender() {
        guard !renderedFirst, queuedBuffers > 0, let frame = firstAudibleFrame,
              let render = player.lastRenderTime, let time = player.playerTime(forNodeTime: render),
              time.sampleRate > 0, time.sampleTime >= frame else { return }
        renderedFirst = true; firstRenderTimer?.invalidate(); firstRenderTimer = nil
        let first = AVAudioTime.seconds(forHostTime: render.hostTime)
            - Double(time.sampleTime - frame) / time.sampleRate
        onFirstRender?(first, AVAudioSession.sharedInstance().outputLatency)
    }
    func endOutput() {
        outputEnded = true
        if queuedBuffers == 0 { onPlaybackFinished?() }
    }
    func stopPlayback() {
        // Synchronous node.stop clears queued sound BEFORE cancellation/network awaits.
        playRevision = UUID(); player.stop(); queuedBuffers = 0; outputEnded = false
        firstRenderTimer?.invalidate(); firstRenderTimer = nil; renderedFirst = false
        scheduledFrames = 0; firstAudibleFrame = nil
        onOutputLevel?(0)
    }
    func stop() {
        safetyTimer?.invalidate(); safetyTimer = nil
        stopPlayback()
        sink.end(); recordingID = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop(); engine?.detach(player); engine = nil
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        if let previous {
            self.previous = nil
            if !CallManager.shared.hasPhoneAudioSession {
                let session = AVAudioSession.sharedInstance()
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
                try? session.setCategory(previous.0, mode: previous.1, options: previous.2)
            }
        }
        onLevel?(0)
    }
}

/// Serial disk/converter work off the audio callback. No UI/session access here.
private final class ChatVoiceRecordingSink: @unchecked Sendable {
    private let queue = DispatchQueue(label: "talkhint.chat.voice.recording")
    private var file: AVAudioFile?
    private var converter: AVAudioConverter?
    private var id: UUID?
    private let target = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
    func begin(url: URL, format: AVAudioFormat) throws -> UUID {
        try queue.sync {
            file = try AVAudioFile(forWriting: url, settings: [
                AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: 16000,
                AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
            ], commonFormat: .pcmFormatFloat32, interleaved: false)
            guard let newConverter = AVAudioConverter(from: format, to: target) else { throw APIError.decoding }
            converter = newConverter; let next = UUID(); id = next; return next
        }
    }
    func end() { queue.sync { id = nil; file = nil; converter = nil } }
    func append(_ input: AVAudioPCMBuffer, at: Double,
                result: @escaping @Sendable (UUID, Float, Double, Bool) -> Void) {
        guard let copy = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: input.frameLength) else { return }
        copy.frameLength = input.frameLength
        let from = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
        let to = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for index in 0..<min(from.count, to.count) {
            if let source = from[index].mData, let destination = to[index].mData {
                memcpy(destination, source, Int(from[index].mDataByteSize))
            }
        }
        queue.async { [self] in
            guard let id, let file, let converter else { return }
            guard let samples = copy.floatChannelData?[0] else { result(id, -100, at, true); return }
            let count = Int(copy.frameLength)
            guard count > 0 else { return }
            var sum: Float = 0
            for i in 0..<count { sum += samples[i] * samples[i] }
            let power = 20 * log10(max(0.0000001, sqrt(sum / Float(count))))
            let capacity = AVAudioFrameCount(ceil(Double(count) * 16000 / copy.format.sampleRate) + 64)
            guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
            var supplied = false, error: NSError?
            let converted = converter.convert(to: output, error: &error) { _, state in
                if supplied { state.pointee = .noDataNow; return nil }
                supplied = true; state.pointee = .haveData; return copy
            }
            do {
                guard converted != .error, error == nil else { throw APIError.decoding }
                if output.frameLength > 0 { try file.write(from: output) }
                result(id, power, at + Double(count) / copy.format.sampleRate, false)
            } catch { result(id, power, at, true) }
        }
    }
}
