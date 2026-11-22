import Foundation

enum ChatTableAttachmentPolicy {
    static let xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    static let csv = "text/csv"
    static func isTable(_ mime: String) -> Bool { [xlsx, csv].contains(mime) }
    static func limit(mime: String, capabilities: ChatCapabilities?) -> Int {
        if isTable(mime) {
            guard capabilities?.tables?.available == true else { return 0 }
            return min(10 * 1024 * 1024, max(0, capabilities?.tables?.limits.bytes ?? 0))
        }
        return min(2 * 1024 * 1024, capabilities?.attachments.maxBytes ?? 2 * 1024 * 1024)
    }
}

struct ChatTableBook: Decodable, Equatable {
    let id: String
    let name: String
    let scope: String
    let revision: Int
    let hidden: Bool
    let downloadUrl: String?
}
struct ChatTablePage: Decodable {
    let books: [ChatTableBook]
    let more: Bool
    let nextOffset: Int?
}
struct ChatTableExport: Decodable { let jobId: String; let status: String }
struct ChatTableJob: Decodable {
    struct Result: Decodable { let revision: Int?; let downloadUrl: String? }
    let id: String
    let status: String
    let result: Result?
    let error_code: String?
}

struct ChatTableExportAttempts {
    private var requests: [String: UUID] = [:]
    private var jobs: [String: String] = [:]
    mutating func request(for key: String) -> UUID {
        if let known = requests[key] { return known }
        let id = UUID(); requests[key] = id; return id
    }
    func job(for key: String) -> String? { jobs[key] }
    mutating func remember(job: String, for key: String) { jobs[key] = job }
    mutating func observed(status: String, for key: String) {
        // Only a definite terminal result allows a new export request.
        if ["failed", "purged"].contains(status) {
            requests[key] = nil; jobs[key] = nil
        }
    }
    static func filename(_ title: String) -> String {
        let forbidden = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\:*?\"<>|"))
        let clean = title.unicodeScalars.map { forbidden.contains($0) ? " " : String($0) }.joined()
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        var stem = clean.lowercased().hasSuffix(".xlsx") ? String(clean.dropLast(5)) : clean
        while stem.utf8.count > 180 { stem.removeLast() }
        if stem.trimmingCharacters(in: .whitespaces).isEmpty {
            stem = NSLocalizedString("chat.tables.filename", comment: "")
        }
        return stem + ".xlsx"
    }
}

extension APIClient {
    static func tableID(_ value: String) throws -> String {
        guard !value.isEmpty, value.count <= 80,
              value.range(of: "^[a-zA-Z0-9_-]+$", options: .regularExpression) != nil else { throw APIError.decoding }
        return value
    }
    func chatTables(search: String, offset: Int = 0) async throws -> ChatTablePage {
        let data = try await request("/api/chat-v1/tables", method: "GET", json: nil, authenticated: true,
            queryItems: [URLQueryItem(name: "search", value: String(search.prefix(160))),
                         URLQueryItem(name: "offset", value: String(max(0, offset))), URLQueryItem(name: "hidden", value: "0")])
        return try JSONDecoder().decode(ChatTablePage.self, from: data)
    }
    func chatExportTable(_ book: ChatTableBook, conversationId: String, requestId: UUID) async throws -> ChatTableExport {
        let data = try await request("/api/chat-v1/tables/\(try Self.tableID(book.id))/export",
            method: "POST", json: ["conversationId": conversationId, "revision": book.revision,
                                   "requestId": requestId.uuidString.lowercased()], authenticated: true)
        return try JSONDecoder().decode(ChatTableExport.self, from: data)
    }
    func chatTableJob(_ id: String) async throws -> ChatTableJob {
        let data = try await request("/api/chat-v1/tables/jobs/\(try Self.tableID(id))",
                                     method: "GET", json: nil, authenticated: true)
        return try JSONDecoder().decode(ChatTableJob.self, from: data)
    }
}
