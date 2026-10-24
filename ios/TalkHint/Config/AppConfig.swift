import Foundation

enum AppConfig {
    /// Base URL of the TalkHint backend (the published Reserved VM app).
    /// No trailing slash. Change this to your server before building.
    #if TALKHINT_NATIVE_VALIDATION
    // Reserved .invalid domain: hosted XCTest must never reach the live backend.
    static let baseURL = URL(string: "https://talkhint-native-tests.invalid")!
    #else
    static let baseURL: URL = {
        #if DEBUG
        // Xcode Scheme > Run > Arguments > Environment Variables.
        // Release builds cannot be redirected by a launch environment.
        if let raw = ProcessInfo.processInfo.environment["TALKHINT_API_BASE_URL"], !raw.isEmpty {
            guard let url = URL(string: raw), url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/" else {
                preconditionFailure("TALKHINT_API_BASE_URL must be an HTTPS origin")
            }
            return url
        }
        #endif
        return URL(string: "https://talkhint.app")!
    }()
    #endif

    /// WebSocket base URL derived from `baseURL` (https -> wss, http -> ws).
    /// Used by the in-call screen to subscribe to the `/ui` transcript/hint feed.
    static var webSocketBaseURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = (baseURL.scheme == "http") ? "ws" : "wss"
        return components.url!
    }

    /// Bundle id. Must match the APNs VoIP certificate installed on the server
    /// (APNS_BUNDLE_ID=app.talkhint). The VoIP push topic is `app.talkhint.voip`.
    static let bundleId = "app.talkhint"

    /// APNs environment reported to the backend so it picks the right APNs host.
    /// Debug builds (run from Xcode) produce sandbox push tokens; release builds
    /// (TestFlight / App Store) produce production tokens.
    static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
