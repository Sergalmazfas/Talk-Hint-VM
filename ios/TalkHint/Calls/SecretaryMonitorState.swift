import Foundation

/// Bounded local-only recovery. A successful engine start is not proof of
/// playback and must not replenish the retry budget.
struct SecretaryMonitorRecovery {
    private(set) var attempts = 0
    private var lastAttempt: TimeInterval?
    private(set) var failure: String?

    mutating func recordFailure(_ code: String) { failure = code }

    mutating func requestAttempt(now: TimeInterval) -> Bool {
        guard attempts < 3, lastAttempt.map({ now - $0 >= 2 }) ?? true else { return false }
        attempts += 1
        lastAttempt = now
        return true
    }

    mutating func rendered() { self = SecretaryMonitorRecovery() }
    mutating func retryByOwner() { attempts = 0; lastAttempt = nil }
}

/// Transport and text never imply successful audio rendering.
struct SecretaryMonitorState {
    private(set) var connected = false
    private(set) var received = false
    private(set) var played = false
    mutating func connect() { connected = true }
    mutating func receiveAudio() { received = true }
    mutating func renderAudio() { if received { played = true } }
    mutating func resetAudio() { received = false; played = false }
    mutating func reset() { self = SecretaryMonitorState() }
    var statusKey: String {
        if played { return "secretary.live.audio_playing" }
        if received { return "secretary.live.audio_receiving" }
        if connected { return "secretary.live.transcript_only" }
        return "secretary.live.connecting"
    }
}
