import Foundation

struct ChatCapabilities: Decodable {
    struct AI: Decodable { let available: Bool; let model: String? }
    struct Attachments: Decodable { let available: Bool; let mimeTypes: [String]; let maxBytes: Int }
    struct Voice: Decodable { let available: Bool }
    let ai: AI
    let attachments: Attachments
    let voice: Voice
}

struct ChatConversation: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    let createdAt: String
    var updatedAt: String
}

struct CallPlanExpectedQuestion: Codable, Equatable {
    let q: String
    let answer: String?

    private enum CodingKeys: String, CodingKey { case q, answer }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        q = try container.decode(String.self, forKey: .q)
        answer = try container.decodeIfPresent(String.self, forKey: .answer)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(q, forKey: .q)
        try container.encode(answer, forKey: .answer)
    }
}

struct ChatCallPlan: Codable, Equatable {
    let goal: String
    let ownerFacts: [String]
    let sayAsk: [String]
    let expectedQuestions: [CallPlanExpectedQuestion]
    let unknowns: [String]
    let disclosurePolicy: DisclosurePolicy
    let language: String
    let executor: String
    let targetPhone: String?
    let voicemail: String?

    struct DisclosurePolicy: Codable, Equatable {
        let allowed: [String]
        let forbidden: [String]
    }
}

struct ChatMessageAction: Codable, Equatable {
    struct Result: Codable, Equatable {
        let id: String?
        let status: String?
        let expiresAt: String?
        var taskId: String? = nil

        init(id: String? = nil, status: String? = nil, expiresAt: String? = nil) {
            self.id = id
            self.status = status
            self.expiresAt = expiresAt
        }
    }

    let plan: ChatCallPlan
    let planHash: String
    var status: String
    var result: Result?

    init(plan: ChatCallPlan, planHash: String, status: String, result: Result? = nil) {
        self.plan = plan
        self.planHash = planHash
        self.status = status
        self.result = result
    }
}

struct ChatMessage: Codable, Identifiable, Equatable {
    struct Event: Codable, Equatable {
        let kind: String
        let sourcePath: String
        let taskId: String
    }
    let id: String
    let conversationId: String
    let sequence: Int
    let role: String
    var text: String
    var status: String
    let clientRequestId: String?
    let attachmentIds: [String]
    let createdAt: String
    let errorCode: String?
    var action: ChatMessageAction?
    var event: Event? = nil

    init(id: String, conversationId: String, sequence: Int, role: String, text: String, status: String,
         clientRequestId: String?, attachmentIds: [String], createdAt: String, errorCode: String?,
         action: ChatMessageAction? = nil) {
        self.id = id
        self.conversationId = conversationId
        self.sequence = sequence
        self.role = role
        self.text = text
        self.status = status
        self.clientRequestId = clientRequestId
        self.attachmentIds = attachmentIds
        self.createdAt = createdAt
        self.errorCode = errorCode
        self.action = action
    }
}

struct ChatPlanConfirmation: Decodable {
    struct Review: Decodable {
        let phoneNumber: String
        let instruction: String
        let confirmationToken: String
    }
    let message: ChatMessage
    let dialed: Bool
    let review: Review?
}

struct ChatAttachment: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let mimeType: String
    let size: Int
    var status: String
}

struct ChatMessagePair: Decodable {
    let message: ChatMessage
    let reply: ChatMessage?
}

extension APIClient {
    func chatCapabilities() async throws -> ChatCapabilities {
        let data = try await request("/api/chat-v1/capabilities", method: "GET", json: nil, authenticated: true)
        return try JSONDecoder().decode(ChatCapabilities.self, from: data)
    }

    func chatConversations() async throws -> [ChatConversation] {
        let data = try await request("/api/chat-v1/conversations", method: "GET", json: nil, authenticated: true)
        return try JSONDecoder().decode(ConversationPage.self, from: data).conversations
    }

    func createChatConversation(requestId: UUID, title: String? = nil) async throws -> ChatConversation {
        var body: [String: Any] = ["clientRequestId": requestId.uuidString.lowercased()]
        if let title, !title.isEmpty { body["title"] = title }
        let data = try await request("/api/chat-v1/conversations", method: "POST", json: body, authenticated: true)
        let result = try JSONDecoder().decode([String: ChatConversation].self, from: data)
        guard let conversation = result["conversation"] else { throw APIError.decoding }
        return conversation
    }

    func chatMessages(conversationId: String, beforeSequence: Int? = nil) async throws -> (messages: [ChatMessage], hasMore: Bool) {
        var query: [URLQueryItem] = []
        if let beforeSequence { query.append(URLQueryItem(name: "beforeSequence", value: String(beforeSequence))) }
        let data = try await request("/api/chat-v1/conversations/\(conversationId)/messages",
                                     method: "GET", json: nil, authenticated: true, queryItems: query)
        let result = try JSONDecoder().decode(MessagePage.self, from: data)
        return (result.messages, result.hasMore)
    }

    func sendChatMessage(conversationId: String, requestId: UUID, text: String,
                         attachmentIds: [String], language: String, context: ChatPhoneContext? = nil) async throws -> ChatMessagePair {
        var body: [String: Any] = ["clientRequestId": requestId.uuidString.lowercased(), "text": text,
                                   "attachmentIds": attachmentIds, "language": language]
        if let context {
            body["context"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(context))
        }
        let data = try await request("/api/chat-v1/conversations/\(conversationId)/messages",
                                     method: "POST", json: body, authenticated: true)
        return try JSONDecoder().decode(ChatMessagePair.self, from: data)
    }
    func chatResultDetails(path: String) async throws -> String {
        // Only same-origin authenticated endpoints built by this server.
        guard path.hasPrefix("/api/secretary/tasks/") || path.hasPrefix("/api/chat-v1/conversations/"),
              !path.contains(".."), !path.contains("://") else { throw APIError.decoding }
        let data = try await request(path, method: "GET", json: nil, authenticated: true)
        guard let json = try? JSONSerialization.jsonObject(with: data),
              let formatted = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: formatted, encoding: .utf8) else { throw APIError.decoding }
        return text
    }
    func saveChatFollowup(conversationId: String, taskId: String, text: String) async throws {
        _ = try await request("/api/chat-v1/conversations/\(conversationId)/followups", method: "POST",
                              json: ["taskId": taskId, "text": text], authenticated: true)
    }

    func chatMessage(conversationId: String, messageId: String) async throws -> ChatMessage {
        let data = try await request("/api/chat-v1/conversations/\(conversationId)/messages/\(messageId)",
                                     method: "GET", json: nil, authenticated: true)
        let result = try JSONDecoder().decode([String: ChatMessage].self, from: data)
        guard let message = result["message"] else { throw APIError.decoding }
        return message
    }

    func confirmChatPlan(conversationId: String, messageId: String, planHash: String) async throws -> ChatPlanConfirmation {
        let data = try await request("/api/chat-v1/conversations/\(conversationId)/messages/\(messageId)/confirm-plan",
                                     method: "POST", json: ["planHash": planHash], authenticated: true)
        return try JSONDecoder().decode(ChatPlanConfirmation.self, from: data)
    }

    func uploadChatAttachment(requestId: UUID, name: String, mimeType: String, data fileData: Data) async throws -> ChatAttachment {
        let body: [String: Any] = ["clientRequestId": requestId.uuidString.lowercased(), "name": name,
                                   "mimeType": mimeType, "dataBase64": fileData.base64EncodedString()]
        let data = try await request("/api/chat-v1/attachments", method: "POST", json: body, authenticated: true)
        let result = try JSONDecoder().decode([String: ChatAttachment].self, from: data)
        guard let attachment = result["attachment"] else { throw APIError.decoding }
        return attachment
    }

    func downloadChatAttachment(id: String) async throws -> Data {
        try await request("/api/chat-v1/attachments/\(id)", method: "GET", json: nil, authenticated: true)
    }

    func chatAttachmentInfo(id: String) async throws -> ChatAttachment {
        let data = try await request("/api/chat-v1/attachments/\(id)/info", method: "GET", json: nil, authenticated: true)
        return try JSONDecoder().decode(ChatAttachmentEnvelope.self, from: data).attachment
    }
}

private struct MessagePage: Decodable {
    let messages: [ChatMessage]
    let hasMore: Bool
}

private struct ConversationPage: Decodable {
    let conversations: [ChatConversation]
    let nextCursor: String?
}

private struct ChatAttachmentEnvelope: Decodable {
    let attachment: ChatAttachment
}
