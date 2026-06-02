import Foundation
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
        let callSid: String
        let fromNumber: String
        var twilioCall: Call?
        var answered: Bool
    }

    private var sessions: [UUID: CallSession] = [:]
    private var answerActions: [UUID: CXAnswerCallAction] = [:]

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
        sessions[uuid] = CallSession(uuid: uuid, callSid: callSid, fromNumber: fromNumber, twilioCall: nil, answered: false)

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

    private func endSession(_ uuid: UUID) {
        sessions[uuid] = nil
        answerActions[uuid] = nil
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
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard var session = sessions[action.callUUID] else {
            action.fail()
            return
        }

        // CallKit will activate the audio session; keep it disabled until then.
        audioDevice.isEnabled = false
        answerActions[action.callUUID] = action

        let callSid = session.callSid
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
            // Active call -> hang up the Twilio leg.
            call.disconnect()
        } else if !session.answered {
            // User declined before answering -> reject on the backend.
            let callSid = session.callSid
            Task { try? await APIClient.shared.rejectCall(callSid: callSid) }
        }

        endSession(action.callUUID)
        action.fulfill()
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
