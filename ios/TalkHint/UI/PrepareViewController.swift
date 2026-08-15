import UIKit
import AVFoundation

/// PREPARE stage — the pre-call preparation chat, ported from the web `/app`
/// UI. The user explains the upcoming call by voice or text; GPT-5.6 Sol (one
/// brain, honest errors, never a silent model substitution) asks at most a
/// couple of clarifying questions, proposes a compact call goal ("✓ Всё верно /
/// Изменить"), and after explicit confirmation delivers the first English
/// phrase with its translation.
///
/// Transport mirrors the web client exactly:
/// - voice → `POST /api/prepare/stt` (gpt-4o-transcribe, tap-to-record)
/// - dialog → the `/ui` WebSocket: `prepare_message` / `prepare_reply` /
///   `prepare_confirm_goal` / `prepare_opening` / `prepare_error`
/// - confirmation activates the goal through the EXISTING `goal_set` mechanism
///   (the server echoes `goal_set`, which we mirror into `SessionStore.callGoal`
///   so the next call is grounded in it).
final class PrepareViewController: UIViewController {

    // MARK: - Stream

    private let stream = CallHintStream()

    // MARK: - UI

    private let scrollView = UIScrollView()
    private let feedStack = UIStackView()
    private let inputBar = UIView()
    private let textField = UITextField()
    private let sendButton = UIButton(type: .system)
    private let micButton = UIButton(type: .system)
    private let statusLabel = UILabel()

    /// The transient "…" thinking bubble shown while Sol is working.
    private var thinkingBubble: UIView?
    /// The button row of the currently pending goal-proposal card (removed once
    /// the user confirms or asks for changes, like the web card).
    private weak var pendingGoalButtons: UIStackView?

    // MARK: - Recording

    private var recorder: AVAudioRecorder?
    private var isRecording = false
    private var recordingURL: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("prepare-utterance.m4a")
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Подготовка звонка"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Заново", style: .plain, target: self, action: #selector(resetTapped))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-prepare-reset"
        buildUI()

        stream.delegate = self
        stream.connect()

        addAIMessage("Расскажите голосом или текстом, что за звонок вам предстоит и чего вы хотите добиться. Я задам пару уточняющих вопросов и предложу цель.")

        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    }

    deinit {
        stream.disconnect()
        recorder?.stop()
    }

    // MARK: - UI construction

    private var inputBarBottomConstraint: NSLayoutConstraint!

    private func buildUI() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        view.addSubview(scrollView)

        feedStack.axis = .vertical
        feedStack.spacing = 10
        feedStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(feedStack)

        inputBar.backgroundColor = .secondarySystemBackground
        inputBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(inputBar)

        statusLabel.font = .preferredFont(forTextStyle: .caption1)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.text = ""
        statusLabel.accessibilityIdentifier = "text-prepare-status"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        inputBar.addSubview(statusLabel)

        micButton.setImage(UIImage(systemName: "mic.fill"), for: .normal)
        micButton.tintColor = .systemBlue
        micButton.accessibilityIdentifier = "button-prepare-mic"
        micButton.addTarget(self, action: #selector(micTapped), for: .touchUpInside)
        micButton.translatesAutoresizingMaskIntoConstraints = false

        textField.placeholder = "Опишите ситуацию…"
        textField.borderStyle = .roundedRect
        textField.returnKeyType = .send
        textField.delegate = self
        textField.accessibilityIdentifier = "input-prepare-text"
        textField.translatesAutoresizingMaskIntoConstraints = false

        sendButton.setImage(UIImage(systemName: "arrow.up.circle.fill"), for: .normal)
        sendButton.tintColor = .systemGreen
        sendButton.accessibilityIdentifier = "button-prepare-send"
        sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        sendButton.translatesAutoresizingMaskIntoConstraints = false

        inputBar.addSubview(micButton)
        inputBar.addSubview(textField)
        inputBar.addSubview(sendButton)

        inputBarBottomConstraint = inputBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: inputBar.topAnchor),

            feedStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 12),
            feedStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 12),
            feedStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -12),
            feedStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -12),
            feedStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -24),

            inputBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputBarBottomConstraint,

            statusLabel.topAnchor.constraint(equalTo: inputBar.topAnchor, constant: 4),
            statusLabel.leadingAnchor.constraint(equalTo: inputBar.leadingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(equalTo: inputBar.trailingAnchor, constant: -12),

            micButton.leadingAnchor.constraint(equalTo: inputBar.leadingAnchor, constant: 12),
            micButton.centerYAnchor.constraint(equalTo: textField.centerYAnchor),
            micButton.widthAnchor.constraint(equalToConstant: 36),
            micButton.heightAnchor.constraint(equalToConstant: 36),

            textField.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 4),
            textField.leadingAnchor.constraint(equalTo: micButton.trailingAnchor, constant: 8),
            textField.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -8),
            textField.bottomAnchor.constraint(equalTo: inputBar.bottomAnchor, constant: -10),
            textField.heightAnchor.constraint(equalToConstant: 40),

            sendButton.trailingAnchor.constraint(equalTo: inputBar.trailingAnchor, constant: -12),
            sendButton.centerYAnchor.constraint(equalTo: textField.centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 36),
            sendButton.heightAnchor.constraint(equalToConstant: 36),
        ])
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue,
              let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double else { return }
        let overlap = max(0, view.bounds.maxY - frame.minY - view.safeAreaInsets.bottom)
        inputBarBottomConstraint.constant = -overlap
        UIView.animate(withDuration: duration) { self.view.layoutIfNeeded() }
    }

    // MARK: - Feed bubbles

    private func makeBubble(text: String, isUser: Bool) -> UIView {
        let container = UIView()
        let bubble = UIView()
        bubble.layer.cornerRadius = 14
        bubble.backgroundColor = isUser ? .systemGreen.withAlphaComponent(0.85) : .secondarySystemBackground
        bubble.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(bubble)

        let label = UILabel()
        label.text = text
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        label.textColor = isUser ? .white : .label
        label.translatesAutoresizingMaskIntoConstraints = false
        bubble.addSubview(label)

        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -10),
            label.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -12),

            bubble.topAnchor.constraint(equalTo: container.topAnchor),
            bubble.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            bubble.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, multiplier: 0.85),
            isUser
                ? bubble.trailingAnchor.constraint(equalTo: container.trailingAnchor)
                : bubble.leadingAnchor.constraint(equalTo: container.leadingAnchor),
        ])
        return container
    }

    private func appendToFeed(_ view: UIView) {
        feedStack.addArrangedSubview(view)
        self.view.layoutIfNeeded()
        let bottom = CGPoint(x: 0, y: max(0, scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom))
        scrollView.setContentOffset(bottom, animated: true)
    }

    private func addUserMessage(_ text: String) {
        appendToFeed(makeBubble(text: text, isUser: true))
    }

    private func addAIMessage(_ text: String) {
        appendToFeed(makeBubble(text: text, isUser: false))
    }

    private func showThinking() {
        hideThinking()
        let bubble = makeBubble(text: "…", isUser: false)
        thinkingBubble = bubble
        appendToFeed(bubble)
    }

    private func hideThinking() {
        thinkingBubble?.removeFromSuperview()
        thinkingBubble = nil
    }

    /// Goal-proposal card: compact goal + "✓ Всё верно / Изменить". The goal is
    /// NOT active until the user confirms; "Изменить" just continues the dialog.
    private func addGoalProposal(_ goal: String) {
        let card = UIView()
        card.backgroundColor = UIColor.systemYellow.withAlphaComponent(0.15)
        card.layer.cornerRadius = 14
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor.systemOrange.cgColor
        card.accessibilityIdentifier = "card-goal-proposal"

        let header = UILabel()
        header.text = "🎯 ЦЕЛЬ ЗВОНКА"
        header.font = .preferredFont(forTextStyle: .caption1)
        header.textColor = .systemOrange

        let goalLabel = UILabel()
        goalLabel.text = goal
        goalLabel.numberOfLines = 0
        goalLabel.font = .preferredFont(forTextStyle: .body)

        let confirmButton = UIButton(type: .system)
        confirmButton.setTitle("✓ Всё верно", for: .normal)
        confirmButton.setTitleColor(.white, for: .normal)
        confirmButton.backgroundColor = .systemGreen
        confirmButton.layer.cornerRadius = 8
        confirmButton.accessibilityIdentifier = "button-goal-confirm"

        let editButton = UIButton(type: .system)
        editButton.setTitle("Изменить", for: .normal)
        editButton.backgroundColor = .tertiarySystemBackground
        editButton.layer.cornerRadius = 8
        editButton.accessibilityIdentifier = "button-goal-edit"

        let buttons = UIStackView(arrangedSubviews: [confirmButton, editButton])
        buttons.axis = .horizontal
        buttons.distribution = .fillEqually
        buttons.spacing = 8
        buttons.heightAnchor.constraint(equalToConstant: 40).isActive = true
        pendingGoalButtons = buttons

        confirmButton.addAction(UIAction { [weak self, weak buttons] _ in
            guard let self = self else { return }
            buttons?.removeFromSuperview()
            self.showThinking()
            self.stream.confirmPrepareGoal(goal)
        }, for: .touchUpInside)

        editButton.addAction(UIAction { [weak self, weak buttons] _ in
            buttons?.removeFromSuperview()
            self?.textField.placeholder = "Что изменить в цели?"
            self?.textField.becomeFirstResponder()
        }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [header, goalLabel, buttons])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
        ])
        appendToFeed(card)
    }

    /// Opening-phrase card shown after the goal is confirmed.
    private func addOpeningPhrase(en: String, translation: String?) {
        let card = UIView()
        card.backgroundColor = UIColor.systemGreen.withAlphaComponent(0.12)
        card.layer.cornerRadius = 14
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor.systemGreen.cgColor
        card.accessibilityIdentifier = "card-opening-phrase"

        let header = UILabel()
        header.text = "💬 ПЕРВАЯ ФРАЗА"
        header.font = .preferredFont(forTextStyle: .caption1)
        header.textColor = .systemGreen

        let enLabel = UILabel()
        enLabel.text = en
        enLabel.numberOfLines = 0
        enLabel.font = .preferredFont(forTextStyle: .headline)

        let stack = UIStackView(arrangedSubviews: [header, enLabel])
        stack.axis = .vertical
        stack.spacing = 6

        if let translation = translation, !translation.isEmpty {
            let trLabel = UILabel()
            trLabel.text = translation
            trLabel.numberOfLines = 0
            trLabel.font = .preferredFont(forTextStyle: .subheadline)
            trLabel.textColor = .secondaryLabel
            stack.addArrangedSubview(trLabel)
        }

        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
        ])
        appendToFeed(card)
    }

    // MARK: - Actions

    @objc private func sendTapped() {
        let text = (textField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        textField.text = ""
        textField.placeholder = "Опишите ситуацию…"
        addUserMessage(text)
        showThinking()
        stream.sendPrepareMessage(text)
    }

    @objc private func resetTapped() {
        stream.resetPrepare()
        hideThinking()
        pendingGoalButtons?.removeFromSuperview()
        feedStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        addAIMessage("Начнём заново. Расскажите, что за звонок вам предстоит.")
    }

    // MARK: - Voice input (tap-to-record → /api/prepare/stt)

    @objc private func micTapped() {
        if isRecording {
            stopRecordingAndTranscribe()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        let session = AVAudioSession.sharedInstance()
        session.requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard granted else {
                    self.addAIMessage("⚠️ Нет доступа к микрофону. Разрешите доступ в Настройках iOS.")
                    return
                }
                do {
                    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                    try session.setActive(true)
                    let settings: [String: Any] = [
                        AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: 16_000,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
                    ]
                    try? FileManager.default.removeItem(at: self.recordingURL)
                    let recorder = try AVAudioRecorder(url: self.recordingURL, settings: settings)
                    recorder.record()
                    self.recorder = recorder
                    self.isRecording = true
                    self.micButton.tintColor = .systemRed
                    self.micButton.setImage(UIImage(systemName: "stop.circle.fill"), for: .normal)
                    self.statusLabel.text = "🎙 Запись… нажмите ещё раз, чтобы остановить"
                } catch {
                    self.addAIMessage("⚠️ Не удалось начать запись: \(error.localizedDescription)")
                }
            }
        }
    }

    private func stopRecordingAndTranscribe() {
        recorder?.stop()
        recorder = nil
        isRecording = false
        micButton.tintColor = .systemBlue
        micButton.setImage(UIImage(systemName: "mic.fill"), for: .normal)
        statusLabel.text = "Распознаю речь…"
        micButton.isEnabled = false

        let url = recordingURL
        Task { @MainActor in
            defer {
                self.micButton.isEnabled = true
                self.statusLabel.text = ""
            }
            guard let data = try? Data(contentsOf: url), data.count > 2000 else {
                self.addAIMessage("⚠️ Запись слишком короткая — попробуйте ещё раз.")
                return
            }
            do {
                let text = try await APIClient.shared.prepareTranscribe(audio: data, mimeType: "audio/m4a")
                guard !text.isEmpty else {
                    self.addAIMessage("⚠️ Речь не распознана — попробуйте ещё раз, чуть ближе к микрофону.")
                    return
                }
                // Straight into the preparation chat, same as a typed message.
                self.addUserMessage(text)
                self.showThinking()
                self.stream.sendPrepareMessage(text)
            } catch {
                self.addAIMessage("⚠️ " + error.localizedDescription)
            }
        }
    }
}

// MARK: - UITextFieldDelegate

extension PrepareViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        sendTapped()
        return true
    }
}

// MARK: - CallHintStreamDelegate

extension PrepareViewController: CallHintStreamDelegate {
    func callHintStream(_ stream: CallHintStream, didReceive event: CallHintEvent) {
        switch event {
        case .prepareReply(let text, let proposedGoal):
            hideThinking()
            addAIMessage(text)
            if let goal = proposedGoal { addGoalProposal(goal) }
        case .prepareOpening(let phraseEn, let translation):
            hideThinking()
            addOpeningPhrase(en: phraseEn, translation: translation)
            addAIMessage("📞 Цель подтверждена. Начинайте звонок с этой фразы — я буду подсказывать дальше.")
        case .prepareError(let text):
            hideThinking()
            addAIMessage("⚠️ " + text)
        case .goalSet(let goal):
            // Confirmation activated the goal through the existing mechanism —
            // mirror it locally so the next call is grounded in it.
            SessionStore.shared.callGoal = goal
            addAIMessage("🎯 Цель: " + goal)
        default:
            break // live-call events are not relevant on the PREPARE screen
        }
    }

    func callHintStreamDidConnect(_ stream: CallHintStream) {
        statusLabel.text = ""
    }

    func callHintStream(_ stream: CallHintStream, didDisconnectWillRetryAttempt attempt: Int, of maxAttempts: Int) {
        statusLabel.text = CallHintStream.reconnectingStatusText(attempt: attempt, of: maxAttempts)
    }

    func callHintStreamDidFailTerminally(_ stream: CallHintStream) {
        statusLabel.text = "Нет соединения с сервером"
        addAIMessage("⚠️ Нет соединения с сервером. Вернитесь на экран позже или попробуйте снова.")
    }

    func callHintStreamDidRequireSignIn(_ stream: CallHintStream) {
        statusLabel.text = "Требуется вход в аккаунт"
        addAIMessage("⚠️ Войдите в аккаунт, чтобы готовить звонок.")
    }
}
