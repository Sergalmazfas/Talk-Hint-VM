import UIKit
import WebKit

/// Hosts the full TalkHint web experience (talkhint.app/app) inside a WKWebView.
/// The native session token is injected into the page's localStorage before the
/// web app's own scripts run, so the user is signed in automatically without a
/// second login. Phone calls stay native (CallKit + InCallViewController); this
/// screen is for the dashboard / settings / modes / subscription.
final class WebAppViewController: UIViewController {
    var onLoggedOut: (() -> Void)?

    private var webView: WKWebView!
    private let refreshControl = UIRefreshControl()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "TalkHint"
        view.backgroundColor = .systemBackground

        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Log Out", style: .plain, target: self, action: #selector(logoutTapped))
        navigationItem.rightBarButtonItem?.accessibilityIdentifier = "button-logout"

        buildWebView()
        loadApp()
    }

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Inject the session token into localStorage before the page scripts run
        // so the web app authenticates the same account automatically.
        if let token = SessionStore.shared.token, !token.isEmpty {
            let escaped = token
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "")
                .replacingOccurrences(of: "\r", with: "")
            let js = """
            (function() {
              try {
                var t = "\(escaped)";
                if (t) {
                  localStorage.setItem('ln', t);
                  localStorage.setItem('talkhint_ln', t);
                  localStorage.setItem('talkhint_token', t);
                }
              } catch (e) {}
            })();
            """
            let userScript = WKUserScript(
                source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            config.userContentController.addUserScript(userScript)
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.accessibilityIdentifier = "webview-talkhint"
        view.addSubview(webView)

        refreshControl.addTarget(self, action: #selector(reloadTapped), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: guide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
        ])
    }

    private func loadApp() {
        let url = AppConfig.baseURL.appendingPathComponent("app")
        webView.load(URLRequest(url: url))
    }

    @objc private func reloadTapped() {
        webView.reload()
    }

    @objc private func logoutTapped() {
        Task {
            await PushManager.shared.unregisterCurrentToken()
            await APIClient.shared.logout()
            SessionStore.shared.clear()
            onLoggedOut?()
        }
    }
}

extension WebAppViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        refreshControl.endRefreshing()
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        refreshControl.endRefreshing()
    }
}
