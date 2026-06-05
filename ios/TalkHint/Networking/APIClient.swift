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

    struct AvailablePhoneNumber { let id: String; let number: String; let country: String }

    /// Fetches numbers from the unassigned pool the user can claim.
    func availableNumbers() async throws -> [AvailablePhoneNumber] {
        let data = try await request("/api/numbers/available", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["numbers"] as? [[String: Any]] else {
            throw APIError.decoding
        }
        return arr.compactMap { item in
            guard let id = item["id"] as? String,
                  let number = item["twilioNumber"] as? String else { return nil }
            let country = (item["country"] as? String) ?? ""
            return AvailablePhoneNumber(id: id, number: number, country: country)
        }
    }

    /// Claims a pool number for the signed-in user with a friendly name.
    /// Returns the id of the newly assigned phone number.
    @discardableResult
    func assignNumber(numberId: String, name: String) async throws -> String {
        let body: [String: Any] = ["numberId": numberId, "name": name, "type": "personal"]
        let data = try await request("/api/numbers", method: "POST", json: body, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let phoneNumber = obj["phoneNumber"] as? [String: Any],
              let id = phoneNumber["id"] as? String else {
            throw APIError.decoding
        }
        return id
    }

    // MARK: - Prompts & templates

    struct UserPrompt {
        let id: String
        let name: String
        let content: String
        var isActive: Bool
    }

    /// Fetches the signed-in user's saved prompts.
    func prompts() async throws -> [UserPrompt] {
        let data = try await request("/api/prompts", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["prompts"] as? [[String: Any]] else {
            throw APIError.decoding
        }
        return arr.compactMap { Self.parsePrompt($0) }
    }

    /// Creates a new prompt and returns it.
    @discardableResult
    func createPrompt(name: String, content: String) async throws -> UserPrompt {
        let body: [String: Any] = ["name": name, "content": content]
        let data = try await request("/api/prompts", method: "POST", json: body, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let promptObj = obj["prompt"] as? [String: Any],
              let prompt = Self.parsePrompt(promptObj) else {
            throw APIError.decoding
        }
        return prompt
    }

    /// Updates a prompt's name/content and/or active flag. Only the provided
    /// fields are sent.
    func updatePrompt(id: String, name: String? = nil, content: String? = nil, isActive: Bool? = nil) async throws {
        var body: [String: Any] = [:]
        if let name = name { body["name"] = name }
        if let content = content { body["content"] = content }
        if let isActive = isActive { body["isActive"] = isActive }
        _ = try await request("/api/prompts/\(id)", method: "PUT", json: body, authenticated: true)
    }

    func deletePrompt(id: String) async throws {
        _ = try await request("/api/prompts/\(id)", method: "DELETE", json: nil, authenticated: true)
    }

    struct PromptTemplate {
        let id: String
        let name: String
        let category: String
        let contentRu: String
        let contentEn: String
        let contentEs: String

        /// Returns the template body for the given language code, falling back to
        /// English.
        func content(for language: String) -> String {
            switch language {
            case "ru": return contentRu.isEmpty ? contentEn : contentRu
            case "es": return contentEs.isEmpty ? contentEn : contentEs
            default: return contentEn
            }
        }
    }

    /// Fetches the built-in prompt templates (public endpoint).
    func templates() async throws -> [PromptTemplate] {
        let data = try await request("/api/templates", method: "GET", json: nil, authenticated: false)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["templates"] as? [[String: Any]] else {
            throw APIError.decoding
        }
        return arr.compactMap { item in
            guard let id = item["id"] as? String,
                  let name = item["name"] as? String else { return nil }
            return PromptTemplate(
                id: id,
                name: name,
                category: (item["category"] as? String) ?? "",
                contentRu: (item["contentRu"] as? String) ?? "",
                contentEn: (item["contentEn"] as? String) ?? "",
                contentEs: (item["contentEs"] as? String) ?? ""
            )
        }
    }

    private static func parsePrompt(_ item: [String: Any]) -> UserPrompt? {
        guard let id = item["id"] as? String,
              let name = item["name"] as? String else { return nil }
        let content = (item["content"] as? String) ?? ""
        let isActive = (item["isActive"] as? Bool) ?? false
        return UserPrompt(id: id, name: name, content: content, isActive: isActive)
    }

    // MARK: - Call history

    /// A finished/recorded call as stored in the backend `calls` table.
    struct CallRecord {
        let id: String
        let userId: String?
        let callSid: String
        let fromNumber: String
        let toNumber: String
        let status: String
        let startedAt: Date?
        let endedAt: Date?
        let transcript: String?
    }

    /// Fetches the signed-in user's past calls, newest first. The backend
    /// `/api/calls` route is unscoped (returns every user's calls), so user
    /// scoping is enforced here. This fails CLOSED: if the current user id is
    /// unknown we refuse rather than risk exposing other users' history.
    func calls() async throws -> [CallRecord] {
        guard let mine = SessionStore.shared.userId else { throw APIError.notAuthenticated }
        let data = try await request("/api/calls", method: "GET", json: nil, authenticated: true)
        guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw APIError.decoding
        }
        return arr
            .compactMap { Self.parseCall($0) }
            .filter { $0.userId == mine }
            .sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
    }

    /// Fetches a single call (including its full transcript) by id. Enforces
    /// ownership client-side because the backend route is unscoped: a record
    /// belonging to another user is treated as not authorized.
    func call(id: String) async throws -> CallRecord {
        guard let mine = SessionStore.shared.userId else { throw APIError.notAuthenticated }
        let data = try await request("/api/calls/\(id)", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let call = Self.parseCall(obj) else {
            throw APIError.decoding
        }
        guard call.userId == mine else { throw APIError.notAuthenticated }
        return call
    }

    private static func parseCall(_ item: [String: Any]) -> CallRecord? {
        guard let id = item["id"] as? String,
              let callSid = item["callSid"] as? String else { return nil }
        return CallRecord(
            id: id,
            userId: item["userId"] as? String,
            callSid: callSid,
            fromNumber: (item["fromNumber"] as? String) ?? "",
            toNumber: (item["toNumber"] as? String) ?? "",
            status: (item["status"] as? String) ?? "",
            startedAt: parseDate(item["startedAt"]),
            endedAt: parseDate(item["endedAt"]),
            transcript: item["transcript"] as? String
        )
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoFormatterNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func parseDate(_ value: Any?) -> Date? {
        guard let s = value as? String else { return nil }
        return isoFormatter.date(from: s) ?? isoFormatterNoFraction.date(from: s)
    }

    // MARK: - Settings

    /// Fetches the user's current SMS/voice forwarding number (nil if unset).
    func forwardingPhone() async throws -> String? {
        let data = try await request("/api/settings/forwarding", method: "GET", json: nil, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.decoding
        }
        return obj["forwardingPhone"] as? String
    }

    /// Sets (or clears, when `phone` is nil/empty) the forwarding number. Returns
    /// the normalized value the backend stored.
    @discardableResult
    func setForwardingPhone(_ phone: String?) async throws -> String? {
        let body: [String: Any] = ["forwardingPhone": phone ?? ""]
        let data = try await request("/api/settings/forwarding", method: "POST", json: body, authenticated: true)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.decoding
        }
        return obj["forwardingPhone"] as? String
    }

    /// Updates how incoming calls are handled. Accepts "live", "forwarding" or
    /// "training" (the backend `callMode` enum).
    func setCallMode(_ mode: String) async throws {
        _ = try await request("/api/user/call-mode", method: "POST", json: ["callMode": mode], authenticated: true)
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
