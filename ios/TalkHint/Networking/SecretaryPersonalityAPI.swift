import Foundation

struct SecretaryBackendMismatch: LocalizedError {
    var errorDescription: String? { NSLocalizedString("secretary.personality.origin_changed", comment: "") }
}

struct SecretaryOutgoingSetupUnavailable: LocalizedError {
    var errorDescription: String? {
        NSLocalizedString("secretary.personality.setup_unavailable", comment: "")
    }
}

struct SecretaryPersonalityItem: Decodable {
    let id: String
    let slug: String
    let name: String
    let description: String
    let status: String
    let currentVersion: Int
}
struct SecretaryPersonalityContent: Decodable {
    struct Guidance: Decodable { let personal: String; let work: String }
    let version: Int
    let name: String
    let description: String
    let rules: String
    let examples: [String]
    let modeGuidance: Guidance
}
struct SecretaryPersonalityBinding: Decodable {
    let personalityId: String
    let version: Int
    let snapshot: SecretaryPersonalityContent
}
struct SecretaryPersonalityPage: Decodable {
    let items: [SecretaryPersonalityItem]
    let nextCursor: String?
}
struct SecretaryPersonalityDetails: Decodable {
    let personality: SecretaryPersonalityItem
    let versions: [SecretaryPersonalityContent]
}
struct SecretaryPersonalityContext: Decodable {
    struct DefaultOutgoing: Decodable {
        let numberId: String
        let provider: String
    }
    struct Number: Decodable {
        let id: String
        let type: String
        let twilioNumber: String
        let friendlyName: String?
    }
    let numbers: [Number]
    var defaultOutgoing: DefaultOutgoing? = nil
}
struct SecretaryOutgoingSetup: Decodable {
    struct Card: Decodable { let id: String; let title: String; let description: String }
    let protocolVersion: Int
    let numberId: String
    let scope: String
    let fromNumber: String
    let cardIds: [String]
    let cards: [Card]
    let assignment: SecretaryPersonalityBinding?
    let provider: String
    let engine: String
    let reasoning: String
}
extension APIClient {
    /// Catalog and number IDs are opaque UUIDs/unreserved identifiers, not URL
    /// fragments. Pass them raw to requestURL, which performs URL construction.
    /// Pre-encoding here makes appendingPathComponent encode "%" a second time.
    /// Reject path separators/escapes instead of letting an ID change the route.
    static func secretaryPathID(_ id: String) throws -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard !id.isEmpty, id != ".", id != "..",
              id.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            throw APIError.decoding
        }
        return id
    }

    func secretaryPersonalityContext() async throws -> SecretaryPersonalityContext {
        try JSONDecoder().decode(SecretaryPersonalityContext.self, from: await request(
            "/api/secretary-personalities/context", method: "GET", json: nil, authenticated: true))
    }
    func secretaryPersonalityPage(search: String, cursor: String? = nil) async throws -> SecretaryPersonalityPage {
        var query = [URLQueryItem(name: "q", value: search), URLQueryItem(name: "limit", value: "25")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try JSONDecoder().decode(SecretaryPersonalityPage.self, from: await request(
            "/api/secretary-personalities", method: "GET", json: nil, authenticated: true, queryItems: query))
    }
    func secretaryPersonalityDetails(id: String) async throws -> SecretaryPersonalityDetails {
        let safe = try Self.secretaryPathID(id)
        return try JSONDecoder().decode(SecretaryPersonalityDetails.self, from: await request(
            "/api/secretary-personalities/\(safe)", method: "GET", json: nil, authenticated: true))
    }
    func secretaryOutgoingSetup(numberId: String) async throws -> SecretaryOutgoingSetup {
        let safe = try Self.secretaryPathID(numberId)
        let result = try JSONDecoder().decode(SecretaryOutgoingSetup.self, from: await request(
            "/api/secretary-personalities/numbers/\(safe)/outgoing", method: "GET", json: nil, authenticated: true))
        guard result.protocolVersion == 1, result.provider == "retell", result.numberId == numberId else { throw APIError.decoding }
        return result
    }
    func saveSecretaryOutgoingSetup(numberId: String, personalityId: String?, version: Int?, cardIds: [String]) async throws -> SecretaryOutgoingSetup {
        let safe = try Self.secretaryPathID(numberId)
        let body: [String: Any] = [
            "personalityId": personalityId.map { $0 as Any } ?? NSNull(),
            "version": version.map { $0 as Any } ?? NSNull(), "cardIds": cardIds,
        ]
        return try JSONDecoder().decode(SecretaryOutgoingSetup.self, from: await request(
            "/api/secretary-personalities/numbers/\(safe)/outgoing", method: "PUT", json: body, authenticated: true))
    }
}
