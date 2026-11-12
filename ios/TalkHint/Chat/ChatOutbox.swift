import Foundation

struct ChatSessionScope: Equatable {
    let ownerId: String?
    func permits(currentUserId: String?) -> Bool {
        guard let ownerId else { return false }
        return currentUserId == ownerId
    }
}

struct ChatPendingSend: Codable, Equatable, Identifiable {
    let id: UUID
    let conversationId: String
    let text: String
    let attachmentIds: [String]
    let language: String
    var state: State
    var context: ChatPhoneContext? = nil
    var mode: String? = nil
    enum State: String, Codable { case pending, sending, uncertain, failed }
}

struct ChatComposerDraft: Codable, Equatable {
    var text: String
    var attachments: [ChatAttachment]
}

/// Persisted Chat state is namespaced by owner and API origin. No credentials
/// are stored here. Pending items remain isolated if the owner signs out.
final class ChatOutbox {
    private let defaults: UserDefaults
    private let owner: String
    private let origin: String
    init(owner: String, origin: String = AppConfig.baseURL.absoluteString, defaults: UserDefaults = .standard) {
        self.owner = owner; self.origin = origin; self.defaults = defaults
    }
    private var prefix: String { "talkhint.chat.\(owner).\(originKey)." }
    private var originKey: String { origin.replacingOccurrences(of: ":", with: "_").replacingOccurrences(of: "/", with: "_") }
    private var sendsKey: String { prefix + "outbox" }
    private var selectionKey: String { prefix + "selected" }
    private var conversationRequestKey: String { prefix + "conversation-request" }
    private var draftsKey: String { prefix + "drafts" }
    var composerDrafts: [String: ChatComposerDraft] {
        get {
            guard let data = defaults.data(forKey: draftsKey) else { return [:] }
            return (try? JSONDecoder().decode([String: ChatComposerDraft].self, from: data)) ?? [:]
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            defaults.set(data, forKey: draftsKey)
        }
    }
    var selectedConversationId: String? {
        get { defaults.string(forKey: selectionKey) }
        set { if let newValue { defaults.set(newValue, forKey: selectionKey) } else { defaults.removeObject(forKey: selectionKey) } }
    }
    var pendingSends: [ChatPendingSend] {
        get {
            guard let data = defaults.data(forKey: sendsKey) else { return [] }
            return (try? JSONDecoder().decode([ChatPendingSend].self, from: data)) ?? []
        }
        set {
            guard let data = try? JSONEncoder().encode(newValue) else { return }
            defaults.set(data, forKey: sendsKey)
        }
    }
    func beginConversationRequest() -> UUID {
        if let raw = defaults.string(forKey: conversationRequestKey), let id = UUID(uuidString: raw) { return id }
        let id = UUID()
        defaults.set(id.uuidString.lowercased(), forKey: conversationRequestKey)
        return id
    }
    func finishConversationRequest() { defaults.removeObject(forKey: conversationRequestKey) }
    func enqueue(conversationId: String, text: String, attachmentIds: [String], language: String,
                 requestId: UUID = UUID(), mode: String? = nil) -> ChatPendingSend {
        let send = ChatPendingSend(id: requestId, conversationId: conversationId, text: text,
                                  attachmentIds: attachmentIds, language: language, state: .pending, mode: mode)
        pendingSends.append(send)
        return send
    }
    func remove(_ id: UUID) { pendingSends.removeAll { $0.id == id } }
    func setState(_ state: ChatPendingSend.State, for id: UUID) {
        pendingSends = pendingSends.map { item in
            var updated = item
            if updated.id == id { updated.state = state }
            return updated
        }
    }
    func setContext(_ context: ChatPhoneContext?, for id: UUID) {
        pendingSends = pendingSends.map { item in
            var updated = item
            if updated.id == id { updated.context = context }
            return updated
        }
    }
    func clear() {
        defaults.removeObject(forKey: sendsKey)
        defaults.removeObject(forKey: selectionKey)
        defaults.removeObject(forKey: conversationRequestKey)
        defaults.removeObject(forKey: draftsKey)
    }

    /// Stable merge by server message id and sequence. Polls cannot duplicate rows.
    static func merge(_ current: [ChatMessage], _ incoming: [ChatMessage]) -> [ChatMessage] {
        let acceptedRequestIds = Set(incoming.compactMap(\.clientRequestId).map { $0.lowercased() })
        var indexed = Dictionary(uniqueKeysWithValues: current
            .filter { !acceptedRequestIds.contains($0.id.lowercased()) }
            .map { ($0.id, $0) })
        incoming.forEach { indexed[$0.id] = $0 }
        return indexed.values.sorted { $0.sequence < $1.sequence }
    }
}
