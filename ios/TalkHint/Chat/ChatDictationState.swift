import Foundation

/// Pure, deterministic dictation lifecycle. No microphone, network or send authority.
struct ChatDictationState {
    enum Phase: Equatable { case idle, permission, recording, recognizing, failed }
    struct Context: Equatable {
        let ownerId: String
        let conversationId: String?
        let draftRevision: Int
    }
    struct Capture {
        let id: UUID
        let context: Context
        let text: String
        let selection: NSRange
    }
    private(set) var phase: Phase = .idle
    private(set) var capture: Capture?
    private(set) var attemptId: UUID?
    var isBusy: Bool { phase != .idle }

    mutating func begin(context: Context, text: String, selection: NSRange) -> UUID? {
        guard phase == .idle else { return nil }
        let id = UUID()
        capture = Capture(id: id, context: context, text: text, selection: selection)
        phase = .permission
        return id
    }
    mutating func allow(_ id: UUID) -> Bool {
        guard capture?.id == id, phase == .permission else { return false }
        phase = .recording
        return true
    }
    mutating func recognize() -> UUID? {
        guard phase == .recording || phase == .failed else { return nil }
        let id = UUID()
        attemptId = id
        phase = .recognizing
        return id
    }
    func accepts(_ id: UUID, context: Context) -> Bool {
        phase == .recognizing && attemptId == id && capture?.context == context
    }
    mutating func fail(_ id: UUID) {
        guard phase == .recognizing, attemptId == id else { return }
        phase = .failed
        attemptId = nil
    }
    /// Inserts at the original UTF-16 selection, preserving existing draft text.
    /// Whitespace separates dictation from existing words without erasing them.
    mutating func finish(_ id: UUID, context: Context, transcript: String) -> (text: String, caret: Int)? {
        guard accepts(id, context: context), let capture else { return nil }
        let spoken = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !spoken.isEmpty else { fail(id); return nil }
        let original = capture.text as NSString
        let start = min(max(0, capture.selection.location), original.length)
        let length = min(max(0, capture.selection.length), original.length - start)
        let before = original.substring(to: start)
        let after = original.substring(from: start + length)
        let prefix = before.last.map { $0.isWhitespace ? "" : " " } ?? ""
        let suffix = after.first.map { $0.isWhitespace ? "" : " " } ?? ""
        let insertion = prefix + spoken + suffix
        let result = original.replacingCharacters(in: NSRange(location: start, length: length), with: insertion)
        cancel()
        return (result, start + (prefix + spoken).utf16.count)
    }
    mutating func cancel() {
        phase = .idle
        capture = nil
        attemptId = nil
    }
}

/// Future full-screen Voice Orb must reuse this chat identity, not start a
/// second history. This contract grants no microphone or external-action access.
struct ChatVoiceConversationContext: Equatable {
    let ownerId: String
    let conversationId: String
}
