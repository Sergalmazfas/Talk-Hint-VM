import Foundation
import UIKit

enum APIError: LocalizedError {
    case http(Int, String)
    case decoding
    case notAuthenticated

    var errorDescription: String? {
        switch self {
        case .http(let code, let message):
            return "Server error \(code): \(message)"
        case .decoding:
            return "Unexpected server response."
        case .notAuthenticated:
            return "You are not logged in."
        }
    }
}

/// Thin HTTP client for the TalkHint backend. All authenticated routes use the
/// session Bearer token (the same token returned by /api/auth/login).
final class APIClient {
    static let shared = APIClient()
    private init() {}

    private let session = URLSession(configuration: .default)

    // MARK: - Auth

    struct LoginResult { let token: String; let userId: String; let email: String }

    func login(email: String, password: String) async throws -> LoginResult {
        let body = ["email": email, "password": password]
        let data = try await request("/api/auth/login", method: "POST", json: body, authenticated: false)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["token"] as? String,
              let user = obj["user"] as? [String: Any],
              let userId = user["id"] as? String else {
            throw APIError.decoding
        }
        let emailOut = (user["email"] as? String) ?? email
        return LoginResult(token: token, userId: userId, email: emailOut)
    }

    /// URL that starts the Replit OIDC ("Continue with Google") flow for the
    /// native app. /api/callback returns to the `talkhint://` scheme.
    var googleLoginURL: URL? {
        AppConfig.baseURL.appendingPathComponent("/api/login/ios")
    }

    struct MeResult { let userId: String; let email: String }

    /// Fetches the current user using an explicit Bearer token (used right
    /// after the OAuth callback, before the token is saved to SessionStore).
    func me(token: String) async throws -> MeResult {
        var req = URLRequest(url: AppConfig.baseURL.appendingPathComponent("/api/auth/me"))
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.decoding }
        guard (200..<300).contains(http.statusCode) else {
            var message = ""
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                message = (obj["error"] as? String) ?? ""
            }
            throw APIError.http(http.statusCode, message)
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = obj["user"] as? [String: Any],
              let userId = user["id"] as? String else {
            throw APIError.decoding
        }
        let email = (user["email"] as? String) ?? ""
        return MeResult(userId: userId, email: email)
    }

    func logout() async {
        _ = try? await request("/api/auth/logout", method: "POST", json: [:], authenticated: true)
    }

    // MARK: - Device tokens (VoIP push registration)

    func registerDevice(voipToken: String) async throws {
        let deviceModel = await MainActor.run { UIDevice.current.model }
        let body: [String: Any] = [
            "platform": "ios",
            "token": voipToken,
            "bundleId": AppConfig.bundleId,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0",
            "deviceModel": deviceModel,
            "environment": AppConfig.apnsEnvironment,
        ]
        _ = try await request("/api/devices/register", method: "POST", json: body, authenticated: true)
    }

    func unregisterDevice(voipToken: String) async throws {
        let body: [String: Any] = ["token": voipToken, "platform": "ios"]
        _ = try await request("/api/devices/unregister", method: "POST", json: body, authenticated: true)
    }

    // MARK: - Call control

    /// Accepts a pending call as an iOS client. Returns the conference room name
    /// (e.g. "call-{callSid}") that the outbound Twilio connect() must join.
    func acceptCall(callSid: String) async throws -> String {
        let body: [String: Any] = ["callSid": callSid, "clientType": "ios"]
        let data = try await request("/api/call/accept", method: "POST", json: body, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let conference = obj["conference"] as? String else {
            throw APIError.decoding
        }
        return conference
    }

    func rejectCall(callSid: String) async throws {
        let body: [String: Any] = ["callSid": callSid]
        _ = try await request("/api/call/reject", method: "POST", json: body, authenticated: true)
    }

    /// Fetches a Twilio Voice access token (identity user-{userId},
    /// outgoingApplicationSid = TWILIO_TWIML_APP_SID) used for the outbound
    /// connect() into the conference.
    func fetchTwilioAccessToken() async throws -> String {
        let data = try await request("/api/token", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = obj["token"] as? String else {
            throw APIError.decoding
        }
        return token
    }

    // MARK: - Account & subscription

    struct SubscriptionInfo { let plan: String; let hasStripeCustomer: Bool }

    /// Fetches the current plan / subscription status (read-only).
    func subscription() async throws -> SubscriptionInfo {
        let data = try await request("/api/subscription", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let plan = obj["plan"] as? String else {
            throw APIError.decoding
        }
        let hasCustomer = (obj["stripeCustomerId"] as? String) != nil
        return SubscriptionInfo(plan: plan, hasStripeCustomer: hasCustomer)
    }

    struct PhoneNumberItem { let id: String; let number: String; let name: String }

    /// Fetches the phone numbers assigned to the signed-in user.
    func numbers() async throws -> [PhoneNumberItem] {
        let data = try await request("/api/numbers", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["numbers"] as? [[String: Any]] else {
            throw APIError.decoding
        }
        return arr.compactMap { item in
            guard let id = item["id"] as? String,
                  let number = item["twilioNumber"] as? String else { return nil }
            let name = (item["name"] as? String) ?? ""
            return PhoneNumberItem(id: id, number: number, name: name)
        }
    }

    // MARK: - Core request

    private func request(_ path: String, method: String, json: [String: Any]?, authenticated: Bool) async throws -> Data {
        var req = URLRequest(url: AppConfig.baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let json = json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
        }

        if authenticated {
            guard let token = SessionStore.shared.token else { throw APIError.notAuthenticated }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.decoding }
        guard (200..<300).contains(http.statusCode) else {
            var message = ""
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                message = (obj["error"] as? String) ?? ""
            }
            throw APIError.http(http.statusCode, message)
        }
        return data
    }
}
