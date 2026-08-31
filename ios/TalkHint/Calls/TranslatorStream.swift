import Foundation

enum TranslatorStreamEvent {
    case connected(model: String)
    case sourceTranscript(String)
    case translatedTranscriptDelta(String)
    case translatedTranscriptDone(String)
    case audio(Data)
    case turnCompleted
    case error(String, fatal: Bool)
    case closed
}

protocol TranslatorStreamDelegate: AnyObject {
    func translatorStream(_ stream: TranslatorStream, didReceive event: TranslatorStreamEvent)
}

/// Authenticated, native-only transport for the standalone Translator tab.
/// It intentionally does not share CallHintStream or the /ui socket.
final class TranslatorStream: NSObject, URLSessionWebSocketDelegate {
    weak var delegate: TranslatorStreamDelegate?

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var generation = 0
    private(set) var isConnected = false

    func connect() {
        guard task == nil else { return }
        guard let token = SessionStore.shared.token else {
            emit(.error(NSLocalizedString("translator.error.sign_in", comment: ""), fatal: true))
            return
        }

        guard let url = Self.websocketURL(baseURL: AppConfig.webSocketBaseURL, token: token) else {
            emit(.error(NSLocalizedString("translator.error.connection", comment: ""), fatal: true))
            return
        }

        let configuration = URLSessionConfiguration.default
        let socketSession = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        session = socketSession
        let socket = socketSession.webSocketTask(with: url)
        generation += 1
        task = socket
        socket.resume()
    }

    func stop() {
        isConnected = false
        generation += 1
        let stoppedTask = task
        let stoppedSession = session
        task = nil
        session = nil
        if let stoppedTask = stoppedTask, stoppedTask.state == .running {
            send(["type": "stop"], over: stoppedTask)
            stoppedTask.cancel(with: .normalClosure, reason: nil)
        } else {
            stoppedTask?.cancel()
        }
        stoppedSession?.invalidateAndCancel()
    }

    func sendAudio(_ data: Data) {
        guard isConnected, let task = task else { return }
        task.send(.data(data)) { [weak self] error in
            guard let self = self, self.task === task else { return }
            if let error = error {
                self.emit(.error(error.localizedDescription, fatal: false))
            }
        }
    }

    private func send(_ payload: [String: Any], over targetTask: URLSessionWebSocketTask? = nil) {
        guard let activeTask = targetTask ?? task,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        activeTask.send(.string(text)) { [weak self] error in
            guard let self = self else { return }
            if let error = error, self.task === activeTask {
                self.emit(.error(error.localizedDescription, fatal: false))
            }
        }
    }

    private func receiveNext(on receivingTask: URLSessionWebSocketTask, generation: Int) {
        receivingTask.receive { [weak self] result in
            guard let self = self,
                  self.generation == generation,
                  self.task === receivingTask else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handle(text: text)
                case .data(let data):
                    self.emit(.audio(data))
                @unknown default:
                    break
                }
                self.receiveNext(on: receivingTask, generation: generation)
            case .failure(let error):
                self.isConnected = false
                self.emit(.error(error.localizedDescription, fatal: true))
            }
        }
    }

    private func handle(text: String) {
        guard let event = Self.decode(text) else { return }
        if case .closed = event {
            isConnected = false
        }
        emit(event)
    }

    static func websocketURL(baseURL: URL, token: String) -> URL? {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("translator"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        return components?.url
    }

    static func decode(_ text: String) -> TranslatorStreamEvent? {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return nil }

        switch type {
        case "session_config":
            return .connected(model: (object["model"] as? String) ?? "gpt-realtime")
        case "source_transcript":
            guard let text = object["text"] as? String, !text.isEmpty else { return nil }
            return .sourceTranscript(text)
        case "translated_transcript_delta":
            guard let text = object["text"] as? String, !text.isEmpty else { return nil }
            return .translatedTranscriptDelta(text)
        case "translated_transcript_done":
            guard let text = object["text"] as? String, !text.isEmpty else { return nil }
            return .translatedTranscriptDone(text)
        case "audio":
            guard let encoded = object["data"] as? String,
                  let data = Data(base64Encoded: encoded) else { return nil }
            return .audio(data)
        case "turn_completed":
            return .turnCompleted
        case "error":
            return .error(
                (object["message"] as? String) ?? NSLocalizedString("translator.error.connection", comment: ""),
                fatal: (object["fatal"] as? Bool) ?? false
            )
        case "closed":
            return .closed
        default:
            // Provider diagnostics such as ready and speech_started do not
            // alter the native screen state.
            return nil
        }
    }

    private func emit(_ event: TranslatorStreamEvent) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.delegate?.translatorStream(self, didReceive: event)
        }
    }

    // MARK: URLSessionWebSocketDelegate

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        guard task === webSocketTask else { return }
        isConnected = true
        let openedGeneration = generation
        send(
            ["type": "start", "languages": ["ru", "en"], "sourceLangHint": "auto"],
            over: webSocketTask
        )
        receiveNext(on: webSocketTask, generation: openedGeneration)
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        guard task === webSocketTask else { return }
        isConnected = false
        task = nil
        let closedSession = self.session
        self.session = nil
        closedSession?.invalidateAndCancel()
        emit(.closed)
    }
}