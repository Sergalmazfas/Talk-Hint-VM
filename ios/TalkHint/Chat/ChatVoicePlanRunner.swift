import Foundation

/// Runs ONLY after a native explicit approval. Reuses the signed review, outgoing
/// configuration and durable request identity used by the ordinary review screen.
/// No model tool invokes this object.
@MainActor
final class ChatVoicePlanRunner {
    private let api: APIClient
    private var draft: SessionStore.SecretaryCallDraft?
    init(api: APIClient) { self.api = api }

    func reconcileCreatedTask() {
        // Only clear the ambiguous draft owned by THIS runner, never another flow's draft.
        if let draft, draft.ownerId == SessionStore.shared.userId,
           SessionStore.shared.pendingSecretaryCall?.clientRequestId == draft.clientRequestId {
            SessionStore.shared.clearPendingSecretaryCall()
            self.draft = nil
        }
    }

    func start(_ review: ChatPlanConfirmation.Review, valid: () -> Bool) async throws -> APIClient.SecretaryTask {
        let store = SessionStore.shared
        guard valid(), !CallManager.shared.hasPhoneAudioSession else { throw APIError.decoding }
        if draft == nil {
            // Never replace a previous ambiguous launch (the existing recovery flow owns it).
            guard store.pendingSecretaryCall == nil else { throw APIError.decoding }
            let owner = store.userId
            let provider = store.secretaryVoiceProvider
            var next = SessionStore.SecretaryCallDraft(instruction: review.instruction,
                confirmationToken: review.confirmationToken, clientRequestId: UUID(),
                voiceProvider: provider, phoneNumber: review.phoneNumber, requestAttempted: true)
            next.ownerId = owner; next.environmentOrigin = AppConfig.baseURL.absoluteString
            if provider == .retell {
                let savedNumber = store.secretaryOutgoingNumberId
                let context = try await api.secretaryPersonalityContext()
                guard let number = savedNumber ?? context.defaultOutgoing.flatMap({ $0.provider == "retell" ? $0.numberId : nil }),
                      let line = context.numbers.first(where: { $0.id == number }) else {
                    throw SecretaryOutgoingSetupUnavailable()
                }
                let setup = try await api.secretaryOutgoingSetup(numberId: number)
                guard valid(), store.userId == owner, store.secretaryOutgoingNumberId == savedNumber,
                      setup.scope == line.type, !setup.engine.isEmpty, !setup.reasoning.isEmpty else {
                    throw SecretaryOutgoingSetupUnavailable()
                }
                next.secretaryNumberId = number
                next.secretaryBackendOrigin = AppConfig.baseURL.absoluteString
            }
            guard valid(), store.userId == owner, store.secretaryVoiceProvider == provider,
                  store.savePendingSecretaryCall(next) else { throw APIError.decoding }
            draft = next
        }
        guard let draft, valid(), !CallManager.shared.hasPhoneAudioSession, draft.ownerId == store.userId,
              draft.environmentOrigin == AppConfig.baseURL.absoluteString,
              draft.instruction == review.instruction, draft.phoneNumber == review.phoneNumber else {
            throw APIError.decoding
        }
        // The SAME request is retried after ambiguous transport failure, never a new call.
        let task = try await api.createSecretaryTask(phoneNumber: review.phoneNumber,
            instruction: draft.instruction, confirmationToken: draft.confirmationToken,
            voiceProvider: draft.voiceProvider, live: true, clientRequestId: draft.clientRequestId,
            secretaryNumberId: draft.secretaryNumberId, secretaryBackendOrigin: draft.secretaryBackendOrigin)
        if store.userId == draft.ownerId { store.clearPendingSecretaryCall() }
        self.draft = nil
        return task
    }
}
