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
    private var cloneSpeech: CopilotCloneSpeechOutput?
    private var releasedHoldId: String?
    private var restoredHoldId: String?
    private var pendingReply: (hold: String, response: String, text: String)?
    private var currentHoldId: String?
    private var visibleReply: (hold: String, response: String, text: String)?
    private var cloneRequestActive = false
    private var shownReplyHoldId: String?

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
            self.currentHoldId = holdId
            self.visibleReply = nil
            self.cloneRequestActive = false
            self.cloneSpeech?.cancel()
            self.cloneSpeech?.discardCachedReply()
            self.screen?.clearVerifiedReply()
        }
        stream.onPrivateFinal = { [weak self] holdId, responseId, text in
            guard let self, !self.stopped, !self.gateFailure,
                  self.currentHoldId == holdId, self.shownReplyHoldId != holdId,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            self.pendingReply = (holdId, responseId, text)
            self.maybeShowVerifiedReply()
        }
        viewController.onStreamFailed = { [weak self] in self?.cloneSpeech?.cancel() }
        cloneSpeech = CopilotCloneSpeechOutput(device: device)
        viewController.onCloneSpeechTapped = { [weak self] holdId, responseId in
            self?.playVerifiedReply(holdId: holdId, responseId: responseId)
        }
        viewController.onMute = { [weak self] in
            onMute()
            if CallManager.shared.isMuted { self?.cloneSpeech?.cancel() }
        }
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
                self.cloneSpeech?.cancel()
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
        if let holdId, holdId == currentHoldId {
            releasedHoldId = holdId
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
                if let hold = self.releasedHoldId { self.restoredHoldId = hold }
                self.maybeShowVerifiedReply()
            }
        }
    }

    private func failClosed() {
        guard !stopped, !gateFailure else { return }
        gateFailure = true
        gateClosed = true
        restoringEpoch = 0
        visibleReply = nil
        cloneSpeech?.cancel()
        cloneSpeech?.discardCachedReply()
        device.audioInterrupted()
        callbackGate.stop()
        stream.stop()
        screen?.clearVerifiedReply()
        screen?.gateFailed()
    }

    func stop() {
        stopped = true
        visibleReply = nil
        cloneSpeech?.cancel()
        cloneSpeech?.discardCachedReply()
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

    private func maybeShowVerifiedReply() {
        guard let reply = pendingReply, let releasedHoldId,
              reply.hold == releasedHoldId, restoredHoldId == releasedHoldId,
              !stopped, !gateFailure, !gateClosed, stream.state == .ready else { return }
        pendingReply = nil
        visibleReply = reply
        shownReplyHoldId = reply.hold
        screen?.showVerifiedReply(text: reply.text, holdId: reply.hold, responseId: reply.response)
    }

    private func playVerifiedReply(holdId: String, responseId: String) {
        guard let reply = visibleReply, reply.hold == holdId,
              reply.response == responseId, !cloneRequestActive,
              !stopped, !gateFailure, !gateClosed,
              restoredHoldId == holdId, releasedHoldId == holdId,
              stream.state == .ready, !CallManager.shared.isMuted,
              let cloneSpeech else {
            screen?.speechFailed()
            return
        }
        cloneRequestActive = true
        screen?.cloneSpeechStarted()
        cloneSpeech.play(callSid: callSid, holdId: reply.hold,
                         responseId: reply.response, text: reply.text) { [weak self] outcome in
            guard let self, !self.stopped,
                  self.visibleReply?.hold == holdId,
                  self.visibleReply?.response == responseId else { return }
            self.cloneRequestActive = false
            if CallManager.shared.isMuted, outcome == .success {
                self.screen?.cloneSpeechFinished(outcome: .cancelled)
            } else {
                self.screen?.cloneSpeechFinished(outcome: outcome)
            }
        }
    }
}