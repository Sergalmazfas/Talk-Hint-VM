import Foundation
import UIKit
import AVFoundation

private final class CopilotCallbackGate {
    private let lock = NSLock()
    private var epoch: UInt64 = 0
    private var stopped = false
    func activate(_ value: UInt64) { lock.lock(); epoch = value; lock.unlock() }
    func allows(_ value: UInt64) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return !stopped && epoch == value
    }
    func allowsPublic(_ value: UInt64) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return !stopped && epoch == 0 && value == 0
    }
    func allowsRemote() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return !stopped
    }
    func stop() { lock.lock(); stopped = true; epoch = 0; lock.unlock() }
}

/// Owns the V1 Copilot stream and the one-way audio gate.  All UI state is
/// main-actor isolated; audio callbacks are deliberately handled off-main.
@MainActor
final class CopilotCallCoordinator {
    private let device: CopilotAudioDevice
    private let callSid: String
    private let stream: CopilotStream
    private let language: String
    private let callbackGate = CopilotCallbackGate()
    private var activeEpoch: UInt64 = 0
    private var pendingEpoch: UInt64 = 0
    private var gateClosed = false
    private var releaseRequested = false
    private var gateFailure = false
    private var restoringEpoch: UInt64 = 0
    private var stopped = false
    private weak var screen: CopilotViewController?
    private var speech: CopilotSpeechOutput?
    private var releasedHoldId: String?
    private var restoredHoldId: String?
    private var pendingReply: (hold: String, response: String, text: String)?
    private var spokenHolds = Set<String>()
    private var speechGeneration = 0
    private struct Timing {
        let press: TimeInterval
        var release: TimeInterval? = nil
        var transcript: TimeInterval? = nil
        var response: TimeInterval? = nil
        var ttsStart: TimeInterval? = nil
        var firstAudio: TimeInterval? = nil
    }
    private var timings: [String: Timing] = [:]
    private func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
    private func mark(_ event: String, hold: String) {
        #if DEBUG
        let t = timings[hold]
        let ms = t.flatMap { $0.release }.map { Int((now() - $0) * 1000) }
        print("[CopilotAutoSpeak] \(event) hold=\(hold.prefix(8)) since_release_ms=\(ms.map { String($0) } ?? "n/a")")
        #endif
    }
    private func logTimings(_ hold: String) {
        #if DEBUG
        guard let t = timings[hold], let release = t.release else { return }
        func ms(_ a: TimeInterval?, _ b: TimeInterval?) -> String {
            guard let a, let b else { return "n/a" }
            return String(Int((b - a) * 1000))
        }
        print("[CopilotAutoSpeak] hold=\(hold.prefix(8)) release_to_transcription_ms=\(ms(release, t.transcript)) transcription_to_response_ms=\(ms(t.transcript, t.response)) response_to_tts_first_audio_ms=\(ms(t.response, t.firstAudio)) release_to_tts_first_audio_ms=\(ms(release, t.firstAudio))")
        #endif
    }

    init(callSid: String, device: CopilotAudioDevice) {
        self.callSid = callSid
        self.device = device
        let configuredLanguage = SessionStore.shared.copilotLanguage.lowercased()
        language = ["ru", "es", "uk", "kk"].contains(configuredLanguage) ? configuredLanguage : "ru"
        let rate = max(1, Int(AVAudioSession.sharedInstance().sampleRate))
        stream = CopilotStream(callSid: callSid, language: language, sampleRateHz: rate)
    }

    func present(callerName: String, from presenter: UIViewController,
                onMute: @escaping () -> Void,
                onSpeaker: @escaping (Bool) -> Void,
                onEnd: @escaping () -> Void) {
        installCallbacks()
        let viewController = CopilotViewController(callSid: callSid,
                                                    language: language, stream: stream)
        screen = viewController
        viewController.requestPrivateGate = { [weak self] completion in
            self?.requestPrivateGate(completion)
        }
        viewController.onReleaseHold = { [weak self] holdId in
            self?.releasePrivateGate(holdId: holdId)
        }
        viewController.onPressHold = { [weak self] holdId in
            guard let self else { return }
            self.releasedHoldId = nil
            self.restoredHoldId = nil
            self.pendingReply = nil
            self.timings[holdId] = Timing(press: self.now())
            self.mark("copilot_press", hold: holdId)
        }
        stream.onPrivateSourceComplete = { [weak self] holdId in
            guard let self, var timing = self.timings[holdId], timing.transcript == nil else { return }
            timing.transcript = self.now()
            self.timings[holdId] = timing
            self.mark("transcription_complete", hold: holdId)
        }
        stream.onPrivateFinal = { [weak self] holdId, responseId, text in
            guard let self, !self.stopped, !self.gateFailure,
                  self.timings[holdId] != nil, !self.spokenHolds.contains(holdId) else { return }
            var timing = self.timings[holdId]!
            timing.response = self.now()
            self.timings[holdId] = timing
            self.mark("copilot_response_complete", hold: holdId)
            self.pendingReply = (holdId, responseId, text)
            self.maybeSpeak()
        }
        viewController.onStreamFailed = { [weak self] in self?.cancelSpeech() }
        speech = CopilotSpeechOutput(device: device)
        viewController.onMute = onMute
        viewController.onSpeaker = onSpeaker
        viewController.onEnd = onEnd
        presenter.present(viewController, animated: true)
    }

    private func installCallbacks() {
        let transport = stream
        let gate = callbackGate
        device.capturedPCM = { bytes, count, _, _, epoch in
            let copy = Data(bytes: bytes, count: Int(count))
            if gate.allowsPublic(epoch) {
                transport.sendAudio(pcm16Base64: copy.base64EncodedString(), direction: "owner")
            } else if epoch != 0 && gate.allows(epoch) {
                transport.sendAudio(pcm16Base64: copy.base64EncodedString(), direction: "private")
            }
        }
        device.remotePCM = { bytes, count, _, _, _ in
            let copy = Data(bytes: bytes, count: Int(count))
            if gate.allowsRemote() {
                transport.sendAudio(pcm16Base64: copy.base64EncodedString(), direction: "guest")
            }
        }
        device.formatDidChange = { [weak self] format in
            // Any route/format change invalidates the negotiated stream
            // contract. Fail closed rather than silently changing rate.
            Task { @MainActor [weak self] in
                guard let self else { return }
                _ = format
                self.failClosed()
            }
        }
    }

    private func requestPrivateGate(_ completion: @escaping (Bool) -> Void) {
        guard !stopped, !gateFailure, stream.state == .ready, !gateClosed else {
            completion(false)
            return
        }
        guard device.isEnabled else {
            failClosed()
            completion(false)
            return
        }
        let token = device.closeOwnerUplinkAtFrameBoundary()
        pendingEpoch = token
        gateClosed = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let acknowledged = self?.device.wait(forOwnerUplinkClosed: token, timeout: 0.5) ?? false
            DispatchQueue.main.async {
                guard let self, !self.stopped, !self.gateFailure,
                      self.gateClosed, self.pendingEpoch == token else {
                    completion(false)
                    return
                }
                guard acknowledged else {
                    self.failClosed()
                    completion(false)
                    return
                }
                // The closed-frame ACK ensures a capture callback can no
                // longer expose the microphone when speech replacement stops.
                self.cancelSpeech()
                self.pendingEpoch = 0
                if self.releaseRequested {
                    self.releaseRequested = false
                    self.restoreUplink(after: token)
                    completion(false)
                    return
                }
                self.activeEpoch = token
                self.callbackGate.activate(token)
                completion(true)
            }
        }
    }

    private func releasePrivateGate(holdId: String?) {
        guard !stopped, !gateFailure else { return }
        if let holdId, var timing = timings[holdId], timing.release == nil {
            timing.release = now()
            timings[holdId] = timing
            releasedHoldId = holdId
            mark("copilot_release", hold: holdId)
        }
        let epoch = activeEpoch
        if epoch == 0 {
            if pendingEpoch == 0 && !gateClosed { return }
            // The UI can release before the frame-boundary ACK arrives.
            // Keep the uplink closed until that worker observes the request.
            releaseRequested = true
            return
        }
        // Drain before reopening, so no private frame can race into the public
        // uplink after the user's hold ends.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            self.device.finishPrivateCapture(atFrameBoundary: epoch)
            let drained = self.device.wait(forPrivateDrain: epoch, timeout: 0.5)
            DispatchQueue.main.async {
                guard !self.stopped, !self.gateFailure else { return }
                guard drained else {
                    // An unacknowledged finish fence cannot safely reopen.
                    self.failClosed()
                    return
                }
                // Keep activeEpoch set until all callback-delivered frames
                // have been queued. hold_end must follow that tail.
                if let holdId {
                    self.stream.holdEnd(holdId: holdId)
                }
                self.callbackGate.activate(0)
                self.activeEpoch = 0
                self.releaseRequested = false
                self.restoreUplink(after: epoch)
            }
        }
    }

    private func restoreUplink(after epoch: UInt64) {
        guard !stopped, !gateFailure, gateClosed else { return }
        restoringEpoch = epoch
        guard device.openOwnerUplink() else {
            failClosed()
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let opened = self?.device.wait(forOwnerUplinkOpen: epoch, timeout: 0.5) ?? false
            DispatchQueue.main.async {
                guard let self, !self.stopped, !self.gateFailure,
                      self.restoringEpoch == epoch else { return }
                guard opened else {
                    self.failClosed()
                    return
                }
                self.restoringEpoch = 0
                self.gateClosed = false
                self.screen?.gateRestored()
                if let hold = self.releasedHoldId {
                    self.restoredHoldId = hold
                    self.maybeSpeak()
                }
            }
        }
    }

    private func failClosed() {
        guard !stopped, !gateFailure else { return }
        cancelSpeech()
        gateFailure = true
        gateClosed = true
        restoringEpoch = 0
        device.audioInterrupted()
        callbackGate.stop()
        stream.stop()
        screen?.gateFailed()
    }

    func stop() {
        cancelSpeech()
        stopped = true
        activeEpoch = 0
        pendingEpoch = 0
        releaseRequested = false
        callbackGate.stop()
        // Never reopen on end: Twilio may still be disconnecting. The next
        // call prepares the shared device only after this call is gone.
        device.capturedPCM = nil
        device.remotePCM = nil
        device.formatDidChange = nil
        stream.stop()
        screen?.dismiss(animated: true)
        screen = nil
    }

    private func maybeSpeak() {
        guard let reply = pendingReply, let releasedHoldId,
              reply.hold == releasedHoldId, restoredHoldId == releasedHoldId,
              !stopped, !gateFailure, !gateClosed, !spokenHolds.contains(reply.hold),
              stream.state == .ready, let speech else { return }
        spokenHolds.insert(reply.hold)
        pendingReply = nil
        // CallKit/Twilio mute suppresses even injected capture audio. Never
        // report a spoken reply when the Guest cannot receive it.
        if CallManager.shared.isMuted {
            mark("tts_muted", hold: reply.hold)
            screen?.speechFailed()
            timings.removeValue(forKey: reply.hold)
            return
        }
        let generation = speechGeneration
        var timing = timings[reply.hold]!
        timing.ttsStart = now()
        timings[reply.hold] = timing
        mark("tts_request_start", hold: reply.hold)
        speech.speak(reply.text, firstAudio: { [weak self] in
            guard let self, !self.stopped, self.speechGeneration == generation,
                  var timing = self.timings[reply.hold] else { return }
            timing.firstAudio = self.now()
            self.timings[reply.hold] = timing
            self.mark("tts_first_audio", hold: reply.hold)
            self.logTimings(reply.hold)
        }, completion: { [weak self] success in
            guard let self, !self.stopped, self.speechGeneration == generation else { return }
            let delivered = success && !CallManager.shared.isMuted
            self.mark(delivered ? "tts_playback_complete" : "tts_failed", hold: reply.hold)
            if !delivered { self.screen?.speechFailed() }
            self.timings.removeValue(forKey: reply.hold)
        })
    }

    private func cancelSpeech() {
        speechGeneration += 1
        speech?.cancel()
    }
}