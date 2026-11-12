import Foundation

/// Origin eligibility only. The authenticated server capability is ALSO required:
/// this policy never identifies the owner or grants permission to spend or call.
enum ChatVoiceClientPolicy {
    enum Build {
        case productionOwnerPilot
        case development
        case isolated
    }

    static var currentBuild: Build {
        #if TALKHINT_NATIVE_VALIDATION || TALKHINT_CHAT_PREVIEW
        return .isolated
        #elseif TALKHINT_CHAT_LIVE_DEV || TALKHINT_APP_DEV
        return .development
        #else
        return .productionOwnerPilot
        #endif
    }

    static func allows(origin: URL, build: Build) -> Bool {
        guard origin.scheme == "https", let host = origin.host?.lowercased(),
              origin.port == nil || origin.port == 443,
              origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil,
              origin.path.isEmpty || origin.path == "/" else { return false }
        switch build {
        case .productionOwnerPilot:
            return host == "talkhint.app"
        case .development:
            return host.hasSuffix(".replit.dev") && host != ".replit.dev"
        case .isolated:
            return false
        }
    }
}
