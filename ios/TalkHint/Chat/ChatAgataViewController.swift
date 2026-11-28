import UIKit
import SwiftUI
import AVFoundation

/// Existing Orb artwork; a separate transport keeps legacy STT/TTS untouched.
@MainActor
final class ChatAgataViewController: UIViewController {
    private let api: APIClient
    private let conversation: ChatConversation
    private let validOwner: () -> Bool
    private let status = UILabel()
    private let lastLine = UILabel()
    private let recoveryButton = UIButton(type: .system)
    private var orb: UIHostingController<ChatVoiceOrbView>?
    private var operation: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []
    private lazy var voice = ChatAgataSession(api: api, conversationId: conversation.id, validOwner: validOwner)

    init(api: APIClient, conversation: ChatConversation, validOwner: @escaping () -> Bool) {
        self.api = api; self.conversation = conversation; self.validOwner = validOwner
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private func text(_ key: String) -> String {
        NSLocalizedString(key, tableName: "Agata", bundle: .main, comment: "")
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let back = UIButton(type: .system)
        back.setImage(UIImage(systemName: "chevron.left",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 23)), for: .normal)
        back.accessibilityLabel = NSLocalizedString("chat.back", comment: "")
        back.accessibilityIdentifier = "chat-agata-back"
        back.addTarget(self, action: #selector(close), for: .touchUpInside)
        let title = UILabel()
        title.text = text("title"); title.font = .preferredFont(forTextStyle: .headline)
        title.textAlignment = .center; title.adjustsFontForContentSizeCategory = true
        let balance = UIView()
        let header = UIStackView(arrangedSubviews: [back, title, balance])
        for v in [back, balance] {
            v.widthAnchor.constraint(equalToConstant: 44).isActive = true
            v.heightAnchor.constraint(equalToConstant: 44).isActive = true
        }
        let host = UIHostingController(rootView: ChatVoiceOrbView(phase: .thinking))
        orb = host; addChild(host); host.view.backgroundColor = .clear
        status.text = text("connecting")
        status.font = .preferredFont(forTextStyle: .title3)
        status.adjustsFontForContentSizeCategory = true
        status.textAlignment = .center; status.numberOfLines = 0
        status.accessibilityIdentifier = "chat-agata-status"
        lastLine.font = .preferredFont(forTextStyle: .footnote)
        lastLine.adjustsFontForContentSizeCategory = true
        lastLine.numberOfLines = 2; lastLine.textAlignment = .center
        lastLine.lineBreakMode = .byTruncatingTail; lastLine.textColor = .secondaryLabel
        let notice = UILabel()
        notice.text = NSLocalizedString("chat.voiceMode.saved", comment: "")
        notice.font = .preferredFont(forTextStyle: .footnote)
        notice.adjustsFontForContentSizeCategory = true
        notice.textColor = .secondaryLabel; notice.textAlignment = .center; notice.numberOfLines = 0
        let stop = UIButton(type: .system)
        stop.setImage(UIImage(systemName: "stop.fill"), for: .normal)
        stop.backgroundColor = .black; stop.tintColor = .white; stop.layer.cornerRadius = 28
        stop.accessibilityLabel = text("stop"); stop.accessibilityIdentifier = "chat-agata-stop"
        stop.addTarget(self, action: #selector(close), for: .touchUpInside)
        let left = UIView(), right = UIView()
        let controls = UIStackView(arrangedSubviews: [left, stop, right])
        left.widthAnchor.constraint(equalTo: right.widthAnchor).isActive = true
        let spacer = UIView()
        recoveryButton.setTitle(text("checkPrevious"), for: .normal)
        recoveryButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        recoveryButton.titleLabel?.adjustsFontForContentSizeCategory = true
        recoveryButton.titleLabel?.numberOfLines = 0
        recoveryButton.accessibilityIdentifier = "chat-agata-recovery"
        recoveryButton.isHidden = true
        recoveryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        recoveryButton.addTarget(self, action: #selector(checkPrevious), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [header, host.view, status, recoveryButton, lastLine, spacer, notice, controls])
        stack.axis = .vertical; stack.spacing = 12
        view.addSubview(stack); stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            host.view.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.32),
            stop.widthAnchor.constraint(equalToConstant: 56),
            stop.heightAnchor.constraint(equalToConstant: 56)
        ])
        host.didMove(toParent: self)
        voice.onState = { [weak self] phase, level in
            guard let self else { return }
            self.orb?.rootView = ChatVoiceOrbView(phase: phase, level: level, screenActive: true)
            let key = phase == .speaking ? "speaking" : phase == .thinking ? "thinking" : "listening"
            self.status.text = NSLocalizedString("chat.voiceMode." + key, comment: "")
        }
        voice.onText = { [weak self] in self?.lastLine.text = $0 }
        voice.onError = { [weak self] in self?.showEnd("error") }
        voice.onEnded = { [weak self] budget in self?.showEnd(budget ? "budget" : "ended") }
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.operation?.cancel(); self?.voice.stop(); self?.showEnd("ended")
                }
            })
        }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard operation == nil else { return }
        operation = Task { [weak self] in await self?.start() }
    }
    private func start() async {
        guard validOwner() else { showEnd("error"); return }
        guard !CallManager.shared.hasPhoneAudioSession else { showEnd("audioBusy"); return }
        let granted = await withCheckedContinuation { c in
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { c.resume(returning: $0) }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) }
            }
        }
        guard !Task.isCancelled, validOwner(), viewIfLoaded?.window != nil else { return }
        guard granted else {
            status.text = NSLocalizedString("chat.voiceMode.permissionDenied", comment: "")
            orb?.rootView = ChatVoiceOrbView(phase: .unavailable)
            return
        }
        do {
            let language = (Bundle.main.preferredLocalizations.first ?? "en").components(separatedBy: "-")[0]
            try await voice.start(language: language)
        } catch is CancellationError {
            // Leaving the screen is not a failed user utterance.
        } catch {
            voice.stop()
            guard !Task.isCancelled else { return }
            showEnd(ChatAgataFailure.messageKey(error))
        }
    }
    private func showEnd(_ key: String) {
        status.text = text(key)
        recoveryButton.isHidden = key != "unreconciled"
        orb?.rootView = ChatVoiceOrbView(phase: .unavailable)
    }
    @objc private func checkPrevious() {
        guard validOwner(), recoveryButton.isEnabled else { return }
        recoveryButton.isEnabled = false
        status.text = text("checkingPrevious")
        operation = Task { [weak self] in
            guard let self else { return }
            defer { self.recoveryButton.isEnabled = true }
            do {
                let result = try await self.api.recoverChatAgata()
                guard !Task.isCancelled, self.validOwner(), self.viewIfLoaded?.window != nil else { return }
                switch result.state {
                case .ready: self.showEnd("recoveryReady")
                case .blocked: self.showEnd("unreconciled")
                case .reviewRequired: self.showEnd("reviewRequired")
                }
            } catch {
                guard !Task.isCancelled, self.validOwner(), self.viewIfLoaded?.window != nil else { return }
                self.showEnd("recoveryUnavailable")
                self.recoveryButton.isHidden = false
            }
            // No start(), microphone request, or automatic paid retry here.
        }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        voice.stop(); operation?.cancel()
    }
    @objc private func close() { voice.stop(); operation?.cancel(); dismiss(animated: true) }
    deinit {
        operation?.cancel()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }
}
