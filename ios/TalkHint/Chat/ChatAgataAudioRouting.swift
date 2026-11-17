import AVFoundation
import OSLog
@preconcurrency import WebRTC

/// WebRTC reapplies webRTCConfiguration when its audio device starts.
/// Changing only the live AVAudioSession before factory creation is not enough.
/// This lease changes that template ONLY for Agata, without owning activation.
@MainActor
final class ChatAgataAudioConfigurationLease {
    private let read: () -> RTCAudioSessionConfiguration
    private let write: (RTCAudioSessionConfiguration) -> Void
    private var previous: RTCAudioSessionConfiguration?
    private var installed: RTCAudioSessionConfiguration?

    init(read: @escaping () -> RTCAudioSessionConfiguration = { RTCAudioSessionConfiguration.webRTC() },
         write: @escaping (RTCAudioSessionConfiguration) -> Void = { RTCAudioSessionConfiguration.setWebRTC($0) }) {
        self.read = read; self.write = write
    }

    static func speakerConfiguration(from source: RTCAudioSessionConfiguration) -> RTCAudioSessionConfiguration {
        // Never mutate WebRTC's previous shared object: it must be restorable.
        let value = RTCAudioSessionConfiguration()
        value.category = AVAudioSession.Category.playAndRecord.rawValue
        value.mode = AVAudioSession.Mode.voiceChat.rawValue
        value.categoryOptions = source.categoryOptions.union(.defaultToSpeaker)
        if #available(iOS 26.0, *) { value.categoryOptions.insert(.allowBluetoothHFP) }
        else { value.categoryOptions.insert(.allowBluetooth) }
        value.sampleRate = source.sampleRate
        value.ioBufferDuration = source.ioBufferDuration
        value.inputNumberOfChannels = source.inputNumberOfChannels
        value.outputNumberOfChannels = source.outputNumberOfChannels
        return value
    }

    func install() {
        guard installed == nil else { return }
        let old = read()
        let value = Self.speakerConfiguration(from: old)
        previous = old; installed = value
        write(value)
    }

    func restore() {
        defer { previous = nil; installed = nil }
        // A newer owner may have replaced the template. Never undo its work.
        guard let previous, let installed, read() === installed else { return }
        write(previous)
    }
}

/// Only bounded technical values. No device names/UIDs, speech, SDP or credentials.
struct ChatAgataAudioSnapshot: Equatable {
    let inputs: String
    let outputs: String
    let category: String
    let mode: String
    let volume: Float
    let defaultToSpeaker: Bool
    let phoneOwnsAudio: Bool

    init(inputs: [AVAudioSession.Port], outputs: [AVAudioSession.Port],
         category: AVAudioSession.Category, mode: AVAudioSession.Mode,
         volume: Float, options: AVAudioSession.CategoryOptions, phoneOwnsAudio: Bool) {
        self.inputs = inputs.prefix(4).map(Self.portLabel).joined(separator: ",")
        self.outputs = outputs.prefix(4).map(Self.portLabel).joined(separator: ",")
        self.category = category == .playAndRecord ? "playAndRecord" : category == .playback ? "playback" : "other"
        self.mode = mode == .voiceChat ? "voiceChat" : mode == .videoChat ? "videoChat" : mode == .default ? "default" : "other"
        self.volume = volume.isFinite ? min(1, max(0, volume)) : 0
        self.defaultToSpeaker = options.contains(.defaultToSpeaker)
        self.phoneOwnsAudio = phoneOwnsAudio
    }

    private static func portLabel(_ port: AVAudioSession.Port) -> String {
        switch port {
        case .builtInSpeaker: return "speaker"
        case .builtInReceiver: return "receiver"
        case .builtInMic: return "builtInMic"
        case .bluetoothHFP: return "bluetoothHFP"
        case .bluetoothA2DP: return "bluetoothA2DP"
        case .bluetoothLE: return "bluetoothLE"
        case .headphones: return "headphones"
        case .headsetMic: return "headsetMic"
        case .carAudio: return "carAudio"
        case .airPlay: return "airPlay"
        case .usbAudio: return "usbAudio"
        case .lineIn: return "lineIn"
        case .lineOut: return "lineOut"
        default: return "other"
        }
    }
}

@MainActor
final class ChatAgataAudioRouting {
    private static let logger = Logger(subsystem: "app.talkhint", category: "AgataAudio")
    private let lease = ChatAgataAudioConfigurationLease()
    private var observer: NSObjectProtocol?
    private var running = false
    private var nextSample: TimeInterval = 0

    func start() {
        guard !running else { return }
        lease.install()
        running = true
        nextSample = 0
        observer = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.intValue ?? 0
            Task { @MainActor [weak self] in
                guard let self, self.running else { return }
                self.record(stage: "route_changed", reason: reason)
            }
        }
        record(stage: "before_device")
    }

    func sample(receivedLevel: Double) {
        guard running else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now >= nextSample else { return }
        nextSample = now + 5
        record(stage: "received_audio", receivedLevel: receivedLevel)
    }

    func stop() {
        guard running else { return }
        running = false
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        record(stage: "stop")
        // Restores the RTC template, not the live session/category of CallKit.
        // No setActive(false), preferred input, output override or gain change.
        lease.restore()
    }

    private func record(stage: String, reason: Int = 0, receivedLevel: Double = 0) {
        let audio = AVAudioSession.sharedInstance()
        let snapshot = ChatAgataAudioSnapshot(inputs: audio.currentRoute.inputs.map(\.portType),
            outputs: audio.currentRoute.outputs.map(\.portType), category: audio.category, mode: audio.mode,
            volume: audio.outputVolume, options: audio.categoryOptions,
            phoneOwnsAudio: CallManager.shared.hasPhoneAudioSession)
        let level = receivedLevel.isFinite ? min(1, max(0, receivedLevel)) : 0
        Self.logger.info("stage=\(stage, privacy: .public) reason=\(reason) inputs=\(snapshot.inputs, privacy: .public) outputs=\(snapshot.outputs, privacy: .public) category=\(snapshot.category, privacy: .public) mode=\(snapshot.mode, privacy: .public) volume=\(snapshot.volume) defaultSpeaker=\(snapshot.defaultToSpeaker) phoneOwnsAudio=\(snapshot.phoneOwnsAudio) receivedRMS=\(level)")
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }
}
