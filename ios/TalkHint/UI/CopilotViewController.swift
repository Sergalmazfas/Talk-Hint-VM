import UIKit

/// Minimal Copilot call surface. CallManager owns the phone call; closures are
/// the integration seam for its audio gate, mute, route, and end actions.
final class CopilotViewController: UIViewController {
    let stream: CopilotStream
    /// Main's callback must close Owner→Guest before calling completion(true).
    var requestPrivateGate: (@escaping (Bool) -> Void) -> Void = { completion in completion(false) }
    /// Main drains private frames, queues hold_end, then restores normal
    /// uplink. This is called synchronously on every release/cancel; a nil
    /// hold ID means the local gate request was still in flight.
    var onReleaseHold: ((String?) -> Void)?
    var onSpeaker: ((Bool) -> Void)?
    var onMute: (() -> Void)?
    var onEnd: (() -> Void)?

    private let guestLabel = UILabel()
    private let ownerLabel = UILabel()
    private let ptt = UIButton(type: .system)
    private let status = UILabel()
    private var holdId: String?
    private var privateActive = false
    private var failed = false
    private var pressed = false
    private var intentGeneration = 0
    private var releaseDeliveredGeneration: Int?
    private var releasePending = false

    init(callSid: String, language: String, sampleRateHz: Int, stream: CopilotStream? = nil) {
        // CallManager must pass the measured device sample rate. Supplying a
        // stream is useful when it already owns the transport.
        self.stream = stream ?? CopilotStream(callSid: callSid, language: language, sampleRateHz: sampleRateHz)
        super.init(nibName: nil, bundle: nil)
    }
    /// Use when CallManager/coordinator already constructed the stream with
    /// the measured hardware rate.
    convenience init(callSid: String, language: String, stream: CopilotStream) {
        self.init(callSid: callSid, language: language, sampleRateHz: 1, stream: stream)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = NSLocalizedString("copilot.title", comment: "")
        buildUI()
        stream.onReady = { [weak self] in self?.setReady() }
        stream.onGuestText = { [weak self] text in self?.guestLabel.text = text }
        stream.onPrivateText = { [weak self] text in self?.ownerLabel.text = text }
        stream.onHoldReady = { [weak self] holdId in self?.serverHoldReady(holdId) }
        stream.onFailure = { [weak self] _ in self?.streamFailed() }
        stream.start()
    }

    private func buildUI() {
        guestLabel.font = .systemFont(ofSize: 30, weight: .semibold)
        guestLabel.numberOfLines = 0
        guestLabel.textAlignment = .center
        guestLabel.text = NSLocalizedString("copilot.guest_waiting", comment: "")
        ownerLabel.font = .systemFont(ofSize: 22, weight: .medium)
        ownerLabel.numberOfLines = 0
        ownerLabel.textAlignment = .center
        ownerLabel.textColor = .secondaryLabel
        ownerLabel.text = NSLocalizedString("copilot.owner_waiting", comment: "")
        status.textAlignment = .center
        status.textColor = .secondaryLabel
        status.text = NSLocalizedString("copilot.connecting", comment: "")

        ptt.setImage(UIImage(systemName: "mic.fill"), for: .normal)
        ptt.setTitle("  " + NSLocalizedString("copilot.hold_to_talk", comment: ""), for: .normal)
        ptt.titleLabel?.font = .systemFont(ofSize: 20, weight: .bold)
        ptt.tintColor = .white
        ptt.setTitleColor(.white, for: .normal)
        ptt.backgroundColor = .systemBlue
        ptt.layer.cornerRadius = 64
        ptt.isEnabled = false
        ptt.accessibilityIdentifier = "copilot-ptt"
        ptt.addGestureRecognizer(UILongPressGestureRecognizer(target: self, action: #selector(pttChanged(_:))))

        let speaker = control("speaker.wave.2", action: #selector(speakerTapped))
        let mute = control("mic.slash", action: #selector(muteTapped))
        let end = control("phone.down.fill", action: #selector(endTapped))
        end.tintColor = .systemRed
        let controls = UIStackView(arrangedSubviews: [speaker, mute, end])
        controls.axis = .horizontal; controls.distribution = .equalCentering
        let stack = UIStackView(arrangedSubviews: [guestLabel, ownerLabel, status, ptt, controls])
        stack.axis = .vertical; stack.alignment = .fill; stack.spacing = 22
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            ptt.heightAnchor.constraint(equalToConstant: 128)
        ])
    }

    private func control(_ image: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: image), for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func setReady() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.ptt.isEnabled = !self.releasePending
            self?.status.text = NSLocalizedString("copilot.ready", comment: "")
        }
    }

    private func streamFailed() {
        DispatchQueue.main.async { [weak self] in
            self?.failed = true; self?.ptt.isEnabled = false
            // Keep the control receiving touch-up while a press is in flight;
            // the release event is what safely hands the audio gate back.
            if self?.pressed == true { self?.ptt.isEnabled = true }
            self?.status.text = NSLocalizedString("copilot.unavailable", comment: "")
        }
    }

    @objc private func pttChanged(_ gesture: UILongPressGestureRecognizer) {
        // Release must be handled even after transport failure. The audio
        // gate intentionally remains closed until this event reaches main.
        if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed {
            deliverReleaseIfNeeded()
            return
        }
        guard !failed, !releasePending, stream.state == .ready else { return }
        if gesture.state == .began {
            pressed = true
            intentGeneration += 1
            releaseDeliveredGeneration = nil
            let generation = intentGeneration
            let id = UUID().uuidString
            requestPrivateGate { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, granted, !self.failed,
                          self.pressed, self.intentGeneration == generation else {
                        // Release is delivered synchronously by the gesture
                        // handler exactly once. A late gate result never
                        // emits a second release request.
                        return
                    }
                    self.holdId = id
                    // UI remains non-private until the server's hold_ready arrives.
                    self.stream.holdStart(holdId: id)
                }
            }
    }

    private func deliverReleaseIfNeeded() {
        guard pressed, releaseDeliveredGeneration != intentGeneration else { return }
        pressed = false
        releaseDeliveredGeneration = intentGeneration
        releasePending = true
        ptt.isEnabled = false
        let id = holdId
        holdId = nil; privateActive = false
        // Do not send hold_end or reopen audio here. The coordinator must
        // drain device frames first, then queue hold_end, then reopen.
        onReleaseHold?(id)
        status.text = NSLocalizedString("copilot.ready", comment: "")
    }

    /// Coordinator calls this after private frames have drained, hold_end has
    /// been queued, and Owner→Guest uplink is open again. Until then a new
    /// press is rejected, preventing overlapping release drains.
    func gateRestored() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.gateRestored() }
            return
        }
        releasePending = false
        if !failed, stream.state == .ready { ptt.isEnabled = true }
    }

    private func serverHoldReady(_ id: String) {
        guard pressed, holdId == id, !failed else { return }
        privateActive = true
        status.text = NSLocalizedString("copilot.private", comment: "")
    }

    @objc private func speakerTapped() { onSpeaker?(true) }
    @objc private func muteTapped() { onMute?() }
    @objc private func endTapped() { onEnd?() }

    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        stream.stop()
        super.dismiss(animated: flag, completion: completion)
    }
}