import UIKit
import UniformTypeIdentifiers
import AVFoundation
import QuickLook

@MainActor
final class ChatViewController: UIViewController, UITextViewDelegate, UIDocumentPickerDelegate,
                               UIScrollViewDelegate, QLPreviewControllerDataSource, QLPreviewControllerDelegate,
                               UIGestureRecognizerDelegate {
    var onClose: (() -> Void)?
    private let appearance: ChatScreenAppearance
    private let api: APIClient
    private lazy var phoneContext = ChatPhoneContextCollector()
    private let sessionScope: ChatSessionScope
    private var currentOwnerId: () -> String? = { SessionStore.shared.userId }
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
    private var pendingNewVoice = false
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
    private var attachmentRetry: (name: String, mime: String, data: Data, requestId: UUID)?
    private var isUploadingAttachment = false
    private var confirmingPlanMessageIDs = Set<String>()
    private var previewURL: URL?
    private var previewFiles: [ObjectIdentifier: URL] = [:]
    private var recordingLimitTask: Task<Void, Never>?
    private var recognitionTask: Task<Void, Never>?
    private var meterTimer: Timer?
    private var dictation = ChatDictationState()
    private let dictationBar = ChatDictationBar()
    private let inputControls = UIStackView()
    private let orbButton = UIButton(type: .system)
    private static var voiceClientEnabled: Bool {
        ChatVoiceClientPolicy.allows(origin: AppConfig.baseURL,
                                     build: ChatVoiceClientPolicy.currentBuild)
    }
    private var composerHeight: NSLayoutConstraint?
    private weak var referenceComposerCard: UIView?
    private weak var referenceMoreButton: UIButton?
    private var draftRevision = 0
    private var hasRestoredComposer = false
    private var pendingDictationAudio: Data?
    private var heardAudio = false
    private var dictationStartedAt: Date?
    private var observers: [NSObjectProtocol] = []
    private var hasLoadedChat = false
    private var savedScrollPosition: CGPoint?
    private var pendingScrollRestore: CGPoint?
    private var resumeTask: Task<Void, Never>?
    #if DEBUG
    var onOfflinePreviewLoaded: (() -> Void)?
    private(set) var offlinePreviewReady = false

    /// Visual state fixture only; never requests microphone permission or STT.
    func applyOfflinePreviewState(_ state: ChatApprovedPreview.State) {
        guard appearance.isApprovedReference else { return }
        if state == .editing {
            composer.text = NSLocalizedString("chat.preview.message.1", comment: "")
            composer.textColor = .label
            updateComposerControls()
            composer.becomeFirstResponder()
        } else if state == .recording || state == .recognizing {
            guard let id = dictation.begin(context: dictationContext, text: draftText,
                                           selection: NSRange(location: 0, length: 0)),
                  dictation.allow(id) else { return }
            if state == .recognizing { _ = dictation.recognize() }
            updateDictationUI()
            if state == .recording {
                // Fixed fixture amplitude, not claimed to be microphone data.
                dictationBar.update(level: 0.65)
                dictationBar.configure(mode: .recording, elapsed: 4)
            }
        }
    }
    #endif

    private var draftText: String {
        composer.text == NSLocalizedString("chat.message.placeholder", comment: "") ? "" : (composer.text ?? "")
    }
    private var dictationContext: ChatDictationState.Context {
        .init(ownerId: sessionScope.ownerId ?? "", conversationId: currentConversation?.id, draftRevision: draftRevision)
    }

    override init(nibName nibNameOrNil: String? = nil, bundle nibBundleOrNil: Bundle? = nil) {
        appearance = .existing
        let owner = SessionStore.shared.userId
        sessionScope = ChatSessionScope(ownerId: owner)
        api = Self.makeChatClient(scope: ChatSessionScope(ownerId: owner), token: SessionStore.shared.token)
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    }
    required init?(coder: NSCoder) {
        appearance = .existing
        let owner = SessionStore.shared.userId
        sessionScope = ChatSessionScope(ownerId: owner)
        api = Self.makeChatClient(scope: ChatSessionScope(ownerId: owner), token: SessionStore.shared.token)
        super.init(coder: coder)
    }
    /// Injected transport/store, used by offline checks and the isolated live Dev scheme.
    init(api: APIClient, ownerId: String, currentOwnerId: @escaping () -> String?, draftStore: ChatOutbox,
         appearance: ChatScreenAppearance = .existing) {
        self.appearance = appearance
        self.api = api
        self.sessionScope = ChatSessionScope(ownerId: ownerId)
        self.currentOwnerId = currentOwnerId
        self.outbox = draftStore
        super.init(nibName: nil, bundle: nil)
    }
    private static func makeChatClient(scope: ChatSessionScope, token: String?) -> APIClient {
        APIClient(transport: { request in try await URLSession.shared.data(for: request) },
                  tokenProvider: {
            guard scope.permits(currentUserId: SessionStore.shared.userId) else { return nil }
            return token
        })
    }
    static func liveApprovedScreen() -> ChatViewController? {
        guard let owner = SessionStore.shared.userId, SessionStore.shared.isLoggedIn else { return nil }
        let scope = ChatSessionScope(ownerId: owner)
        return ChatViewController(api: makeChatClient(scope: scope, token: SessionStore.shared.token),
                                  ownerId: owner, currentOwnerId: { SessionStore.shared.userId },
                                  draftStore: ChatOutbox(owner: owner, origin: AppConfig.baseURL.absoluteString),
                                  appearance: .approvedReference)
    }
    private var isCurrentOwner: Bool {
        sessionScope.permits(currentUserId: currentOwnerId())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        navigationItem.title = nil
        build()
        configureOwner()
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.cancelDictation()
                    self?.persistDraft()
                }
            })
        }
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        guard isCurrentOwner else { return }
        pendingScrollRestore = savedScrollPosition
        if hasLoadedChat {
            updatePolling()
            resumeTask = Task { await refreshVisibleConversation() }
        } else {
            resumeTask = Task { await load() }
        }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        savedScrollPosition = scroll.contentOffset
        resumeTask?.cancel()
        pollTask?.cancel()
        cancelDictation()
        persistDraft()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateComposerControls()
        if let position = pendingScrollRestore {
            restoreScrollPosition(position)
            pendingScrollRestore = nil
        }
    }
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        guard appearance.isApprovedReference,
              previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle else { return }
        referenceComposerCard?.layer.borderColor = UIColor.separator.resolvedColor(with: traitCollection).cgColor
        for (button, symbol) in [(fileButton, "plus"), (voiceButton, "mic")] {
            button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 24, weight: .regular))?.withTintColor(
                UIColor.label.resolvedColor(with: traitCollection), renderingMode: .alwaysOriginal), for: .disabled)
        }
        referenceMoreButton?.setImage(UIImage(systemName: "ellipsis", withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .semibold))?.withTintColor(
            UIColor.label.resolvedColor(with: traitCollection), renderingMode: .alwaysOriginal), for: .disabled)
    }
    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        meterTimer?.invalidate()
        recognitionTask?.cancel()
        recordingLimitTask?.cancel()
        resumeTask?.cancel()
    }
    private func configureOwner() {
        guard outbox == nil else { return }
        guard let owner = sessionScope.ownerId else { return }
        outbox = ChatOutbox(owner: owner)
    }
    private func build() {
        let header = UIView()
        let back = iconButton("chevron.left", title: NSLocalizedString("chat.back", comment: ""), action: #selector(closeChat))
        back.accessibilityIdentifier = "chat-back"
        let menu = iconButton("line.3.horizontal", title: NSLocalizedString("chat.menu", comment: ""), action: #selector(toggleDrawer))
        menu.accessibilityIdentifier = "chat-menu"
        if appearance.isApprovedReference {
            // Match the reference's more glyph, without implementing a menu.
            menu.removeTarget(self, action: #selector(toggleDrawer), for: .touchUpInside)
            menu.setImage(UIImage(systemName: "ellipsis"), for: .normal)
            menu.setImage(UIImage(systemName: "ellipsis"), for: .disabled)
            menu.setImage(UIImage(systemName: "ellipsis", withConfiguration: UIImage.SymbolConfiguration(pointSize: 23, weight: .semibold))?.withTintColor(.label, renderingMode: .alwaysOriginal), for: .disabled)
            referenceMoreButton = menu
            menu.isEnabled = false
            menu.accessibilityIdentifier = "chat-more-unavailable"
            menu.accessibilityLabel = NSLocalizedString("chat.more.unavailable", comment: "")
            menu.accessibilityHint = NSLocalizedString("chat.more.hint", comment: "")
        }
        for button in [back, menu] {
            button.setTitle(nil, for: .normal)
            button.widthAnchor.constraint(equalToConstant: 44).isActive = true
            button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        }
        topTitle.text = NSLocalizedString("tab.chat", comment: "")
        topTitle.font = appearance.titleFont
        topTitle.adjustsFontForContentSizeCategory = true
        topTitle.textColor = .label
        let headerStack = UIStackView(arrangedSubviews: [back, topTitle, menu])
        headerStack.axis = .horizontal; headerStack.alignment = .center
        headerStack.distribution = .fill
        headerStack.spacing = 8
        if appearance.isApprovedReference {
            topTitle.text = NSLocalizedString("chat.screen.title", comment: "")
            topTitle.textAlignment = .center
            let folder = UIImageView(image: UIImage(systemName: "folder", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)))
            folder.tintColor = .label
            folder.contentMode = .scaleAspectFit
            folder.setContentHuggingPriority(.required, for: .horizontal)
            folder.isAccessibilityElement = false
            headerStack.removeArrangedSubview(topTitle)
            topTitle.removeFromSuperview()
            let titleGroup = UIStackView(arrangedSubviews: [folder, topTitle])
            titleGroup.alignment = .center
            titleGroup.spacing = 8
            headerStack.insertArrangedSubview(titleGroup, at: 1)
            let leadingSpace = UIView(), trailingSpace = UIView()
            titleGroup.insertArrangedSubview(leadingSpace, at: 0)
            titleGroup.addArrangedSubview(trailingSpace)
            leadingSpace.widthAnchor.constraint(equalTo: trailingSpace.widthAnchor).isActive = true
            folder.widthAnchor.constraint(equalToConstant: 20).isActive = true
            for button in [back, menu] {
                button.tintColor = .label
                button.backgroundColor = .systemBackground
                button.layer.cornerRadius = 22
                button.layer.shadowColor = UIColor.black.cgColor
                button.layer.shadowOpacity = 0.07
                button.layer.shadowRadius = 4
                button.layer.shadowOffset = CGSize(width: 0, height: 1)
                button.setPreferredSymbolConfiguration(.init(pointSize: 23, weight: .semibold), forImageIn: .normal)
            }
        }
        topTitle.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        topTitle.lineBreakMode = .byTruncatingTail
        headerStack.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(headerStack)
        view.addSubview(header)
        header.translatesAutoresizingMaskIntoConstraints = false

        messagesStack.axis = .vertical; messagesStack.spacing = appearance.messageSpacing
        messagesStack.alignment = .fill
        // Both appearances size the transcript with Auto Layout; with an autoresizing mask
        // the stack never defined the scroll content size, so the existing chat could not scroll.
        messagesStack.translatesAutoresizingMaskIntoConstraints = false
        scroll.delegate = self
        scroll.accessibilityIdentifier = "chat-messages"
        scroll.keyboardDismissMode = .interactive
        let messageTap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboardFromMessageSpace))
        messageTap.cancelsTouchesInView = false
        messageTap.delegate = self
        scroll.addGestureRecognizer(messageTap)
        scroll.addSubview(messagesStack); scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        retryButton.setTitle(NSLocalizedString("chat.retry", comment: ""), for: .normal)
        retryButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        let statusRow = UIStackView(arrangedSubviews: [statusLabel, removeAttachmentButton, retryButton])
        statusRow.axis = .horizontal; statusRow.alignment = .center; statusRow.spacing = 8
        view.addSubview(statusRow); statusRow.translatesAutoresizingMaskIntoConstraints = false

        let inputCard = UIView()
        if appearance.isApprovedReference { referenceComposerCard = inputCard }
        inputCard.backgroundColor = appearance.isApprovedReference ? .systemBackground : .secondarySystemBackground
        inputCard.layer.cornerRadius = appearance.isApprovedReference ? 28 : 22
        inputCard.layer.borderColor = UIColor.separator.cgColor
        inputCard.layer.borderWidth = appearance.isApprovedReference ? 0.5 : 1
        composer.font = appearance.composerFont
        composer.adjustsFontForContentSizeCategory = true
        composer.delegate = self
        let keyboardToolbar = UIToolbar()
        keyboardToolbar.sizeToFit()
        let keyboardDoneButton = UIBarButtonItem(title: NSLocalizedString("chat.keyboard.done", comment: ""),
                                                 style: .done, target: self, action: #selector(dismissKeyboard))
        keyboardDoneButton.accessibilityLabel = NSLocalizedString("chat.keyboard.done", comment: "")
        keyboardToolbar.items = [
            UIBarButtonItem.flexibleSpace(),
            keyboardDoneButton,
        ]
        composer.inputAccessoryView = keyboardToolbar
        composer.accessibilityLabel = NSLocalizedString("chat.message.placeholder", comment: "")
        composer.accessibilityIdentifier = "chat-composer"
        composer.backgroundColor = .clear
        composer.text = NSLocalizedString("chat.message.placeholder", comment: "")
        composer.textColor = UIColor.secondaryLabel
        composer.textContainerInset = UIEdgeInsets(top: 11, left: 2, bottom: 10, right: 2)
        composer.translatesAutoresizingMaskIntoConstraints = false
        fileButton = iconButton("plus", title: NSLocalizedString("chat.attach", comment: ""), action: #selector(pickFile))
        voiceButton = iconButton("mic", title: NSLocalizedString("chat.voice", comment: ""), action: #selector(toggleRecording))
        for button in [fileButton, voiceButton] {
            button.setTitle(nil, for: .normal)
            button.widthAnchor.constraint(equalToConstant: 44).isActive = true
            button.heightAnchor.constraint(equalToConstant: 44).isActive = true
            if appearance.isApprovedReference {
                button.tintColor = .label
                button.setPreferredSymbolConfiguration(.init(pointSize: 24, weight: .regular), forImageIn: .normal)
                let symbol = button === fileButton ? "plus" : "mic"
                button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 24, weight: .regular))?.withTintColor(.label, renderingMode: .alwaysOriginal), for: .disabled)
            }
        }
        fileButton.accessibilityIdentifier = "chat-attachment"
        voiceButton.accessibilityIdentifier = "chat-dictation"
        removeAttachmentButton.setImage(UIImage(systemName: "xmark.circle"), for: .normal)
        removeAttachmentButton.tintColor = .secondaryLabel
        removeAttachmentButton.accessibilityLabel = NSLocalizedString("chat.removeAttachment", comment: "")
        removeAttachmentButton.isHidden = true
        removeAttachmentButton.addTarget(self, action: #selector(removeLastAttachment), for: .touchUpInside)
        sendButton.setImage(UIImage(systemName: "arrow.up"), for: .normal)
        sendButton.tintColor = .white; sendButton.backgroundColor = UIColor(red: 0.23, green: 0.55, blue: 0.38, alpha: 1)
        sendButton.layer.cornerRadius = 22; sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
        sendButton.accessibilityLabel = NSLocalizedString("chat.send", comment: "")
        orbButton.setImage(UIImage(systemName: "waveform"), for: .normal)
        orbButton.backgroundColor = .black
        orbButton.tintColor = .white
        orbButton.layer.cornerRadius = appearance.orbSize / 2
        orbButton.layer.borderWidth = 1
        orbButton.layer.borderColor = UIColor.gray.cgColor
        orbButton.isEnabled = false
        orbButton.accessibilityIdentifier = "chat-orb-unavailable"
        orbButton.accessibilityLabel = NSLocalizedString("chat.orb.unavailable", comment: "")
        orbButton.accessibilityHint = NSLocalizedString("chat.orb.hint", comment: "")
        orbButton.setImage(UIImage(systemName: "waveform"), for: .disabled)
        if Self.voiceClientEnabled {
            orbButton.isEnabled = false // server must confirm the sole owner's access first
            orbButton.accessibilityIdentifier = "chat-voice-open"
            orbButton.accessibilityLabel = NSLocalizedString("chat.voiceMode.open", comment: "")
            orbButton.accessibilityHint = NSLocalizedString("chat.voiceMode.noOutput", comment: "")
            orbButton.addTarget(self, action: #selector(openVoiceMode), for: .touchUpInside)
        }
        if appearance.isApprovedReference {
            orbButton.setImage(UIImage(systemName: "waveform", withConfiguration: UIImage.SymbolConfiguration(pointSize: 24, weight: .semibold))?.withTintColor(.white, renderingMode: .alwaysOriginal), for: .disabled)
            orbButton.layer.borderWidth = 0
        }
        let orbCaption = UILabel()
        orbCaption.text = NSLocalizedString(Self.voiceClientEnabled ? "chat.voiceMode.open" : "chat.orb.unavailable", comment: "")
        orbCaption.font = .preferredFont(forTextStyle: .caption2)
        orbCaption.adjustsFontForContentSizeCategory = true
        orbCaption.textColor = .secondaryLabel
        orbCaption.numberOfLines = 0
        orbCaption.textAlignment = .center
        let orb = UIStackView(arrangedSubviews: [orbButton, orbCaption])
        orb.axis = .vertical; orb.alignment = .center; orb.spacing = 2
        orb.widthAnchor.constraint(equalToConstant: appearance.isApprovedReference ? 48 : 58).isActive = true
        orbCaption.isHidden = appearance.isApprovedReference
        orbButton.widthAnchor.constraint(equalToConstant: appearance.orbSize).isActive = true
        orbButton.heightAnchor.constraint(equalToConstant: appearance.orbSize).isActive = true
        let composerItems: [UIView] = appearance.isApprovedReference
            ? [fileButton, composer, voiceButton, sendButton]
            : [fileButton, composer, voiceButton, sendButton, orb]
        composerItems.forEach { inputControls.addArrangedSubview($0) }
        inputControls.axis = .horizontal; inputControls.alignment = .center; inputControls.spacing = 2
        composer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let inputStack = UIStackView(arrangedSubviews: [inputControls, dictationBar])
        inputStack.axis = .vertical
        inputCard.addSubview(inputStack); inputStack.translatesAutoresizingMaskIntoConstraints = false
        dictationBar.isHidden = true
        dictationBar.onCancel = { [weak self] in self?.cancelDictation() }
        dictationBar.onStop = { [weak self] in self?.stopRecording(discard: false) }
        dictationBar.onRetry = { [weak self] in self?.transcribeDictation() }
        composerHeight = composer.heightAnchor.constraint(equalToConstant: 44)
        composerHeight?.isActive = true
        view.addSubview(inputCard); inputCard.translatesAutoresizingMaskIntoConstraints = false
        // In the approved reference, the black Orb is OUTSIDE the input capsule.
        // Voice entry is Dev-only. Release keeps the unavailable button.
        let inputTrailing: NSLayoutConstraint
        if appearance.isApprovedReference {
            view.addSubview(orb)
            orb.translatesAutoresizingMaskIntoConstraints = false
            inputTrailing = inputCard.trailingAnchor.constraint(equalTo: orb.leadingAnchor, constant: -10)
            NSLayoutConstraint.activate([
                orb.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
                orb.bottomAnchor.constraint(equalTo: inputCard.bottomAnchor, constant: -4),
            ])
        } else {
            inputTrailing = inputCard.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14)
        }
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
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: appearance.isApprovedReference ? 16 : 18),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: appearance.isApprovedReference ? -16 : -18),
            scroll.bottomAnchor.constraint(equalTo: statusRow.topAnchor, constant: -6),
            statusRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            statusRow.bottomAnchor.constraint(equalTo: inputCard.topAnchor, constant: -8),
            inputCard.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: appearance.isApprovedReference ? 16 : 14),
            inputTrailing,
            inputCard.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
            inputStack.topAnchor.constraint(equalTo: inputCard.topAnchor, constant: 6),
            inputStack.leadingAnchor.constraint(equalTo: inputCard.leadingAnchor, constant: 6),
            inputStack.trailingAnchor.constraint(equalTo: inputCard.trailingAnchor, constant: -6),
            inputStack.bottomAnchor.constraint(equalTo: inputCard.bottomAnchor, constant: -6),
            sendButton.widthAnchor.constraint(equalToConstant: 44), sendButton.heightAnchor.constraint(equalToConstant: 44),
            messagesStack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            messagesStack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16),
            messagesStack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            messagesStack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            messagesStack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
        ])
        statusLabel.text = appearance.isApprovedReference ? nil : NSLocalizedString("chat.disclaimer", comment: "")
        updateComposerControls()
        renderMessages()
    }
    private func updateHeaderTitle(_ title: String) {
        topTitle.text = appearance.isApprovedReference ? NSLocalizedString("chat.screen.title", comment: "") : title
        topTitle.accessibilityValue = appearance.isApprovedReference ? title : nil
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
            orbButton.isEnabled = Self.voiceClientEnabled && capabilities?.voiceMode?.available == true
            guard isCurrentOwner else { return }
            fileButton.isEnabled = (capabilities?.attachments.available ?? false) && attachments.count < 3
            voiceButton.isEnabled = capabilities?.voice.available ?? true
            updateComposerControls()
            conversations = try await recent
            guard isCurrentOwner, !Task.isCancelled else { return }
            hasLoadedChat = true
            if pendingNewVoice {
                pendingNewVoice = false
                beginNewVoiceConversation()
                return
            }
            if let selected = outbox?.selectedConversationId,
               let conversation = conversations.first(where: { $0.id == selected }) {
                await open(conversation)
            } else if let first = conversations.first {
                await open(first)
            } else {
                showWelcome()
            }
            #if DEBUG
            onOfflinePreviewLoaded?()
            offlinePreviewReady = onOfflinePreviewLoaded != nil
            #endif
        } catch { if !Task.isCancelled, isCurrentOwner { showError(error) } }
    }
    private func refreshVisibleConversation() async {
        guard let conversation = currentConversation, isCurrentOwner else { return }
        do {
            let page = try await api.chatMessages(conversationId: conversation.id)
            guard !Task.isCancelled, isCurrentOwner, currentConversation?.id == conversation.id else { return }
            messages = ChatOutbox.merge(messages, page.messages)
            renderMessages()
            updatePolling()
        } catch {
            if !Task.isCancelled, isCurrentOwner { statusLabel.text = NSLocalizedString("chat.error.network", comment: "") }
        }
    }
    private func restoreScrollPosition(_ position: CGPoint) {
        let minY = -scroll.adjustedContentInset.top
        let maxY = max(minY, scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height)
        scroll.setContentOffset(CGPoint(x: 0, y: min(maxY, max(minY, position.y))), animated: false)
    }
    @objc private func closeChat() {
        closeDrawer()
        cancelDictation()
        persistDraft()
        view.endEditing(true)
        onClose?()
    }
    private func showWelcome() {
        currentConversation = nil
        messages = []
        hasMoreMessages = false
        renderMessages()
        updateHeaderTitle(NSLocalizedString("chat.title", comment: ""))
        restoreDraft()
    }
    @objc private func newChat() {
        guard isCurrentOwner else { return }
        closeDrawer()
        cancelDictation()
        persistDraft()
        createNewChat(preservingDraft: false)
    }
    private func createNewChat(preservingDraft: Bool, onCreated: (() -> Void)? = nil) {
        let draft = composer.text == NSLocalizedString("chat.message.placeholder", comment: "") ? "" : composer.text
        let draftAttachments = attachments
        let originDraftKey = currentConversation?.id ?? "_new"
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
                if isCurrentOwner, preservingDraft, currentConversation?.id == conversation.id {
                    composer.text = draft
                    composer.textColor = .label
                    attachments = draftAttachments
                    draftRevision += 1
                    renderAttachmentStatus()
                    if originDraftKey != conversation.id {
                        var saved = outbox.composerDrafts
                        saved.removeValue(forKey: originDraftKey)
                        outbox.composerDrafts = saved
                    }
                }
                if isCurrentOwner { onCreated?() }
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
    @objc private func openVoiceMode() {
        guard Self.voiceClientEnabled, capabilities?.voiceMode?.available == true,
              isCurrentOwner, presentedViewController == nil,
              !dictation.isBusy, !isSending, !isUploadingAttachment,
              !CallManager.shared.hasPhoneAudioSession else { return }
        guard let conversation = currentConversation else {
            createNewChat(preservingDraft: true, onCreated: { [weak self] in self?.openVoiceMode() })
            return
        }
        persistDraft()
        view.endEditing(true)
        let id = conversation.id
        let controller = ChatVoiceViewController(api: api, conversation: conversation,
            validOwner: { [weak self] in
                guard let self else { return false }
                return self.isCurrentOwner && self.currentConversation?.id == id
            }, submit: { [weak self] text, requestID in
                guard let self, self.isCurrentOwner, self.currentConversation?.id == id else {
                    throw APIError.decoding
                }
                return try await self.sendVoiceTurn(text: text, requestID: requestID, conversationID: id)
            }, attachments: { [weak self] in self?.pickFile() })
        present(controller, animated: true)
    }

    /// Main-screen voice always starts a NEW conversation. In-chat Orb keeps this one.
    func beginNewVoiceConversation() {
        guard isCurrentOwner, !CallManager.shared.hasPhoneAudioSession else { return }
        guard hasLoadedChat else { pendingNewVoice = true; return }
        guard Self.voiceClientEnabled, capabilities?.voiceMode?.available == true,
              presentedViewController == nil, !dictation.isBusy, !isSending, !isUploadingAttachment else { return }
        createNewChat(preservingDraft: false, onCreated: { [weak self] in self?.openVoiceMode() })
    }

    private func sendVoiceTurn(text: String, requestID: UUID, conversationID: String) async throws -> ChatMessagePair {
        guard Self.voiceClientEnabled, capabilities?.voiceMode?.available == true,
              isCurrentOwner, currentConversation?.id == conversationID,
              let outbox else { throw APIError.decoding }
        let pending = outbox.pendingSends.first(where: { $0.id == requestID })
            ?? outbox.enqueue(conversationId: conversationID, text: text,
                              attachmentIds: attachments.map(\.id),
                              language: String((Bundle.main.preferredLocalizations.first ?? "en").prefix(2)),
                              requestId: requestID, mode: "voice")
        // Capture context once, before first send. Ambiguous retries reuse the same payload.
        if pending.state == .pending {
            let context = ChatPhoneContextCollector.isRelevant(text) ? await phoneContext.collect() : nil
            guard isCurrentOwner, currentConversation?.id == conversationID else { throw APIError.decoding }
            outbox.setContext(context, for: pending.id)
        }
        outbox.setState(.sending, for: pending.id)
        let saved = outbox.pendingSends.first(where: { $0.id == pending.id }) ?? pending
        do {
            let pair = try await api.sendChatMessage(conversationId: conversationID, requestId: saved.id,
                text: saved.text, attachmentIds: saved.attachmentIds, language: saved.language,
                context: saved.context, mode: saved.mode)
            guard isCurrentOwner, currentConversation?.id == conversationID else { throw APIError.decoding }
            outbox.remove(saved.id)
            messages = ChatOutbox.merge(messages, [pair.message] + (pair.reply.map { [$0] } ?? []))
            // Only attachments actually sent by this turn are removed from the draft.
            attachments.removeAll { saved.attachmentIds.contains($0.id) }
            persistDraft()
            return pair
        } catch {
            outbox.setState(.uncertain, for: pending.id)
            throw error
        }
    }
    private func open(_ conversation: ChatConversation) async {
        guard isCurrentOwner else { return }
        if currentConversation?.id != conversation.id && isUploadingAttachment {
            statusLabel.text = NSLocalizedString("chat.file.uploading", comment: "")
            return
        }
        if currentConversation?.id != conversation.id {
            cancelDictation()
            persistDraft()
            attachmentRetry = nil
            fileButton.isEnabled = (capabilities?.attachments.available ?? false) && attachments.count < 3
            retryButton.isHidden = true
        }
        let changedConversation = currentConversation?.id != conversation.id
        // Text typed while the first conversation was still loading belongs to "_new";
        // keep it on screen instead of replacing it with the placeholder.
        let unopenedDraft = currentConversation == nil && hasRestoredComposer ? (text: draftText, files: attachments) : nil
        currentConversation = conversation
        if changedConversation {
            draftRevision += 1
            restoreDraft()
            if let unopenedDraft, !unopenedDraft.text.isEmpty || !unopenedDraft.files.isEmpty,
               draftText.isEmpty, attachments.isEmpty, let outbox {
                composer.text = unopenedDraft.text.isEmpty ? NSLocalizedString("chat.message.placeholder", comment: "") : unopenedDraft.text
                composer.textColor = unopenedDraft.text.isEmpty ? .secondaryLabel : .label
                attachments = unopenedDraft.files
                renderAttachmentStatus()
                persistDraft()
                var saved = outbox.composerDrafts
                saved.removeValue(forKey: "_new")
                outbox.composerDrafts = saved
            }
        }
        outbox?.selectedConversationId = conversation.id
        updateHeaderTitle(displayTitle(conversation))
        do {
            let page = try await api.chatMessages(conversationId: conversation.id)
            guard isCurrentOwner, currentConversation?.id == conversation.id else { return }
            messages = ChatOutbox.merge([], page.messages)
            hasMoreMessages = page.hasMore
            loadAttachmentMetadata(in: page.messages, conversationId: conversation.id)
            renderMessages()
            updatePolling()
            await recoverOutbox()
        } catch { if !Task.isCancelled, isCurrentOwner, currentConversation?.id == conversation.id { showError(error) } }
    }
    private func displayTitle(_ conversation: ChatConversation) -> String {
        conversation.title.isEmpty || conversation.title == "New chat"
            ? NSLocalizedString("chat.new", comment: "") : conversation.title
    }
    @objc private func closeDrawer() {
        drawer?.removeFromSuperview()
        drawer = nil
    }
    @objc private func toggleDrawer() {
        if drawer != nil { closeDrawer(); return }
        cancelDictation()
        view.endEditing(true)
        let overlay = UIView()
        overlay.accessibilityViewIsModal = true
        overlay.accessibilityIdentifier = "chat-drawer"
        overlay.translatesAutoresizingMaskIntoConstraints = false
        let dim = UIButton(type: .custom)
        dim.backgroundColor = UIColor.black.withAlphaComponent(0.2)
        dim.accessibilityLabel = NSLocalizedString("chat.close", comment: "")
        dim.addTarget(self, action: #selector(closeDrawer), for: .touchUpInside)
        dim.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(dim)
        let panel = UIView(); panel.backgroundColor = .secondarySystemBackground
        panel.translatesAutoresizingMaskIntoConstraints = false
        let menuScroll = UIScrollView()
        menuScroll.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(menuScroll)
        let list = UIStackView(); list.axis = .vertical; list.spacing = 6
        let title = UILabel(); title.text = NSLocalizedString("chat.recent", comment: ""); title.font = .preferredFont(forTextStyle: .title2)
        title.adjustsFontForContentSizeCategory = true
        list.addArrangedSubview(title)
        let create = UIButton(type: .system); create.setTitle(NSLocalizedString("chat.new", comment: ""), for: .normal)
        create.accessibilityIdentifier = "chat-new"
        create.contentHorizontalAlignment = .leading; create.addTarget(self, action: #selector(newChat), for: .touchUpInside); list.addArrangedSubview(create)
        for conversation in conversations {
            let item = UIButton(type: .system); item.setTitle(displayTitle(conversation), for: .normal); item.contentHorizontalAlignment = .leading
            item.titleLabel?.numberOfLines = 2
            item.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.closeDrawer()
                Task { await self.open(conversation) }
            }, for: .touchUpInside)
            list.addArrangedSubview(item)
        }
        let note = UILabel()
        note.text = NSLocalizedString("chat.futureNote", comment: "")
        note.textColor = .secondaryLabel
        note.font = .preferredFont(forTextStyle: .footnote)
        note.adjustsFontForContentSizeCategory = true
        note.numberOfLines = 0
        list.addArrangedSubview(note)
        for future in ["chat.calendar", "chat.tasks", "chat.notebook", "chat.contacts", "chat.files", "chat.mail", "chat.card", "chat.connections", "chat.tariff", "chat.help", "chat.about"] {
            let item = UIButton(type: .system)
            item.setTitle(NSLocalizedString(future, comment: ""), for: .normal)
            item.isEnabled = false
            item.accessibilityHint = NSLocalizedString("chat.coming", comment: "")
            item.accessibilityIdentifier = future
            item.contentHorizontalAlignment = .leading
            list.addArrangedSubview(item)
        }
        let settings = UIButton(type: .system); settings.setTitle(NSLocalizedString("chat.settings", comment: ""), for: .normal)
        settings.accessibilityIdentifier = "chat-settings"
        settings.contentHorizontalAlignment = .leading
        settings.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        settings.titleLabel?.font = .preferredFont(forTextStyle: .body)
        settings.titleLabel?.adjustsFontForContentSizeCategory = true
        settings.titleLabel?.numberOfLines = 0
        settings.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(settings)
        let close = UIButton(type: .system); close.setTitle(NSLocalizedString("chat.close", comment: ""), for: .normal)
        close.addTarget(self, action: #selector(closeDrawer), for: .touchUpInside); list.addArrangedSubview(close)
        for case let item as UIButton in list.arrangedSubviews {
            item.titleLabel?.font = .preferredFont(forTextStyle: .body)
            item.titleLabel?.adjustsFontForContentSizeCategory = true
            item.titleLabel?.numberOfLines = 0
            item.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        list.translatesAutoresizingMaskIntoConstraints = false
        menuScroll.addSubview(list)
        overlay.addSubview(panel)
        view.addSubview(overlay)
        drawer = overlay
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor), overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor), overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            dim.leadingAnchor.constraint(equalTo: overlay.leadingAnchor), dim.trailingAnchor.constraint(equalTo: overlay.trailingAnchor),
            dim.topAnchor.constraint(equalTo: overlay.topAnchor), dim.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),
            panel.leadingAnchor.constraint(equalTo: overlay.leadingAnchor), panel.topAnchor.constraint(equalTo: overlay.topAnchor),
            panel.bottomAnchor.constraint(equalTo: overlay.bottomAnchor),
            panel.widthAnchor.constraint(equalToConstant: min(320, max(240, view.bounds.width - 40))),
            menuScroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor), menuScroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            menuScroll.topAnchor.constraint(equalTo: panel.safeAreaLayoutGuide.topAnchor), menuScroll.bottomAnchor.constraint(equalTo: settings.topAnchor, constant: -8),
            settings.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 16),
            settings.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -16),
            settings.bottomAnchor.constraint(equalTo: panel.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            settings.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            list.topAnchor.constraint(equalTo: menuScroll.contentLayoutGuide.topAnchor, constant: 16),
            list.bottomAnchor.constraint(equalTo: menuScroll.contentLayoutGuide.bottomAnchor, constant: -16),
            list.leadingAnchor.constraint(equalTo: menuScroll.contentLayoutGuide.leadingAnchor, constant: 16),
            list.trailingAnchor.constraint(equalTo: menuScroll.contentLayoutGuide.trailingAnchor, constant: -16),
            list.widthAnchor.constraint(equalTo: menuScroll.frameLayoutGuide.widthAnchor, constant: -32),
        ])
        panel.transform = CGAffineTransform(translationX: -320, y: 0); panel.alpha = 0
        UIView.animate(withDuration: 0.28, delay: 0, usingSpringWithDamping: 0.88, initialSpringVelocity: 0.2) { panel.transform = .identity; panel.alpha = 1 }
    }
    @objc private func openSettings() {
        guard isCurrentOwner else { return }
        closeDrawer()
        navigationController?.pushViewController(SettingsViewController(api: api), animated: true)
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
            welcome.textColor = .label
            messagesStack.addArrangedSubview(UIView()); messagesStack.addArrangedSubview(welcome); return
        }
        if appearance.isApprovedReference {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let date = formatter.date(from: messages[0].createdAt) ?? ISO8601DateFormatter().date(from: messages[0].createdAt)
            if let date {
                let dateLabel = UILabel()
                let local = DateFormatter()
                local.locale = Locale(identifier: Bundle.main.preferredLocalizations.first ?? Locale.current.identifier)
                local.doesRelativeDateFormatting = true
                local.dateStyle = .medium
                local.timeStyle = .short
                dateLabel.text = local.string(from: date)
                dateLabel.font = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 13))
                dateLabel.adjustsFontForContentSizeCategory = true
                dateLabel.textColor = .secondaryLabel
                dateLabel.textAlignment = .center
                dateLabel.accessibilityIdentifier = "chat-date"
                messagesStack.addArrangedSubview(dateLabel)
            }
        }
        for message in messages {
            let bubble = UIView()
            bubble.layer.cornerRadius = appearance.bubbleRadius; bubble.layer.masksToBounds = true
            bubble.layer.cornerCurve = .continuous
            let isUser = message.role == "user"
            bubble.backgroundColor = appearance.bubbleColor(isUser: isUser)
            let content = UIStackView()
            content.axis = .vertical; content.spacing = 7
            content.translatesAutoresizingMaskIntoConstraints = false
            bubble.addSubview(content)
            NSLayoutConstraint.activate([
                content.topAnchor.constraint(equalTo: bubble.topAnchor, constant: appearance.bubbleVerticalInset),
                content.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: appearance.bubbleInset),
                content.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -appearance.bubbleInset),
                content.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -appearance.bubbleVerticalInset),
            ])
            if !message.text.isEmpty {
                let text = UILabel()
                text.text = message.text; text.font = appearance.messageFont
                text.textColor = .label
                text.accessibilityIdentifier = "chat-message-text"
                text.adjustsFontForContentSizeCategory = true; text.numberOfLines = 0
                content.addArrangedSubview(text)
            }
            if let event = message.event {
                let details = UIButton(type: .system)
                details.setTitle(NSLocalizedString("chat.result.details", comment: ""), for: .normal)
                details.contentHorizontalAlignment = .leading
                details.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
                details.addAction(UIAction { [weak self] _ in
                    guard let self, self.isCurrentOwner else { return }
                    Task {
                        do {
                            let text = try await self.api.chatResultDetails(path: event.sourcePath)
                            guard self.isCurrentOwner else { return }
                            let screen = UIViewController()
                            screen.title = NSLocalizedString("chat.result.details", comment: "")
                            let body = UITextView()
                            body.isEditable = false
                            body.font = .preferredFont(forTextStyle: .body)
                            body.text = text
                            body.backgroundColor = .systemBackground
                            screen.view = body
                            self.navigationController?.pushViewController(screen, animated: true)
                        } catch { self.showError(error) }
                    }
                }, for: .touchUpInside)
                content.addArrangedSubview(details)
                if event.kind == "call_result" {
                    let followup = UIButton(type: .system)
                    followup.setTitle(NSLocalizedString("chat.result.followup", comment: ""), for: .normal)
                    followup.contentHorizontalAlignment = .leading
                    followup.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
                    followup.addAction(UIAction { [weak self] _ in
                        guard let self, self.isCurrentOwner else { return }
                        let alert = UIAlertController(title: NSLocalizedString("chat.result.followup", comment: ""),
                                                      message: NSLocalizedString("chat.result.notCalendar", comment: ""),
                                                      preferredStyle: .alert)
                        alert.addTextField { $0.text = message.text.components(separatedBy: "\n").last }
                        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
                        alert.addAction(UIAlertAction(title: NSLocalizedString("chat.result.save", comment: ""), style: .default) { [weak self] _ in
                            guard let self, let text = alert.textFields?.first?.text, !text.isEmpty else { return }
                            Task {
                                do {
                                    try await self.api.saveChatFollowup(conversationId: message.conversationId, taskId: event.taskId, text: text)
                                    let page = try await self.api.chatMessages(conversationId: message.conversationId)
                                    guard self.isCurrentOwner, self.currentConversation?.id == message.conversationId else { return }
                                    self.messages = ChatOutbox.merge(self.messages, page.messages)
                                    self.renderMessages()
                                } catch { self.showError(error) }
                            }
                        })
                        self.present(alert, animated: true)
                    }, for: .touchUpInside)
                    content.addArrangedSubview(followup)
                }
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
            row.axis = .horizontal; row.alignment = .top; row.spacing = appearance.isApprovedReference ? 12 : 32
            messagesStack.addArrangedSubview(row)
            // The bubble and the scroll view only share an ancestor once the row is in the
            // stack; activating this earlier throws NSGenericException ("no common ancestor").
            bubble.widthAnchor.constraint(lessThanOrEqualTo: scroll.frameLayoutGuide.widthAnchor,
                                          multiplier: appearance.maxBubbleWidth(isUser: isUser, isFinal: message.id == messages.last?.id)).isActive = true
            if message.role == "assistant", message.status == "queued" || message.status == "generating" {
                let progress = UILabel()
                progress.text = NSLocalizedString(message.status == "queued" ? "chat.reply.queued" : "chat.reply.generating", comment: "")
                progress.font = .preferredFont(forTextStyle: .caption1)
                progress.textColor = UIColor(red: 0.48, green: 0.52, blue: 0.48, alpha: 1)
                messagesStack.addArrangedSubview(progress)
            }
            if message.role == "assistant", isCompleteAssistantMessage(message), let action = message.action {
                messagesStack.addArrangedSubview(callPlanCard(for: message, action: action))
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

    private func isCompleteAssistantMessage(_ message: ChatMessage) -> Bool {
        message.status == "complete"
    }

    private func callPlanCard(for message: ChatMessage, action: ChatMessageAction) -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 16
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor.separator.cgColor
        let content = UIStackView()
        content.axis = .vertical
        content.spacing = 9
        content.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            content.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            content.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            content.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])

        let title = UILabel()
        title.text = NSLocalizedString("chat.plan.title", comment: "")
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        content.addArrangedSubview(title)
        let state = UILabel()
        state.text = NSLocalizedString(action.status == "confirmed"
                                      ? "chat.plan.status.confirmed" : "chat.plan.status.proposed", comment: "")
        state.font = .preferredFont(forTextStyle: .caption1)
        state.textColor = .secondaryLabel
        state.adjustsFontForContentSizeCategory = true
        content.addArrangedSubview(state)
        addPlanSection(NSLocalizedString("chat.plan.goal", comment: ""), values: [action.plan.goal], to: content)
        addPlanSection(NSLocalizedString("chat.plan.checklist", comment: ""),
                       values: action.plan.sayAsk.enumerated().map { "\($0.offset + 1). \($0.element)" },
                       to: content)
        addPlanSection(NSLocalizedString("chat.plan.facts", comment: ""), values: action.plan.ownerFacts, to: content)
        addPlanSection(NSLocalizedString("chat.plan.allowed", comment: ""),
                       values: action.plan.disclosurePolicy.allowed, to: content)
        addPlanSection(NSLocalizedString("chat.plan.forbidden", comment: ""),
                       values: action.plan.disclosurePolicy.forbidden, to: content)
        addPlanSection(NSLocalizedString("chat.plan.unknowns", comment: ""), values: action.plan.unknowns, to: content)
        let expected = action.plan.expectedQuestions.map {
            "\($0.q) — \($0.answer.flatMap { $0.isEmpty ? nil : $0 } ?? NSLocalizedString("chat.plan.unknownAnswer", comment: ""))"
        }
        addPlanSection(NSLocalizedString("chat.plan.expected", comment: ""), values: expected, to: content)
        addPlanSection(NSLocalizedString("chat.plan.language", comment: ""),
                       values: [NSLocalizedString("chat.plan.language.\(action.plan.language)", comment: "")], to: content)
        addPlanSection(NSLocalizedString("chat.plan.executor", comment: ""),
                       values: [NSLocalizedString(action.plan.executor == "hint"
                                                 ? "chat.plan.executor.hint" : "chat.plan.executor.secretary", comment: "")],
                       to: content)
        addPlanSection(NSLocalizedString("chat.plan.phone", comment: ""),
                       values: [action.plan.targetPhone ?? NSLocalizedString("chat.plan.notProvided", comment: "")], to: content)
        addPlanSection(NSLocalizedString("chat.plan.voicemail", comment: ""),
                       values: [action.plan.voicemail.map {
                           NSLocalizedString("chat.plan.voicemail.\($0)", comment: "")
                       } ?? NSLocalizedString("chat.plan.notProvided", comment: "")], to: content)

        let button = UIButton(type: .system)
        let isHint = action.plan.executor == "hint"
        let savedHint = isHint && action.status == "confirmed"
        button.setTitle(NSLocalizedString(savedHint ? "chat.plan.saved" :
                                            (isHint ? "chat.plan.saveHint" : "chat.plan.reviewSecretary"), comment: ""),
                        for: .normal)
        button.contentHorizontalAlignment = .leading
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.lineBreakMode = .byWordWrapping
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.accessibilityIdentifier = "chat-plan-action-\(message.id)"
        button.isEnabled = !savedHint && !confirmingPlanMessageIDs.contains(message.id)
        button.alpha = button.isEnabled ? 1 : 0.65
        button.addAction(UIAction { [weak self] _ in self?.reviewPlan(message: message) }, for: .touchUpInside)
        content.addArrangedSubview(button)
        return card
    }

    private func addPlanSection(_ heading: String, values: [String], to stack: UIStackView) {
        let label = UILabel()
        label.numberOfLines = 0
        label.adjustsFontForContentSizeCategory = true
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.textColor = .secondaryLabel
        let body = values.isEmpty ? NSLocalizedString("chat.plan.none", comment: "") : values.joined(separator: "\n")
        label.text = "\(heading)\n\(body)"
        stack.addArrangedSubview(label)
    }

    private func reviewPlan(message: ChatMessage) {
        guard isCurrentOwner, currentConversation?.id == message.conversationId,
              let action = message.action, ["proposed", "confirmed"].contains(action.status),
              !confirmingPlanMessageIDs.contains(message.id) else { return }
        if action.plan.executor == "secretary", navigationController == nil {
            showPlanError(NSLocalizedString("chat.plan.navigationUnavailable", comment: ""))
            return
        }
        let alert = UIAlertController(title: NSLocalizedString("chat.plan.confirm.title", comment: ""),
                                      message: String(format: NSLocalizedString("chat.plan.confirm.message", comment: ""),
                                                      planReviewSummary(action.plan)),
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.cancel", comment: ""), style: .cancel))
        alert.addAction(UIAlertAction(title: NSLocalizedString("chat.plan.confirm.action", comment: ""), style: .default) {
            [weak self] _ in self?.confirmPlan(message: message, planHash: action.planHash)
        })
        present(alert, animated: true)
    }

    private func planReviewSummary(_ plan: ChatCallPlan) -> String {
        [
            NSLocalizedString("chat.plan.goal", comment: "") + ": \(plan.goal)",
            NSLocalizedString("chat.plan.checklist", comment: "") + ": " + plan.sayAsk.joined(separator: "; "),
            NSLocalizedString("chat.plan.facts", comment: "") + ": " + plan.ownerFacts.joined(separator: "; "),
            NSLocalizedString("chat.plan.allowed", comment: "") + ": " + plan.disclosurePolicy.allowed.joined(separator: "; "),
            NSLocalizedString("chat.plan.forbidden", comment: "") + ": " + plan.disclosurePolicy.forbidden.joined(separator: "; "),
            NSLocalizedString("chat.plan.unknowns", comment: "") + ": " + plan.unknowns.joined(separator: "; "),
            NSLocalizedString("chat.plan.expected", comment: "") + ": " + plan.expectedQuestions.map {
                "\($0.q) — \($0.answer ?? NSLocalizedString("chat.plan.unknownAnswer", comment: ""))"
            }.joined(separator: "; "),
            NSLocalizedString("chat.plan.language", comment: "") + ": " +
                NSLocalizedString("chat.plan.language.\(plan.language)", comment: ""),
            NSLocalizedString("chat.plan.executor", comment: "") + ": " +
                NSLocalizedString(plan.executor == "hint" ? "chat.plan.executor.hint" : "chat.plan.executor.secretary", comment: ""),
            NSLocalizedString("chat.plan.phone", comment: "") + ": " + (plan.targetPhone ?? NSLocalizedString("chat.plan.notProvided", comment: "")),
            NSLocalizedString("chat.plan.voicemail", comment: "") + ": " + (plan.voicemail ?? NSLocalizedString("chat.plan.notProvided", comment: "")),
        ].joined(separator: "\n")
    }

    private func confirmPlan(message: ChatMessage, planHash: String) {
        guard isCurrentOwner, currentConversation?.id == message.conversationId,
              let current = messages.first(where: { $0.id == message.id }),
              !confirmingPlanMessageIDs.contains(message.id) else { return }
        guard let currentAction = current.action, currentAction.planHash == planHash else {
            showPlanError(NSLocalizedString("chat.plan.stale", comment: ""))
            return
        }
        confirmingPlanMessageIDs.insert(message.id)
        renderMessages()
        Task {
            defer {
                confirmingPlanMessageIDs.remove(message.id)
                if isCurrentOwner, currentConversation?.id == message.conversationId { renderMessages() }
            }
            do {
                let result = try await api.confirmChatPlan(conversationId: message.conversationId,
                                                           messageId: message.id, planHash: planHash)
                guard isCurrentOwner, currentConversation?.id == message.conversationId else { return }
                guard let index = messages.firstIndex(where: { $0.id == message.id }),
                      messages[index].action?.planHash == planHash,
                      result.message.id == message.id,
                      result.message.conversationId == message.conversationId,
                      result.message.action?.planHash == planHash else {
                    showPlanError(NSLocalizedString("chat.plan.requestFailed", comment: ""))
                    return
                }
                guard result.dialed == false else {
                    showPlanError(NSLocalizedString("chat.plan.unexpectedDial", comment: ""))
                    return
                }
                messages[index] = result.message
                renderMessages()
                if currentAction.plan.executor == "secretary" {
                    guard let review = result.review else {
                        showPlanError(NSLocalizedString("chat.plan.reviewUnavailable", comment: ""))
                        return
                    }
                    guard viewIfLoaded?.window != nil, let navigationController else {
                        showPlanError(NSLocalizedString("chat.plan.navigationUnavailable", comment: ""))
                        return
                    }
                    navigationController.pushViewController(
                        SecretaryTaskReviewViewController(phoneNumber: review.phoneNumber,
                                                           instruction: review.instruction,
                                                           confirmationToken: review.confirmationToken,
                                                           displayInstruction: planReviewSummary(currentAction.plan)),
                        animated: true)
                }
            } catch {
                guard isCurrentOwner, currentConversation?.id == message.conversationId else { return }
                if let apiError = error as? APIError, case .http(_, let detail) = apiError,
                   ["PLAN_STALE", "PLAN_CHANGED"].contains(detail) {
                    showPlanError(NSLocalizedString("chat.plan.stale", comment: ""))
                } else {
                    showPlanError(NSLocalizedString("chat.plan.requestFailed", comment: ""))
                }
            }
        }
    }

    private func showPlanError(_ message: String) {
        guard isCurrentOwner else { return }
        let alert = UIAlertController(title: NSLocalizedString("common.error", comment: ""),
                                      message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("common.ok", comment: ""), style: .default))
        present(alert, animated: true)
    }

    @objc private func dismissKeyboard() {
        guard !dictation.isBusy else { return }
        persistDraft()
        composer.resignFirstResponder()
    }

    @objc private func dismissKeyboardFromMessageSpace() {
        guard composer.isFirstResponder, !dictation.isBusy else { return }
        persistDraft()
        composer.resignFirstResponder()
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var hitView: UIView? = touch.view
        while let candidate = hitView, candidate !== scroll {
            if candidate is UIControl || candidate is UITextView || candidate is UITextField { return false }
            hitView = candidate.superview
        }
        return hitView === scroll || hitView?.isDescendant(of: scroll) == true
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
        guard isCurrentOwner, !dictation.isBusy else { return }
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
        draftRevision += 1
        persistDraft()
        renderAttachmentStatus()
        Task {
            do {
                let context = ChatPhoneContextCollector.isRelevant(text) ? await phoneContext.collect() : nil
                guard isCurrentOwner else { isSending = false; return }
                outbox.setContext(context, for: pending.id)
                let pair = try await api.sendChatMessage(conversationId: conversation.id, requestId: pending.id,
                                                         text: text, attachmentIds: pending.attachmentIds, language: pending.language, context: context, mode: pending.mode)
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
            updateComposerControls()
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
        guard !dictation.isBusy, !isSending, let outbox, let item = outbox.pendingSends.first(where: { $0.id == id }) else { return }
        guard currentConversation?.id == item.conversationId else { return }
        isSending = true
        outbox.setState(.sending, for: id)
        Task {
            defer { isSending = false; updateComposerControls() }
            do {
                let result = try await api.sendChatMessage(conversationId: item.conversationId, requestId: item.id,
                    text: item.text, attachmentIds: item.attachmentIds, language: item.language, context: item.context, mode: item.mode)
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
        guard let conversation = currentConversation else { return }
        pollTask = Task {
            while !Task.isCancelled {
                let generating = messages.contains(where: { $0.status == "queued" || $0.status == "generating" })
                try? await Task.sleep(nanoseconds: generating ? 1_000_000_000 : 5_000_000_000)
                guard !Task.isCancelled else { break }
                do {
                    let page = try await api.chatMessages(conversationId: conversation.id)
                    if isCurrentOwner, currentConversation?.id == conversation.id {
                        messages = ChatOutbox.merge(messages, page.messages); renderMessages()
                        loadAttachmentMetadata(in: page.messages, conversationId: conversation.id)
                    }
                    guard isCurrentOwner, currentConversation?.id == conversation.id else { break }
                } catch { if isCurrentOwner { statusLabel.text = NSLocalizedString("chat.error.network", comment: "") } }
            }
        }
    }
    func textViewDidBeginEditing(_ textView: UITextView) {
        if textView.text == NSLocalizedString("chat.message.placeholder", comment: "") { textView.text = ""; textView.textColor = .label }
    }
    func textViewDidChange(_ textView: UITextView) {
        hasRestoredComposer = true
        draftRevision += 1
        persistDraft()
        updateComposerControls()
    }
    func textViewDidEndEditing(_ textView: UITextView) {
        if textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { textView.text = NSLocalizedString("chat.message.placeholder", comment: ""); textView.textColor = .secondaryLabel }
    }
    @objc private func pickFile() {
        guard isCurrentOwner, !dictation.isBusy else { return }
        guard attachments.count < 3 else {
            statusLabel.text = NSLocalizedString("chat.file.limit", comment: "")
            return
        }
        guard !isUploadingAttachment else { return }
        if let pending = attachmentRetry {
            uploadAttachment(name: pending.name, mime: pending.mime, data: pending.data, requestId: pending.requestId)
            return
        }
        let menu = UIAlertController(title: NSLocalizedString("chat.attach", comment: ""), message: NSLocalizedString("chat.attach.sourcesNote", comment: ""), preferredStyle: .actionSheet)
        for key in ["chat.attach.camera", "chat.attach.photos"] {
            let action = UIAlertAction(title: NSLocalizedString(key, comment: "") + " — " + NSLocalizedString("chat.attach.notAvailable", comment: ""), style: .default, handler: nil)
            action.isEnabled = false
            menu.addAction(action)
        }
        menu.addAction(UIAlertAction(title: NSLocalizedString("chat.attach.files", comment: ""), style: .default) { [weak self] _ in
            guard let self, self.isCurrentOwner, !self.dictation.isBusy else { return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.plainText, .png, .jpeg, .pdf], asCopy: true)
            picker.delegate = self
            self.present(picker, animated: true)
        })
        menu.addAction(UIAlertAction(title: NSLocalizedString("chat.dictation.cancel", comment: ""), style: .cancel))
        menu.popoverPresentationController?.sourceView = fileButton
        menu.popoverPresentationController?.sourceRect = fileButton.bounds
        present(menu, animated: true)
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
            ? (appearance.isApprovedReference ? nil : NSLocalizedString("chat.disclaimer", comment: ""))
            : attachments.map { "\($0.name) · " + NSLocalizedString("chat.file.ready", comment: "") }.joined(separator: "   ")
        persistDraft()
        updateComposerControls()
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
                previewFiles[ObjectIdentifier(preview)] = url
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
    nonisolated func previewControllerDidDismiss(_ controller: QLPreviewController) {
        let identifier = ObjectIdentifier(controller)
        Task { @MainActor [weak self] in
            guard let self = self, let url = self.previewFiles.removeValue(forKey: identifier) else { return }
            try? FileManager.default.removeItem(at: url)
            if self.previewURL == url { self.previewURL = nil }
        }
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
        guard isCurrentOwner, !dictation.isBusy, !isSending, !isCreatingConversation, !isUploadingAttachment,
              capabilities?.voice.available != false else { return }
        let audioSession = AVAudioSession.sharedInstance()
        guard !CallManager.shared.hasPhoneAudioSession,
              !audioSession.isOtherAudioPlaying,
              !audioSession.secondaryAudioShouldBeSilencedHint else {
            statusLabel.text = NSLocalizedString("chat.voice.call_busy", comment: "")
            return
        }
        let text = draftText
        let selection = text.isEmpty ? NSRange(location: 0, length: 0) : composer.selectedRange
        guard let id = dictation.begin(context: dictationContext, text: text, selection: selection) else { return }
        persistDraft()
        composer.resignFirstResponder()
        updateDictationUI()
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
            DispatchQueue.main.async {
                guard let self, self.isCurrentOwner, self.viewIfLoaded?.window != nil,
                      self.dictation.capture?.context == self.dictationContext,
                      self.dictation.capture?.id == id else { return }
                if allowed, self.dictation.allow(id) {
                    self.startRecording()
                } else {
                    self.cancelDictation()
                    let alert = UIAlertController(title: NSLocalizedString("chat.voice.permission", comment: ""), message: nil, preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: NSLocalizedString("chat.dictation.settings", comment: ""), style: .default) { _ in
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    })
                    alert.addAction(UIAlertAction(title: NSLocalizedString("chat.dictation.cancel", comment: ""), style: .cancel))
                    self.present(alert, animated: true)
                }
            }
        }
    }
    private func startRecording() {
        let audioSession = AVAudioSession.sharedInstance()
        guard isCurrentOwner, !CallManager.shared.hasPhoneAudioSession,
              !audioSession.isOtherAudioPlaying, !audioSession.secondaryAudioShouldBeSilencedHint else {
            cancelDictation()
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
            recordingURL = url
            recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue])
            recorder?.isMeteringEnabled = true
            guard recorder?.record() == true else { throw APIError.decoding }
            heardAudio = false
            dictationStartedAt = Date()
            meterTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.sampleDictationLevel() }
            }
            if let meterTimer { RunLoop.main.add(meterTimer, forMode: .common) }
            statusLabel.text = NSLocalizedString("chat.voice.recording", comment: "")
            updateDictationUI()
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
            cancelDictation()
            statusLabel.text = NSLocalizedString("chat.voice.error", comment: "")
        }
    }
    private func stopRecording(discard: Bool) {
        if discard { cancelDictation(); return }
        guard let recorder else { return }
        recordingLimitTask?.cancel()
        recordingLimitTask = nil
        meterTimer?.invalidate(); meterTimer = nil
        recorder.stop(); self.recorder = nil
        let url = recordingURL; recordingURL = nil
        restoreAudioSession()
        defer { if let url { try? FileManager.default.removeItem(at: url) } }
        guard heardAudio else {
            cancelDictation()
            statusLabel.text = NSLocalizedString("chat.dictation.noSpeech", comment: "")
            return
        }
        guard let url, let data = try? Data(contentsOf: url), !data.isEmpty else {
            cancelDictation()
            statusLabel.text = NSLocalizedString("chat.voice.error", comment: "")
            return
        }
        pendingDictationAudio = data
        transcribeDictation()
    }
    private func sampleDictationLevel() {
        guard let recorder, recorder.isRecording else { return }
        guard isCurrentOwner, !CallManager.shared.hasPhoneAudioSession else {
            cancelDictation()
            statusLabel.text = NSLocalizedString("chat.voice.call_busy", comment: "")
            return
        }
        recorder.updateMeters()
        let db = recorder.averagePower(forChannel: 0)
        if db > -60 { heardAudio = true }
        dictationBar.update(level: min(1, max(0, (db + 60) / 60)))
        dictationBar.configure(mode: .recording, elapsed: Date().timeIntervalSince(dictationStartedAt ?? Date()))
    }
    private func transcribeDictation() {
        guard isCurrentOwner, let data = pendingDictationAudio,
              dictation.capture?.context == dictationContext,
              let attempt = dictation.recognize() else { return }
        recognitionTask?.cancel()
        updateDictationUI()
        statusLabel.text = NSLocalizedString("chat.dictation.recognizing", comment: "")
        recognitionTask = Task { [weak self] in
            guard let self else { return }
            do {
                try Task.checkCancellation()
                let transcript = try await api.prepareTranscribe(audio: data, mimeType: "audio/m4a")
                try Task.checkCancellation()
                guard isCurrentOwner, dictation.accepts(attempt, context: dictationContext) else { return }
                guard let result = dictation.finish(attempt, context: dictationContext, transcript: transcript) else {
                    cancelDictation()
                    statusLabel.text = NSLocalizedString("chat.dictation.noSpeech", comment: "")
                    return
                }
                pendingDictationAudio = nil
                composer.text = result.text
                composer.textColor = .label
                composer.selectedRange = NSRange(location: result.caret, length: 0)
                draftRevision += 1
                persistDraft()
                updateDictationUI()
                statusLabel.text = NSLocalizedString("chat.dictation.review", comment: "")
                composer.becomeFirstResponder()
            } catch {
                guard !Task.isCancelled, isCurrentOwner, dictation.accepts(attempt, context: dictationContext) else { return }
                dictation.fail(attempt)
                updateDictationUI()
                statusLabel.text = NSLocalizedString("chat.voice.error", comment: "")
            }
        }
    }
    private func cancelDictation() {
        recognitionTask?.cancel(); recognitionTask = nil
        recordingLimitTask?.cancel(); recordingLimitTask = nil
        meterTimer?.invalidate(); meterTimer = nil
        recorder?.stop(); recorder = nil
        if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
        recordingURL = nil
        pendingDictationAudio = nil
        dictationStartedAt = nil
        dictation.cancel()
        restoreAudioSession()
        updateDictationUI()
        if isViewLoaded { renderAttachmentStatus() }
    }
    private func updateDictationUI() {
        inputControls.isHidden = dictation.isBusy
        dictationBar.isHidden = !dictation.isBusy
        switch dictation.phase {
        case .permission: dictationBar.configure(mode: .permission)
        case .recording: dictationBar.configure(mode: .recording, elapsed: Date().timeIntervalSince(dictationStartedAt ?? Date()))
        case .failed: dictationBar.configure(mode: .failed)
        default: dictationBar.configure(mode: .recognizing)
        }
        updateComposerControls()
    }
    private func updateComposerControls() {
        sendButton.isHidden = draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attachments.isEmpty
        sendButton.isEnabled = isCurrentOwner && !dictation.isBusy && !isSending && !isUploadingAttachment && attachmentRetry == nil
        voiceButton.isEnabled = isCurrentOwner && !dictation.isBusy && !isSending && !isUploadingAttachment && capabilities?.voice.available != false
        if composer.bounds.width > 0 {
            let height = min(120, max(44, composer.sizeThatFits(CGSize(width: composer.bounds.width, height: .greatestFiniteMagnitude)).height))
            if abs((composerHeight?.constant ?? 0) - height) > 0.5 { composerHeight?.constant = height }
        }
    }
    private func persistDraft() {
        guard hasRestoredComposer, isCurrentOwner, let outbox else { return }
        var saved = outbox.composerDrafts
        saved[currentConversation?.id ?? "_new"] = ChatComposerDraft(text: draftText, attachments: attachments)
        outbox.composerDrafts = saved
    }
    private func restoreDraft() {
        let saved = outbox?.composerDrafts[currentConversation?.id ?? "_new"]
        composer.text = saved?.text.isEmpty == false ? saved?.text : NSLocalizedString("chat.message.placeholder", comment: "")
        composer.textColor = saved?.text.isEmpty == false ? .label : .secondaryLabel
        attachments = saved?.attachments ?? []
        hasRestoredComposer = true
        for attachment in attachments { attachmentCache[attachment.id] = attachment }
        renderAttachmentStatus()
    }
    private func restoreAudioSession() {
        // Never deactivate another feature's audio when no recording was begun.
        guard previousAudioCategory != nil else { return }
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
