import UIKit

/// The approved screen is opt-in for the isolated Xcode preview. Existing
/// application entry points keep their previous appearance until owner approval.
enum ChatScreenAppearance {
    case existing
    case approvedReference

    var isApprovedReference: Bool { self == .approvedReference }

    var messageFont: UIFont {
        isApprovedReference
            ? UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 20))
            : .preferredFont(forTextStyle: .body)
    }
    var titleFont: UIFont {
        isApprovedReference
            ? UIFontMetrics(forTextStyle: .headline).scaledFont(for: .systemFont(ofSize: 20, weight: .bold))
            : .preferredFont(forTextStyle: .headline)
    }
    var composerFont: UIFont {
        isApprovedReference
            ? UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 19))
            : .preferredFont(forTextStyle: .body)
    }
    var messageSpacing: CGFloat { isApprovedReference ? 14 : 12 }
    var bubbleRadius: CGFloat { isApprovedReference ? 22 : 18 }
    var bubbleInset: CGFloat { isApprovedReference ? 16 : 14 }
    var bubbleVerticalInset: CGFloat { 12 }
    func maxBubbleWidth(isUser: Bool, isFinal: Bool) -> CGFloat {
        guard isApprovedReference else { return 0.82 }
        // The source's short dialogue bubbles are narrower than the final reply.
        return isUser ? 0.80 : (isFinal ? 0.96 : 0.85)
    }
    var orbSize: CGFloat { isApprovedReference ? 48 : 44 }

    func bubbleColor(isUser: Bool) -> UIColor {
        UIColor { traits in
            if traits.userInterfaceStyle == .dark {
                return isUser
                    ? UIColor(red: 0.12, green: 0.25, blue: 0.18, alpha: 1)
                    : UIColor(red: 0.23, green: 0.19, blue: 0.32, alpha: 1)
            }
            if self.isApprovedReference {
                // Approximate JPEG samples; device comparison remains required.
                return isUser
                    ? UIColor(red: 236 / 255, green: 250 / 255, blue: 224 / 255, alpha: 1)
                    : UIColor(red: 243 / 255, green: 239 / 255, blue: 255 / 255, alpha: 1)
            }
            return isUser
                ? UIColor(red: 0.88, green: 0.94, blue: 0.88, alpha: 1)
                : UIColor(red: 0.94, green: 0.92, blue: 0.98, alpha: 1)
        }
    }
}
