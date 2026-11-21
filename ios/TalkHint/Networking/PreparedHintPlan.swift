import Foundation

struct PreparedHintPlansResponse: Decodable {
    let plans: [PreparedHintPlan]
    let serverTime: String
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
        self.parameters = params
    }
}
