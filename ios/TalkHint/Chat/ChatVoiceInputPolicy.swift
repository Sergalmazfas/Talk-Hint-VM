import Foundation

/// Chat input only. These values never affect phone/Retell audio.
struct ChatVoiceInputPolicy {
    enum Event: Equatable { case none, candidate, rejected, speech }
    static let interruptionDB: Float = -25
    static let interruptionSeconds = 0.4
    static let minimumSpeechSeconds = 0.5
    private(set) var firstSpeech: Double?
    private(set) var lastSpeech: Double?
    private var candidateAt: Double?
    private(set) var accepted = false
    private(set) var playback = false

    mutating func reset(playback: Bool = false) {
        self = Self()
        self.playback = playback
    }
    mutating func sample(db: Float, at: Double) -> Event {
        guard db.isFinite, at.isFinite else { return .none }
        if !accepted && playback {
            if db <= Self.interruptionDB {
                let hadCandidate = candidateAt != nil
                candidateAt = nil; firstSpeech = nil; lastSpeech = nil
                return hadCandidate ? .rejected : .none
            }
            // Missing audio is NOT evidence of continuous speech.
            if let lastSpeech, at < lastSpeech || at - lastSpeech > 0.15 {
                candidateAt = nil
            }
            if candidateAt == nil {
                candidateAt = at; firstSpeech = at; lastSpeech = at
                return .candidate
            }
            lastSpeech = at
            guard at - candidateAt! >= Self.interruptionSeconds else { return .none }
            accepted = true
            return .speech
        }
        if db > -38 {
            lastSpeech = at
            if firstSpeech == nil { firstSpeech = at }
            if !accepted { accepted = true; return .speech }
        }
        return .none
    }
    var speechDuration: Double { max(0, (lastSpeech ?? 0) - (firstSpeech ?? 0)) }
    var canSubmit: Bool { accepted && speechDuration >= Self.minimumSpeechSeconds }
}

struct ChatVoiceLanguageHint {
    private(set) var lastUserLanguage: String?
    static let supported = Set(["ru", "en", "es", "uk", "kk"])
    static func normalized(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let code = raw.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init)
        return code.flatMap { supported.contains($0) ? $0 : nil }
    }
    func hint(interface: String, profile: String? = nil) -> String {
        lastUserLanguage ?? Self.normalized(profile) ?? Self.normalized(interface) ?? "en"
    }
    mutating func detected(_ language: String?) {
        if let code = Self.normalized(language) { lastUserLanguage = code }
    }
}

enum ChatVoiceHistoryRetryPolicy {
    static func shouldRetry(_ error: Error, attempt: Int) -> Bool {
        guard attempt < 2, let network = error as? URLError else { return false }
        return [.networkConnectionLost, .notConnectedToInternet, .timedOut, .cannotConnectToHost].contains(network.code)
    }
}
