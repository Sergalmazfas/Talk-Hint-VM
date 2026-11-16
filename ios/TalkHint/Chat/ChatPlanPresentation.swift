import Foundation

/// Presentation only. Never changes the signed instruction, plan hash, call language or authorization.
enum ChatPlanPresentation {
    static func missing(_ warnings: [ChatMessageAction.Warning]?, language: String? = nil) -> String? {
        guard let warnings, !warnings.isEmpty else { return nil }
        let code = (language ?? Bundle.main.preferredLocalizations.first ?? "en")
            .components(separatedBy: "-").first ?? "en"
        return warnings.map { $0.labels[code] ?? $0.labels["en"] ?? $0.field }.joined(separator: " · ")
    }

    static func instruction(_ original: String) -> String {
        guard original.hasPrefix("Owner-approved call plan."),
              let start = original.firstIndex(of: "\n"),
              let bytes = String(original[original.index(after: start)...]).data(using: .utf8),
              let plan = try? JSONDecoder().decode(ChatCallPlan.self, from: bytes) else { return original }
        let sections: [(String, [String])] = [
            ("chat.plan.goal", [plan.goal]),
            ("chat.plan.checklist", plan.sayAsk.enumerated().map { "\($0.offset + 1). \($0.element)" }),
            ("chat.plan.facts", plan.ownerFacts),
            ("chat.plan.expected", plan.expectedQuestions.map {
                "\($0.q) — \($0.answer.flatMap { $0.isEmpty ? nil : $0 } ?? NSLocalizedString("chat.plan.unknownAnswer", comment: ""))"
            }),
            ("chat.plan.allowed", plan.disclosurePolicy.allowed),
            ("chat.plan.forbidden", plan.disclosurePolicy.forbidden),
            ("chat.plan.unknowns", plan.unknowns),
            ("chat.plan.language", [NSLocalizedString("chat.plan.language.\(plan.language)", comment: "")]),
            ("chat.plan.phone", [plan.targetPhone ?? NSLocalizedString("chat.plan.notProvided", comment: "")])
        ]
        return sections.filter { !$0.1.isEmpty }.map {
            NSLocalizedString($0.0, comment: "") + ":\n" + $0.1.joined(separator: "\n")
        }.joined(separator: "\n\n")
    }
}
