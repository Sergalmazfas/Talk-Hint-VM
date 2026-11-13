import Foundation

enum ChatVoicePresentation {
    /// Keep full history on the server/text screen, not in the voice screen's viewport.
    static func latestUtterance(_ texts: [String]) -> String {
        texts.reversed().first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? ""
    }
}

/// Chat-only proposal. The active value stays 1.2 until device testing/approval.
/// No Katya/Retell timers reference this type.
enum ChatVoicePausePolicy {
    static let currentSeconds: Double = 1.2
    static let proposedSeconds: Double = 0.8
    static func wouldEnd(silence: Double, threshold: Double) -> Bool { silence >= threshold }
}

/// UTF-16 offsets match the persisted JavaScript string. Never waits for the full answer.
struct ChatVoiceSentenceCursor {
    private(set) var offset = 0
    mutating func next(_ text: String, complete: Bool) -> (offset: Int, length: Int)? {
        let source = text as NSString
        guard source.length > offset else { return nil }
        let maximum = min(source.length, offset + 400)
        var end: Int?
        for i in offset..<maximum {
            let char = source.character(at: i)
            if char == 10 || char == 33 || char == 63 || char == 46 {
                // A decimal price is not the end of a sentence. At a streaming
                // trailing dot, wait one more character to disambiguate.
                if char == 46 {
                    if i + 1 == source.length && !complete { continue }
                    let before = i > 0 ? source.character(at: i - 1) : 0
                    let after = i + 1 < source.length ? source.character(at: i + 1) : 0
                    if (48...57).contains(before) && (48...57).contains(after) { continue }
                }
                end = i + 1; break
            }
        }
        if end == nil && source.length - offset >= 400 {
            // Bound long unpunctuated output at whitespace, not inside a token/number.
            for i in stride(from: maximum - 1, through: offset + 1, by: -1) {
                if source.character(at: i) == 32 { end = i + 1; break }
            }
        }
        if end == nil && complete { end = source.length }
        guard let end else { return nil }
        let result = (offset: offset, length: end - offset)
        offset = end
        return result
    }
}

/// One actual turn, one clock. No mixing of medians or synthesized timing.
struct ChatVoiceLatencyTrace {
    var speechEnd: Double
    var vadFinished: Double
    var sttStarted: Double?
    var sttFinished: Double?
    var submissionStarted: Double?
    var accepted: Double?
    var sentenceReady: Double?
    var ttsStarted: Double?
    func payload(messageId: String, render: Double, outputLatency: Double) -> [String: Any]? {
        guard let sttStarted, let sttFinished, let submissionStarted, let accepted,
              let sentenceReady, let ttsStarted,
              speechEnd <= vadFinished, vadFinished <= sttStarted, sttStarted <= sttFinished,
              sttFinished <= submissionStarted, submissionStarted <= accepted,
              accepted <= sentenceReady, sentenceReady <= ttsStarted, ttsStarted <= render else { return nil }
        func ms(_ duration: Double) -> Double { duration * 1000 }
        return [
            "requestId": UUID().uuidString, "messageId": messageId,
            "speechEndToVadMs": ms(vadFinished - speechEnd),
            "sttMs": ms(sttFinished - sttStarted),
            "submissionMs": ms(accepted - submissionStarted),
            "acceptedToFirstSentenceMs": ms(sentenceReady - accepted),
            "handoffWaitMs": ms(sttStarted - vadFinished + submissionStarted - sttFinished + ttsStarted - sentenceReady),
            "ttsToFirstRenderMs": ms(render - ttsStarted),
            "estimatedOutputLatencyMs": ms(outputLatency),
            "speechEndToEstimatedFirstSoundMs": ms(render + outputLatency - speechEnd),
        ]
    }
}
