import Foundation

enum CallProfileScope: String, Codable, CaseIterable, Hashable {
    case personal, work, shared

    var localizedName: String {
        switch self {
        case .personal: return NSLocalizedString("profiles.personal", comment: "")
        case .work: return NSLocalizedString("profiles.work", comment: "")
        case .shared: return NSLocalizedString("profiles.shared", comment: "")
        }
    }
}

struct CallProfileNumber: Decodable {
    let id: String
    let phoneNumber: String
    let name: String
    let type: String
}

struct CallProfileItem: Decodable {
    let id: CallProfileScope
    let numbers: [CallProfileNumber]
    let secretaryOutboundReady: Bool
}

struct CallProfilesSnapshot: Decodable {
    struct RecommendedNumber: Decodable {
        let id: String
        let phoneNumber: String
        let available: Bool
        let existingBindingMove: Bool?
    }
    let profiles: [CallProfileItem]
    let recommendedWorkNumber: RecommendedNumber
    let incomingAiEnabled: Bool
    let calendarConnected: Bool

    func profile(_ scope: CallProfileScope) -> CallProfileItem? {
        profiles.first { $0.id == scope }
    }
}
