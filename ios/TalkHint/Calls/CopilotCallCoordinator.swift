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
    private var stopped = false
    private weak var screen: CopilotViewController?

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
            if gate.allows(epoch) {
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
                self.device.audioInterrupted()
                self.callbackGate.stop()
                self.gateClosed = true
                self.stream.stop()
            }
        }
    }

    private func requestPrivateGate(_ completion: @escaping (Bool) -> Void) {
        guard !stopped, stream.state == .ready, !gateClosed else {
            completion(false)
            return
        }
        let token = device.closeOwnerUplinkAtFrameBoundary()
        pendingEpoch = token
        gateClosed = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let acknowledged = self?.device.wait(forOwnerUplinkClosed: token, timeout: 0.5) ?? false
            DispatchQueue.main.async {
                guard let self, !self.stopped, self.gateClosed else {
                    completion(false)
                    return
                }
                guard acknowledged else {
                    self.pendingEpoch = 0
                    self.device.openOwnerUplink()
                    self.gateClosed = false
                    self.screen?.gateRestored()
                    completion(false)
                    return
                }
                self.pendingEpoch = 0
                if self.releaseRequested {
                    self.releaseRequested = false
                    self.device.openOwnerUplink()
                    self.gateClosed = false
                    self.screen?.gateRestored()
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
                guard !self.stopped else { return }
                guard drained else {
                    // Leave the device closed and stop the transport; the UI
                    // intentionally remains disabled until the call ends.
                    self.stream.stop()
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
                self.device.openOwnerUplink()
                self.gateClosed = false
                self.screen?.gateRestored()
            }
        }
    }

    func stop() {
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
}