import Foundation

enum ChatConversationTitle {
    // Display-only compatibility for titles saved by older clients that kept
    // an input hint inside the editable text. Never rewrite stored messages.
    static func display(_ raw: String) -> String {
        var title = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let oldHints = ["Write a message…", "Напишите сообщение…", "Escribe un mensaje…",
                        "Хабарлама жазыңыз…", "Напишіть повідомлення…",
                        NSLocalizedString("chat.message.placeholder", comment: "")]
        for hint in oldHints where !hint.isEmpty {
            if title.hasPrefix(hint) {
                title = String(title.dropFirst(hint.count)).trimmingCharacters(in: .whitespacesAndNewlines)
                break
            }
        }
        return title.isEmpty || title == "New chat" ? NSLocalizedString("chat.new", comment: "") : title
    }
}
