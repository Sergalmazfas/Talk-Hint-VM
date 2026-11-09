import UIKit

/// Only an entry in the existing tab shell, never the actual chat container.
final class ChatEntryViewController: UIViewController {}

/// The chat owns a separate full-screen stack. Existing Settings is pushed on
/// that stack; its standard back button returns to the same chat instance.
@MainActor
final class ChatNavigationController: UINavigationController, UINavigationControllerDelegate {
    var onVisible: (() -> Void)?

    init(chat: UIViewController) {
        super.init(rootViewController: chat)
        modalPresentationStyle = .fullScreen
        isModalInPresentation = true
        delegate = self
        setNavigationBarHidden(true, animated: false)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func navigationController(_ navigationController: UINavigationController,
                              willShow viewController: UIViewController, animated: Bool) {
        setNavigationBarHidden(viewController === viewControllers.first, animated: animated)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        onVisible?()
    }
}

@MainActor
final class TalkHintTabBarController: UITabBarController, UITabBarControllerDelegate {
    private let chatFactory: () -> UIViewController
    private(set) var retainedChatNavigation: ChatNavigationController?
    private weak var chatOrigin: UIViewController?

    convenience init() {
        self.init(chatFactory: { ChatViewController() })
    }

    init(chatFactory: @escaping () -> UIViewController) {
        self.chatFactory = chatFactory
        super.init(nibName: nil, bundle: nil)
        delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func tabBarController(_ tabBarController: UITabBarController,
                          shouldSelect viewController: UIViewController) -> Bool {
        guard (viewController as? UINavigationController)?.viewControllers.first is ChatEntryViewController else { return true }
        openChat()
        // Keep the previous tab selected behind the full-screen chat.
        return false
    }

    func openChat(animated: Bool = true) {
        guard presentedViewController == nil, viewIfLoaded?.window != nil else { return }
        if retainedChatNavigation == nil {
            let chat = chatFactory()
            let navigation = ChatNavigationController(chat: chat)
            (chat as? ChatViewController)?.onClose = { [weak self] in self?.closeChat() }
            navigation.onVisible = { [weak self] in self?.dismissChatForExternalTabSelection() }
            retainedChatNavigation = navigation
        }
        guard let navigation = retainedChatNavigation else { return }
        chatOrigin = selectedViewController
        present(navigation, animated: animated)
    }

    func closeChat(animated: Bool = true) {
        guard let navigation = retainedChatNavigation,
              presentedViewController === navigation,
              navigation.presentedViewController == nil,
              !navigation.isBeingDismissed else { return }
        // Never dismiss an in-call screen presented over chat.
        navigation.view.endEditing(true)
        navigation.dismiss(animated: animated)
    }

    override var selectedViewController: UIViewController? {
        didSet { dismissChatForExternalTabSelection() }
    }

    private func dismissChatForExternalTabSelection() {
        guard let origin = chatOrigin, selectedViewController !== origin else { return }
        // Existing Secretary/APNs routing can select its tab. Do not hide that
        // destination behind chat, but do not tear down a presented phone UI.
        closeChat(animated: false)
    }
}
