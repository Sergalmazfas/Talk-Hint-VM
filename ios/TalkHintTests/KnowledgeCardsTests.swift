import XCTest
import UIKit
@testable import TalkHint

/// No URLSession, Keychain, accounts or phone services. Every request made by
/// this client is captured, including unexpected paths (which fail closed).
private actor CardsTransport {
    enum Fault {
        case status(Int), offline, malformed, wrongScope, invalidCard
    }
    private var rows: [String: [String: Any]] = [:]
    private var requests: [URLRequest] = []
    private var fault: Fault?
    private var holdNext = false
    private var held: CheckedContinuation<(Data, URLResponse), Error>?
    private var heldResponse: (Data, URLResponse)?

    func failNext(_ fault: Fault) { self.fault = fault }
    func delayNextRead() { holdNext = true }
    func hasPendingRead() -> Bool { held != nil }
    func recorded() -> [URLRequest] { requests }
    func releaseRead() {
        guard let continuation = held, let response = heldResponse else { return }
        held = nil
        heldResponse = nil
        continuation.resume(returning: response)
    }

    func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let url = try XCTUnwrap(request.url)
        let path = url.path
        guard path == "/api/cards" || path.hasPrefix("/api/cards/") else {
            XCTFail("Forbidden non-card endpoint: \(url)")
            throw URLError(.unsupportedURL)
        }
        let method = request.httpMethod ?? "GET"
        let response = { (status: Int, object: [String: Any]) throws -> (Data, URLResponse) in
            (try JSONSerialization.data(withJSONObject: object),
             try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)))
        }
        if let failure = fault {
            fault = nil
            switch failure {
            case .status(let code): return try response(code, ["error": "denied-\(code)"])
            case .offline: throw URLError(.networkConnectionLost)
            case .malformed: return try response(200, ["cards": "not-an-array"])
            case .wrongScope:
                let foreign: [String: Any] = [
                    "id": "foreign", "cardType": "project", "title": "Foreign",
                    "body": "Must not render", "profileScope": "work"
                ]
                return try response(200, method == "GET" ? ["cards": [foreign]] : ["card": foreign])
            case .invalidCard: return try response(200, ["cards": [["id": "broken"]]])
            }
        }
        switch method {
        case "GET":
            let scope = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "profile" })?.value
            let matching = rows.values.filter { $0["profileScope"] as? String == scope }
            let result = try response(200, ["cards": matching])
            if holdNext {
                holdNext = false
                heldResponse = result
                return try await withCheckedThrowingContinuation { held = $0 }
            }
            return result
        case "POST", "PUT":
            var row = try XCTUnwrap(try JSONSerialization.jsonObject(
                with: try XCTUnwrap(request.httpBody)) as? [String: Any])
            let id = method == "POST" ? UUID().uuidString : url.lastPathComponent
            if method == "PUT", rows[id] == nil { return try response(404, ["error": "missing"]) }
            row["id"] = id
            rows[id] = row
            return try response(method == "POST" ? 201 : 200, ["card": row])
        case "DELETE":
            guard rows.removeValue(forKey: url.lastPathComponent) != nil else {
                return try response(404, ["error": "missing"])
            }
            return try response(200, ["ok": true])
        default:
            XCTFail("Unexpected method: \(method)")
            throw URLError(.unsupportedURL)
        }
    }
}

@MainActor
final class KnowledgeCardsTests: XCTestCase {
    private func client(_ server: CardsTransport, token: String? = "isolated-test-token") -> APIClient {
        APIClient(transport: { try await server.send($0) }, tokenProvider: { token })
    }

    private func create(_ api: APIClient, _ scope: CallProfileScope) async throws -> APIClient.KnowledgeCardItem {
        try await api.createCard(cardType: "project", title: scope.rawValue,
                                 body: "Details", sortOrder: 4, profileScope: scope)
    }

    private func cell(_ screen: KnowledgeCardsViewController, section: Int = 0) -> UITableViewCell {
        screen.tableView(screen.tableView, cellForRowAt: IndexPath(row: 0, section: section))
    }

    private func text(_ cell: UITableViewCell) -> UIListContentConfiguration? {
        cell.contentConfiguration as? UIListContentConfiguration
    }

    private func waitUntil(_ condition: () async -> Bool,
                           file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = Date().addingTimeInterval(3)
        while !(await condition()) {
            guard Date() < deadline else {
                XCTFail("Timed out waiting for UI/transport", file: file, line: line)
                throw URLError(.timedOut)
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }

    func testScopedCRUDUsesExactURLsBearerAndJSON() async throws {
        let server = CardsTransport()
        let api = client(server)
        var ids: [CallProfileScope: String] = [:]
        for scope in CallProfileScope.allCases {
            let card = try await create(api, scope)
            ids[scope] = card.id
        }
        for scope in CallProfileScope.allCases {
            let cards = try await api.knowledgeCards(profileScope: scope)
            XCTAssertEqual(cards.map(\.id), [try XCTUnwrap(ids[scope])])
            let updated = try await api.updateCard(id: cards[0].id, cardType: "company",
                title: "Edited \(scope.rawValue)", body: "Updated", sortOrder: 9, profileScope: scope)
            XCTAssertEqual(updated.profileScope, scope)
            XCTAssertEqual(updated.title, "Edited \(scope.rawValue)")
            let reopened = try await api.knowledgeCards(profileScope: scope)
            XCTAssertEqual(reopened.first?.body, "Updated")
            try await api.deleteCard(id: updated.id)
            let empty = try await api.knowledgeCards(profileScope: scope)
            XCTAssertTrue(empty.isEmpty)
        }
        let requests = await server.recorded()
        XCTAssertEqual(requests.count, 18)
        for request in requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer isolated-test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            let url = try XCTUnwrap(request.url)
            XCTAssertFalse(url.absoluteString.contains("%3F"))
            if request.httpMethod == "GET" {
                let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
                XCTAssertEqual(url.path, "/api/cards")
                XCTAssertEqual(query.count, 1)
                XCTAssertEqual(query[0].name, "profile")
                XCTAssertTrue(CallProfileScope.allCases.map(\.rawValue).contains(query[0].value ?? ""))
                XCTAssertNil(request.httpBody)
            } else if request.httpMethod == "POST" || request.httpMethod == "PUT" {
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                let json = try XCTUnwrap(try JSONSerialization.jsonObject(
                    with: try XCTUnwrap(request.httpBody)) as? [String: Any])
                XCTAssertEqual(Set(json.keys), Set(["cardType", "title", "body", "sortOrder", "profileScope"]))
                XCTAssertTrue(CallProfileScope.allCases.map(\.rawValue).contains(json["profileScope"] as? String ?? ""))
                let scope = try XCTUnwrap(CallProfileScope(rawValue: try XCTUnwrap(json["profileScope"] as? String)))
                let id = try XCTUnwrap(ids[scope])
                XCTAssertEqual(url.path, request.httpMethod == "POST" ? "/api/cards" : "/api/cards/\(id)")
            } else {
                XCTAssertEqual(request.httpMethod, "DELETE")
                XCTAssertTrue(ids.values.contains(url.lastPathComponent))
                XCTAssertNil(url.query)
            }
        }
    }

    func testMissingTokenNeverReachesTransport() async throws {
        let server = CardsTransport()
        do {
            _ = try await client(server, token: nil).knowledgeCards(profileScope: .work)
            XCTFail("Missing auth must fail")
        } catch APIError.notAuthenticated {} catch { XCTFail("\(error)") }
        let requests = await server.recorded()
        XCTAssertTrue(requests.isEmpty)
    }

    func testHTTPFailuresRemainExplicitForEveryCardOperation() async throws {
        let server = CardsTransport()
        let api = client(server)
        for scope in CallProfileScope.allCases {
            for status in [401, 403, 404, 500] {
                for operation in 0..<4 {
                    await server.failNext(.status(status))
                    do {
                        switch operation {
                        case 0: _ = try await api.knowledgeCards(profileScope: scope)
                        case 1: _ = try await create(api, scope)
                        case 2: _ = try await api.updateCard(id: "missing", cardType: "project",
                            title: "Edit", body: "Body", sortOrder: 0, profileScope: scope)
                        default: try await api.deleteCard(id: "missing")
                        }
                        XCTFail("HTTP \(status) was swallowed")
                    } catch APIError.http(let code, let message) {
                        XCTAssertEqual(code, status)
                        XCTAssertEqual(message, "denied-\(status)")
                    } catch { XCTFail("Wrong error: \(error)") }
                }
            }
        }
    }

    func testBadPayloadAndCrossScopeResponseFailClosed() async throws {
        let server = CardsTransport()
        let api = client(server)
        for fault in [CardsTransport.Fault.malformed, .wrongScope, .invalidCard] {
            await server.failNext(fault)
            do {
                _ = try await api.knowledgeCards(profileScope: .personal)
                XCTFail("Invalid response must not become an empty/successful list")
            } catch APIError.decoding {} catch { XCTFail("\(error)") }
        }
        for operation in 0..<2 {
            await server.failNext(.wrongScope)
            do {
                if operation == 0 {
                    _ = try await create(api, .personal)
                } else {
                    _ = try await api.updateCard(id: "foreign", cardType: "project",
                        title: "Edit", body: "Body", sortOrder: 0, profileScope: .personal)
                }
                XCTFail("A mutation response must retain the requested profile")
            } catch APIError.decoding {} catch { XCTFail("\(error)") }
        }
    }

    func testListShowsHTTPErrorsAndRecoversAfterDisconnect() async throws {
        let server = CardsTransport()
        let api = client(server)
        for scope in CallProfileScope.allCases {
            let card = try await create(api, scope)
            let screen = KnowledgeCardsViewController(profileScope: scope, api: api)
            screen.loadViewIfNeeded()
            for status in [401, 403, 404, 500] {
                await server.failNext(.status(status))
                await screen.loadCards()
                XCTAssertEqual(text(cell(screen))?.text, NSLocalizedString("profiles.cards_load_failed", comment: ""))
                XCTAssertTrue(text(cell(screen))?.secondaryText?.contains("\(status)") == true)
                XCTAssertFalse(screen.tableView(screen.tableView, canEditRowAt: IndexPath(row: 0, section: 0)))
            }
            await server.failNext(.offline)
            await screen.loadCards()
            XCTAssertNotNil(text(cell(screen))?.secondaryText)
            XCTAssertEqual(text(cell(screen))?.text, NSLocalizedString("profiles.cards_load_failed", comment: ""))
            // Exercise the actual pull-to-refresh target, not a replacement UI.
            screen.tableView.refreshControl?.sendActions(for: .valueChanged)
            try await waitUntil { self.cell(screen).accessibilityIdentifier == "cell-card-\(card.id)" }
            XCTAssertFalse(screen.tableView.refreshControl?.isRefreshing ?? true)
            XCTAssertEqual(text(cell(screen))?.text, scope.rawValue)
        }
    }

    func testLateReadCannotOverwriteNewerReadOrResurrectDeletedCard() async throws {
        let server = CardsTransport()
        let api = client(server)
        let card = try await create(api, .work)
        let screen = KnowledgeCardsViewController(profileScope: .work, api: api)
        screen.loadViewIfNeeded()
        await server.delayNextRead()
        let oldRead = Task { await screen.loadCards() }
        try await waitUntil { await server.hasPendingRead() }
        _ = try await api.updateCard(id: card.id, cardType: "project", title: "New",
                                    body: "New body", sortOrder: 0, profileScope: .work)
        await screen.loadCards()
        await server.releaseRead()
        await oldRead.value
        XCTAssertEqual(text(cell(screen))?.text, "New")
        await server.delayNextRead()
        let beforeDelete = Task { await screen.loadCards() }
        try await waitUntil { await server.hasPendingRead() }
        await screen.deleteCard(card)
        await server.releaseRead()
        await beforeDelete.value
        XCTAssertEqual(text(cell(screen))?.text, NSLocalizedString("profiles.empty_cards", comment: ""))
        await screen.loadCards()
        XCTAssertEqual(text(cell(screen))?.text, NSLocalizedString("profiles.empty_cards", comment: ""))
    }

    func testLateSuccessCannotHideNewerError() async throws {
        let server = CardsTransport()
        let api = client(server)
        _ = try await create(api, .personal)
        let screen = KnowledgeCardsViewController(profileScope: .personal, api: api)
        screen.loadViewIfNeeded()
        await server.delayNextRead()
        let oldRead = Task { await screen.loadCards() }
        try await waitUntil { await server.hasPendingRead() }
        await server.failNext(.status(403))
        await screen.loadCards()
        await server.releaseRead()
        await oldRead.value
        XCTAssertTrue(text(cell(screen))?.secondaryText?.contains("403") == true)
        await screen.loadCards()
        XCTAssertEqual(text(cell(screen))?.text, "personal")
    }

    func testDelayedPersonalResponseCannotChangeWorkOrSharedScreen() async throws {
        let server = CardsTransport()
        let api = client(server)
        for scope in CallProfileScope.allCases { _ = try await create(api, scope) }
        let personal = KnowledgeCardsViewController(profileScope: .personal, api: api)
        personal.loadViewIfNeeded()
        await server.delayNextRead()
        let oldRead = Task { await personal.loadCards() }
        try await waitUntil { await server.hasPendingRead() }
        let work = KnowledgeCardsViewController(profileScope: .work, api: api)
        let shared = KnowledgeCardsViewController(profileScope: .shared, api: api)
        work.loadViewIfNeeded()
        shared.loadViewIfNeeded()
        await work.loadCards()
        await shared.loadCards()
        await server.releaseRead()
        await oldRead.value
        XCTAssertEqual(text(cell(personal))?.text, "personal")
        XCTAssertEqual(text(cell(work))?.text, "work")
        XCTAssertEqual(text(cell(shared))?.text, "shared")
    }

    func testEditorKeepsDraftAndAllowsRetryAfterFailure() async throws {
        let animationsEnabled = UIView.areAnimationsEnabled
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(animationsEnabled) }
        let server = CardsTransport()
        let api = client(server)
        for scope in CallProfileScope.allCases {
            for editing in [false, true] {
                let card = editing ? try await create(api, scope) : nil
                var saved = false
                let editor = KnowledgeCardEditorViewController(card: card, profileScope: scope, api: api) {
                    saved = true
                }
                let window = UIWindow(frame: UIScreen.main.bounds)
                window.rootViewController = UINavigationController(rootViewController: editor)
                window.makeKeyAndVisible()
                defer { window.isHidden = true; window.rootViewController = nil }
                editor.loadViewIfNeeded()
                let title = try XCTUnwrap(descendant(editor.view, id: "input-card-title") as? UITextField)
                let body = try XCTUnwrap(descendant(editor.view, id: "input-card-body") as? UITextView)
                title.text = "Draft"
                body.text = "Do not lose this"
                for fault in [CardsTransport.Fault.status(401), .status(403), .status(404), .status(500), .offline] {
                    await server.failNext(fault)
                    try tap(editor.navigationItem.rightBarButtonItem)
                    try await waitUntil { editor.presentedViewController is UIAlertController }
                    let alert = try XCTUnwrap(editor.presentedViewController as? UIAlertController)
                    XCTAssertFalse(saved)
                    XCTAssertFalse(alert.message?.isEmpty ?? true)
                    if case .status(let code) = fault {
                        XCTAssertTrue(alert.message?.contains("\(code)") == true)
                    }
                    XCTAssertEqual(title.text, "Draft")
                    XCTAssertEqual(body.text, "Do not lose this")
                    XCTAssertEqual(editor.navigationItem.rightBarButtonItem?.isEnabled, true)
                    await withCheckedContinuation { continuation in
                        editor.dismiss(animated: false) { continuation.resume() }
                    }
                }
                try tap(editor.navigationItem.rightBarButtonItem)
                try await waitUntil { saved }
                let stored = try await api.knowledgeCards(profileScope: scope)
                XCTAssertTrue(stored.contains { $0.title == "Draft" && $0.profileScope == scope })
            }
        }
    }

    func testDeleteFailurePreservesRowAndOffersRetry() async throws {
        let animationsEnabled = UIView.areAnimationsEnabled
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(animationsEnabled) }
        let server = CardsTransport()
        let api = client(server)
        let card = try await create(api, .shared)
        let screen = KnowledgeCardsViewController(profileScope: .shared, api: api)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = screen
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        await screen.loadCards()
        // Both the appearance-triggered GET and the explicit load must have
        // reached the transport before injecting a DELETE failure.
        try await waitUntil {
            let requests = await server.recorded()
            return requests.filter { $0.httpMethod == "GET" }.count >= 2
                && self.cell(screen).accessibilityIdentifier == "cell-card-\(card.id)"
        }
        // Exercise swipe confirmation without invoking private UIAlertAction handlers.
        screen.tableView(screen.tableView, commit: .delete, forRowAt: IndexPath(row: 0, section: 0))
        try await waitUntil { screen.presentedViewController is UIAlertController }
        let confirmation = try XCTUnwrap(screen.presentedViewController as? UIAlertController)
        XCTAssertTrue(confirmation.actions.contains { $0.style == .destructive })
        let beforeConfirmation = await server.recorded()
        XCTAssertFalse(beforeConfirmation.contains { $0.httpMethod == "DELETE" })
        await withCheckedContinuation { continuation in
            screen.dismiss(animated: false) { continuation.resume() }
        }
        for fault in [CardsTransport.Fault.status(401), .status(403), .status(404), .status(500), .offline] {
            await server.failNext(fault)
            await screen.deleteCard(card)
            let alert = try XCTUnwrap(screen.presentedViewController as? UIAlertController)
            XCTAssertEqual(alert.title, NSLocalizedString("common.delete_failed", comment: ""))
            if case .status(let code) = fault {
                XCTAssertTrue(alert.message?.contains("\(code)") == true)
            }
            XCTAssertEqual(cell(screen).accessibilityIdentifier, "cell-card-\(card.id)")
            await withCheckedContinuation { continuation in
                screen.dismiss(animated: false) { continuation.resume() }
            }
        }
        await screen.deleteCard(card)
        XCTAssertEqual(text(cell(screen))?.text, NSLocalizedString("profiles.empty_cards", comment: ""))
    }

    private func tap(_ button: UIBarButtonItem?) throws {
        let button = try XCTUnwrap(button)
        let action = try XCTUnwrap(button.action)
        XCTAssertTrue(UIApplication.shared.sendAction(action, to: button.target, from: button, for: nil))
    }

    private func descendant(_ view: UIView, id: String) -> UIView? {
        if view.accessibilityIdentifier == id { return view }
        return view.subviews.lazy.compactMap { self.descendant($0, id: id) }.first
    }

    func testNativeNavigationCreateEditDeleteAndReopenKeepsScope() async throws {
        let animationsEnabled = UIView.areAnimationsEnabled
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(animationsEnabled) }
        let server = CardsTransport()
        let api = client(server)
        let profiles = CallProfilesViewController(api: api)
        let nav = UINavigationController(rootViewController: profiles)
        nav.loadViewIfNeeded()
        profiles.loadViewIfNeeded()
        // No viewWillAppear on profiles: this test must never fetch/attach a number.
        for (section, scope) in CallProfileScope.allCases.enumerated() {
            let index = IndexPath(row: scope == .shared ? 0 : 1, section: section)
            profiles.tableView(profiles.tableView, didSelectRowAt: index)
            let screen = try XCTUnwrap(nav.topViewController as? KnowledgeCardsViewController)
            screen.loadViewIfNeeded()
            await screen.loadCards()
            try tap(screen.navigationItem.rightBarButtonItem)
            let editor = try XCTUnwrap(nav.topViewController as? KnowledgeCardEditorViewController)
            editor.loadViewIfNeeded()
            XCTAssertEqual((descendant(editor.view, id: "label-card-profile") as? UILabel)?.text,
                String(format: NSLocalizedString("profiles.cards_title", comment: ""), scope.localizedName))
            let title = try XCTUnwrap(descendant(editor.view, id: "input-card-title") as? UITextField)
            let body = try XCTUnwrap(descendant(editor.view, id: "input-card-body") as? UITextView)
            title.text = "\(scope.rawValue) UI"
            body.text = "Saved by native editor"
            try tap(editor.navigationItem.rightBarButtonItem)
            try await waitUntil { nav.topViewController === screen }
            await screen.loadCards()
            XCTAssertEqual(text(cell(screen))?.text, "\(scope.rawValue) UI")
            screen.tableView(screen.tableView, didSelectRowAt: IndexPath(row: 0, section: 0))
            let edit = try XCTUnwrap(nav.topViewController as? KnowledgeCardEditorViewController)
            edit.loadViewIfNeeded()
            XCTAssertEqual((descendant(edit.view, id: "input-card-body") as? UITextView)?.text, "Saved by native editor")
            (descendant(edit.view, id: "input-card-title") as? UITextField)?.text = "Edited UI"
            try tap(edit.navigationItem.rightBarButtonItem)
            try await waitUntil { nav.topViewController === screen }
            nav.popToViewController(profiles, animated: false)
            profiles.tableView(profiles.tableView, didSelectRowAt: index)
            let reopened = try XCTUnwrap(nav.topViewController as? KnowledgeCardsViewController)
            reopened.loadViewIfNeeded()
            await reopened.loadCards()
            XCTAssertEqual(reopened.title, screen.title)
            XCTAssertEqual(text(cell(reopened))?.text, "Edited UI")
            let stored = try await api.knowledgeCards(profileScope: scope)
            XCTAssertEqual(stored.count, 1)
            XCTAssertEqual(stored.first?.profileScope, scope)
            await reopened.deleteCard(try XCTUnwrap(stored.first))
            await reopened.loadCards()
            XCTAssertEqual(text(cell(reopened))?.text, NSLocalizedString("profiles.empty_cards", comment: ""))
            nav.popToViewController(profiles, animated: false)
        }
        let requests = await server.recorded()
        XCTAssertTrue(requests.allSatisfy { $0.url?.path.hasPrefix("/api/cards") == true })
    }
}
