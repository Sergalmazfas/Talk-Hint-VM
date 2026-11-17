import Foundation

struct ChatAgataTicket: Decodable {
    struct IceServer: Decodable {
        let urls: [String]
        let username: String?
        let credential: String?
        private enum CodingKeys: String, CodingKey { case urls, username, credential }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let list = try? c.decode([String].self, forKey: .urls) { urls = list }
            else { urls = [try c.decode(String.self, forKey: .urls)] }
            username = try c.decodeIfPresent(String.self, forKey: .username)
            credential = try c.decodeIfPresent(String.self, forKey: .credential)
        }
    }
    let sessionId: String
    let conversationId: String
    let callId: String
    let accessToken: String
    let iceServers: [IceServer]
    let maxSeconds: Int
}

struct ChatAgataStatus: Decodable {
    let state: String
    let orbState: String
    let budgetExceeded: Bool?
    let voiceErrorCode: String?
}

extension APIClient {
    func createChatAgata(conversationId: String, requestId: UUID, language: String) async throws -> ChatAgataTicket {
        let data = try await request("/api/chat-v1/conversations/\(conversationId)/agata", method: "POST",
            json: ["clientRequestId": requestId.uuidString.lowercased(),
                   "language": ["ru", "es", "en"].contains(language) ? language : "en"], authenticated: true)
        let ticket = try JSONDecoder().decode(ChatAgataTicket.self, from: data)
        guard ticket.conversationId == conversationId, !ticket.accessToken.isEmpty,
              ticket.maxSeconds > 0, ticket.maxSeconds <= 300,
              Self.validAgataComponent(ticket.sessionId),
              Self.validAgataComponent(ticket.callId), ticket.callId.hasPrefix("call_") else {
            throw APIError.decoding
        }
        return ticket
    }
    func chatAgataStatus(_ id: String) async throws -> ChatAgataStatus {
        guard Self.validAgataComponent(id) else { throw APIError.decoding }
        return try JSONDecoder().decode(ChatAgataStatus.self, from: await request(
            "/api/chat-v1/agata/\(id)", method: "GET", json: nil, authenticated: true))
    }
    func chatAgataOperation(_ operation: String, sessionId: String) async throws {
        guard ["joined", "stop"].contains(operation), Self.validAgataComponent(sessionId) else {
            throw APIError.decoding
        }
        _ = try await request("/api/chat-v1/agata/\(sessionId)/\(operation)", method: "POST",
                              json: [:], authenticated: true)
    }
    func reconcileChatAgata(_ id: String) async throws -> ChatAgataStatus {
        guard Self.validAgataComponent(id) else { throw APIError.decoding }
        let data = try await request("/api/chat-v1/agata/\(id)/reconcile", method: "POST",
                                     json: [:], authenticated: true)
        return try JSONDecoder().decode(ChatAgataStatus.self, from: data)
    }
    static func validAgataComponent(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 150 &&
            value.unicodeScalars.allSatisfy { CharacterSet(charactersIn:
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-").contains($0) }
    }
}

/// The short-lived token is sent ONLY to Retell, never persisted or logged.
enum ChatAgataSignaling {
    static func request(ticket: ChatAgataTicket, sdp: String, sessionId: String? = nil) throws -> URLRequest {
        guard APIClient.validAgataComponent(ticket.callId),
              sessionId.map(APIClient.validAgataComponent) ?? true else { throw APIError.decoding }
        let suffix = sessionId.map { "/\($0)" } ?? ""
        let url = URL(string: "https://api.retellai.com/webrtc-proxy/\(ticket.callId)/v1/webrtc/sessions\(suffix)")!
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        r.httpMethod = sessionId == nil ? "POST" : "DELETE"
        r.setValue("Bearer \(ticket.accessToken)", forHTTPHeaderField: "Authorization")
        if sessionId == nil {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: ["identity": "client", "sdp": sdp])
        }
        return r
    }
}
