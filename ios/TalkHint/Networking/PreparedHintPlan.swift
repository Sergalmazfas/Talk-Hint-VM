import Foundation

struct PreparedHintPlansResponse: Decodable {
    let plans: [PreparedHintPlan]
    let serverTime: String
}

struct PreparedHintPlan: Decodable {
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
