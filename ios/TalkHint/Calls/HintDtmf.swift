import Foundation

/// Dispatch only. Neither a successful SDK call nor this return value proves
/// that the destination IVR received/accepted a digit. Never queue for recovery.
enum HintDtmf {
    static func isValid(_ digits: String) -> Bool {
        !digits.isEmpty && digits.count <= 32 &&
            digits.allSatisfy { "0123456789*#".contains($0) }
    }

    @discardableResult
    static func send(_ digits: String, connected: Bool, dispatch: (String) -> Void) -> Bool {
        guard connected, isValid(digits) else { return false }
        dispatch(digits)
        return true
    }
}
