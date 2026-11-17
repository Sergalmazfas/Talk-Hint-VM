import Foundation

/// Memory has its own contract. It is never decoded as a call plan.
indirect enum ChatMemoryValue: Codable, Equatable {
    case object([String: ChatMemoryValue]), array([ChatMemoryValue])
    case string(String), number(Decimal), bool(Bool), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Decimal.self) { self = .number(v) }
        else if let v = try? c.decode([ChatMemoryValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: ChatMemoryValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }

    subscript(_ key: String) -> ChatMemoryValue? {
        guard case .object(let v) = self else { return nil }
        return v[key]
    }
    var string: String? {
        guard case .string(let v) = self else { return nil }
        return v
    }
    var displayText: String {
        switch self {
        case .string(let v): return v
        case .object(let v): return v.keys.sorted().map { "\($0): \(v[$0]!.displayText)" }.joined(separator: "\n")
        case .array(let v): return v.map(\.displayText).joined(separator: ", ")
        case .number(let v): return NSDecimalNumber(decimal: v).stringValue
        case .bool(let v): return v ? "true" : "false"
        case .null: return "—"
        }
    }
}

struct ChatMemoryAction: Codable, Equatable {
    struct Snapshot: Codable, Equatable {
        let content: ChatMemoryValue?
        let state: ChatMemoryValue

        var displayText: String {
            guard let content, content != .null else { return "—" }
            if let raw = content["raw"] {
                guard let text = raw.string else { return raw.displayText }
                if let parsed = try? JSONDecoder().decode(ChatMemoryValue.self, from: Data(text.utf8)) {
                    return parsed.displayText
                }
                return text.isEmpty ? "—" : text
            }
            // Explicit card fields only; metadata is shown separately.
            return [content["title"]?.string, content["body"]?.string].compactMap { $0 }.joined(separator: "\n")
        }
    }
    struct Patch: Codable, Equatable {
        let kind: String
        let id: String
        let before: Snapshot
        let after: Snapshot
    }
    let id: String
    let memoryHash: String
    var status: String
    let createdAt: String
    let expiresAt: String
    let patches: [Patch]
    let notice: String?

    static func date(_ text: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: text) { return date }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: text)
    }
    func effectiveStatus(at now: Date = Date()) -> String {
        guard status == "proposed" else { return status }
        guard memoryHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              !patches.isEmpty, patches.allSatisfy({ ["profile", "card"].contains($0.kind) }),
              let deadline = Self.date(expiresAt) else { return "unavailable" }
        return deadline <= now ? "expired" : "proposed"
    }
    func canDecide(at now: Date = Date()) -> Bool { effectiveStatus(at: now) == "proposed" }
    static func rejectionStatus(for code: String) -> String? {
        ["MEMORY_STALE": "stale", "MEMORY_EXPIRED": "expired"][code]
    }
}

enum ChatMemoryDecision: String, CaseIterable { case save, cancel }
struct ChatMemoryConfirmation: Decodable {
    let message: ChatMessage
    let dialed: Bool
}

extension APIClient {
    func decideChatMemory(conversationId: String, messageId: String, memoryHash: String,
                          decision: ChatMemoryDecision) async throws -> ChatMemoryConfirmation {
        let data = try await request(
            "/api/chat-v1/conversations/\(conversationId)/messages/\(messageId)/memory/\(decision.rawValue)",
            method: "POST", json: ["memoryHash": memoryHash], authenticated: true)
        return try JSONDecoder().decode(ChatMemoryConfirmation.self, from: data)
    }
}
