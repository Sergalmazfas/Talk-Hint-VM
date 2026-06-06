import Foundation
import UIKit
import CallKit
import AVFoundation
import TwilioVoice

/// Owns the CallKit provider and the Twilio Voice connection for iOS calls.
///
/// Flow (Path A — Engine sends the VoIP push, app connects outbound into a
/// Twilio conference):
///   1. VoIP push arrives -> `reportIncomingCall` shows the native call UI.
///   2. User answers -> `POST /api/call/accept {clientType:"ios"}` returns the
///      conference name, then `GET /api/token` returns a Twilio access token,
///      then `TwilioVoiceSDK.connect(params: ["conferenceRoom": ...])` joins.
///   3. User declines -> `POST /api/call/reject`.
@MainActor
final class CallManager: NSObject {
    static let shared = CallManager()

    private let provider: CXProvider
    private let callController = CXCallController()
    private let audioDevice = DefaultAudioDevice()

    private struct CallSession {
        let uuid: UUID
        let callSid: String?      // nil for outgoing calls (Twilio assigns the SID)
        let remoteLabel: String
        var twilioCall: Call?
        var answered: Bool
        let isOutgoing: Bool
    }

    private var sessions: [UUID: CallSession] = [:]
    private var answerActions: [UUID: CXAnswerCallAction] = [:]
    private var inCallScreen: InCallViewController?

    private override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic, .phoneNumber]
        provider = CXProvider(configuration: config)

        super.init()

        provider.setDelegate(self, queue: nil)
        // Let CallKit own the audio session lifecycle.
        TwilioVoiceSDK.audioDevice = audioDevice
    }

    /// Must be called from the PushKit `didReceiveIncomingPush` handler. iOS 13+
    /// requires a call to be reported for every received VoIP push, and the
    /// PushKit completion handler must run only after `reportNewIncomingCall`.
    func reportIncomingCall(callSid: String, fromNumber: String, completion: @escaping () -> Void) {
        let uuid = UUID()
        sessions[uuid] = CallSession(uuid: uuid, callSid: callSid, remoteLabel: fromNumber, twilioCall: nil, answered: false, isOutgoing: false)

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: fromNumber)
        update.localizedCallerName = fromNumber
        update.hasVideo = false
        update.supportsDTMF = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false

        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil {
                self?.sessions[uuid] = nil
            }
            completion()
        }
    }

    /// Reports and immediately ends a placeholder call. Used when a VoIP push is
    /// malformed or arrives while logged out — iOS still requires a reported call.
    func reportAndImmediatelyEnd(completion: @escaping () -> Void) {
        let uuid = UUID()
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: "TalkHint")
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] _ in
            self?.provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
            completion()
        }
    }

    /// Places an outbound call to a typed phone number, reusing the existing
    /// Twilio token + TwiML voice flow — no second calling path.
    ///
    /// Flow (client-initiated, mirrors the incoming path):
    ///   1. `CXStartCallAction` shows the native outgoing-call UI.
    ///   2. `GET /api/token` returns a Twilio access token, then
    ///      `TwilioVoiceSDK.connect(params: ["To": number])` dials. The backend
    ///      `/twilio/voice` handler dials the number with the user's caller ID,
    ///      starts the transcription media stream and registers this user as the
    ///      call owner so the `/ui` hint feed is routed back to them.
    ///   3. On connect the live assistant screen opens (`presentInCallScreen`).
    ///
    /// `number` must be E.164 (leading "+"), which the backend requires to route
    /// the outbound dial.
    func startOutgoingCall(to number: String) {
        let uuid = UUID()
        sessions[uuid] = CallSession(uuid: uuid, callSid: nil, remoteLabel: number,
                                     twilioCall: nil, answered: false, isOutgoing: true)

        let handle = CXHandle(type: .phoneNumber, value: number)
        let startAction = CXStartCallAction(call: uuid, handle: handle)
        let transaction = CXTransaction(action: startAction)
        callController.request(transaction) { [weak self] error in
            guard let error = error else { return }
            print("[CallManager] startOutgoingCall request failed: \(error.localizedDescription)")
            Task { @MainActor in self?.sessions[uuid] = nil }
        }
    }

    /// Ends the currently active call by requesting a `CXEndCallAction` through
    /// CallKit, so the existing `CXEndCallAction` handler runs and the audio
    /// session / Twilio leg are released correctly. Called by the in-call
    /// assistant screen's End Call button — never tear down the screen directly.
    func endCall() {
        // Prefer a connected call; fall back to any tracked session.
        let uuid = sessions.first(where: { $0.value.twilioCall != nil })?.key
            ?? sessions.keys.first
        guard let callUUID = uuid else { return }

        let endAction = CXEndCallAction(call: callUUID)
        let transaction = CXTransaction(action: endAction)
        callController.request(transaction) { error in
            if let error = error {
                print("[CallManager] endCall request failed: \(error.localizedDescription)")
            }
        }
    }

    private func endSession(_ uuid: UUID) {
        sessions[uuid] = nil
        answerActions[uuid] = nil
        tearDownInCallScreen()
    }

    // MARK: - Mute

    /// The active Twilio call, if any (prefers a connected leg).
    private var activeCall: Call? {
        sessions.first(where: { $0.value.twilioCall != nil })?.value.twilioCall
    }

    /// The UUID of the active (connected) call, used to drive CallKit mute
    /// transactions. Falls back to any tracked session.
    private var activeCallUUID: UUID? {
        sessions.first(where: { $0.value.twilioCall != nil })?.key ?? sessions.keys.first
    }

    /// Whether the active call's microphone is currently muted. Returns false
    /// when there is no active call.
    var isMuted: Bool {
        activeCall?.isMuted ?? false
    }

    /// Requests the active call be (un)muted through CallKit so the native call
    /// UI stays the single source of truth. The Twilio leg is muted in the
    /// `CXSetMutedCallAction` handler, which then refreshes the in-call screen.
    /// No-op when there is no active call.
    func setMuted(_ muted: Bool) {
        guard let uuid = activeCallUUID else { return }
        let action = CXSetMutedCallAction(call: uuid, muted: muted)
        let transaction = CXTransaction(action: action)
        callController.request(transaction) { error in
            if let error = error {
                print("[CallManager] setMuted request failed: \(error.localizedDescription)")
            }
        }
    }

    /// Toggles the active call's microphone via CallKit. No-op when there is no
    /// active call.
    func toggleMute() {
        setMuted(!isMuted)
    }

    // MARK: - In-call assistant screen

    /// Presents the live transcript/hint screen once a call connects.
    private func presentInCallScreen(for uuid: UUID) {
        guard inCallScreen == nil, let session = sessions[uuid] else { return }
        guard let top = Self.topViewController() else { return }
        let screen = InCallViewController(callerName: session.remoteLabel)
        inCallScreen = screen
        top.present(screen, animated: true)
    }

    /// Closes the live assistant screen when the call ends.
    private func tearDownInCallScreen() {
        guard let screen = inCallScreen else { return }
        inCallScreen = nil
        screen.teardown()
    }

    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
            ?? scene?.windows.first?.rootViewController else { return nil }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
}

// MARK: - CXProviderDelegate

extension CallManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        for session in sessions.values {
            session.twilioCall?.disconnect()
        }
        sessions.removeAll()
        answerActions.removeAll()
        audioDevice.isEnabled = false
        tearDownInCallScreen()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        guard var session = sessions[action.callUUID] else {
            action.fail()
            return
        }

        // CallKit will activate the audio session; keep it disabled until then.
        audioDevice.isEnabled = false
        let uuid = action.callUUID
        let number = session.remoteLabel

        provider.reportOutgoingCall(with: uuid, startedConnectingAt: Date())

        Task { @MainActor in
            do {
                let accessToken = try await APIClient.shared.fetchTwilioAccessToken()

                // The call may have been canceled (CXEndCallAction) while we
                // awaited the token. If so, the session is gone — abort instead
                // of resurrecting it / connecting a ghost Twilio call. Safe
                // because @MainActor means no interleaving past this point.
                guard self.sessions[uuid] != nil else {
                    action.fail()
                    return
                }

                let connectOptions = ConnectOptions(accessToken: accessToken) { builder in
                    builder.params = ["To": number]
                    builder.uuid = uuid
                }
                let call = TwilioVoiceSDK.connect(options: connectOptions, delegate: self)

                session.twilioCall = call
                session.answered = true
                self.sessions[uuid] = session
                action.fulfill()
                // callDidConnect reports the connected time and opens the screen.
            } catch {
                action.fail()
                self.provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
                self.endSession(uuid)
            }
        }
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard var session = sessions[action.callUUID] else {
            action.fail()
            return
        }

        // CallKit will activate the audio session; keep it disabled until then.
        audioDevice.isEnabled = false
        answerActions[action.callUUID] = action

        guard let callSid = session.callSid else {
            // Incoming calls always carry a callSid; bail safely if missing.
            answerActions[action.callUUID] = nil
            action.fail()
            return
        }
        let uuid = action.callUUID

        Task { @MainActor in
            do {
                let conference = try await APIClient.shared.acceptCall(callSid: callSid)
                let accessToken = try await APIClient.shared.fetchTwilioAccessToken()

                let connectOptions = ConnectOptions(accessToken: accessToken) { builder in
                    builder.params = ["conferenceRoom": conference]
                    builder.uuid = uuid
                }
                let call = TwilioVoiceSDK.connect(options: connectOptions, delegate: self)

                session.twilioCall = call
                session.answered = true
                self.sessions[uuid] = session
                // action.fulfill() is called from callDidConnect.
            } catch {
                self.answerActions[uuid] = nil
                action.fail()
                self.provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
                self.endSession(uuid)
            }
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard let session = sessions[action.callUUID] else {
            action.fulfill()
            return
        }

        if let call = session.twilioCall {
            // Active call (incoming or outgoing) -> hang up the Twilio leg.
            call.disconnect()
        } else if !session.answered, !session.isOutgoing, let callSid = session.callSid {
            // User declined an incoming call before answering -> reject on the backend.
            Task { try? await APIClient.shared.rejectCall(callSid: callSid) }
        }

        endSession(action.callUUID)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        // Fires for both our own setMuted() requests and external mute changes
        // (native CallKit UI, accessory buttons). Apply to the Twilio leg and
        // refresh the in-call screen so its button never drifts from the call.
        sessions[action.callUUID]?.twilioCall?.isMuted = action.isMuted
        action.fulfill()
        inCallScreen?.refreshMuteButton()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        audioDevice.isEnabled = true
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        audioDevice.isEnabled = false
    }
}

// MARK: - Twilio CallDelegate

extension CallManager: CallDelegate {
    func callDidConnect(call: Call) {
        guard let uuid = call.uuid else { return }
        answerActions[uuid]?.fulfill()
        answerActions[uuid] = nil
        if sessions[uuid]?.isOutgoing == true {
            provider.reportOutgoingCall(with: uuid, connectedAt: Date())
        }
        presentInCallScreen(for: uuid)
    }

    func callDidFailToConnect(call: Call, error: Error) {
        guard let uuid = call.uuid else { return }
        answerActions[uuid]?.fail()
        answerActions[uuid] = nil
        provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
        endSession(uuid)
    }

    func callDidDisconnect(call: Call, error: Error?) {
        guard let uuid = call.uuid else { return }
        let reason: CXCallEndedReason = (error == nil) ? .remoteEnded : .failed
        provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
        endSession(uuid)
    }
}
