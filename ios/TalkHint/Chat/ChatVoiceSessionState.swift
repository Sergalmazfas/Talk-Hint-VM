import Foundation

/// No credentials, phone permissions or model privileges are inferred from voice text.
struct ChatVoiceSessionState {
    enum Phase: String {
        case ready, permission, listening, recognizing, thinking, speaking, muted, error, closed
    }
    private(set) var phase: Phase = .ready
    private(set) var revision = UUID()
    private(set) var microphoneEnabled = false
    private(set) var readback: (messageID: String, planHash: String)?

    mutating func transition(_ next: Phase) {
        phase = next
    }
    mutating func microphone(_ enabled: Bool) {
        microphoneEnabled = enabled
        if !enabled { invalidateReadback(); phase = .muted }
    }
    mutating func interrupt() {
        revision = UUID()
        invalidateReadback()
        if phase != .closed { phase = microphoneEnabled ? .listening : .muted }
    }
    mutating func close() {
        interrupt()
        microphoneEnabled = false
        phase = .closed
    }
    mutating func invalidateReadback() { readback = nil }

    /// May ONLY be called by a real output player's successful end-of-readback callback.
    /// Partial/queued/cancelled audio must never arm approval.
    mutating func didFinishAudibleReadback(messageID: String, planHash: String, revision: UUID) {
        guard self.revision == revision, phase == .speaking else { return }
        readback = (messageID, planHash)
        phase = .listening
    }
    mutating func takeApproval(text: String, messageID: String, planHash: String) -> Bool {
        defer { invalidateReadback() } // One shot; any different answer requires fresh readback.
        guard phase != .closed, let readback,
              readback.messageID == messageID, readback.planHash == planHash else { return false }
        let answer = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".!"))
        return ["yes", "yes, call", "call", "да", "звони", "да, звони", "sí", "si", "llama", "так", "иә"].contains(answer)
    }
}
