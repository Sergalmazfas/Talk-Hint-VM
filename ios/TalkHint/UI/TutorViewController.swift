import UIKit
import WebKit

/// AI Tutor "Emma" — full-screen WKWebView hosting the backend's /tutor page,
/// which renders the 3D avatar (TalkingHead) and streams practice audio to the
/// external Tutor Engine via our backend-issued short-lived realtime token.
/// The native layer only supplies the session Bearer token and mic permission;
/// all teaching logic lives in the engine, all key material stays server-side.
final class TutorViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate {

    private var webView: WKWebView!

    // The tab bar stays VISIBLE on this screen. It used to be hidden for a
    // "dedicated session feel", but combined with the page's Back button being
    // ignored natively that left users with literally no way out of the tutor
    // short of relaunching the app.

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Репетитор Emma"
        view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // Native bridge: the page notifies us when the Call Memory is ready so
        // we can route the user to the confirmation screen.
        config.userContentController.add(self, name: "tutor")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.accessibilityIdentifier = "webview-tutor"
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        loadTutorPage()
    }

    private func loadTutorPage() {
        // The page is loaded WITHOUT credentials — the session token never
        // appears in the URL (it would persist in webview history/logs). The
        // page asks for it via the "needAuth" bridge message and receives it
        // through window.__setAuth(...).
        guard let url = URL(string: "\(AppConfig.baseURL)/tutor") else { return }
        webView.load(URLRequest(url: url))
    }

    private func injectAuthToken() {
        guard let token = SessionStore.shared.token else { return }
        let escaped = token
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        webView.evaluateJavaScript("window.__setAuth('\(escaped)')", completionHandler: nil)
    }

    // MARK: - WKUIDelegate (mic permission)

    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Grant only for our own backend origin; anything else is denied.
        let expectedHost = AppConfig.baseURL.host
        if let expectedHost, origin.host == expectedHost {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }

    // MARK: - WKScriptMessageHandler (page → native)

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "tutor", let body = message.body as? [String: Any],
              let event = body["event"] as? String else { return }
        // Diagnostics (spec §8): surface every bridge event in the Xcode
        // console so lipsyncDiag / latency can be verified on a real device.
        // The body never contains the auth token (needAuth carries no payload).
        NSLog("[TutorBridge] %@ %@", event, body.description)
        switch event {
        case "needAuth":
            // Only hand the token to our own backend page.
            if let host = message.frameInfo.securityOrigin.host as String?,
               host == AppConfig.baseURL.host {
                injectAuthToken()
            }
        case "closeRequested":
            // The page's X / Back (e.g. on the "Call memory confirmed" screen)
            // asks us to leave the tutor: return to the Calls tab and reload
            // the page so the next visit starts fresh at the practice chooser.
            tabBarController?.selectedIndex = 0
            loadTutorPage()
        case "callMemoryConfirmed":
            let alert = UIAlertController(
                title: "Подготовка подтверждена",
                message: "Память тренировки будет использована в вашем следующем реальном звонке.",
                preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            present(alert, animated: true)
        default:
            break
        }
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "tutor")
    }
}
