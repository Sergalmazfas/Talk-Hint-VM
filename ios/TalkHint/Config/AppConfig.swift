import Foundation

enum AppConfig {
    /// Base URL of the TalkHint backend (the published Reserved VM app).
    /// No trailing slash. Change this to your server before building.
    static let baseURL = URL(string: "https://talkhint.app")!

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
