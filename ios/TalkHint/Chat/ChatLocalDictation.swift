import AVFoundation
import Speech

/// An on-device-only recognizer. Unsupported/denied speech permission uses the
/// existing batch recorder. Audio never leaves this object while it is listening.
@MainActor
final class ChatLocalDictation {
    struct Capture { let text: String?; let file: URL }
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var sink: DictationAudioSink?
    private var health: Task<Void, Never>?
    private var lastBufferAt = Date()
    private var startedAt = Date()
    private var lastText = ""
    private var gotFinal = false
    private var finishing = false
    private var healthy = true
    private var running = false
    private(set) var file: URL?
    var onPartial: ((String) -> Void)?
    var onLevel: ((Float) -> Void)?
    var onFallback: (() -> Void)?
    var onStop: (() -> Void)?
    var onCaptureFailure: (() -> Void)?

    static func permitted(locale: Locale) async -> Bool {
        guard let r = SFSpeechRecognizer(locale: locale), r.supportsOnDeviceRecognition else { return false }
        let status = SFSpeechRecognizer.authorizationStatus()
        if status == .authorized { return true }
        guard status == .notDetermined else { return false }
        return await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
    }
    func start(locale: Locale) throws {
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { throw Failure.unavailable }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw Failure.unavailable }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("chat-local-\(UUID()).wav")
        let output = try DictationAudioSink(input: format, request: req, file: url)
        file = url; sink = output; request = req
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            // Pass values to the UI actor, never capture the mutable Speech result.
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal == true
            let failed = error != nil
            Task { @MainActor [weak self] in
                guard let self, self.running || self.finishing else { return }
                if let text { self.lastText = text; self.onPartial?(text) }
                if final && self.finishing { self.gotFinal = true }
                else if failed || final { self.healthy = false; self.onFallback?() }
            }
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            let level = output.append(buffer)
            Task { @MainActor [weak self] in
                guard let self, self.running else { return }
                self.lastBufferAt = Date(); self.onLevel?(level)
            }
        }
        running = true; startedAt = Date(); lastBufferAt = startedAt
        do { engine.prepare(); try engine.start() }
        catch { discard(); throw error }
        health = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self, !Task.isCancelled, self.running else { return }
                let audio = AVAudioSession.sharedInstance()
                if CallManager.shared.hasPhoneAudioSession || audio.isOtherAudioPlaying ||
                    audio.secondaryAudioShouldBeSilencedHint || Date().timeIntervalSince(self.lastBufferAt) > 3 {
                    self.onCaptureFailure?(); return
                }
                if Date().timeIntervalSince(self.startedAt) >= 60 { self.onStop?(); return }
            }
        }
    }
    func finish() async throws -> Capture {
        guard running, let file else { throw Failure.unavailable }
        finishing = true; stopInput()
        request?.endAudio()
        // Only a final result is accepted as the complete utterance. A timeout or
        // recognizer loss keeps the WAV for the existing explicit Stop fallback.
        for _ in 0..<30 {
            if gotFinal || !healthy || Task.isCancelled { break }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        task?.cancel(); task = nil; request = nil; finishing = false
        let saved = sink?.finish() == true; sink = nil
        self.file = nil
        guard saved else { try? FileManager.default.removeItem(at: file); throw Failure.unavailable }
        return Capture(text: healthy && gotFinal && !lastText.isEmpty ? lastText : nil, file: file)
    }
    func discard() {
        finishing = false; stopInput()
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        _ = sink?.finish(); sink = nil
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
    }
    private func stopInput() {
        health?.cancel(); health = nil
        if running { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        running = false
    }
    enum Failure: Error { case unavailable }
}

/// Tap-thread-owned file/converter/request, synchronized with Stop. Only value
/// text/levels cross to the UI actor. The fallback WAV is mono 16 kHz (<4 MB/min).
final class DictationAudioSink: @unchecked Sendable {
    private let lock = NSLock()
    private let converter: AVAudioConverter
    private let format: AVAudioFormat
    private let request: SFSpeechAudioBufferRecognitionRequest
    private var file: AVAudioFile?
    private var failed = false
    init(input: AVAudioFormat, request: SFSpeechAudioBufferRecognitionRequest, file: URL) throws {
        guard let out = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1),
              let converter = AVAudioConverter(from: input, to: out) else { throw ChatLocalDictation.Failure.unavailable }
        self.format = out; self.converter = converter; self.request = request
        self.file = try AVAudioFile(forWriting: file, settings: out.settings)
    }
    func append(_ buffer: AVAudioPCMBuffer) -> Float {
        lock.lock(); defer { lock.unlock() }
        guard let file else { return 0 }
        request.append(buffer)
        var supplied = false
        let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000 / buffer.format.sampleRate)) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { failed = true; return 0 }
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return buffer
        }
        if error != nil { failed = true }
        do { if out.frameLength > 0 { try file.write(from: out) } } catch { failed = true }
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var power: Float = 0
        for i in 0..<Int(buffer.frameLength) { power += samples[i] * samples[i] }
        return min(1, sqrt(power / Float(buffer.frameLength)) * 5)
    }
    func finish() -> Bool {
        lock.lock(); defer { lock.unlock() }
        file = nil
        return !failed
    }
}
