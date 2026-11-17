import AVFoundation
@preconcurrency import WebRTC

/// Audio-only WebRTC. No Twilio/CallKit device, STT or TTS is used here.
@MainActor
final class ChatAgataPeer {
    private static let ssl: Void = { _ = RTCInitializeSSL() }()
    private var factory: RTCPeerConnectionFactory?
    private var connection: RTCPeerConnection?
    private var channel: RTCDataChannel?
    private var track: RTCAudioTrack?
    private var previousEnergy = 0.0
    private var previousDuration = 0.0
    private var disconnected: Task<Void, Never>?
    var onFailure: (() -> Void)?
    var onLevels: ((Double, Double) -> Void)?
    private lazy var delegate = AgataPeerDelegate { [weak self] failed, lost in
        Task { @MainActor in
            guard let self, self.connection != nil else { return }
            self.disconnected?.cancel()
            if failed { self.onFailure?() }
            else if lost {
                self.disconnected = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 7_000_000_000)
                    guard !Task.isCancelled else { return }
                    self?.onFailure?()
                }
            }
        }
    }

    func offer(ice: [ChatAgataTicket.IceServer]) async throws -> String {
        guard !CallManager.shared.hasPhoneAudioSession else { throw APIError.decoding }
        _ = Self.ssl
        let audio = RTCAudioSession.sharedInstance()
        audio.lockForConfiguration()
        do {
            var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
            if #available(iOS 26.0, *) { options.insert(.allowBluetoothHFP) }
            else { options.insert(.allowBluetooth) }
            try audio.setCategory(AVAudioSession.Category.playAndRecord.rawValue, with: options)
            try audio.setMode(AVAudioSession.Mode.voiceChat.rawValue)
            // WebRTC owns activation/deactivation. A second manual activation
            // would leak its activation counter or later deactivate CallKit.
            audio.unlockForConfiguration()
        } catch { audio.unlockForConfiguration(); throw error }
        // Category/mode are settled BEFORE WebRTC creates its audio device.
        factory = RTCPeerConnectionFactory()
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        config.iceServers = ice.map { RTCIceServer(urlStrings: $0.urls,
            username: $0.username ?? "", credential: $0.credential ?? "") }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let factory, let pc = factory.peerConnection(with: config, constraints: constraints, delegate: delegate) else {
            throw APIError.decoding
        }
        connection = pc
        let source = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: [
            "googEchoCancellation": "true", "googNoiseSuppression": "true"
        ], optionalConstraints: nil))
        track = factory.audioTrack(with: source, trackId: "agata-microphone")
        track?.isEnabled = false // No speech before authenticated joined acknowledgement.
        if let track { _ = pc.add(track, streamIds: ["agata"]) }
        channel = pc.dataChannel(forLabel: "control", configuration: RTCDataChannelConfiguration())
        let offer: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
            pc.offer(for: RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true"],
                                             optionalConstraints: nil)) { sdp, error in
                if let error { continuation.resume(throwing: error) }
                else if let sdp { continuation.resume(returning: sdp) }
                else { continuation.resume(throwing: APIError.decoding) }
            }
        }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            pc.setLocalDescription(offer) { e in
                if let e { c.resume(throwing: e) } else { c.resume() }
            }
        }
        // Non-trickle initial offer: the same gateway contract already exercised in Dev.
        for _ in 0..<80 {
            try Task.checkCancellation()
            if pc.iceGatheringState == .complete { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard connection === pc, pc.iceGatheringState == .complete,
              let sdp = pc.localDescription?.sdp else { throw APIError.decoding }
        return sdp
    }

    func answer(_ sdp: String) async throws {
        guard let pc = connection else { throw APIError.decoding }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { e in
                if let e { c.resume(throwing: e) } else { c.resume() }
            }
        }
        for _ in 0..<120 {
            try Task.checkCancellation()
            guard connection === pc else { throw CancellationError() }
            if pc.iceConnectionState == .connected || pc.iceConnectionState == .completed { return }
            if pc.iceConnectionState == .failed || pc.iceConnectionState == .closed { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw APIError.decoding
    }
    func microphone(_ enabled: Bool) { track?.isEnabled = enabled }

    func measureAudio() {
        connection?.statistics { [weak self] report in
            var energy = 0.0, duration = 0.0, input = 0.0
            for stat in report.statistics.values {
                if stat.type == "inbound-rtp", stat.values["kind"] as? String == "audio" {
                    energy += (stat.values["totalAudioEnergy"] as? NSNumber)?.doubleValue ?? 0
                    duration += (stat.values["totalSamplesDuration"] as? NSNumber)?.doubleValue ?? 0
                } else if stat.type == "media-source", stat.values["kind"] as? String == "audio" {
                    input = (stat.values["audioLevel"] as? NSNumber)?.doubleValue ?? 0
                }
            }
            let values = (energy, duration, input)
            Task { @MainActor [weak self] in self?.measured(values) }
        }
    }
    private func measured(_ v: (Double, Double, Double)) {
        guard connection != nil else { return }
        let dt = v.1 - previousDuration, de = v.0 - previousEnergy
        previousEnergy = v.0; previousDuration = v.1
        let output = dt > 0 && de >= 0 ? sqrt(de / dt) : 0
        onLevels?(v.2.isFinite ? v.2 : 0, output.isFinite ? output : 0)
    }
    func close() {
        disconnected?.cancel(); disconnected = nil
        track?.isEnabled = false
        channel?.close(); channel = nil
        connection?.close(); connection = nil
        track = nil; factory = nil
        // No application-level setActive(false): do not deactivate CallKit.
    }
}

/// RTC callbacks stay off the UI actor; only a value crosses to the main actor.
private final class AgataPeerDelegate: NSObject, RTCPeerConnectionDelegate {
    let changed: @Sendable (Bool, Bool) -> Void
    init(_ changed: @escaping @Sendable (Bool, Bool) -> Void) { self.changed = changed }
    func peerConnection(_ p: RTCPeerConnection, didChange s: RTCSignalingState) {}
    func peerConnection(_ p: RTCPeerConnection, didAdd s: RTCMediaStream) {}
    func peerConnection(_ p: RTCPeerConnection, didRemove s: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ p: RTCPeerConnection) {}
    func peerConnection(_ p: RTCPeerConnection, didChange s: RTCIceConnectionState) {
        if s == .failed { changed(true, false) }
        else if s == .disconnected { changed(false, true) }
        else if s == .connected || s == .completed { changed(false, false) }
    }
    func peerConnection(_ p: RTCPeerConnection, didChange s: RTCIceGatheringState) {}
    func peerConnection(_ p: RTCPeerConnection, didGenerate c: RTCIceCandidate) {}
    func peerConnection(_ p: RTCPeerConnection, didRemove c: [RTCIceCandidate]) {}
    func peerConnection(_ p: RTCPeerConnection, didOpen d: RTCDataChannel) {}
}
