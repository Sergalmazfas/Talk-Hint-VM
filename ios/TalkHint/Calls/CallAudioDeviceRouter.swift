import Foundation

/// Chooses the SDK device before connecting, never during a live call.
/// The injected operations keep this policy testable without CallKit or dialing.
final class CallAudioDeviceRouter {
    enum Device: Equatable { case standard, copilot }
    private(set) var device: Device = .standard
    private let install: (Device) -> Void
    private let enableStandard: (Bool) -> Void
    private let enableCopilot: (Bool) -> Void
    private let prepareCopilot: () -> Void

    init(install: @escaping (Device) -> Void,
         enableStandard: @escaping (Bool) -> Void,
         enableCopilot: @escaping (Bool) -> Void,
         prepareCopilot: @escaping () -> Void) {
        self.install = install
        self.enableStandard = enableStandard
        self.enableCopilot = enableCopilot
        self.prepareCopilot = prepareCopilot
    }

    @discardableResult
    func prepare(copilot: Bool, hasSessions: Bool, hasDisconnectingCalls: Bool) -> Bool {
        guard !hasSessions, !hasDisconnectingCalls else { return false }
        setEnabled(false)
        device = copilot ? .copilot : .standard
        if copilot { prepareCopilot() }
        // CallKit, not task preparation or the SDK connect callback, enables IO.
        setEnabled(false)
        install(device)
        return true
    }

    func setEnabled(_ enabled: Bool) {
        switch device {
        case .standard: enableStandard(enabled)
        case .copilot: enableCopilot(enabled)
        }
    }
}
