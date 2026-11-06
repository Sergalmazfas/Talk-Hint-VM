#if DEBUG
import UIKit

/// Local native fixtures, not an alternative AI backend. No real auth/session
/// storage, URLSession, provider, upload, STT or call requests are used here.
@MainActor
enum ChatApprovedPreview {
    enum State: String, CaseIterable {
        case dialogue, empty, editing, recording, recognizing
    }

    static func make(state: State = .dialogue) -> ChatViewController {
        let owner = "chat-reference-offline"
        let defaults = UserDefaults(suiteName: "app.talkhint.chat-reference-preview")!
        let store = ChatOutbox(owner: owner, origin: "https://offline-preview.invalid", defaults: defaults)
        // Each choice has its own draft. Never read or overwrite the real user.
        let conversationID = "reference-\(state.rawValue)"
        store.selectedConversationId = state == .empty ? nil : conversationID
        let api = APIClient(transport: { request in
            let object: [String: Any]
            var code = 200
            let date = Calendar.current.date(bySettingHour: 9, minute: 41, second: 0, of: Date()) ?? Date()
            let timestamp = ISO8601DateFormatter().string(from: date)
            guard request.httpMethod == "GET" else {
                return (try JSONSerialization.data(withJSONObject: ["error": "OFFLINE_PREVIEW_READ_ONLY"]),
                        HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!)
            }
            switch request.url!.path {
            case "/api/chat-v1/capabilities":
                object = ["ai": ["available": false], "voice": ["available": false],
                          "attachments": ["available": false, "mimeTypes": [], "maxBytes": 2097152]]
            case "/api/chat-v1/conversations":
                object = ["conversations": state == .empty ? [] : [
                    ["id": conversationID, "title": NSLocalizedString("chat.screen.title", comment: ""),
                     "createdAt": timestamp, "updatedAt": timestamp]
                ]]
            case "/api/chat-v1/conversations/\(conversationID)/messages":
                object = ["messages": (1...5).map { index in
                    ["id": "reference-\(index)", "conversationId": conversationID, "sequence": index,
                     "role": [1, 3].contains(index) ? "user" : "assistant",
                     "text": NSLocalizedString("chat.preview.message.\(index)", comment: ""),
                     "status": "complete", "attachmentIds": [], "createdAt": timestamp] as [String: Any]
                }, "hasMore": false]
            default:
                object = ["error": "OFFLINE_PREVIEW_ROUTE_UNAVAILABLE"]
                code = 404
            }
            return (try JSONSerialization.data(withJSONObject: object),
                    HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline-preview-not-a-credential" })
        let chat = ChatViewController(api: api, ownerId: owner, currentOwnerId: { owner },
                                      draftStore: store, appearance: .approvedReference)
        chat.onOfflinePreviewLoaded = { [weak chat] in chat?.applyOfflinePreviewState(state) }
        return chat
    }
}

/// A launch screen only for the ChatPreview build configuration. It does not
/// replace any app tab and does not expose future navigation/features.
@MainActor
final class ChatApprovedPreviewHost: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        let title = UILabel()
        title.text = NSLocalizedString("chat.preview.title", comment: "")
        title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        title.numberOfLines = 0
        stack.addArrangedSubview(title)
        let notice = UILabel()
        notice.text = NSLocalizedString("chat.preview.notice", comment: "")
        notice.font = .preferredFont(forTextStyle: .body)
        notice.adjustsFontForContentSizeCategory = true
        notice.numberOfLines = 0
        stack.addArrangedSubview(notice)
        for state in ChatApprovedPreview.State.allCases {
            let button = UIButton(type: .system)
            button.setTitle(NSLocalizedString("chat.preview.\(state.rawValue)", comment: ""), for: .normal)
            button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.titleLabel?.numberOfLines = 0
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
            button.addAction(UIAction { [weak self] _ in
                guard let self, self.presentedViewController == nil else { return }
                let chat = ChatApprovedPreview.make(state: state)
                let nav = ChatNavigationController(chat: chat)
                chat.onClose = { [weak nav] in nav?.dismiss(animated: true) }
                self.present(nav, animated: true)
            }, for: .touchUpInside)
            stack.addArrangedSubview(button)
        }
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            stack.topAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
        ])
    }
}
#endif
