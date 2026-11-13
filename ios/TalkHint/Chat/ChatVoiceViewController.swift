import UIKit
import SwiftUI
import AVFoundation

/// Voice on the existing chat API; input requires explicit action and server access.
@MainActor
final class ChatVoiceViewController: UIViewController {
    private let api: APIClient
    private let conversation: ChatConversation
    private let validOwner: () -> Bool
    private let submit: (String, UUID) async throws -> ChatMessagePair
    private let attachments: () -> Void
    private let capture = ChatVoiceCapture()
    private var session = ChatVoiceSessionState()
    private var operation: Task<Void, Never>?
    private var refresh: Task<Void, Never>?
    private var cancellation: Task<Void, Error>?
    private var replyID: String?
    private var pendingSend: (text: String, id: UUID)?
    private var observers: [NSObjectProtocol] = []
    private var orbHost: UIHostingController<ChatVoiceOrbView>?
    private let status = UILabel()
    private let transcript = UITextView()
    private let mic = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    private var level = 0.0
    private let notice = UILabel()
    private var speechEnabled = false
    private var cursor = ChatVoiceSentenceCursor()
    private var speechQueue: [(message: String, offset: Int, length: Int)] = []
    private var speechTask: Task<Void, Never>?
    private var speechEpoch = UUID()
    private var replyFinished = false
    private var trace: ChatVoiceLatencyTrace?
    private var measuredFirstSound = false

    init(api: APIClient, conversation: ChatConversation, validOwner: @escaping () -> Bool,
         submit: @escaping (String, UUID) async throws -> ChatMessagePair,
         attachments: @escaping () -> Void) {
        self.api = api; self.conversation = conversation; self.validOwner = validOwner
        self.submit = submit; self.attachments = attachments
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        build()
        capture.isAllowed = { [weak self] in
            guard let self else { return false }
            return self.validOwner() && self.session.phase != .closed
                && self.viewIfLoaded?.window != nil
        }
        capture.onLevel = { [weak self] value in
            guard let self, self.session.phase != .speaking else { return }
            self.level = value; self.renderOrb()
        }
        capture.onOutputLevel = { [weak self] value in self?.level = value; self?.renderOrb() }
        capture.onSpeechBegan = { [weak self] in self?.interruptResponse() }
        capture.onUtterance = { [weak self] data in self?.recognize(data) }
        capture.onSpeechEnded = { [weak self] at in
            self?.trace = ChatVoiceLatencyTrace(speechEnd: at, vadFinished: ProcessInfo.processInfo.systemUptime)
        }
        capture.onError = { [weak self] in self?.fail("chat.voiceMode.captureError") }
        capture.onInputRestarted = { [weak self] in
            self?.status.text = NSLocalizedString("chat.voiceMode.inputRestarted", comment: "")
        }
        capture.onFirstRender = { [weak self] at, latency in self?.firstSound(at: at, outputLatency: latency) }
        capture.onPlaybackFinished = { [weak self] in self?.outputFinished() }
        for name in [UIApplication.didEnterBackgroundNotification, AVAudioSession.interruptionNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.pause() }
            })
        }
        // Route/configuration recovery belongs to this screen's capture object.
        // Do not race it by independently pausing on AirPods/Bluetooth changes.
        update()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { [weak self] in await self?.loadSpeechCapabilities() }
        refresh = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.validOwner(), self.session.phase != .closed else { return }
                await self.refreshHistory()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        shutdown()
    }
    deinit {
        operation?.cancel(); refresh?.cancel(); speechTask?.cancel()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }
    private func build() {
        let back = button("chevron.left", key: "chat.back", action: #selector(close))
        back.accessibilityIdentifier = "chat-voice-back"
        let title = UILabel()
        title.text = "TalkHint"
        title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        title.textAlignment = .center
        let subtitle = UILabel()
        subtitle.text = NSLocalizedString("chat.voiceMode.open", comment: "")
        subtitle.font = .preferredFont(forTextStyle: .subheadline)
        subtitle.textColor = .secondaryLabel
        subtitle.textAlignment = .center
        subtitle.adjustsFontForContentSizeCategory = true
        let heading = UIStackView(arrangedSubviews: [title, subtitle])
        heading.axis = .vertical; heading.spacing = 2
        heading.accessibilityIdentifier = "chat-voice-heading"
        let settings = button("gearshape", key: "chat.voiceMode.settings", action: #selector(showSettings))
        let header = UIStackView(arrangedSubviews: [back, heading, settings])
        header.spacing = 12; header.alignment = .center
        let orb = UIHostingController(rootView: ChatVoiceOrbView(phase: .idle))
        addChild(orb); orbHost = orb
        orb.view.backgroundColor = .clear
        let orbHeight = orb.view.heightAnchor.constraint(equalToConstant: 220)
        orbHeight.priority = .defaultLow
        orbHeight.isActive = true
        orb.view.heightAnchor.constraint(greaterThanOrEqualToConstant: 100).isActive = true
        status.numberOfLines = 0; status.textAlignment = .center
        status.font = .preferredFont(forTextStyle: .title3)
        status.accessibilityIdentifier = "chat-voice-status"
        status.adjustsFontForContentSizeCategory = true
        notice.text = NSLocalizedString("chat.voiceMode.noOutput", comment: "")
        notice.font = .preferredFont(forTextStyle: .footnote)
        notice.textColor = .secondaryLabel; notice.numberOfLines = 0
        notice.adjustsFontForContentSizeCategory = true
        notice.textAlignment = .center
        transcript.isEditable = false
        transcript.font = .preferredFont(forTextStyle: .title3)
        transcript.adjustsFontForContentSizeCategory = true
        transcript.accessibilityIdentifier = "chat-voice-transcript"
        transcript.backgroundColor = .secondarySystemBackground
        transcript.layer.cornerRadius = 18
        transcript.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 16, right: 12)
        retry.setTitle(NSLocalizedString("chat.retry", comment: ""), for: .normal)
        retry.addTarget(self, action: #selector(retrySend), for: .touchUpInside)
        retry.isHidden = true
        let plus = button("plus", key: "chat.voiceMode.attachment", action: #selector(pickAttachment))
        mic.setImage(UIImage(systemName: "mic.slash"), for: .normal)
        mic.isEnabled = false // no paid voice input before capability/voice selection
        mic.addTarget(self, action: #selector(toggleMic), for: .touchUpInside)
        mic.accessibilityIdentifier = "chat-voice-microphone"
        let exit = button("xmark", key: "chat.voiceMode.close", action: #selector(close))
        exit.backgroundColor = .black; exit.tintColor = .white; exit.layer.cornerRadius = 28
        exit.accessibilityIdentifier = "chat-voice-close"
        let controls = UIStackView(arrangedSubviews: [plus, mic, exit])
        controls.distribution = .equalSpacing; controls.alignment = .center
        for control in [plus, mic, exit] {
            control.widthAnchor.constraint(equalToConstant: 56).isActive = true
            control.heightAnchor.constraint(equalToConstant: 56).isActive = true
        }
        let stack = UIStackView(arrangedSubviews: [header, orb.view, status, notice, transcript, retry, controls])
        stack.axis = .vertical; stack.spacing = 12
        view.addSubview(stack); stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            // Both views must share an ancestor before activating this constraint.
            orb.view.heightAnchor.constraint(lessThanOrEqualTo: view.heightAnchor, multiplier: 0.32),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
        ])
        orb.didMove(toParent: self)
        orb.view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    }
    private func button(_ symbol: String, key: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 23)), for: .normal)
        button.accessibilityLabel = NSLocalizedString(key, comment: "")
        button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }
    @objc private func close() { shutdown(); dismiss(animated: true) }
    @objc private func pickAttachment() {
        shutdown()
        dismiss(animated: true) { [attachments] in attachments() }
    }
    @objc private func showSettings() {
        pause()
        Task { [weak self] in
            guard let self else { return }
            var body = self.notice.text ?? ""
            do {
                let data = try await self.api.request("/api/chat-v1/voice-budget", method: "GET", json: nil, authenticated: true)
                guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let reserved = value["conservativeReservedUsd"] as? Double,
                      let state = value["mailStatus"] as? String else { throw APIError.decoding }
                let key = state == "delivered" ? "budgetMailSent"
                    : state == "not_needed" ? "budgetMailNotNeeded" : "budgetMailUnconfirmed"
                body += "\n\n" + String(format: NSLocalizedString("chat.voiceMode.budgetSummary", comment: ""),
                    reserved, NSLocalizedString("chat.voiceMode." + key, comment: ""))
            } catch { body += "\n\n" + NSLocalizedString("chat.voiceMode.networkError", comment: "") }
            guard self.validOwner(), self.session.phase != .closed else { return }
            let alert = UIAlertController(title: NSLocalizedString("chat.voiceMode.settings", comment: ""),
                message: body, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: NSLocalizedString("chat.voiceMode.done", comment: ""), style: .cancel))
            self.present(alert, animated: true)
        }
    }
    @objc private func toggleMic() {
        guard validOwner(), session.phase != .closed else { shutdown(); return }
        guard speechEnabled else { status.text = notice.text; return }
        if session.microphoneEnabled { pause(); return }
        // An ambiguous accepted send must be reconciled using its SAME request ID first.
        guard pendingSend == nil else { retry.isHidden = false; return }
        session.microphone(true)
        session.transition(.permission); update()
        let revision = session.revision
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self, self.validOwner(), self.session.revision == revision,
                      self.session.phase != .closed, self.session.microphoneEnabled else { return }
                if granted { self.listen() } else { self.fail("chat.voiceMode.permissionDenied") }
            }
        }
    }
    private func listen() {
        guard validOwner(), session.microphoneEnabled, session.phase != .closed else { return }
        do {
            try capture.start()
            session.transition(.listening); update()
        } catch { fail("chat.voiceMode.captureError") }
    }
    private func recognize(_ data: Data) {
        guard validOwner(), session.microphoneEnabled, session.phase != .closed else { return }
        session.transition(.recognizing); update()
        let revision = session.revision
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                // A new model request cannot race the old request's cancellation/persistence.
                if let cancellation = self.cancellation {
                    try await cancellation.value
                    self.cancellation = nil
                }
                try Task.checkCancellation()
                self.trace?.sttStarted = ProcessInfo.processInfo.systemUptime
                let text = try await self.api.prepareTranscribe(audio: data, mimeType: "audio/wav")
                self.trace?.sttFinished = ProcessInfo.processInfo.systemUptime
                try Task.checkCancellation()
                guard self.validOwner(), self.session.revision == revision else { return }
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    self.fail("chat.voiceMode.noSpeech"); return
                }
                // No model text/ordinary voice "yes" can invoke confirm-plan.
                // A model response is never itself proof of a completed plan readback.
                self.pendingSend = (text, UUID())
                await self.sendPending()
            } catch {
                guard !Task.isCancelled, self.session.revision == revision else { return }
                self.fail("chat.voiceMode.networkError")
            }
        }
    }
    private func sendPending() async {
        guard let pending = pendingSend, validOwner(), session.phase != .closed else { return }
        let revision = session.revision
        session.transition(.thinking); update()
        do {
            trace?.submissionStarted = ProcessInfo.processInfo.systemUptime
            let pair = try await submit(pending.text, pending.id)
            trace?.accepted = ProcessInfo.processInfo.systemUptime
            try Task.checkCancellation()
            guard validOwner(), session.revision == revision else { return }
            pendingSend = nil; retry.isHidden = true
            replyID = pair.reply?.id
            stopSpeech()
            cursor = ChatVoiceSentenceCursor(); replyFinished = false; measuredFirstSound = false
            // Input and output share ONE voice-processing engine.
            if session.microphoneEnabled { try capture.start() }
            while let id = replyID {
                try Task.checkCancellation()
                guard validOwner(), session.revision == revision else { return }
                let reply = try await api.chatMessage(conversationId: conversation.id, messageId: id)
                await refreshHistory()
                if speechEnabled { enqueueSpeech(reply) }
                if !["queued", "generating"].contains(reply.status) {
                    if reply.status != "complete" { fail("chat.voiceMode.networkError"); return }
                    if speechEnabled {
                        replyFinished = true
                        finishOutputIfReady()
                        return
                    }
                    replyID = nil
                    if session.microphoneEnabled {
                        if capture.isRecording { session.transition(.listening); update() }
                        else { listen() }
                    } else { session.transition(.muted); update() }
                    return
                }
                try await Task.sleep(nanoseconds: 350_000_000)
            }
            if session.microphoneEnabled { listen() }
        } catch {
            guard !Task.isCancelled, validOwner(), session.revision == revision else { return }
            fail("chat.voiceMode.networkError")
            retry.isHidden = pendingSend == nil
        }
    }
    @objc private func retrySend() {
        guard operation == nil || session.phase == .error || session.phase == .muted else { return }
        operation = Task { [weak self] in await self?.sendPending() }
    }
    private func refreshHistory() async {
        do {
            let page = try await api.chatMessages(conversationId: conversation.id)
            guard !Task.isCancelled, validOwner(), session.phase != .closed else { return }
            // Full history remains in the SAME chat; the voice screen shows one current utterance.
            let latest = ChatVoicePresentation.latestUtterance(page.messages.map(\.text))
            if transcript.text != latest {
                transcript.text = latest
                transcript.setContentOffset(.zero, animated: false)
            }
        } catch {
            // Preserve rendered history, but never hide the fact that refresh failed.
            guard !Task.isCancelled, validOwner(), session.phase != .closed else { return }
            status.text = NSLocalizedString("chat.voiceMode.networkError", comment: "")
        }
    }
    private func pause() {
        stopSpeech()
        capture.stop()
        session.interrupt(); session.microphone(false)
        operation?.cancel(); operation = nil
        update()
    }
    private func interruptResponse() {
        guard validOwner(), session.phase != .closed else { return }
        stopSpeech() // Immediate local stop, BEFORE any network await.
        let oldReply = replyID
        operation?.cancel(); operation = nil
        replyID = nil
        session.interrupt()
        update()
        guard let id = oldReply else { return }
        cancellation = Task { [api, conversation] in
            try await api.cancelChatVoice(conversationId: conversation.id, messageId: id)
        }
    }
    private func shutdown() {
        stopSpeech()
        capture.stop()
        session.close()
        operation?.cancel(); operation = nil
        refresh?.cancel(); refresh = nil
    }
    private func fail(_ key: String) {
        interruptResponse() // Cancel stale work before showing an audio/route failure.
        stopSpeech()
        capture.stop(); session.microphone(false); session.transition(.error)
        update()
        status.text = NSLocalizedString(key, comment: "")
    }
    private func loadSpeechCapabilities() async {
        do {
            let caps = try await api.chatCapabilities()
            guard validOwner(), session.phase != .closed else { return }
            guard caps.voiceMode?.available == true else {
                mic.isEnabled = false; fail("chat.voiceMode.ownerOnly"); return
            }
            speechEnabled = caps.voiceMode?.speech.available == true
            mic.isEnabled = speechEnabled
            notice.text = NSLocalizedString(speechEnabled ? "chat.voiceMode.aiDisclosure" : "chat.voiceMode.noOutput", comment: "")
        } catch {
            guard validOwner(), session.phase != .closed else { return }
            mic.isEnabled = false; fail("chat.voiceMode.networkError")
        }
    }
    private func enqueueSpeech(_ message: ChatMessage) {
        let complete = message.status == "complete"
        while let part = cursor.next(message.text, complete: complete) {
            if trace?.sentenceReady == nil { trace?.sentenceReady = ProcessInfo.processInfo.systemUptime }
            speechQueue.append((message.id, part.offset, part.length))
        }
        pumpSpeech()
    }
    private func pumpSpeech() {
        guard speechEnabled, speechTask == nil, !speechQueue.isEmpty else { return }
        let epoch = speechEpoch
        speechTask = Task { [weak self] in
            guard let self else { return }
            do {
                while !self.speechQueue.isEmpty {
                    try Task.checkCancellation()
                    guard self.validOwner(), self.speechEpoch == epoch, self.session.phase != .closed else { return }
                    let segment = self.speechQueue.removeFirst()
                    if self.trace?.ttsStarted == nil { self.trace?.ttsStarted = ProcessInfo.processInfo.systemUptime }
                    var remainder = Data()
                    try await self.api.streamChatSpeech(conversationId: self.conversation.id,
                        messageId: segment.message, requestId: UUID(),
                        offset: segment.offset, length: segment.length) { [weak self] data in
                        try Task.checkCancellation()
                        guard let self, self.validOwner(), self.speechEpoch == epoch,
                              self.session.phase != .closed else { throw CancellationError() }
                        remainder.append(data)
                        let even = remainder.count - remainder.count % 2
                        if even > 0 {
                            try self.capture.play(Data(remainder.prefix(even)))
                            remainder.removeFirst(even)
                        }
                    }
                    guard remainder.isEmpty else { throw APIError.decoding }
                }
                self.speechTask = nil
                self.finishOutputIfReady()
            } catch {
                guard !Task.isCancelled, self.speechEpoch == epoch, self.validOwner() else { return }
                self.speechEnabled = false
                self.stopSpeech()
                if case APIError.http(429, "VOICE_DAILY_BUDGET_REACHED") = error {
                    self.mic.isEnabled = false
                    self.notice.text = NSLocalizedString("chat.voiceMode.budgetReached", comment: "")
                    // Text/model history continues; never repeat a possibly billed segment.
                    if self.replyFinished { self.outputFinished() }
                } else { self.fail("chat.voiceMode.networkError") }
            }
        }
    }
    private func finishOutputIfReady() {
        guard replyFinished, speechTask == nil, speechQueue.isEmpty else { return }
        capture.endOutput()
    }
    private func outputFinished() {
        guard replyFinished, speechTask == nil, speechQueue.isEmpty, session.phase != .closed else { return }
        replyID = nil
        if session.microphoneEnabled { session.transition(.listening) }
        else { session.transition(.muted) }
        update()
    }
    private func stopSpeech() {
        capture.stopPlayback()
        speechEpoch = UUID(); speechTask?.cancel(); speechTask = nil
        speechQueue.removeAll()
    }
    private func firstSound(at: Double, outputLatency: Double) {
        guard validOwner(), !measuredFirstSound, let id = replyID, session.phase != .closed else { return }
        measuredFirstSound = true
        session.transition(.speaking); update()
        guard let body = trace?.payload(messageId: id, render: at, outputLatency: outputLatency) else { return }
        let revision = session.revision
        Task { [weak self] in
            guard let self, self.validOwner() else { return }
            do {
                _ = try await self.api.request("/api/chat-v1/conversations/\(self.conversation.id)/voice-latency",
                    method: "POST", json: body, authenticated: true)
            } catch {
                guard self.validOwner(), self.session.phase != .closed, self.session.revision == revision else { return }
                self.status.text = NSLocalizedString("chat.voiceMode.metricsError", comment: "")
            }
        }
    }
    private func update() {
        status.text = NSLocalizedString("chat.voiceMode." + session.phase.rawValue, comment: "")
        mic.setImage(UIImage(systemName: session.microphoneEnabled ? "mic" : "mic.slash"), for: .normal)
        mic.accessibilityLabel = NSLocalizedString(session.microphoneEnabled
            ? "chat.voiceMode.mute" : "chat.voiceMode.unmute", comment: "")
        renderOrb()
    }
    private func renderOrb() {
        let phase: ChatVoiceOrbView.Phase
        switch session.phase {
        case .listening: phase = .listening
        case .recognizing, .thinking: phase = .thinking
        case .speaking: phase = .speaking
        case .error, .closed: phase = .unavailable
        default: phase = .idle
        }
        orbHost?.rootView = ChatVoiceOrbView(phase: phase, level: level,
            screenActive: viewIfLoaded?.window != nil && UIApplication.shared.applicationState == .active)
    }
}
