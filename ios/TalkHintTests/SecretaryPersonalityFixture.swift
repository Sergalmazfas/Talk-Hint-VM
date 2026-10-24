import XCTest
@testable import TalkHint

/// In-memory HTTP only. No URLSession fallback, push, phone SDK or real accounts.
/// Task recovery is separately opt-in and returns a terminal fake task.
actor SecretaryPersonalityFixture {
    private var requests: [URLRequest] = []
    private var saved: [String: [String: Any]] = [:]
    private var nextSaveStatus: Int?
    private let recoveryEnabled: Bool
    private var recoveredTask: [String: Any]?
    private var fakeCreates = 0

    init(recoveryEnabled: Bool = false) { self.recoveryEnabled = recoveryEnabled }
    func recorded() -> [URLRequest] { requests }
    func failNextSave(_ status: Int) { nextSaveStatus = status }
    func creationCount() -> Int { fakeCreates }

    private let katya: [String: Any] = [
        "id": "katya-fixture", "slug": "katya", "name": "Катя",
        "description": "Warm fixture character", "status": "available", "currentVersion": 2,
    ]
    private let content: [String: Any] = [
        "version": 2, "name": "Катя", "description": "Warm fixture character",
        "rules": "Fixture: situational humor, no invented biography.",
        "examples": ["Fixture example: clarify before promising."],
        "modeGuidance": ["personal": "Fixture personal guidance", "work": "Fixture work guidance"],
    ]

    func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let url = try XCTUnwrap(request.url)
        guard url.host == "talkhint-native-tests.invalid",
              request.value(forHTTPHeaderField: "Authorization") == "Bearer personality-fixture" else {
            XCTFail("Fixture received an unexpected host or authentication")
            throw URLError(.unsupportedURL)
        }
        let method = request.httpMethod ?? "GET"
        let path = url.path
        func response(_ object: [String: Any], status: Int = 200) throws -> (Data, URLResponse) {
            (try JSONSerialization.data(withJSONObject: object),
             try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)))
        }
        switch (method, path) {
        case ("GET", "/api/settings/hints"):
            return try response(["liveHintsEnabled": true, "translationEnabled": true])
        case ("GET", "/api/call-profiles"):
            return try response(["profiles": [], "incomingAiEnabled": false, "calendarConnected": false])
        case ("GET", "/api/secretary-personalities/context"):
            return try response(["numbers": [
                ["id": "personal-line", "type": "personal", "twilioNumber": "+12025550101"],
                ["id": "work-line", "type": "work", "twilioNumber": "+12025550102"],
            ]])
        case ("GET", "/api/secretary-personalities"):
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let search = query.first(where: { $0.name == "q" })?.value ?? ""
            let cursor = query.first(where: { $0.name == "cursor" })?.value
            return try response(["items": cursor == nil && (search.isEmpty || search.contains("Катя")) ? [katya] : [],
                                 "nextCursor": cursor == nil ? "fixture-page-2" as Any : NSNull()])
        case ("GET", "/api/secretary-personalities/katya-fixture"):
            return try response(["personality": katya, "versions": [content]])
        case ("GET", "/api/secretary/tasks") where recoveryEnabled:
            return try response(["tasks": recoveredTask.map { [$0] } ?? []])
        case ("POST", "/api/secretary/tasks") where recoveryEnabled:
            let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
            if let task = recoveredTask {
                XCTAssertEqual(task["clientRequestId"] as? String, body["clientRequestId"] as? String)
                return try response(["task": task])
            }
            fakeCreates += 1
            recoveredTask = [
                "id": "terminal-fixture-task", "clientRequestId": try XCTUnwrap(body["clientRequestId"]),
                "phoneNumber": try XCTUnwrap(body["phoneNumber"]), "instruction": try XCTUnwrap(body["instruction"]),
                "status": "completed", "mode": "live",
            ]
            // Server accepted the request, but its first response was lost.
            throw URLError(.timedOut)
        default: break
        }
        let prefix = "/api/secretary-personalities/numbers/"
        if path.hasPrefix(prefix), path.hasSuffix("/outgoing"), ["GET", "PUT"].contains(method) {
            let id = String(path.dropFirst(prefix.count).dropLast("/outgoing".count))
            guard ["personal-line", "work-line"].contains(id) else {
                return try response(["error": "Unknown fixture line"], status: 404)
            }
            let scope = id == "work-line" ? "work" : "personal"
            let cardID = "\(scope)-card"
            var setup: [String: Any] = saved[id] ?? [
                "protocolVersion": 1, "numberId": id, "scope": scope,
                "fromNumber": scope == "work" ? "+12025550102" : "+12025550101",
                "cardIds": [], "assignment": NSNull(),
                "cards": [["id": cardID, "title": "\(scope) facts", "description": "Explicit fixture facts"]],
                "provider": "retell", "engine": "fixture-engine", "reasoning": "medium",
            ]
            if method == "PUT" {
                if let status = nextSaveStatus {
                    nextSaveStatus = nil
                    return try response(["error": "Fixture save rejected"], status: status)
                }
                let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
                let cards = try XCTUnwrap(body["cardIds"] as? [String])
                guard cards.allSatisfy({ $0 == cardID }) else {
                    return try response(["error": "Wrong profile card"], status: 403)
                }
                if let personality = body["personalityId"] as? String {
                    guard personality == "katya-fixture", body["version"] as? Int == 2 else {
                        return try response(["error": "Unknown fixture personality"], status: 400)
                    }
                    setup["assignment"] = ["personalityId": personality, "version": 2, "snapshot": content]
                } else { setup["assignment"] = NSNull() }
                setup["cardIds"] = cards
                saved[id] = setup
            }
            return try response(setup)
        }
        XCTFail("Forbidden fixture request: \(method) \(path)")
        throw URLError(.unsupportedURL)
    }
}
