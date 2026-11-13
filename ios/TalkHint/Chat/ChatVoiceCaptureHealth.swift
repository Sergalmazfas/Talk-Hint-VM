import Foundation

/// Value-only watchdog policy. No microphone, audio session, network or timers.
/// One recovery per engine ownership period; only an explicit new session resets it.
struct ChatVoiceCaptureHealth {
    enum Action: Equatable { case none, recover, fail }
    private(set) var recoveries = 0
    private var lastBufferAt: Double?
    private var waitingSince: Double?

    mutating func awaitInput(at now: Double) {
        waitingSince = now
        lastBufferAt = nil
    }

    mutating func receivedBuffer(at now: Double) {
        lastBufferAt = now
    }

    mutating func configurationChanged(allowed: Bool, recording: Bool, playing: Bool) -> Action {
        guard allowed, recording, !playing, recoveries == 0 else { return .fail }
        recoveries += 1
        return .recover
    }

    mutating func check(at now: Double, running: Bool, allowed: Bool,
                        recording: Bool, playing: Bool) -> Action {
        guard allowed else { return .fail }
        if !running {
            return configurationChanged(allowed: allowed, recording: recording, playing: playing)
        }
        // This clock runs independently of the tap, including when ZERO buffers arrive.
        if recording, let since = lastBufferAt ?? waitingSince, now - since >= 2 {
            return .fail
        }
        return .none
    }
}

/// Real notification/watchdog wiring with injectable operations for offline tests.
/// The capture object alone owns AVAudioEngine; tests use an NSObject, never hardware.
@MainActor
final class ChatVoiceCaptureSupervisor {
    private let center: NotificationCenter
    private let object: AnyObject
    private let name: Notification.Name
    private let allowed: () -> Bool
    private let recording: () -> Bool
    private let playing: () -> Bool
    private let running: () -> Bool
    private let restart: () throws -> Void
    private let failed: () -> Void
    private let now: () -> Double
    private let settleNanoseconds: UInt64
    private var observer: NSObjectProtocol?
    private var timer: Timer?
    private var task: Task<Void, Never>?
    private var epoch = UUID()
    private var active = false
    private var health = ChatVoiceCaptureHealth()

    init(center: NotificationCenter = .default, object: AnyObject, name: Notification.Name,
         allowed: @escaping () -> Bool, recording: @escaping () -> Bool,
         playing: @escaping () -> Bool, running: @escaping () -> Bool,
         restart: @escaping () throws -> Void, failed: @escaping () -> Void,
         now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime },
         settleNanoseconds: UInt64 = 150_000_000) {
        self.center = center; self.object = object; self.name = name
        self.allowed = allowed; self.recording = recording; self.playing = playing
        self.running = running; self.restart = restart; self.failed = failed
        self.now = now; self.settleNanoseconds = settleNanoseconds
    }

    func start(automaticWatchdog: Bool = true) {
        stop()
        active = true; health = ChatVoiceCaptureHealth()
        let revision = epoch
        observer = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
            guard let owner = self else { return }
            Task { @MainActor in
                guard owner.epoch == revision else { return }
                owner.configurationChanged()
            }
        }
        if automaticWatchdog {
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                guard let owner = self else { return }
                Task { @MainActor in
                    guard owner.epoch == revision else { return }
                    owner.check()
                }
            }
            if let timer { RunLoop.main.add(timer, forMode: .common) }
        }
    }
    func awaitInput() { health.awaitInput(at: now()) }
    func receivedBuffer() { health.receivedBuffer(at: now()) }
    func configurationChanged() {
        guard active, task == nil else { return }
        handle(health.configurationChanged(allowed: allowed(), recording: recording(), playing: playing()))
    }
    func check() {
        guard active else { return }
        guard allowed() else { terminate(); return }
        guard task == nil else { return }
        handle(health.check(at: now(), running: running(), allowed: true,
                            recording: recording(), playing: playing()))
    }
    private func handle(_ action: ChatVoiceCaptureHealth.Action) {
        switch action {
        case .none: return
        case .fail: terminate()
        case .recover:
            let revision = epoch
            task = Task { [weak self] in
                guard let self else { return }
                do {
                    try await Task.sleep(nanoseconds: self.settleNanoseconds)
                    guard self.active, self.epoch == revision, !Task.isCancelled else { return }
                    guard self.allowed(), self.recording(), !self.playing() else {
                        self.terminate(); return
                    }
                    try self.restart()
                    // Ignore notifications generated by the restart itself while settling.
                    try await Task.sleep(nanoseconds: self.settleNanoseconds)
                    guard self.active, self.epoch == revision, !Task.isCancelled else { return }
                    self.task = nil
                    guard self.allowed(), self.running() else { self.terminate(); return }
                } catch {
                    guard self.active, self.epoch == revision, !Task.isCancelled else { return }
                    self.terminate()
                }
            }
        }
    }
    private func terminate() {
        stop()
        failed()
    }
    func stop() {
        active = false; epoch = UUID()
        task?.cancel(); task = nil
        timer?.invalidate(); timer = nil
        if let observer { center.removeObserver(observer) }
        observer = nil
    }
}
