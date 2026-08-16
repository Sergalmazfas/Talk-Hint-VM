import UIKit

/// TalkHint design tokens — the light brand style approved on the canvas
/// mockups (white background, green primary, purple AI accent, large radii).
/// All redesigned screens (Calls home, Prepare sheet) draw from here so the
/// palette stays in one place.
enum Theme {
    /// Primary action green (#16A34A) — Call button, confirmations.
    static let green = UIColor(red: 0x16 / 255.0, green: 0xA3 / 255.0, blue: 0x4A / 255.0, alpha: 1)
    /// Darker green for text on light-green backgrounds (#15803D).
    static let greenDark = UIColor(red: 0x15 / 255.0, green: 0x80 / 255.0, blue: 0x3D / 255.0, alpha: 1)
    /// Light green surface (#EAF7EF) — "Goal ready" badge, goal cards.
    static let greenBg = UIColor(red: 0xEA / 255.0, green: 0xF7 / 255.0, blue: 0xEF / 255.0, alpha: 1)
    /// AI accent purple (#7C5CFC) — everything AI-related (Prepare, hints).
    static let purple = UIColor(red: 0x7C / 255.0, green: 0x5C / 255.0, blue: 0xFC / 255.0, alpha: 1)
    /// Light purple surface (#F2EEFF).
    static let purpleBg = UIColor(red: 0xF2 / 255.0, green: 0xEE / 255.0, blue: 0xFF / 255.0, alpha: 1)
    /// Primary text (#111827).
    static let ink = UIColor(red: 0x11 / 255.0, green: 0x18 / 255.0, blue: 0x27 / 255.0, alpha: 1)
    /// Secondary text (#6B7280).
    static let sub = UIColor(red: 0x6B / 255.0, green: 0x72 / 255.0, blue: 0x80 / 255.0, alpha: 1)
    /// Hairline borders (#E5E7EB).
    static let line = UIColor(red: 0xE5 / 255.0, green: 0xE7 / 255.0, blue: 0xEB / 255.0, alpha: 1)
    /// Subtle fill for keypad keys and secondary controls (#F9FAFB).
    static let fill = UIColor(red: 0xF9 / 255.0, green: 0xFA / 255.0, blue: 0xFB / 255.0, alpha: 1)
}
