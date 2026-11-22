import Foundation

struct PreparedHintPlansResponse: Decodable {
    let plans: [PreparedHintPlan]
    let serverTime: String

    init(plans: [PreparedHintPlan] = [], serverTime: String = "") {
        self.plans = plans; self.serverTime = serverTime
    }
    private struct Element: Decodable {
        let value: PreparedHintPlan?
        init(from decoder: Decoder) throws { value = try? PreparedHintPlan(from: decoder) }
    }
    private enum CodingKeys: CodingKey { case plans, serverTime }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        plans = (try? c.decode([Element].self, forKey: .plans))?.compactMap(\.value) ?? []
        serverTime = (try? c.decode(String.self, forKey: .serverTime)) ?? ""
    }
}

struct PreparedHintPlan: Decodable {
    struct Opening: Decodable { let phraseEn: String; let translation: String }
    struct Details: Decodable {
        struct Question: Decodable { let q: String; let answer: String? }
        struct Disclosure: Decodable { let allowed: [String]; let forbidden: [String] }
        let goal: String
        let ownerFacts: [String]
        let sayAsk: [String]
        let expectedQuestions: [Question]
        let unknowns: [String]
        let disclosurePolicy: Disclosure
        let language: String
        let executor: String
        let targetPhone: String?
    }
    let id: String
    let planHash: String
    let createdAt: String
    let expiresAt: String
    let plan: Details
    var opening: Opening? = nil

    var expiration: Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: expiresAt) { return date }
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: expiresAt)
    }

    func isUsable(at date: Date) -> Bool {
        guard plan.executor == "hint", let expiration else { return false }
        return expiration > date
    }
}

/// PREP intent takes precedence over an unrelated pending chat plan.
struct HintCallPreparation {
    let goal: String
    let opening: PreparedHintPlan.Opening
    let parameters: [String: String]

    init(number: String, goal: String, response: PreparedHintPlansResponse,
         localOpening: PreparedHintPlan.Opening? = nil, now: Date? = nil) {
        let clock = ISO8601DateFormatter()
        clock.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let reference = now ?? clock.date(from: response.serverTime) ?? Date()
        let selected = response.plans.first {
            $0.isUsable(at: reference) &&
            ($0.plan.targetPhone == number || ($0.plan.targetPhone == nil && !goal.isEmpty)) &&
            (goal.isEmpty || $0.plan.goal == goal)
        }
        self.goal = selected?.plan.goal ?? goal
        self.opening = selected?.opening ?? localOpening ?? .init(
            phraseEn: "Hi, may I ask you a quick question?", translation: "")
        var params: [String: String] = ["HintPrepared": "1"]
        if let selected {
            params["HintPlanId"] = selected.id
            params["HintPlanHash"] = selected.planHash
        }
        if selected == nil && !self.goal.isEmpty {
            params["HintGoal"] = self.goal
            params["HintOpening"] = self.opening.phraseEn
            params["HintOpeningTranslation"] = self.opening.translation
        }
        self.parameters = Self.bounded(params, number: number)
    }

    /// Twilio documents 800 bytes for JS params (31103); iOS documents no
    /// separate number. Use the same conservative bound INCLUDING To and keys,
    /// URL-encoded, not character count. Never truncate a saved plan id/hash.
    static func bounded(_ input: [String: String], number: String) -> [String: String] {
        var result = input
        for (key, bytes) in [("HintGoal", 160), ("HintOpening", 100), ("HintOpeningTranslation", 80)] {
            if let value = result[key] { result[key] = utf8Prefix(value, bytes: bytes) }
        }
        for key in ["HintOpeningTranslation", "HintOpening", "HintGoal"] {
            while encodedSize(result.merging(["To": number]) { _, new in new }) > 800,
                  let value = result[key], !value.isEmpty {
                result[key] = String(value.dropLast())
            }
        }
        // Malformed server ids must not make a call impossible.
        if encodedSize(result.merging(["To": number]) { _, new in new }) > 800 {
            return ["HintPrepared": "1"]
        }
        return result
    }
    static func encodedSize(_ params: [String: String]) -> Int {
        var c = URLComponents()
        c.queryItems = params.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        return c.percentEncodedQuery?.utf8.count ?? 0
    }
    private static func utf8Prefix(_ value: String, bytes: Int) -> String {
        var result = ""
        for character in value {
            guard result.utf8.count + String(character).utf8.count <= bytes else { break }
            result.append(character)
        }
        return result
    }
}
