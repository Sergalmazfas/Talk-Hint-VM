import UIKit
import UniformTypeIdentifiers
import AVFoundation
import QuickLook

@MainActor
final class ChatViewController: UIViewController, UITextViewDelegate, UIDocumentPickerDelegate,
                               UIScrollViewDelegate, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    private let api: APIClient
    private let sessionScope: ChatSessionScope
    private let scroll = UIScrollView()
    private let messagesStack = UIStackView()
    private let composer = UITextView()
    private let sendButton = UIButton(type: .system)
    private var fileButton = UIButton(type: .system)
    private var voiceButton = UIButton(type: .system)
    private let removeAttachmentButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let retryButton = UIButton(type: .system)
    private let topTitle = UILabel()
    private var drawer: UIView?
    private var conversations: [ChatConversation] = []
    private var messages: [ChatMessage] = []
    private var attachments: [ChatAttachment] = []
    private var attachmentCache: [String: ChatAttachment] = [:]
    private var capabilities: ChatCapabilities?
    private var currentConversation: ChatConversation?
    private var outbox: ChatOutbox?
    private var pollTask: Task<Void, Never>?
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var previousAudioCategory: AVAudioSession.Category?
    private var previousAudioMode: AVAudioSession.Mode?
    private var previousAudioOptions: AVAudioSession.CategoryOptions = []
    private var isSending = false
    private var isCreatingConversation = false
    private var pendingCreationPreservesDraft = false
    private var hasMoreMessages = false
    private var isLoadingOlder = false
    private var drafts: [String: String] = [:]
    private var attachmentRetry: (name: String, mime: String, data: Data, requestId: UUID)?
    private var isUploadingAttachment = false
    private var previewURL: URL?
    private var recordingLimitTask: Task<Void, Never>?

    override init(nibName nibNameOrNil: String? = nil, bundle nibBundleOrNil: Bundle? = nil) {
        let owner = SessionStore.shared.userId
        sessionScope = ChatSessionScope(ownerId: owner)
        api = Self.makeChatClient(scope: ChatSessionScope(ownerId: owner), token: SessionStore.shared.token)
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    }
    required init?(coder: NSCoder) {
        let owner = SessionStore.shared.userId
        sessionScope = ChatSessionScope(ownerId: owner)
        api = Self.makeChatClient(scope: ChatSessionScope(ownerId: owner), token: SessionStore.shared.token)
        super.init(coder: coder)
    }
    private static func makeChatClient(scope: ChatSessionScope, token: String?) -> APIClient {
        APIClient(transport: { request in try await URLSession.shared.data(for: request) },
                  tokenProvider: {
            guard scope.permits(currentUserId: SessionStore.shared.userId) else { return nil }
            return token
        })
    }
    private var isCurrentOwner: Bool {
        sessionScope.permits(currentUserId: SessionStore.shared.userId)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.985, green: 0.988, blue: 0.982, alpha: 1)
        navigationItem.title = nil
        build()
        configureOwner()
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        guard isCurrentOwner else { return }
        Task { await load() }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        pollTask?.cancel()
        stopRecording(discard: true)
    }
    private func configureOwner() {
        guard let owner = sessionScope.ownerId else { return }
        outbox = ChatOutbox(owner: owner)
    }
    private func build() {
        let header = UIView()
        let menu = iconButton("line.3.horizontal", title: NSLocalizedString("chat.recent", comment: ""), action: #selector(toggleDrawer))
        let new = iconButton("square.and.pencil", title: NSLocalizedString("chat.new", comment: ""), action: #selector(newChat))
        topTitle.text = NSLocalizedString("tab.chat", comment: "")
        topTitle.font = .preferredFont(forTextStyle: .headline)
        topTitle.adjustsFontForContentSizeCategory = true
        topTitle.textColor = UIColor(red: 0.12, green: 0.19, blue: 0.15, alpha: 1)
        let headerStack = UIStackView(arrangedSubviews: [menu, topTitle, new])
        headerStack.axis = .horizontal; headerStack.alignment = .center
        headerStack.distribution = .equalSpacing
        headerStack.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(headerStack)
        view.addSubview(header)
        header.translatesAutoresizingMaskIntoConstraints = false

        messagesStack.axis = .vertical; messagesStack.spacing = 18
        messagesStack.alignment = .fill
        scroll.delegate = self
        scroll.keyboardDismissMode = .interactive
        scroll.addSubview(messagesStack); scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = UIColor(red: 0.42, green: 0.46, blue: 0.43, alpha: 1)
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        retryButton.setTitle(NSLocalizedString("chat.retry", comment: ""), for: .normal)
        retryButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        let statusRow = UIStackView(arrangedSubviews: [statusLabel, retryButton])
        statusRow.axis = .horizontal; statusRow.alignment = .center; statusRow.spacing = 8
        view.addSubview(statusRow); statusRow.translatesAutoresizingMaskIntoConstraints = false

        let inputCard = UIView()
        inputCard.backgroundColor = .white
        inputCard.layer.cornerRadius = 22
        inputCard.layer.borderColor = UIColor(red: 0.87, green: 0.9, blue: 0.86, alpha: 1).cgColor
        inputCard.layer.borderWidth = 1
        composer.font = .preferredFont(forTextStyle: .body)
        composer.adjustsFontForContentSizeCategory = true
        composer.delegate = self
        composer.accessibilityLabel = NSLocalizedString("chat.message.placeholder", comment: "")
        composer.backgroundColor = .clear
        composer.text = NSLocalizedString("chat.message.placeholder", comment: "")
        composer.textColor = UIColor.secondaryLabel
        composer.textContainerInset = UIEdgeInsets(top: 13, left: 12, bottom: 8, right: 12)
        inputCard.addSubview(composer); composer.translatesAutoresizingMaskIntoConstraints = false
        fileButton = iconButton("paperclip", title: NSLocalizedString("chat.attach", comment: ""), action: #selector(pickFile))
        voiceButton = iconButton("waveform", title: NSLocalizedString("chat.voice", comment: ""), action: #selector(toggleRecording))
        removeAttachmentButton.setImage(UIImage(systemName: "xmark.circle"), for: .normal)
        removeAttachmentButton.tintColor = .secondaryLabel
        removeAttachmentButton.accessibilityLabel = NSLocalizedString("chat.removeAttachment", comment: "")
        removeAttachmentButton.isHidden = true
        removeAttachmentButton.addTarget(self, action: #selector(removeLastAttachment), for: .touchUpInside)
        sendButton.setImage(UIImage(systemName: "arrow.up"), for: .normal)
        sendButton.tintColor = .white; sendButton.backgroundColor = UIColor(red: 0.23, green: 0.55, blue: 0.38, alpha: 1)
        sendButton.layer.cornerRadius = 20; sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        sendButton.accessibilityLabel = NSLocalizedString("chat.send", comment: "")
        let controls = UIStackView(arrangedSubviews: [fileButton, voiceButton, removeAttachmentButton, UIView(), sendButton])
        controls.axis = .horizontal; controls.alignment = .center; controls.spacing = 8
        inputCard.addSubview(controls); controls.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(inputCard); inputCard.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            header.heightAnchor.constraint(equalToConstant: 48),
            headerStack.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            headerStack.trailingAnchor.constraint(equalTo: header.trailingAnchor),
            headerStack.topAnchor.constraint(equalTo: header.topAnchor),
            headerStack.bottomAnchor.constraint(equalTo: header.bottomAnchor),
            scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            scroll.bottomAnchor.constraint(equalTo: statusRow.topAnchor, constant: -6),
            statusRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            statusRow.bottomAnchor.constraint(equalTo: inputCard.topAnchor, constant: -8),
            inputCard.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            inputCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            inputCard.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
            composer.topAnchor.constraint(equalTo: inputCard.topAnchor, constant: 2),
            composer.leadingAnchor.constraint(equalTo: inputCard.leadingAnchor, constant: 4),
            composer.trailingAnchor.constraint(equalTo: inputCard.trailingAnchor, constant: -4),
            composer.heightAnchor.constraint(greaterThanOrEqualToConstant: 45),
            composer.heightAnchor.constraint(lessThanOrEqualToConstant: 120),
            controls.topAnchor.constraint(equalTo: composer.bottomAnchor, constant: 3),
            controls.leadingAnchor.constraint(equalTo: inputCard.leadingAnchor, constant: 12),
            controls.trailingAnchor.constraint(equalTo: inputCard.trailingAnchor, constant: -12),
            controls.bottomAnchor.constraint(equalTo: inputCard.bottomAnchor, constant: -9),
            sendButton.widthAnchor.constraint(equalToConstant: 40), sendButton.heightAnchor.constraint(equalToConstant: 40),
            messagesStack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            messagesStack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16),
            messagesStack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
        ])
        statusLabel.text = NSLocalizedString("chat.disclaimer", comment: "")
        renderMessages()
    }
    private func iconButton(_ symbol: String, title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.setTitle(title.isEmpty ? nil : " " + title, for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.tintColor = UIColor(red: 0.2, green: 0.36, blue: 0.27, alpha: 1)
        button.addTarget(self, action: action, for: .touchUpInside)
        button.accessibilityLabel = title
        return button
    }
    private func load() async {
        guard isCurrentOwner else { return }
        do {
            async let caps = api.chatCapabilities()
            async let recent = api.chatConversations()
            capabilities = try await caps
            guard isCurrentOwner else { return }
            fileButton.isEnabled = (capabilities?.attachments.available ?? false) && attachments.count < 3
            voiceButton.isEnabled = capabilities?.voice.available ?? true
            conversations = try await recent
            guard isCurrentOwner else { return }
            if let selected = outbox?.selectedConversationId,
               let conversation = conversations.first(where: { $0.id == selected }) {
                await open(conversation)
            } else if let first = conversations.first {
                await open(first)
            } else {
                showWelcome()
            }
        } catch { if isCurrentOwner { showError(error) } }
    }
    private func showWelcome() {
        currentConversation = nil
        messages = []
        hasMoreMessages = false
        renderMessages()
        topTitle.text = NSLocalizedString("chat.title", comment: "")
    }
    @objc private func newChat() {
        guard isCurrentOwner else { return }
        createNewChat(preservingDraft: false)
    }
    private func createNewChat(preservingDraft: Bool) {
        let draft = composer.text == NSLocalizedString("chat.message.placeholder", comment: "") ? "" : composer.text
        guard let outbox, !isCreatingConversation, !isUploadingAttachment else { return }
        isCreatingConversation = true
        pendingCreationPreservesDraft = preservingDraft
        let requestId = outbox.beginConversationRequest()
        Task {
            do {
                let conversation = try await api.createChatConversation(requestId: requestId)
                guard isCurrentOwner else { isCreatingConversation = false; return }
                outbox.finishConversationRequest()
                pendingCreationPreservesDraft = false
                retryButton.removeTarget(self, action: #selector(retryPendingConversation), for: .touchUpInside)
                retryButton.isHidden = true
                if !conversations.contains(where: { $0.id == conversation.id }) { conversations.insert(conversation, at: 0) }
                await open(conversation)
                if isCurrentOwner, preservingDraft, !draft.isEmpty {
                    composer.text = draft
                    composer.textColor = .label
                }
            } catch {
                if isCurrentOwner {
                    showError(error)
                    retryButton.removeTarget(self, action: #selector(retryLoad), for: .touchUpInside)
                    retryButton.addTarget(self, action: #selector(retryPendingConversation), for: .touchUpInside)
                }
            }
            isCreatingConversation = false
        }
    }
    @objc private func retryPendingConversation() {
        createNewChat(preservingDraft: pendingCreationPreservesDraft)
    }
    private func open(_ conversation: ChatConversation) async {
        guard isCurrentOwner else { return }
        if currentConversation?.id != conversation.id && isUploadingAttachment {
            statusLabel.text = NSLocalizedString("chat.file.uploading", comment: "")
            return
        }
        if currentConversation?.id != conversation.id {
            attachmentRetry = nil
            fileButton.isEnabled = (capabilities?.attachments.available ?? false) && attachments.count < 3
            retryButton.isHidden = true
        }
        if let old = currentConversation {
            let oldDraft = composer.text == NSLocalizedString("chat.message.placeholder", comment: "") ? "" : composer.text
            drafts[old.id] = oldDraft
        }
        if currentConversation?.id != conversation.id {
            let restoredDraft = drafts[conversation.id] ?? ""
            if currentConversation != nil { attachments = [] }
            composer.text = restoredDraft.isEmpty ? NSLocalizedString("chat.message.placeholder", comment: "") : restoredDraft
            composer.textColor = restoredDraft.isEmpty ? .secondaryLabel : .label
            renderAttachmentStatus()
        }
        currentConversation = conversation
        outbox?.selectedConversationId = conversation.id
        topTitle.text = displayTitle(conversation)
        do {
            let page = try await api.chatMessages(conversationId: conversation.id)
            guard isCurrentOwner, currentConversation?.id == conversation.id else { return }
            messages = ChatOutbox.merge([], page.messages)
            hasMoreMessages = page.hasMore
            loadAttachmentMetadata(in: page.messages, conversationId: conversation.id)
            renderMessages()
            updatePolling()
            await recoverOutbox()
        } catch { if isCurrentOwner, currentConversation?.id == conversation.id { showError(error) } }
    }
    private func displayTitle(_ conversation: ChatConversation) -> String {
        conversation.title.isEmpty || conversation.title == "New chat"
            ? NSLocalizedString("chat.new", comment: "") : conversation.title
    }
    @objc private func toggleDrawer() {
        if let drawer { UIView.animate(withDuration: 0.22, animations: { drawer.transform = CGAffineTransform(translationX: -320, y: 0); drawer.alpha = 0 }) { _ in drawer.removeFromSuperview(); self.drawer = nil }; return }
        let panel = UIView(); panel.backgroundColor = UIColor(red: 0.98, green: 0.98, blue: 0.96, alpha: 0.99)
        panel.layer.cornerRadius = 20
        let list = UIStackView(); list.axis = .vertical; list.spacing = 6
        let title = UILabel(); title.text = NSLocalizedString("chat.recent", comment: ""); title.font = .preferredFont(forTextStyle: .title2)
        list.addArrangedSubview(title)
        let create = UIButton(type: .system); create.setTitle(NSLocalizedString("chat.new", comment: ""), for: .normal)
        create.contentHorizontalAlignment = .leading; create.addTarget(self, action: #selector(newChat), for: .touchUpInside); list.addArrangedSubview(create)
        for conversation in conversations {
            let item = UIButton(type: .system); item.setTitle(displayTitle(conversation), for: .normal); item.contentHorizontalAlignment = .leading
            item.titleLabel?.numberOfLines = 2
            item.addAction(UIAction { [weak self, weak panel] _ in
                guard let self else { return }
                UIView.animate(withDuration: 0.18, animations: { panel?.alpha = 0 }) { _ in panel?.removeFromSuperview(); self.drawer = nil }
                Task { await self.open(conversation) }
            }, for: .touchUpInside)
            list.addArrangedSubview(item)
        }
        for future in ["chat.calendar", "chat.notebook", "chat.tasks", "chat.files", "chat.mail", "chat.card", "chat.connections", "chat.tariff"] {
            let label = UILabel(); label.text = NSLocalizedString(future, comment: "") + " · " + NSLocalizedString("chat.coming", comment: "")
            label.textColor = .secondaryLabel; label.font = .preferredFont(forTextStyle: .subheadline); list.addArrangedSubview(label)
        }
        let settings = UIButton(type: .system); settings.setTitle(NSLocalizedString("chat.settings", comment: ""), for: .normal)
        settings.contentHorizontalAlignment = .leading
        settings.addAction(UIAction { [weak self, weak panel] _ in
            guard let self else { return }
            panel?.removeFromSuperview(); self.drawer = nil
            self.navigationController?.pushViewController(SettingsViewController(api: self.api), animated: true)
        }, for: .touchUpInside)
        list.addArrangedSubview(settings)
        let close = UIButton(type: .system); close.setTitle(NSLocalizedString("chat.close", comment: ""), for: .normal)
        close.addTarget(self, action: #selector(toggleDrawer), for: .touchUpInside); list.addArrangedSubview(close)
        list.translatesAutoresizingMaskIntoConstraints = false; panel.addSubview(list); panel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(panel); NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8), panel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 6),
            panel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -6), panel.widthAnchor.constraint(equalToConstant: 290),
            list.topAnchor.constraint(equalTo: panel.topAnchor, constant: 20), list.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 18),
            list.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -18), list.bottomAnchor.constraint(lessThanOrEqualTo: panel.bottomAnchor, constant: -16)
        ])
        panel.transform = CGAffineTransform(translationX: -320, y: 0); panel.alpha = 0
        drawer = panel
        UIView.animate(withDuration: 0.28, delay: 0, usingSpringWithDamping: 0.88, initialSpringVelocity: 0.2) { panel.transform = .identity; panel.alpha = 1 }
    }
    private func showError(_ error: Error) {
        let message: String
        if let apiError = error as? APIError, case .http(_, let code) = apiError {
            switch code {
            case "MODEL_UNAVAILABLE": message = NSLocalizedString("chat.error.modelUnavailable", comment: "")
            case "ATTACHMENTS_UNAVAILABLE": message = NSLocalizedString("chat.error.attachmentsUnavailable", comment: "")
            case "GENERATION_INTERRUPTED": message = NSLocalizedString("chat.error.interrupted", comment: "")
            case "CHAT_BUSY": message = NSLocalizedString("chat.error.busy", comment: "")
            default: message = code.isEmpty ? NSLocalizedString("chat.error.network", comment: "") : code
            }
        } else {
            message = NSLocalizedString("chat.error.network", comment: "")
        }
        statusLabel.text = message
        statusLabel.textColor = UIColor.systemRed
        retryButton.removeTarget(self, action: #selector(retryUploadAttachment), for: .touchUpInside)
        retryButton.removeTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        retryButton.setTitle(NSLocalizedString("chat.retry", comment: ""), for: .normal)
        retryButton.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        retryButton.isHidden = false
        statusLabel.accessibilityHint = NSLocalizedString("chat.error.network", comment: "")
    }
    @objc private func retryLoad() { Task { await load() } }
    private func renderMessages() {
        let shouldStickToBottom = scroll.contentOffset.y + scroll.bounds.height >= scroll.contentSize.height - 80
        messagesStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        if messages.isEmpty {
            let welcome = UILabel(); welcome.text = NSLocalizedString("chat.welcome", comment: "")
            welcome.font = .preferredFont(forTextStyle: .title2); welcome.numberOfLines = 0; welcome.textAlignment = .center
            welcome.textColor = UIColor(red: 0.28, green: 0.35, blue: 0.3, alpha: 1)
            messagesStack.addArrangedSubview(UIView()); messagesStack.addArrangedSubview(welcome); return
        }
        for message in messages {
            let bubble = UIView()
            bubble.layer.cornerRadius = 18; bubble.layer.masksToBounds = true
            let isUser = message.role == "user"
            bubble.backgroundColor = isUser ? UIColor(red: 0.88, green: 0.94, blue: 0.88, alpha: 1) : UIColor(red: 0.94, green: 0.92, blue: 0.98, alpha: 1)
            let content = UIStackView()
            content.axis = .vertical; content.spacing = 7
            content.translatesAutoresizingMaskIntoConstraints = false
            bubble.addSubview(content)
            NSLayoutConstraint.activate([
                content.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 12),
                content.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 14),
                content.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -14),
                content.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -12),
                bubble.widthAnchor.constraint(lessThanOrEqualTo: scroll.frameLayoutGuide.widthAnchor, multiplier: 0.82),
            ])
            if !message.text.isEmpty {
                let text = UILabel()
                text.text = message.text; text.font = .preferredFont(forTextStyle: .body)
                text.adjustsFontForContentSizeCategory = true; text.numberOfLines = 0
                content.addArrangedSubview(text)
            }
            if !isUser, message.status == "queued" || message.status == "generating" {
                let progress = UILabel()
                progress.text = NSLocalizedString(message.status == "queued" ? "chat.reply.queued" : "chat.reply.generating", comment: "")
                progress.font = .preferredFont(forTextStyle: .caption1)
                progress.textColor = .secondaryLabel
                progress.numberOfLines = 0
                content.addArrangedSubview(progress)
            }
            for attachmentId in message.attachmentIds {
                let file = UIButton(type: .system)
                let filename = attachmentCache[attachmentId]?.name ?? NSLocalizedString("chat.attachment.label", comment: "")
                file.setTitle(filename, for: .normal)
                file.setImage(UIImage(systemName: "doc"), for: .normal)
                file.tintColor = UIColor(red: 0.34, green: 0.48, blue: 0.39, alpha: 1)
                file.contentHorizontalAlignment = .leading
                file.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
                file.accessibilityLabel = filename
                file.addAction(UIAction { [weak self] _ in self?.openAttachment(id: attachmentId) }, for: .touchUpInside)
                content.addArrangedSubview(file)
            }
            let row = UIStackView(arrangedSubviews: isUser ? [UIView(), bubble] : [bubble, UIView()])
            row.axis = .horizontal; row.alignment = .top; row.spacing = 32
            messagesStack.addArrangedSubview(row)
            if message.role == "assistant", message.status == "queued" || message.status == "generating" {
                let progress = UILabel()
                progress.text = NSLocalizedString(message.status == "queued" ? "chat.reply.queued" : "chat.reply.generating", comment: "")
                progress.font = .preferredFont(forTextStyle: .caption1)
                progress.textColor = UIColor(red: 0.48, green: 0.52, blue: 0.48, alpha: 1)
                messagesStack.addArrangedSubview(progress)
            }
            if ["failed", "interrupted"].contains(message.status) {
                let label = UILabel(); label.text = NSLocalizedString("chat.reply.incomplete", comment: "")
                label.textColor = .secondaryLabel; label.font = .preferredFont(forTextStyle: .caption1)
                messagesStack.addArrangedSubview(label)
            }
            if message.status == "queued", let pendingId = UUID(uuidString: message.id),
               outbox?.pendingSends.contains(where: { $0.id == pendingId }) == true {
                let retry = UIButton(type: .system)
                retry.setTitle(NSLocalizedString("chat.retry", comment: ""), for: .normal)
                retry.contentHorizontalAlignment = .leading
                retry.addAction(UIAction { [weak self] _ in self?.retrySend(pendingId) }, for: .touchUpInside)
                messagesStack.addArrangedSubview(retry)
            }
        }
        DispatchQueue.main.async {
            if shouldStickToBottom {
                self.scroll.scrollRectToVisible(CGRect(x: 0, y: self.scroll.contentSize.height - 1, width: 1, height: 1), animated: true)
            }
        }
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView.panGestureRecognizer.state == .changed,
              scrollView.panGestureRecognizer.velocity(in: scrollView).y > 0,
              scrollView.contentOffset.y < 45, hasMoreMessages, !isLoadingOlder,
              let conversation = currentConversation,
              let before = messages.map(\.sequence).min() else { return }
        isLoadingOlder = true
        let previousHeight = scrollView.contentSize.height
        Task {
            defer { isLoadingOlder = false }
            do {
                let page = try await api.chatMessages(conversationId: conversation.id, beforeSequence: before)
                guard isCurrentOwner, currentConversation?.id == conversation.id else { return }
                hasMoreMessages = page.hasMore
                messages = ChatOutbox.merge(messages, page.messages)
                loadAttachmentMetadata(in: page.messages, conversationId: conversation.id)
                renderMessages()
                DispatchQueue.main.async {
                    self.scroll.layoutIfNeeded()
                    self.scroll.contentOffset.y += max(0, self.scroll.contentSize.height - previousHeight)
                }
            } catch { if isCurrentOwner, currentConversation?.id == conversation.id { statusLabel.text = NSLocalizedString("chat.error.network", comment: "") } }
        }
    }
    @objc private func send() {
        guard isCurrentOwner else { return }
        let text = composer.text == NSLocalizedString("chat.message.placeholder", comment: "") ? "" : composer.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (!text.isEmpty || !attachments.isEmpty), !isSending,
              !isUploadingAttachment, attachmentRetry == nil else { return }
        guard let conversation = currentConversation else { createNewChat(preservingDraft: true); return }
        guard let outbox else { return }
        let pending = outbox.enqueue(conversationId: conversation.id, text: text,
                                     attachmentIds: attachments.map(\.id),
                                     language: String((Bundle.main.preferredLocalizations.first ?? "en").prefix(2)).lowercased())
        outbox.setState(.sending, for: pending.id)
        isSending = true
        composer.text = ""; composer.textColor = .label
        attachments.forEach { attachmentCache[$0.id] = $0 }
        attachments = []
        drafts[conversation.id] = ""
        renderAttachmentStatus()
        Task {
            do {
                let pair = try await api.sendChatMessage(conversationId: conversation.id, requestId: pending.id,
                                                         text: text, attachmentIds: pending.attachmentIds, language: pending.language)
                guard isCurrentOwner else { isSending = false; return }
                if currentConversation?.id == conversation.id {
                    messages = ChatOutbox.merge(messages, [pair.message] + (pair.reply.map { [$0] } ?? []))
                }
                outbox.remove(pending.id)
                renderMessages(); updatePolling()
            } catch {
                guard isCurrentOwner else { isSending = false; return }
                if var updated = outbox.pendingSends.first(where: { $0.id == pending.id }) {
                    updated.state = .uncertain
                    outbox.pendingSends = outbox.pendingSends.map { $0.id == pending.id ? updated : $0 }
                }
                showError(error)
                if currentConversation?.id == conversation.id {
                    messages.append(ChatMessage(id: pending.id.uuidString.lowercased(), conversationId: conversation.id,
                        sequence: (messages.last?.sequence ?? 0) + 1, role: "user", text: text,
                        status: "queued", clientRequestId: pending.id.uuidString.lowercased(), attachmentIds: pending.attachmentIds,
                        createdAt: ISO8601DateFormatter().string(from: Date()), errorCode: nil))
                    renderMessages()
                }
            }
            isSending = false
        }
    }
    private func recoverOutbox() async {
        guard let outbox else { return }
        guard let conversation = currentConversation else { return }
        for item in outbox.pendingSends where item.conversationId == conversation.id {
            do {
                // Reconcile server state only. A paid/model send is never replayed
                // automatically after relaunch; the user explicitly retries below.
                let latest = try await api.chatMessages(conversationId: item.conversationId)
                guard isCurrentOwner, currentConversation?.id == item.conversationId else { return }
                messages = ChatOutbox.merge(messages, latest.messages)
                if latest.messages.contains(where: { $0.clientRequestId?.lowercased() == item.id.uuidString.lowercased() }) {
                    outbox.remove(item.id)
                } else if !messages.contains(where: { $0.id.lowercased() == item.id.uuidString.lowercased() }) {
                    messages.append(ChatMessage(id: item.id.uuidString.lowercased(), conversationId: item.conversationId,
                        sequence: (messages.last?.sequence ?? 0) + 1, role: "user", text: item.text,
                        status: "queued", clientRequestId: item.id.uuidString.lowercased(), attachmentIds: item.attachmentIds,
                        createdAt: ISO8601DateFormatter().string(from: Date()), errorCode: nil))
                }
            } catch {
                statusLabel.text = NSLocalizedString("chat.error.network", comment: "")
            }
        }
        loadAttachmentMetadata(in: messages, conversationId: conversation.id)
        renderMessages()
    }
    private func retrySend(_ id: UUID) {
        guard !isSending, let outbox, let item = outbox.pendingSends.first(where: { $0.id == id }) else { return }
        guard currentConversation?.id == item.conversationId else { return }
        isSending = true
        outbox.setState(.sending, for: id)
        Task {
            defer { isSending = false }
            do {
                let result = try await api.sendChatMessage(conversationId: item.conversationId, requestId: item.id,
                    text: item.text, attachmentIds: item.attachmentIds, language: item.language)
                guard isCurrentOwner else { return }
                outbox.remove(item.id)
                if currentConversation?.id == item.conversationId {
                    messages = ChatOutbox.merge(messages, [result.message] + (result.reply.map { [$0] } ?? []))
                    loadAttachmentMetadata(in: [result.message] + (result.reply.map { [$0] } ?? []), conversationId: item.conversationId)
                    renderMessages(); updatePolling()
                }
            } catch {
                guard isCurrentOwner else { return }
                outbox.setState(.uncertain, for: item.id)
                showError(error)
            }
        }
    }
    private func updatePolling() {
        pollTask?.cancel()
        guard messages.contains(where: { $0.status == "queued" || $0.status == "generating" }),
              let conversation = currentConversation else { return }
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { break }
                do {
                    let page = try await api.chatMessages(conversationId: conversation.id)
                    if isCurrentOwner, currentConversation?.id == conversation.id {
                        messages = ChatOutbox.merge(messages, page.messages); renderMessages()
                        loadAttachmentMetadata(in: page.messages, conversationId: conversation.id)
                    }
                    if !messages.contains(where: { $0.status == "queued" || $0.status == "generating" }) { break }
                } catch { if isCurrentOwner { statusLabel.text = NSLocalizedString("chat.error.network", comment: "") } }
            }
        }
    }
    func textViewDidBeginEditing(_ textView: UITextView) {
        if textView.text == NSLocalizedString("chat.message.placeholder", comment: "") { textView.text = ""; textView.textColor = .label }
    }
    func textViewDidEndEditing(_ textView: UITextView) {
        if textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { textView.text = NSLocalizedString("chat.message.placeholder", comment: ""); textView.textColor = .secondaryLabel }
    }
    @objc private func pickFile() {
        guard isCurrentOwner else { return }
        guard attachments.count < 3 else {
            statusLabel.text = NSLocalizedString("chat.file.limit", comment: "")
            return
        }
        guard !isUploadingAttachment else { return }
        if let pending = attachmentRetry {
            uploadAttachment(name: pending.name, mime: pending.mime, data: pending.data, requestId: pending.requestId)
            return
        }
        let types: [UTType] = [.plainText, .png, .jpeg, .pdf]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = self; present(picker, animated: true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard isCurrentOwner else { return }
        guard attachments.count < 3, !isUploadingAttachment else {
            statusLabel.text = NSLocalizedString("chat.file.limit", comment: "")
            return
        }
        guard let url = urls.first else { return }
        // asCopy URLs may already be inside our sandbox and need no scope.
        // A false result is not itself a read failure; surface any real I/O error.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            let maxBytes = capabilities?.attachments.maxBytes ?? 2 * 1024 * 1024
            guard let size = values.fileSize, size <= maxBytes else {
                statusLabel.text = NSLocalizedString("chat.file.too_large", comment: ""); return
            }
            let data = try Data(contentsOf: url)
            guard let mime = Self.mimeType(url),
                  capabilities?.attachments.mimeTypes.contains(mime) != false else {
                statusLabel.text = NSLocalizedString("chat.file.error", comment: ""); return
            }
            let requestId = UUID()
            attachmentRetry = (url.lastPathComponent, mime, data, requestId)
            uploadAttachment(name: url.lastPathComponent, mime: mime, data: data, requestId: requestId)
        } catch { statusLabel.text = NSLocalizedString("chat.file.error", comment: "") }
    }
    private func uploadAttachment(name: String, mime: String, data: Data, requestId: UUID) {
        guard isCurrentOwner, attachments.count < 3, !isUploadingAttachment else { return }
        let uploadConversationId = currentConversation?.id
        isUploadingAttachment = true
        fileButton.isEnabled = false
        statusLabel.text = "\(name) · " + NSLocalizedString("chat.file.uploading", comment: "")
        statusLabel.textColor = .secondaryLabel
        removeAttachmentButton.isHidden = false
        retryButton.isHidden = true
        Task {
            do {
                let attachment = try await api.uploadChatAttachment(requestId: requestId, name: name, mimeType: mime, data: data)
                guard isCurrentOwner else { return }
                guard attachmentRetry?.requestId == requestId else { return }
                guard currentConversation?.id == uploadConversationId else { isUploadingAttachment = false; return }
                attachments.append(attachment)
                isUploadingAttachment = false
                attachmentRetry = nil
                fileButton.isEnabled = attachments.count < 3 && (capabilities?.attachments.available ?? false)
                statusLabel.text = "\(attachment.name) · " + NSLocalizedString("chat.file.ready", comment: "")
                statusLabel.textColor = .secondaryLabel
                retryButton.removeTarget(self, action: #selector(retryUploadAttachment), for: .touchUpInside)
                retryButton.setTitle(NSLocalizedString("chat.retry", comment: ""), for: .normal)
                retryButton.isHidden = true
                retryButton.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
                renderAttachmentStatus()
            } catch {
                guard isCurrentOwner, attachmentRetry?.requestId == requestId,
                      currentConversation?.id == uploadConversationId else { return }
                isUploadingAttachment = false
                if let apiError = error as? APIError,
                   case .http(_, let code) = apiError, code == "ATTACHMENTS_UNAVAILABLE" {
                    statusLabel.text = NSLocalizedString("chat.error.attachmentsUnavailable", comment: "")
                } else {
                    statusLabel.text = NSLocalizedString("chat.file.error", comment: "")
                }
                statusLabel.textColor = .systemRed
                retryButton.setTitle(NSLocalizedString("chat.file.retry", comment: ""), for: .normal)
                retryButton.isHidden = false
                retryButton.removeTarget(self, action: #selector(retryLoad), for: .touchUpInside)
                retryButton.addTarget(self, action: #selector(retryUploadAttachment), for: .touchUpInside)
            }
        }
    }
    @objc private func retryUploadAttachment() {
        guard let pending = attachmentRetry else { return }
        uploadAttachment(name: pending.name, mime: pending.mime, data: pending.data, requestId: pending.requestId)
    }
    private static func mimeType(_ url: URL) -> String? {
        switch url.pathExtension.lowercased() {
        case "txt": return "text/plain"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "pdf": return "application/pdf"
        default: return nil
        }
    }
    private func renderAttachmentStatus() {
        removeAttachmentButton.isHidden = attachments.isEmpty && attachmentRetry == nil
        fileButton.isEnabled = (capabilities?.attachments.available ?? false)
            && attachments.count < 3 && !isUploadingAttachment && attachmentRetry == nil
        statusLabel.text = attachments.isEmpty
            ? NSLocalizedString("chat.disclaimer", comment: "")
            : attachments.map { "\($0.name) · " + NSLocalizedString("chat.file.ready", comment: "") }.joined(separator: "   ")
    }
    private func loadAttachmentMetadata(in messages: [ChatMessage], conversationId: String) {
        let ids = Set(messages.flatMap(\.attachmentIds)).filter { attachmentCache[$0] == nil }
        for id in ids {
            Task {
                do {
                    let attachment = try await api.chatAttachmentInfo(id: id)
                    guard isCurrentOwner else { return }
                    attachmentCache[id] = attachment
                    if currentConversation?.id == conversationId { renderMessages() }
                } catch {
                    // The message remains visible; file access is owner-checked by the API.
                }
            }
        }
    }
    private func openAttachment(id: String) {
        Task {
            do {
                let attachment: ChatAttachment
                if let cached = attachmentCache[id] {
                    attachment = cached
                } else {
                    attachment = try await api.chatAttachmentInfo(id: id)
                    guard isCurrentOwner else { return }
                    attachmentCache[id] = attachment
                }
                let data = try await api.downloadChatAttachment(id: id)
                guard isCurrentOwner else { return }
                // Do not let an untrusted filename select an HTML/script previewer.
                let ext = ["text/plain": "txt", "image/png": "png", "image/jpeg": "jpg",
                           "application/pdf": "pdf"][attachment.mimeType] ?? "file"
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("talkhint-\(UUID().uuidString)")
                    .appendingPathExtension(ext.isEmpty ? "file" : ext)
                try data.write(to: url, options: .atomic)
                previewURL = url
                let preview = QLPreviewController()
                preview.dataSource = self
                preview.delegate = self
                present(preview, animated: true)
            } catch { if isCurrentOwner { showError(error) } }
        }
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        previewURL! as NSURL
    }
    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        if let previewURL { try? FileManager.default.removeItem(at: previewURL) }
        previewURL = nil
    }
    @objc private func removeLastAttachment() {
        if attachmentRetry != nil {
            attachmentRetry = nil
            isUploadingAttachment = false
            retryButton.isHidden = true
            retryButton.removeTarget(self, action: #selector(retryUploadAttachment), for: .touchUpInside)
            fileButton.isEnabled = attachments.count < 3 && (capabilities?.attachments.available ?? false)
        } else {
            guard !attachments.isEmpty else { return }
            attachments.removeLast()
        }
        renderAttachmentStatus()
    }
    @objc private func toggleRecording() {
        guard isCurrentOwner else { return }
        if recorder?.isRecording == true { stopRecording(discard: false); return }
        let audioSession = AVAudioSession.sharedInstance()
        guard !CallManager.shared.hasPhoneAudioSession,
              !audioSession.isOtherAudioPlaying,
              !audioSession.secondaryAudioShouldBeSilencedHint else {
            statusLabel.text = NSLocalizedString("chat.voice.call_busy", comment: "")
            return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
            DispatchQueue.main.async { guard let self else { return }; if allowed { self.startRecording() } else { self.statusLabel.text = NSLocalizedString("chat.voice.permission", comment: "") } }
        }
    }
    private func startRecording() {
        let audioSession = AVAudioSession.sharedInstance()
        guard isCurrentOwner, !CallManager.shared.hasPhoneAudioSession,
              !audioSession.isOtherAudioPlaying, !audioSession.secondaryAudioShouldBeSilencedHint else {
            statusLabel.text = NSLocalizedString("chat.voice.call_busy", comment: "")
            return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("talkhint-chat-\(UUID().uuidString).m4a")
        do {
            let session = audioSession
            previousAudioCategory = session.category
            previousAudioMode = session.mode
            previousAudioOptions = session.categoryOptions
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue])
            guard recorder?.record() == true else { throw APIError.decoding }
            recordingURL = url; voiceButton.tintColor = .systemRed
            voiceButton.setImage(UIImage(systemName: "stop.fill"), for: .normal)
            voiceButton.accessibilityLabel = NSLocalizedString("chat.voice.stop", comment: "")
            statusLabel.text = NSLocalizedString("chat.voice.recording", comment: "")
            recordingLimitTask?.cancel()
            recordingLimitTask = Task { [weak self] in
                for _ in 0..<120 {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    guard let self, !Task.isCancelled, self.recorder?.isRecording == true else { return }
                    let audio = AVAudioSession.sharedInstance()
                    if CallManager.shared.hasPhoneAudioSession || audio.isOtherAudioPlaying || audio.secondaryAudioShouldBeSilencedHint {
                        self.stopRecording(discard: true)
                        self.statusLabel.text = NSLocalizedString("chat.voice.call_busy", comment: "")
                        return
                    }
                }
                guard let self, !Task.isCancelled, self.recorder?.isRecording == true else { return }
                self.stopRecording(discard: false)
                self.statusLabel.text = NSLocalizedString("chat.voice.limit", comment: "")
            }
        } catch {
            statusLabel.text = NSLocalizedString("chat.voice.error", comment: "")
            recorder?.stop()
            recorder = nil
            recordingURL = nil
            restoreAudioSession()
        }
    }
    private func stopRecording(discard: Bool) {
        guard let recorder else { return }
        recordingLimitTask?.cancel()
        recordingLimitTask = nil
        recorder.stop(); self.recorder = nil
        voiceButton.tintColor = UIColor(red: 0.2, green: 0.36, blue: 0.27, alpha: 1)
        voiceButton.setImage(UIImage(systemName: "waveform"), for: .normal)
        voiceButton.accessibilityLabel = NSLocalizedString("chat.voice", comment: "")
        let url = recordingURL; recordingURL = nil
        restoreAudioSession()
        guard !discard, let url, let data = try? Data(contentsOf: url) else { return }
        Task {
            do {
                let transcript = try await api.prepareTranscribe(audio: data, mimeType: "audio/m4a")
                guard isCurrentOwner else { return }
                composer.text = transcript; composer.textColor = .label; composer.becomeFirstResponder()
            } catch { if isCurrentOwner { statusLabel.text = NSLocalizedString("chat.voice.error", comment: "") } }
            try? FileManager.default.removeItem(at: url)
        }
    }
    private func restoreAudioSession() {
        let session = AVAudioSession.sharedInstance()
        if !CallManager.shared.hasPhoneAudioSession {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            if let category = previousAudioCategory, let mode = previousAudioMode {
                try? session.setCategory(category, mode: mode, options: previousAudioOptions)
            }
        }
        previousAudioCategory = nil
        previousAudioMode = nil
        previousAudioOptions = []
    }
}
