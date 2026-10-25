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
    private var previousToken: String?
    private var previousUserId: String?
    private var previousEmail: String?
    private var scopedTestOwners: [String] = []
    private var previousKeyWindow: UIWindow?
    private var animationsWereEnabled = true
    private var openedControllers: [UIViewController] = []
    private var responseGates: [SecretaryPersonalityResponseGate] = []

    override func setUp() async throws {
        try await super.setUp()
        previousDefaults = UserDefaults.standard.dictionaryRepresentation()
        previousDraft = SessionStore.shared.pendingSecretaryCall
        previousToken = SessionStore.shared.token
        previousUserId = SessionStore.shared.userId
        previousEmail = SessionStore.shared.email
        SessionStore.shared.clearPendingSecretaryCall()
        SessionStore.shared.secretaryOutgoingNumberId = nil
        SessionStore.shared.secretaryVoiceProvider = .openai
        server = SecretaryPersonalityFixture()
        let fixture = server!
        api = APIClient(transport: { try await fixture.send($0) }, tokenProvider: { "personality-fixture" })
        settings = SettingsViewController(api: api)
        nav = UINavigationController(rootViewController: settings)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive })
        previousKeyWindow = scene.windows.first { $0.isKeyWindow }
        animationsWereEnabled = UIView.areAnimationsEnabled
        UIView.setAnimationsEnabled(false)
        window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.rootViewController = nav
        window.makeKeyAndVisible()
        settings.loadViewIfNeeded()
        try await waitUntil { self.settings.viewIfLoaded?.window === self.window &&
            self.nav.transitionCoordinator == nil }
    }

    override func tearDown() async throws {
        do { try await dismissAlert() } catch { XCTFail("Could not dismiss test presentation: \(error)") }
        let controllers = openedControllers + (nav?.viewControllers ?? [])
        for controller in controllers {
            (controller as? SecretaryPersonalityViewController)?.cancelPendingOperations()
            (controller as? SecretaryPersonalityPickerViewController)?.cancelPendingOperations()
        }
        window?.isHidden = true
        window?.rootViewController = nil
        for gate in responseGates { await gate.release() }
        responseGates = []
        // Invalidate/drain controller work before restoring global preferences.
        // Do not let a previous test's late PUT update the next test's session.
        for controller in controllers {
            if let screen = controller as? SecretaryPersonalityViewController {
                await screen.finishPendingOperations()
            } else if let picker = controller as? SecretaryPersonalityPickerViewController {
                await picker.finishPendingOperations()
            }
        }
        openedControllers = []
        window?.isHidden = true
        window?.rootViewController = nil
        window = nil; nav = nil; settings = nil; api = nil; server = nil
        previousKeyWindow?.makeKey()
        previousKeyWindow = nil
        UIView.setAnimationsEnabled(animationsWereEnabled)
        for ownerId in scopedTestOwners {
            SessionStore.shared.save(token: "native-fixture", userId: ownerId, email: "fixture@example.invalid")
            SessionStore.shared.clearPendingSecretaryCall()
        }
        scopedTestOwners = []
        SessionStore.shared.clear()
        if let previousToken, let previousUserId, let previousEmail {
            SessionStore.shared.save(token: previousToken, userId: previousUserId, email: previousEmail)
        }
        SessionStore.shared.clearPendingSecretaryCall()
        if let previousDraft { XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(previousDraft)) }
        // Restore preferences and session identity after isolated account-switch cases.
        let current = UserDefaults.standard.dictionaryRepresentation()
        for key in Set(current.keys).union(previousDefaults.keys) {
            if let value = previousDefaults[key] { UserDefaults.standard.set(value, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
        try await super.tearDown()
    }

    private func waitUntil(file: StaticString = #filePath, line: UInt = #line,
                           fixture: SecretaryPersonalityFixture? = nil,
                           _ condition: () async -> Bool) async throws {
        let deadline = Date().addingTimeInterval(4)
        while !(await condition()) {
            guard Date() < deadline else {
                let recorded = await (fixture ?? server)?.recorded() ?? []
                let paths = recorded.map { "\($0.httpMethod ?? "?") \($0.url?.path ?? "?")" }
                let top = nav?.topViewController
                XCTFail("Timed out waiting for Secretary UI. top=\(String(describing: top.map { type(of: $0) })) " +
                    "attached=\(top?.viewIfLoaded?.window != nil) " +
                    "transition=\(nav?.transitionCoordinator != nil) " +
                    "presented=\(String(describing: top?.presentedViewController.map { type(of: $0) })) " +
                    "fixtureRequests=\(paths)", file: file, line: line)
                throw URLError(.timedOut)
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }
    private func cell(_ vc: UITableViewController, _ section: Int, _ row: Int = 0) -> UITableViewCell {
        vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: row, section: section))
    }
    private func select(_ vc: UITableViewController, _ section: Int, _ row: Int = 0) {
        vc.tableView(vc.tableView, didSelectRowAt: IndexPath(row: row, section: section))
    }
    private func dismissAlert() async throws {
        guard let nav else { return }
        while let presented = nav.presentedViewController ?? nav.topViewController?.presentedViewController {
            let presenter = try XCTUnwrap(presented.presentingViewController)
            presenter.dismiss(animated: false)
            try await waitUntil {
                presented.presentingViewController == nil &&
                    presenter.presentedViewController == nil && !presented.isBeingDismissed
            }
        }
    }
    private func open() async throws -> SecretaryPersonalityViewController {
        XCTAssertEqual(cell(settings, 3, 1).accessibilityIdentifier, "cell-secretary-personality")
        select(settings, 3, 1)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityViewController &&
            self.nav.transitionCoordinator == nil &&
            self.nav.topViewController?.viewIfLoaded?.window === self.window }
        let screen = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityViewController)
        openedControllers.append(screen)
        screen.loadViewIfNeeded()
        try await waitUntil { self.cell(screen, 1).textLabel?.text == "+12025550101" }
        return screen
    }
    private func chooseKatya(_ screen: SecretaryPersonalityViewController) async throws {
        select(screen, 2)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityPickerViewController &&
            self.nav.transitionCoordinator == nil &&
            self.nav.topViewController?.viewIfLoaded?.window === self.window }
        let picker = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityPickerViewController)
        openedControllers.append(picker)
        picker.loadViewIfNeeded()
        try await waitUntil {
            picker.tableView(picker.tableView, numberOfRowsInSection: 0) >= 2 &&
                self.cell(picker, 0, 1).textLabel?.text == "Катя"
        }
        select(picker, 0, 1)
        try await waitUntil { self.nav.topViewController === screen &&
            self.nav.transitionCoordinator == nil && screen.viewIfLoaded?.window === self.window &&
            self.cell(screen, 2).textLabel?.text == "Катя" }
    }
    private func save(_ screen: SecretaryPersonalityViewController, success: Bool = true) async throws {
        XCTAssertNil(screen.presentedViewController, "Each save must start without a stale alert")
        let before = await server.recorded().filter { $0.httpMethod == "PUT" }.count
        select(screen, 5)
        try await waitUntil {
            let writes = await self.server.recorded().filter { $0.httpMethod == "PUT" }.count
            return writes == before + 1 && screen.presentedViewController is UIAlertController
        }
        let alert = try XCTUnwrap(screen.presentedViewController as? UIAlertController)
        if success {
            XCTAssertEqual(alert.message, NSLocalizedString("secretary.personality.saved", comment: ""))
        } else { XCTAssertTrue(alert.message?.contains("500") == true) }
        try await dismissAlert()
    }
    private func draft(attempted: Bool) -> SessionStore.SecretaryCallDraft {
        var draft = SessionStore.SecretaryCallDraft(instruction: "Fixture only", confirmationToken: "expired.fixture",
            clientRequestId: UUID(), voiceProvider: .retell, phoneNumber: "+12025550103", requestAttempted: attempted)
        draft.secretaryNumberId = "personal-line"
        draft.secretaryBackendOrigin = AppConfig.baseURL.absoluteString
        draft.ownerId = SessionStore.shared.userId
        draft.environmentOrigin = AppConfig.baseURL.absoluteString
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

    func testPendingSecretaryDraftIsIsolatedAcrossOwnerAccounts() {
        let ownerA = "native-fixture-a-\(UUID().uuidString)"
        let ownerB = "native-fixture-b-\(UUID().uuidString)"
        scopedTestOwners = [ownerA, ownerB]

        SessionStore.shared.save(token: "native-fixture", userId: ownerA, email: "a@example.invalid")
        let pending = draft(attempted: true)
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))

        SessionStore.shared.save(token: "native-fixture", userId: ownerB, email: "b@example.invalid")
        XCTAssertNil(SessionStore.shared.pendingSecretaryCall, "An uncertain request must not follow a login to another owner")

        SessionStore.shared.save(token: "native-fixture", userId: ownerA, email: "a@example.invalid")
        XCTAssertEqual(
            SessionStore.shared.pendingSecretaryCall?.clientRequestId,
            pending.clientRequestId,
            "The original owner can resume the same idempotent request in its original scope")
    }

    func testPendingDraftStorageSeparatesDevelopmentAndProductionOrigins() {
        let owner = "native-fixture-owner"
        let devKey = SessionStore.pendingSecretaryCallStorageKey(
            ownerId: owner, backendOrigin: "https://dev.example.invalid")
        let productionKey = SessionStore.pendingSecretaryCallStorageKey(
            ownerId: owner, backendOrigin: "https://talkhint.app")
        let anotherOwnerKey = SessionStore.pendingSecretaryCallStorageKey(
            ownerId: "another-owner", backendOrigin: "https://dev.example.invalid")

        XCTAssertNotEqual(devKey, productionKey)
        XCTAssertNotEqual(devKey, anotherOwnerKey)
    }

    func testHomePreconfirmSummaryIncludesExactTaskAndRetellRuntime() {
        let pending = SessionStore.SecretaryCallDraft(
            instruction: "Ask whether the appointment is available tomorrow.",
            confirmationToken: "fixture",
            clientRequestId: UUID(),
            voiceProvider: .retell,
            phoneNumber: "+12025550199",
            requestAttempted: false)
        let setup = SecretaryOutgoingSetup(
            protocolVersion: 1,
            numberId: "personal-line",
            scope: "personal",
            fromNumber: "+12025550101",
            cardIds: [],
            cards: [],
            assignment: nil,
            provider: "retell",
            engine: "gpt-6.1-sol",
            reasoning: "medium")
        let home = HomeViewController(secretary: true, api: api)
        let summary = home.secretaryCallPreconfirmSummary(
            draft: pending,
            destination: "+12025550199",
            setup: setup,
            lineName: "Personal line")

        XCTAssertTrue(summary.contains("+12025550199"))
        XCTAssertTrue(summary.contains(pending.instruction))
        XCTAssertTrue(summary.contains("Personal line"))
        XCTAssertTrue(summary.contains("gpt-6.1-sol"))
        XCTAssertTrue(summary.contains("medium"))
        XCTAssertTrue(summary.contains(AppConfig.bundleId))
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
        try await dismissAlert()
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
        try await dismissAlert()
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

    private func useResponseGate() -> SecretaryPersonalityResponseGate {
        let gate = SecretaryPersonalityResponseGate(fixture: server)
        responseGates.append(gate)
        api = APIClient(transport: { try await gate.send($0) }, tokenProvider: { "personality-fixture" })
        settings = SettingsViewController(api: api)
        nav.setViewControllers([settings], animated: false)
        settings.loadViewIfNeeded()
        return gate
    }

    func testLateSavedResponseCannotChangePreferencesAfterLeavingScreen() async throws {
        let gate = useResponseGate()
        let pending = draft(attempted: false)
        XCTAssertTrue(SessionStore.shared.savePendingSecretaryCall(pending))
        let screen = try await open()
        await screen.load("work-line")
        try await chooseKatya(screen)
        await gate.arm(method: "PUT", path: "/api/secretary-personalities/numbers/work-line/outgoing")
        select(screen, 5)
        try await waitUntil { await gate.isHolding() }
        nav.popToRootViewController(animated: false)
        try await waitUntil { screen.viewIfLoaded?.window == nil }
        await gate.release()
        await screen.finishPendingOperations()
        XCTAssertNil(SessionStore.shared.secretaryOutgoingNumberId)
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .openai)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.clientRequestId, pending.clientRequestId)
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.secretaryNumberId, pending.secretaryNumberId)
        XCTAssertNil(screen.presentedViewController)
        XCTAssertNil(settings.presentedViewController)
        // PUT completed remotely before the lost/late response. Read it back;
        // never pretend cancellation rolled it back or issue another PUT.
        let reopened = try await open()
        await reopened.load("work-line")
        XCTAssertEqual(cell(reopened, 2).textLabel?.text, "Катя")
        let requests = await server.recorded()
        XCTAssertEqual(requests.filter { $0.httpMethod == "PUT" }.count, 1)
        XCTAssertFalse(requests.contains { $0.url?.path == "/api/secretary/tasks" })
    }

    func testLateFailedSaveDoesNotPresentOnDetachedController() async throws {
        let gate = useResponseGate()
        let screen = try await open()
        await server.failNextSave(500)
        await gate.arm(method: "PUT", path: "/api/secretary-personalities/numbers/personal-line/outgoing")
        select(screen, 5)
        try await waitUntil { await gate.isHolding() }
        nav.popToRootViewController(animated: false)
        try await waitUntil { screen.viewIfLoaded?.window == nil }
        await gate.release()
        await screen.finishPendingOperations()
        XCTAssertNil(screen.presentedViewController)
        XCTAssertNil(settings.presentedViewController)
        XCTAssertNil(SessionStore.shared.secretaryOutgoingNumberId)
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .openai)
    }

    func testReturnAfterInterruptedSaveReadsSameLineWithoutAnotherPUT() async throws {
        let gate = useResponseGate()
        let screen = try await open()
        await screen.load("work-line")
        try await chooseKatya(screen)
        await gate.arm(method: "PUT", path: "/api/secretary-personalities/numbers/work-line/outgoing")
        select(screen, 5)
        try await waitUntil { await gate.isHolding() }
        nav.pushViewController(UIViewController(), animated: false)
        await gate.release()
        await screen.finishPendingOperations()
        nav.popViewController(animated: false)
        try await waitUntil {
            self.cell(screen, 1).textLabel?.text == "+12025550102" &&
                self.cell(screen, 2).textLabel?.text == "Катя"
        }
        XCTAssertNil(screen.presentedViewController)
        XCTAssertNil(SessionStore.shared.secretaryOutgoingNumberId)
        let requests = await server.recorded()
        XCTAssertEqual(requests.filter { $0.httpMethod == "PUT" }.count, 1)
        XCTAssertGreaterThanOrEqual(requests.filter {
            $0.httpMethod == "GET" &&
                $0.url?.path == "/api/secretary-personalities/numbers/work-line/outgoing"
        }.count, 2)
    }

    func testOlderLineResponseCannotReplaceNewerLineSelection() async throws {
        let gate = useResponseGate()
        let screen = try await open()
        await gate.arm(method: "GET", path: "/api/secretary-personalities/numbers/work-line/outgoing")
        let older = Task { @MainActor in await screen.load("work-line") }
        try await waitUntil { await gate.isHolding() }
        await screen.load("personal-line")
        await gate.release()
        await older.value
        XCTAssertEqual(cell(screen, 1).textLabel?.text, "+12025550101")
        XCTAssertEqual(cell(screen, 4).accessibilityIdentifier, "secretary-personality-card-personal-card")
        XCTAssertNil(screen.presentedViewController)
    }

    func testLateCatalogDetailCannotSelectCharacterAfterBack() async throws {
        let gate = useResponseGate()
        let screen = try await open()
        select(screen, 2)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityPickerViewController &&
            self.nav.transitionCoordinator == nil }
        let picker = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityPickerViewController)
        openedControllers.append(picker)
        try await waitUntil { self.cell(picker, 0, 1).textLabel?.text == "Катя" }
        await gate.arm(method: "GET", path: "/api/secretary-personalities/katya-fixture")
        select(picker, 0, 1)
        try await waitUntil { await gate.isHolding() }
        nav.popViewController(animated: false)
        await gate.release()
        await picker.finishPendingOperations()
        XCTAssertTrue(nav.topViewController === screen)
        XCTAssertEqual(cell(screen, 2).textLabel?.text, NSLocalizedString("secretary.personality.none", comment: ""))
        XCTAssertNil(screen.presentedViewController)
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
        try await waitUntil(fixture: fixture) { await fixture.recorded().contains { $0.httpMethod == "GET" } }
        let button = try XCTUnwrap(descendant(home.view, id: "button-start-call") as? UIButton)
        XCTAssertTrue(button.isEnabled) // expired token must not unlock Prepare
        XCTAssertEqual(button.configuration?.title, NSLocalizedString("secretary.live.retry_safe", comment: ""))
        button.sendActions(for: .touchUpInside)
        try await waitUntil(fixture: fixture) { home.presentedViewController is UIAlertController }
        let locked = try XCTUnwrap(SessionStore.shared.pendingSecretaryCall)
        XCTAssertEqual(locked.clientRequestId, pending.clientRequestId)
        XCTAssertEqual(locked.secretaryNumberId, "personal-line")
        XCTAssertEqual(locked.voiceProvider, .retell)
        try await dismissAlert()
        // A new controller restores the persisted draft, then finds the accepted
        // terminal task by request ID in the fake history. No monitoring opens.
        let reopened = HomeViewController(secretary: true, api: client)
        nav.setViewControllers([reopened], animated: false)
        reopened.loadViewIfNeeded()
        try await waitUntil(fixture: fixture) { SessionStore.shared.pendingSecretaryCall == nil }
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
        try await waitUntil(fixture: fixture) { await fixture.recorded().contains { $0.httpMethod == "GET" } }
        let button = try XCTUnwrap(descendant(home.view, id: "button-start-call") as? UIButton)
        button.sendActions(for: .touchUpInside)
        try await waitUntil(fixture: fixture) { home.presentedViewController is UIAlertController }
        let alert = try XCTUnwrap(home.presentedViewController as? UIAlertController)
        XCTAssertTrue(alert.message?.contains(NSLocalizedString("secretary.personality.origin_changed", comment: "")) == true)
        let requests = await fixture.recorded()
        XCTAssertFalse(requests.contains { $0.httpMethod == "POST" })
        XCTAssertEqual(SessionStore.shared.pendingSecretaryCall?.clientRequestId, pending.clientRequestId)
        XCTAssertTrue(SessionStore.shared.pendingSecretaryCall?.requestAttempted == true)
    }

    func testCallReviewShowsVerifiedOwnerLineCatalogVersionAndRuntime() async throws {
        SessionStore.shared.secretaryOutgoingNumberId = "work-line"
        SessionStore.shared.secretaryVoiceProvider = .retell
        _ = try await api.saveSecretaryOutgoingSetup(
            numberId: "work-line", personalityId: "katya-fixture",
            version: 2, cardIds: ["work-card"])

        let review = SecretaryTaskReviewViewController(
            phoneNumber: "+12025550103", instruction: "Ask about the appointment",
            confirmationToken: "fixture-only", api: api)
        nav.pushViewController(review, animated: false)
        review.loadViewIfNeeded()
        try await waitUntil {
            (self.descendant(review.view, id: "summary-secretary-configuration") as? UILabel)?
                .text?.contains("gpt-6.1-sol") == true
        }
        let summary = try XCTUnwrap(
            (descendant(review.view, id: "summary-secretary-configuration") as? UILabel)?.text)
        XCTAssertTrue(summary.contains("app.talkhint"))
        XCTAssertTrue(summary.contains("+12025550102"))
        XCTAssertTrue(summary.contains("Катя"))
        XCTAssertTrue(summary.contains("2"))
        XCTAssertTrue(summary.contains("medium"))
        XCTAssertTrue(summary.contains("Debug · Dev"))
        let start = try XCTUnwrap(descendant(review.view, id: "button-secretary-start") as? UIButton)
        XCTAssertTrue(start.isEnabled, "Only a verified saved setup may enable the call action")
        let requests = await server.recorded()
        XCTAssertTrue(requests.contains {
            $0.url?.path == "/api/secretary-personalities/numbers/work-line/outgoing" &&
                $0.httpMethod == "GET"
        })
        XCTAssertFalse(requests.contains { $0.url?.path == "/api/secretary/tasks" },
                       "Reviewing configuration must not create a task")
    }

    func testRemovedSavedLineIsNotSilentlyReplaced() async throws {
        SessionStore.shared.secretaryOutgoingNumberId = "removed-line"
        select(settings, 3, 1)
        try await waitUntil { self.nav.topViewController is SecretaryPersonalityViewController }
        let screen = try XCTUnwrap(nav.topViewController as? SecretaryPersonalityViewController)
        screen.loadViewIfNeeded()
        try await waitUntil { screen.presentedViewController is UIAlertController }
        XCTAssertEqual(cell(screen, 1).textLabel?.text,
                       NSLocalizedString("secretary.personality.no_numbers", comment: ""))
        let requests = await server.recorded()
        XCTAssertFalse(requests.contains { $0.url?.path.hasSuffix("/outgoing") == true },
                       "A stale line must not be replaced by the first available line")
    }

    func testReviewBlocksRetellWithoutSavedOutgoingLine() throws {
        SessionStore.shared.secretaryOutgoingNumberId = nil
        SessionStore.shared.secretaryVoiceProvider = .retell
        let review = SecretaryTaskReviewViewController(
            phoneNumber: "+12025550103", instruction: "Fixture only",
            confirmationToken: "fixture-only", api: api)
        review.loadViewIfNeeded()
        let start = try XCTUnwrap(descendant(review.view, id: "button-secretary-start") as? UIButton)
        XCTAssertFalse(start.isEnabled)
        let summary = try XCTUnwrap(
            (descendant(review.view, id: "summary-secretary-configuration") as? UILabel)?.text)
        XCTAssertTrue(summary.contains(NSLocalizedString("secretary.review.setup_unavailable", comment: "")))
    }
}
#endif
