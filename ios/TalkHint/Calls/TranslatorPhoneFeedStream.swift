import Foundation

/// Read-only event feed for an active PSTN translator call. This intentionally
/// has no start/send-audio API: Twilio media streams own every microphone leg.
enum TranslatorPhoneFeedEvent: Equatable {
    case transcript(leg: String, source: String, translation: String?, isFinal: Bool)
    case translation(leg: String, text: String, isFinal: Bool)
    case translationDelta(leg: String, text: String)
    case turnCompleted(leg: String)
    case error(String, fatal: Bool)
}

protocol TranslatorPhoneFeedStreamDelegate: AnyObject {
    func translatorPhoneFeed(_ stream: TranslatorPhoneFeedStream, didReceive event: TranslatorPhoneFeedEvent)
    func translatorPhoneFeedDidConnect(_ stream: TranslatorPhoneFeedStream)
}

final class TranslatorPhoneFeedStream: NSObject, URLSessionWebSocketDelegate {
    weak var delegate: TranslatorPhoneFeedStreamDelegate?
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?

    func connect() {
        guard task == nil, let token = SessionStore.shared.token else {
            if SessionStore.shared.token == nil { emit(.error(NSLocalizedString("translator.error.sign_in", comment: ""), fatal: true)) }
            return
        }
        guard let url = Self.websocketURL(baseURL: AppConfig.webSocketBaseURL, token: token) else {
            emit(.error(NSLocalizedString("translator.error.connection", comment: ""), fatal: true))
            return
        }
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: url)
        self.session = session
        self.task = task
        task.resume()
    }

    func stop() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    static func websocketURL(baseURL: URL, token: String) -> URL? {
        var components = URLComponents(url: baseURL.appendingPathComponent("translator-feed"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        return components?.url
    }

    static func decode(_ text: String) -> TranslatorPhoneFeedEvent? {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return nil }
        let leg = (object["leg"] as? String) ?? "owner"
        switch type {
        case "translator_source_transcript", "translator_transcript", "transcript", "source_transcript":
            let source = (object["sourceTranscript"] as? String) ?? (object["source"] as? String)
                ?? (object["text"] as? String) ?? ""
            let translation = (object["translatedTranscript"] as? String) ?? (object["translation"] as? String)
            guard !source.isEmpty else { return nil }
            // A source event opens a turn. It stays mutable until its explicit
            // turn_completed event so translated deltas/done can update the
            // same card. Ignore a stray isFinal on source events.
            return .transcript(leg: leg, source: source, translation: translation,
                               isFinal: !(type == "source_transcript" || type == "translator_source_transcript")
                                   && ((object["isFinal"] as? Bool) ?? false))
        case "translator_translation_delta", "translation_delta", "translated_transcript_delta":
            guard let delta = (object["translatedTranscript"] as? String) ?? (object["text"] as? String),
                  !delta.isEmpty else { return nil }
            return .translationDelta(leg: leg, text: delta)
        case "translator_translation", "translated_transcript_done":
            guard let translated = (object["translatedTranscript"] as? String) ?? (object["translation"] as? String)
                ?? (object["text"] as? String), !translated.isEmpty else { return nil }
            return .translation(leg: leg, text: translated, isFinal: true)
        case "translator_turn_completed", "turn_completed":
            return .turnCompleted(leg: leg)
        case "translator_error", "error":
            return .error((object["message"] as? String) ?? NSLocalizedString("translator.error.connection", comment: ""),
                          fatal: (object["fatal"] as? Bool) ?? true)
        default:
            return nil
        }
    }

    private func receiveNext(_ socket: URLSessionWebSocketTask) {
        socket.receive { [weak self] result in
            guard let self, self.task === socket else { return }
            if case let .success(message) = result {
                if case let .string(text) = message, let event = Self.decode(text) { self.emit(event) }
                self.receiveNext(socket)
            } else if case let .failure(error) = result {
                self.emit(.error(error.localizedDescription, fatal: true))
            }
        }
    }

    private func emit(_ event: TranslatorPhoneFeedEvent) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.translatorPhoneFeed(self, didReceive: event)
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard task === webSocketTask else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.translatorPhoneFeedDidConnect(self)
        }
        receiveNext(webSocketTask)
    }
}