import Foundation
import AVFoundation
import UIKit

@MainActor
final class ChatAudioOwnership {
    static let shared = ChatAudioOwnership()
    enum Owner: Equatable { case phone, agata, readAloud, dictation }
    private var agataLease: UUID?
    private var dictationLease: UUID?
    private var playback: (() -> Void)?
    var owner: Owner? {
        if CallManager.shared.hasPhoneAudioSession { return .phone }
        if agataLease != nil { return .agata }
        if dictationLease != nil { return .dictation }
        return playback == nil ? nil : .readAloud
    }
    func beginAgata() -> UUID? {
        guard !CallManager.shared.hasPhoneAudioSession, agataLease == nil, dictationLease == nil else { return nil }
        playback?()
        let lease = UUID(); agataLease = lease
        return lease
    }
    func endAgata(_ lease: UUID?) {
        if let lease, agataLease == lease { agataLease = nil }
    }
    func beginDictation() -> UUID? {
        guard !CallManager.shared.hasPhoneAudioSession, agataLease == nil, dictationLease == nil else { return nil }
        playback?()
        let lease = UUID(); dictationLease = lease
        return lease
    }
    func endDictation(_ lease: UUID?) {
        if let lease, dictationLease == lease { dictationLease = nil }
    }
    func interruptPlayback() { playback?() }
    func claimPlayback(stop: @escaping () -> Void) -> Bool {
        guard owner == nil else { return false }
        playback = stop
        return true
    }
    func releasePlayback() { playback = nil }
}

struct ChatReadAloudManifest: Decodable {
    struct Segment: Decodable { let offset: Int; let length: Int }
    let revision: Int
    let offsetEncoding: String
    let textHash: String
    let segments: [Segment]
    func validate(text: String) throws {
        let units = Array(text.utf16)
        guard revision == 1, offsetEncoding == "utf-16", !segments.isEmpty else { throw APIError.decoding }
        var end = 0
        for s in segments {
            guard s.offset == end, s.length > 0, s.length <= 600,
                  s.offset <= units.count - s.length else { throw APIError.decoding }
            end = s.offset + s.length
            guard end == units.count || !(0xDC00...0xDFFF).contains(units[end]) else { throw APIError.decoding }
        }
        guard end == units.count else { throw APIError.decoding }
    }
}

/// Playback only. No microphone, ChatVoiceCapture, STT or implicit paid retries.
@MainActor
final class ChatReadAloudPlayer {
    private let api: APIClient
    private let valid: () -> Bool
    private var task: Task<Void, Never>?
    private var player: AVAudioPlayer?
    private var generation = UUID()
    private(set) var messageId: String?
    var onChange: (() -> Void)?
    var onError: ((Error) -> Void)?
    private var previous: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var observers: [NSObjectProtocol] = []
    init(api: APIClient, valid: @escaping () -> Bool) {
        self.api = api; self.valid = valid
        for name in [AVAudioSession.interruptionNotification, UIApplication.didEnterBackgroundNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.stop() }
            })
        }
    }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }
    func play(_ message: ChatMessage) {
        if messageId == message.id { stop(); return }
        stop()
        guard valid(), message.role == "assistant", message.status == "complete",
              ChatAudioOwnership.shared.claimPlayback(stop: { [weak self] in self?.stop() }) else {
            onError?(APIError.http(409, "AUDIO_BUSY")); return
        }
        messageId = message.id
        let epoch = UUID(); generation = epoch
        onChange?()
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let base = "/api/chat-v1/conversations/\(message.conversationId)/messages/\(message.id)/read-aloud"
                try self.check(epoch)
                let data = try await self.api.request(base, method: "GET", json: nil, authenticated: true)
                let manifest = try JSONDecoder().decode(ChatReadAloudManifest.self, from: data)
                try manifest.validate(text: message.text)
                let playbackId = UUID().uuidString.lowercased()
                for segment in manifest.segments {
                    try self.check(epoch)
                    let pcm = try await self.api.chatBinary(base, method: "POST",
                        body: ["requestId": UUID().uuidString.lowercased(), "playbackId": playbackId,
                               "offset": segment.offset, "length": segment.length], audio: true)
                    try self.check(epoch)
                    let session = AVAudioSession.sharedInstance()
                    if self.previous == nil {
                        self.previous = (session.category, session.mode, session.categoryOptions)
                        try session.setCategory(.playback, mode: .spokenAudio)
                        try session.setActive(true)
                    }
                    self.player = try AVAudioPlayer(data: Self.wav(pcm))
                    guard self.player?.play() == true else { throw APIError.decoding }
                    while self.player?.isPlaying == true {
                        try self.check(epoch)
                        try await Task.sleep(nanoseconds: 50_000_000)
                    }
                }
                if self.generation == epoch { self.stop() }
            } catch {
                guard self.generation == epoch else { return }
                self.stop()
                if !(error is CancellationError) { self.onError?(error) }
            }
        }
    }
    private func check(_ epoch: UUID) throws {
        guard epoch == generation, valid(), !Task.isCancelled,
              ChatAudioOwnership.shared.owner == .readAloud else { throw CancellationError() }
    }
    func stop() {
        generation = UUID(); task?.cancel(); task = nil
        player?.stop(); player = nil
        let owned = messageId != nil
        messageId = nil
        if owned {
            ChatAudioOwnership.shared.releasePlayback()
            // Never deactivate/reconfigure a newly started phone/Retell session.
            if ChatAudioOwnership.shared.owner == nil, let previous {
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                try? AVAudioSession.sharedInstance().setCategory(previous.0, mode: previous.1, options: previous.2)
            }
        }
        previous = nil
        if owned { onChange?() }
    }
    static func wav(_ pcm: Data) throws -> Data {
        guard !pcm.isEmpty, pcm.count % 2 == 0, pcm.count < Int(UInt32.max) - 36 else { throw APIError.decoding }
        var data = Data("RIFF".utf8)
        func u32(_ n: UInt32) { var v = n.littleEndian; data.append(Data(bytes: &v, count: 4)) }
        func u16(_ n: UInt16) { var v = n.littleEndian; data.append(Data(bytes: &v, count: 2)) }
        u32(UInt32(pcm.count) + 36); data.append(Data("WAVEfmt ".utf8))
        u32(16); u16(1); u16(1); u32(24_000); u32(48_000); u16(2); u16(16)
        data.append(Data("data".utf8)); u32(UInt32(pcm.count)); data.append(pcm)
        return data
    }
}

final class ChatNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
