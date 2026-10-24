import AVFoundation

/// Independent playback nodes mix the two parties in real time. A single FIFO
/// would serialize continuous guest frames with Secretary speech and grow lag.
/// No microphone, input-node tap, recording, or phone-call audio ownership.
final class SecretaryAudioPlayer {
    static let shared = SecretaryAudioPlayer()
    let engine = AVAudioEngine()
    private let players = ["guest": AVAudioPlayerNode(), "secretary": AVAudioPlayerNode()]
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 8_000,
                                      channels: 1, interleaved: false)!
    private let lock = NSLock()
    private var pending = [String: Int]()
    private var epochs = [String: Int]()
    private(set) var isReady = false
    var onPlayed: (() -> Void)?
    var channelCount: Int { players.count }

    init() {
        for (index, player) in players.values.enumerated() {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, fromBus: 0,
                           toBus: AVAudioNodeBus(index), format: format)
        }
        engine.mainMixerNode.outputVolume = 1
    }

    func start() -> Bool {
        do {
            if !engine.isRunning { try engine.start() }
            for player in players.values where !player.isPlaying { player.play() }
            isReady = true
            return true
        } catch {
            let failure = error as NSError
            NSLog("[SecretaryAudio] engine failed (%@:%ld)", failure.domain, failure.code)
            isReady = false
            return false
        }
    }

    func enqueue(muLaw: Data, role: String) -> Bool {
        guard isReady, let player = players[role],
              !muLaw.isEmpty, muLaw.count <= 24_000 else { return false }
        lock.lock()
        // A stalled monitor drops only its local old audio, never the call.
        let reset = (pending[role] ?? 0) + muLaw.count > 24_000
        if reset { epochs[role, default: 0] += 1; pending[role] = 0 }
        let epoch = epochs[role, default: 0]
        pending[role, default: 0] += muLaw.count
        lock.unlock()
        if reset { player.stop(); player.play() }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(muLaw.count)),
              let channel = buffer.floatChannelData?[0] else { release(muLaw.count, role: role, epoch: epoch); return false }
        buffer.frameLength = AVAudioFrameCount(muLaw.count)
        for (index, byte) in muLaw.enumerated() {
            channel[index] = Float(Self.decodeMuLaw(byte)) / 32_768
        }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self, self.release(muLaw.count, role: role, epoch: epoch) else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.isReady, self.release(0, role: role, epoch: epoch) else { return }
                self.onPlayed?()
            }
        }
        return true
    }

    @discardableResult
    private func release(_ count: Int, role: String, epoch: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard epochs[role, default: 0] == epoch else { return false }
        pending[role] = max(0, (pending[role] ?? 0) - count)
        return true
    }

    func pause() { stop() }
    func stop() {
        isReady = false
        onPlayed = nil
        lock.lock()
        for role in players.keys { epochs[role, default: 0] += 1 }
        pending.removeAll()
        lock.unlock()
        for player in players.values { player.stop() }
        engine.stop()
    }

    static func decodeMuLaw(_ byte: UInt8) -> Int16 {
        let value = ~byte
        let magnitude = ((Int(value & 0x0f) << 3) + 0x84) << Int((value & 0x70) >> 4)
        return Int16((value & 0x80) != 0 ? 0x84 - magnitude : magnitude - 0x84)
    }
}
