import Foundation

/// The hint stream owns one connection at a time. Tests can suspend delivery
/// without touching the network; normal clients always use URLSession below.
protocol CallHintSocket: AnyObject {
    var response: URLResponse? { get }
    func resume()
    func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void)
    func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping (Error?) -> Void)
    func cancel()
}

final class URLSessionCallHintSocket: CallHintSocket {
    private let session: URLSession
    private let task: URLSessionWebSocketTask

    init(url: URL) {
        let session = URLSession(configuration: .default)
        self.session = session
        self.task = session.webSocketTask(with: url)
    }

    deinit { cancel() }

    var response: URLResponse? { task.response }
    func resume() { task.resume() }

    func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
        task.receive(completionHandler: completionHandler)
    }

    func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping (Error?) -> Void) {
        task.send(message, completionHandler: completionHandler)
    }

    func cancel() {
        task.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }
}
