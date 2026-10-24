import XCTest
import UIKit
@testable import TalkHint

// Hosted UIKit tests (not XCUITest). Real controllers/delegates and HTTP decoding;
// action-sheet choices use the same methods as their production handlers.
// Only the compile-time isolated configuration may touch singleton preferences.
#if TALKHINT_NATIVE_VALIDATION
@MainActor
final class SecretaryPersonalityUITests: XCTestCase {
    private var window: UIWindow!
    private var nav: UINavigationController!
    private var settings: SettingsViewController!
    private var api: APIClient!
    private var server: SecretaryPersonalityFixture!
    private var previousDefaults: [String: Any] = [:]
    private var previousDraft: SessionStore.SecretaryCallDraft?

    override func setUp() async throws {
        try await super.setUp()
        previousDefaults = UserDefaults.standard.dictionaryRepresentation()
        previousDraft = SessionStore.shared.pendingSecretaryCall
        SessionStore.shared.clearPendingSecretaryCall()
        SessionStore.shared.secretaryOutgoingNumberId = nil
        SessionStore.shared.secretaryVoiceProvider = .openai
        server = SecretaryPersonalityFixture()
        let fixture = server!
        api = APIClient(transport: { try await fixture.send($0) }, tokenProvider: { "personality-fixture" })
        settings = SettingsViewController(api: api)
        nav = UINavigationController(rootViewController: settings)
        window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = nav
        window.makeKeyAndVisible()
        settings.loadViewIfNeeded()
    }

    override func tearDown() async throws {
        await dismissAlert()
        window.isHidden = true
        window.rootViewController = nil
        window = nil; nav = nil; settings = nil; api = nil; server = nil
        SessionStore.shared.clearPendingSecretaryCall()
        if let previousDraft { XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(previousDraft)) }
        // Restore only preferences modified by these tests.
        let current = UserDefaults.standard.dictionaryRepresentation()
        for key in Set(current.keys).union(previousDefaults.keys)
            where key.hasPrefix("talkhint.secretary.") {
            if let value = previousDefaults[key] { UserDefaults.standard.set(value, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        try await super.tearDown()
    }

    private func waitUntil(_ condition: () async -> Bool) async throws {
        let deadline = Date().addingTimeInterval(4)
        while !(await condition()) {
            guard Date() < deadline else { XCTFail("Timed out waiting for Secretary UI"); throw URLError(.timedOut) }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }
    private func cell(_ vc: UITableViewController, _ section: Int, _ row: Int = 0) -> UITableViewCell {
        vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: row, section: section))
    }
    private func select(_ vc: UITableViewController, _ section: Int, _ row: Int = 0) {
        vc.tableView(vc.tableView, didSelectRowAt: IndexPath(row: row, section: section))
    }
    private func dismissAlert() async {
        guard let nav, nav.presentedViewController != nil || nav.topViewController?.presentedViewController != nil else { return }
        await withCheckedContinuation { continuation in
            nav.dismiss(animated: false) { continuation.resume() }
        }
    }
    private func open() async throws -> SecretaryPersonalityViewController {
        XCTAssertEqual(cell(settings, 3, 1).accessibilityIdentifier, "cell-secretary-personality")
        select(settings, 3, 1)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityViewController }
        let screen = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityViewController)
        screen.loadViewIfNeeded()
        try await waitUntil { self.cell(screen, 1).textLabel?.text == "+12025550101" }
        return screen
    }
    private func chooseKatya(_ screen: SecretaryPersonalityViewController) async throws {
        select(screen, 2)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityPickerViewController }
        let picker = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityPickerViewController)
        picker.loadViewIfNeeded()
        try await waitUntil {
            picker.tableView(picker.tableView, numberOfRowsInSection: 0) >= 2 &&
                self.cell(picker, 0, 1).textLabel?.text == "Катя"
        }
        select(picker, 0, 1)
        try await waitUntil { self.nav.topViewController === screen && self.cell(screen, 2).textLabel?.text == "Катя" }
    }
    private func save(_ screen: SecretaryPersonalityViewController, success: Bool = true) async throws {
        select(screen, 5)
        try await waitUntil { screen.presentedViewController is UIAlertController }
        let alert = try XCTUnwrap(screen.presentedViewController as? UIAlertController)
        if success {
            XCTAssertEqual(alert.message, NSLocalizedString("secretary.personality.saved", comment: ""))
        } else { XCTAssertTrue(alert.message?.contains("500") == true) }
        await dismissAlert()
    }
    private func draft(attempted: Bool) -> SessionStore.SecretaryCallDraft {
        var draft = SessionStore.SecretaryCallDraft(instruction: "Fixture only", confirmationToken: "expired.fixture",
            clientRequestId: UUID(), voiceProvider: .retell, phoneNumber: "+12025550103", requestAttempted: attempted)
        draft.secretaryNumberId = "personal-line"
        draft.secretaryBackendOrigin = AppConfig.baseURL.absoluteString
        return draft
    }

    func testSettingsKatyaCharacterExplicitCardsSaveAndReopen() async throws {
        let screen = try await open()
        XCTAssertEqual(cell(screen, 2).textLabel?.text, NSLocalizedString("secretary.personality.none", comment: ""))
        XCTAssertEqual(cell(screen, 4).accessoryType, .none)
        try await chooseKatya(screen)
        XCTAssertEqual(cell(screen, 3).textLabel?.text, "Fixture: situational humor, no invented biography.")
        XCTAssertTrue(cell(screen, 3).detailTextLabel?.text?.contains("Fixture personal guidance") == true)
        XCTAssertTrue(cell(screen, 3).detailTextLabel?.text?.contains("Fixture example") == true)
        // Character choice alone is not disclosure consent.
        XCTAssertEqual(cell(screen, 4).accessoryType, .none)
        select(screen, 4)
        XCTAssertEqual(cell(screen, 4).accessoryType, .checkmark)
        try await save(screen)
        XCTAssertEqual(SessionStore.shared.secretaryOutgoingNumberId, "personal-line")
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .retell)
        nav.popToRootViewController(animated: false)
        let reopened = try await open()
        XCTAssertEqual(cell(reopened, 2).textLabel?.text, "Катя")
        XCTAssertEqual(cell(reopened, 4).accessoryType, .checkmark)
        select(reopened, 4) // explicit revocation persists too
        try await save(reopened)
        nav.popToRootViewController(animated: false)
        let revoked = try await open()
        XCTAssertEqual(cell(revoked, 4).accessoryType, .none)
        let requests = await server.recorded()
        let writes = requests.filter { $0.httpMethod == "PUT" }
        XCTAssertEqual(writes.count, 2)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(writes.first?.httpBody)) as? [String: Any])
        XCTAssertEqual(body["personalityId"] as? String, "katya-fixture")
        XCTAssertEqual(body["version"] as? Int, 2)
        XCTAssertEqual(body["cardIds"] as? [String], ["personal-card"])
        XCTAssertEqual(Set(body.keys), ["personalityId", "version", "cardIds"])
        XCTAssertFalse(requests.contains { $0.url?.path.hasPrefix("/api/secretary/tasks") == true })
    }

    func testPersonalWorkLineSheetAndPermissionsStaySeparate() async throws {
        let screen = try await open()
        try await chooseKatya(screen)
        select(screen, 4)
        try await save(screen)
        select(screen, 1)
        try await waitUntil { screen.presentedViewController is UIAlertController }
        let sheet = try XCTUnwrap(screen.presentedViewController as? UIAlertController)
        XCTAssertTrue(sheet.actions.contains { $0.title?.contains("+12025550101") == true })
        XCTAssertTrue(sheet.actions.contains { $0.title?.contains("+12025550102") == true })
        await dismissAlert()
        await screen.load("work-line") // same async handler as the line sheet
        XCTAssertEqual(cell(screen, 1).textLabel?.text, "+12025550102")
        XCTAssertEqual(cell(screen, 4).accessibilityIdentifier, "secretary-personality-card-work-card")
        XCTAssertEqual(cell(screen, 4).accessoryType, .none)
        XCTAssertNotEqual(cell(screen, 2).textLabel?.text, "Катя")
        try await chooseKatya(screen)
        XCTAssertTrue(cell(screen, 3).detailTextLabel?.text?.contains("Fixture work guidance") == true)
        select(screen, 4)
        try await save(screen)
        nav.popToRootViewController(animated: false)
        select(settings, 3, 1)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityViewController }
        let reopened = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityViewController)
        reopened.loadViewIfNeeded()
        try await waitUntil { self.cell(reopened, 1).textLabel?.text == "+12025550102" }
        XCTAssertEqual(cell(reopened, 4).accessoryType, .checkmark)
        await reopened.load("personal-line")
        XCTAssertEqual(cell(reopened, 4).accessibilityIdentifier, "secretary-personality-card-personal-card")
        XCTAssertEqual(cell(reopened, 4).accessoryType, .checkmark)
    }

    func testSaveServerErrorKeepsDraftAndAllowsRetryWithoutLocalCommit() async throws {
        var pending = draft(attempted: false)
        pending.voiceProvider = .openai
        pending.secretaryNumberId = nil
        pending.secretaryBackendOrigin = nil
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))
        let before = SessionStore.shared.pendingSecretaryCall
        let screen = try await open()
        await screen.load("work-line")
        try await chooseKatya(screen)
        select(screen, 4)
        await server.failNextSave(500)
        try await save(screen, success: false)
        XCTAssertNil(SessionStore.shared.secretaryOutgoingNumberId)
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .openai)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.clientRequestId, before?.clientRequestId)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.voiceProvider, .openai)
        XCTAssertNil(SessionStore.shared.pendingSecretaryCall?.secretaryNumberId)
        XCTAssertEqual(cell(screen, 2).textLabel?.text, "Катя")
        XCTAssertEqual(cell(screen, 4).accessoryType, .checkmark)
        try await save(screen)
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .retell)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.clientRequestId, pending.clientRequestId)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.secretaryNumberId, "work-line")
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.secretaryBackendOrigin, AppConfig.baseURL.absoluteString)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.voiceProvider, .retell)
    }

    func testGPTAndRetellSelectionOnlyChangesFutureDrafts() async throws {
        let screen = try await open()
        await screen.load("work-line")
        try await save(screen)
        nav.popToRootViewController(animated: false)
        let pending = draft(attempted: false)
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))
        select(settings, 3, 0)
        try await waitUntil { self.settings.presentedViewController is UIAlertController }
        let sheet = try XCTUnwrap(settings.presentedViewController as? UIAlertController)
        XCTAssertEqual(sheet.actions.filter { $0.style != .cancel }.count, 2)
        await dismissAlert()
        settings.applySecretaryProvider(.openai)
        XCTAssertNil(SessionStore.shared.secretaryOutgoingNumberId)
        let changed = try XCTUnwrap(SessionStore.shared.pendingSecretaryCall)
        XCTAssertNil(changed.secretaryNumberId)
        XCTAssertNil(changed.secretaryBackendOrigin)
        XCTAssertEqual(changed.voiceProvider, .openai)
        XCTAssertEqual(changed.clientRequestId, pending.clientRequestId)
        // GPT did not delete the server's Work assignment; Retell does not
        // silently bind a line just because its provider was selected.
        settings.applySecretaryProvider(.retell)
        XCTAssertNil(SessionStore.shared.secretaryOutgoingNumberId)
        let stored = try await api.secretaryOutgoingSetup(numberId: "work-line")
        XCTAssertEqual(stored.numberId, "work-line")
        let attempted = draft(attempted: true)
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(attempted))
        settings.applySecretaryProvider(.openai)
        let locked = try XCTUnwrap(SessionStore.shared.pendingSecretaryCall)
        XCTAssertEqual(locked.clientRequestId, attempted.clientRequestId)
        XCTAssertEqual(locked.secretaryNumberId, attempted.secretaryNumberId)
        XCTAssertEqual(locked.secretaryBackendOrigin, attempted.secretaryBackendOrigin)
        XCTAssertEqual(locked.voiceProvider, attempted.voiceProvider)
        XCTAssertEqual(locked.phoneNumber, attempted.phoneNumber)
        XCTAssertTrue(locked.requestAttempted)
    }

    func testSavingNewSetupCannotRewriteAmbiguousRequestAndBackendMismatchNeverSends() async throws {
        let pending = draft(attempted: true)
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))
        let screen = try await open()
        await screen.load("work-line")
        try await chooseKatya(screen)
        try await save(screen)
        let restored = try XCTUnwrap(SessionStore.shared.pendingSecretaryCall)
        XCTAssertEqual(restored.clientRequestId, pending.clientRequestId)
        XCTAssertEqual(restored.secretaryNumberId, "personal-line")
        XCTAssertEqual(restored.secretaryBackendOrigin, pending.secretaryBackendOrigin)
        XCTAssertEqual(restored.voiceProvider, .retell)
        XCTAssertTrue(restored.requestAttempted)
        XCTAssertFalse(restored.needsPreparation)
        let count = await server.recorded().count
        do {
            _ = try await api.createSecretaryTask(phoneNumber: restored.phoneNumber!, instruction: restored.instruction,
                confirmationToken: restored.confirmationToken, voiceProvider: restored.voiceProvider,
                live: true, clientRequestId: restored.clientRequestId, secretaryNumberId: restored.secretaryNumberId,
                secretaryBackendOrigin: "https://previous-backend.invalid")
            XCTFail("Changed backend must not receive an ambiguous request")
        } catch is SecretaryBackendMismatch { }
        let after = await server.recorded()
        XCTAssertEqual(after.count, count)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.clientRequestId, pending.clientRequestId)
    }

    private func descendant(_ view: UIView, id: String) -> UIView? {
        if view.accessibilityIdentifier == id { return view }
        return view.subviews.lazy.compactMap { self.descendant($0, id: id) }.first
    }

    func testHomeRestoresAmbiguousRequestAfterLostResponseWithoutAnotherCall() async throws {
        let fixture = SecretaryPersonalityFixture(recoveryEnabled: true)
        let client = APIClient(transport: { try await fixture.send($0) }, tokenProvider: { "personality-fixture" })
        let pending = draft(attempted: true)
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))
        SessionStore.shared.secretaryOutgoingNumberId = "work-line"
        SessionStore.shared.secretaryVoiceProvider = .openai
        let home = HomeViewController(secretary: true, api: client)
        nav.setViewControllers([home], animated: false)
        home.loadViewIfNeeded()
        try await waitUntil { await fixture.recorded().contains { $0.httpMethod == "GET" } }
        let button = try XCTUnwrap(descendant(home.view, id: "button-start-call") as? UIButton)
        XCTAssertTrue(button.isEnabled) // expired token must not unlock Prepare
        XCTAssertEqual(button.configuration?.title, NSLocalizedString("secretary.live.retry_safe", comment: ""))
        button.sendActions(for: .touchUpInside)
        try await waitUntil { home.presentedViewController is UIAlertController }
        let locked = try XCTUnwrap(SessionStore.shared.pendingSecretaryCall)
        XCTAssertEqual(locked.clientRequestId, pending.clientRequestId)
        XCTAssertEqual(locked.secretaryNumberId, "personal-line")
        XCTAssertEqual(locked.voiceProvider, .retell)
        await dismissAlert()
        // A new controller restores the persisted draft, then finds the accepted
        // terminal task by request ID in the fake history. No monitoring opens.
        let reopened = HomeViewController(secretary: true, api: client)
        nav.setViewControllers([reopened], animated: false)
        reopened.loadViewIfNeeded()
        try await waitUntil { SessionStore.shared.pendingSecretaryCall == nil }
        let requests = await fixture.recorded()
        XCTAssertEqual(requests.filter { $0.httpMethod == "POST" }.count, 1)
        let creates = await fixture.creationCount()
        XCTAssertEqual(creates, 1)
        let request = try XCTUnwrap(requests.first { $0.httpMethod == "POST" })
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["clientRequestId"] as? String, pending.clientRequestId.uuidString)
        XCTAssertEqual(body["secretaryNumberId"] as? String, "personal-line")
        XCTAssertEqual(body["voiceProvider"] as? String, "retell")
        XCTAssertEqual(body["phoneNumber"] as? String, pending.phoneNumber)
        XCTAssertNil(reopened.presentedViewController)
    }

    func testHomeBackendChangeShowsErrorWithoutSendingOrUnlockingDraft() async throws {
        let fixture = SecretaryPersonalityFixture(recoveryEnabled: true)
        let client = APIClient(transport: { try await fixture.send($0) }, tokenProvider: { "personality-fixture" })
        var pending = draft(attempted: true)
        pending.secretaryBackendOrigin = "https://previous-backend.invalid"
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))
        let home = HomeViewController(secretary: true, api: client)
        nav.setViewControllers([home], animated: false)
        home.loadViewIfNeeded()
        try await waitUntil { await fixture.recorded().contains { $0.httpMethod == "GET" } }
        let button = try XCTUnwrap(descendant(home.view, id: "button-start-call") as? UIButton)
        button.sendActions(for: .touchUpInside)
        try await waitUntil { home.presentedViewController is UIAlertController }
        let alert = try XCTUnwrap(home.presentedViewController as? UIAlertController)
        XCTAssertTrue(alert.message?.contains(NSLocalizedString("secretary.personality.origin_changed", comment: "")) == true)
        let requests = await fixture.recorded()
        XCTAssertFalse(requests.contains { $0.httpMethod == "POST" })
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.clientRequestId, pending.clientRequestId)
        XCTAssertTrue(SessionStore.shared.pendingSecretaryCall?.requestAttempted == true)
    }
}
#endif
