import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class ChatDeviceAgendaTests: XCTestCase {
    @MainActor private final class Fake: ChatDeviceAgendaProviding {
        var calendarAccess: ChatAgendaAccess = .notRequested
        var remindersAccess: ChatAgendaAccess = .notRequested
        var grant = false
        var fail = false
        var reads: [ChatAgendaKind] = []
        var requests: [ChatAgendaKind] = []
        var saved: [ChatReminderDraft] = []
        var deleted: [String] = []
        var values = [ChatAgendaItem(id: "fixture", title: "Device-only fixture", date: Date(timeIntervalSince1970: 0),
                                    subtitle: "Offline list", completed: false, editable: true)]
        func access(_ kind: ChatAgendaKind) -> ChatAgendaAccess { kind == .calendar ? calendarAccess : remindersAccess }
        func requestAccess(_ kind: ChatAgendaKind) async throws -> Bool {
            requests.append(kind)
            if kind == .calendar { calendarAccess = grant ? .allowed : .denied }
            else { remindersAccess = grant ? .allowed : .denied }
            return grant
        }
        func items(_ kind: ChatAgendaKind, on day: Date) async throws -> [ChatAgendaItem] {
            reads.append(kind)
            if fail { throw ChatAgendaError.readFailed }
            return values
        }
        func reminder(_ id: String) throws -> ChatReminderDraft {
            .init(id: id, title: "Existing", due: nil, completed: false)
        }
        func saveReminder(_ draft: ChatReminderDraft) throws { saved.append(draft) }
        func deleteReminder(_ id: String) throws { deleted.append(id) }
    }
    private var windows: [UIWindow] = []
    private var previousWindow: UIWindow?
    override func tearDown() async throws {
        for window in windows { window.isHidden = true; window.rootViewController = nil }
        windows = []
        previousWindow?.makeKey()
        previousWindow = nil
        try await super.tearDown()
    }
    private func api(status: Int = 200, task: Bool = false, calls: @escaping () -> Void = {}) -> APIClient {
        APIClient(transport: { request in
            calls()
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/secretary/tasks")
            XCTAssertNil(request.httpBody) // Device records never become request bodies.
            let tasks: [[String: Any]] = task ? [["id": "assignment", "phoneNumber": "+12025550123",
                "instruction": "Existing offline assignment", "status": "completed",
                "summary": "Offline report"]] : []
            return (try JSONSerialization.data(withJSONObject: ["tasks": tasks]),
                HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline-fixture" })
    }
    private func screen(_ kind: ChatAgendaKind, fake: Fake, client: APIClient? = nil,
                        owner: @escaping () -> Bool = { true }) -> ChatDeviceAgendaViewController {
        let controller = ChatDeviceAgendaViewController(kind: kind, store: fake,
            api: client ?? api(), validOwner: owner)
        controller.loadViewIfNeeded()
        controller.viewWillAppear(false)
        return controller
    }
    private func wait(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(4)
        while !condition() {
            if Date() > deadline { XCTFail("Offline agenda state did not settle"); throw URLError(.timedOut) }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }
    private func all<T: UIView>(_ view: UIView, _ type: T.Type) -> [T] {
        ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { all($0, type) }
    }
    func testOpeningCalendarDoesNotPromptReadWriteOrUseServer() async throws {
        let fake = Fake()
        var calls = 0
        let vc = screen(.calendar, fake: fake, client: api(calls: { calls += 1 }))
        await Task.yield()
        XCTAssertTrue(fake.requests.isEmpty)
        XCTAssertTrue(fake.reads.isEmpty)
        XCTAssertTrue(fake.saved.isEmpty)
        XCTAssertTrue(fake.deleted.isEmpty)
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 0)).accessibilityIdentifier,
                       "agenda-permission")
        XCTAssertFalse(try XCTUnwrap(vc.navigationItem.rightBarButtonItem).isEnabled)
    }
    func testCalendarPermissionDoesNotGrantRemindersAndGrantDoesNotWrite() async throws {
        let fake = Fake()
        fake.grant = true
        let vc = screen(.calendar, fake: fake)
        vc.tableView(vc.tableView, didSelectRowAt: IndexPath(row: 0, section: 0))
        try await wait { fake.reads == [.calendar] }
        XCTAssertEqual(fake.requests, [.calendar])
        XCTAssertEqual(fake.remindersAccess, .notRequested)
        XCTAssertTrue(fake.saved.isEmpty)
        XCTAssertTrue(fake.deleted.isEmpty)
    }
    func testDeniedRemindersStillShowExistingAssignmentsWithoutCallingAnyone() async throws {
        let fake = Fake()
        fake.remindersAccess = .denied
        let vc = screen(.reminders, fake: fake, client: api(task: true))
        try await wait {
            vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 1)).accessibilityIdentifier == "agenda-assignment-assignment"
        }
        XCTAssertTrue(fake.reads.isEmpty)
        XCTAssertTrue(fake.requests.isEmpty)
        let row = vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 1))
        XCTAssertEqual(row.textLabel?.text, "Existing offline assignment")
        XCTAssertTrue(fake.saved.isEmpty)
    }
    func testServerFailureIsNotAnEmptySuccessfulAssignmentsList() async throws {
        let fake = Fake()
        let vc = screen(.reminders, fake: fake, client: api(status: 503))
        try await wait {
            vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 1)).accessibilityIdentifier == "agenda-assignments-retry"
        }
        let cell = vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 1))
        XCTAssertEqual(cell.textLabel?.text, NSLocalizedString("agenda.assignments.error", comment: ""))
    }
    func testDeviceReadFailureIsAnExplicitRetry() async throws {
        let fake = Fake()
        fake.calendarAccess = .allowed
        fake.fail = true
        let vc = screen(.calendar, fake: fake)
        try await wait {
            vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 0)).accessibilityIdentifier == "agenda-retry"
        }
        XCTAssertTrue(fake.saved.isEmpty)
        XCTAssertTrue(fake.deleted.isEmpty)
    }
    func testDifferentOwnerCannotReadOrRequestPermission() async throws {
        let fake = Fake()
        fake.remindersAccess = .allowed
        var calls = 0
        let vc = screen(.reminders, fake: fake, client: api(calls: { calls += 1 }), owner: { false })
        await Task.yield()
        XCTAssertEqual(vc.numberOfSections(in: vc.tableView), 0)
        XCTAssertTrue(fake.reads.isEmpty)
        XCTAssertTrue(fake.requests.isEmpty)
        XCTAssertEqual(calls, 0)
    }
    func testRevokedPermissionAndChangedOwnerHidePreviouslyLoadedRows() async throws {
        let fake = Fake()
        fake.calendarAccess = .allowed
        var owner = true
        let vc = screen(.calendar, fake: fake, owner: { owner })
        try await wait {
            vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 0)).accessibilityIdentifier == "agenda-item-0"
        }
        fake.calendarAccess = .denied
        vc.viewWillAppear(false)
        XCTAssertEqual(vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 0)).accessibilityIdentifier,
                       "agenda-permission")
        owner = false
        vc.viewWillAppear(false)
        XCTAssertEqual(vc.numberOfSections(in: vc.tableView), 0)
    }
    func testReminderEditorDoesNotSaveUntilExplicitSaveAndRejectsChangedOwner() {
        let fake = Fake()
        var owner = true
        let editor = ChatReminderEditor(store: fake,
            draft: .init(id: nil, title: "Offline draft", due: nil, completed: false), validOwner: { owner })
        editor.loadViewIfNeeded()
        XCTAssertTrue(fake.saved.isEmpty)
        let save = editor.navigationItem.rightBarButtonItem!
        UIApplication.shared.sendAction(save.action!, to: save.target, from: save, for: nil)
        XCTAssertEqual(fake.saved.count, 1)
        XCTAssertEqual(fake.saved.first?.title, "Offline draft")
        UIApplication.shared.sendAction(save.action!, to: save.target, from: save, for: nil)
        XCTAssertEqual(fake.saved.count, 1) // Double tap cannot create a second reminder.
        owner = false
        UIApplication.shared.sendAction(save.action!, to: save.target, from: save, for: nil)
        XCTAssertEqual(fake.saved.count, 1)
    }
    func testReminderEditorCancelDoesNotWriteOrDelete() {
        let fake = Fake()
        let editor = ChatReminderEditor(store: fake,
            draft: .init(id: "existing", title: "Offline draft", due: nil, completed: false), validOwner: { true })
        editor.loadViewIfNeeded()
        let cancel = editor.navigationItem.leftBarButtonItem!
        UIApplication.shared.sendAction(cancel.action!, to: cancel.target, from: cancel, for: nil)
        XCTAssertTrue(fake.saved.isEmpty)
        XCTAssertTrue(fake.deleted.isEmpty)
    }
    func testDueDateWithoutEmbeddedCalendarIsStillRecognized() {
        let components = DateComponents(year: 2026, month: 11, day: 28, hour: 12, minute: 30)
        XCTAssertEqual(ChatDeviceAgendaStore.dueDate(components), Calendar.current.date(from: components))
        XCTAssertNil(ChatDeviceAgendaStore.dueDate(nil))
    }
    func testAgataMenuConfirmationDoesNotCreateSessionOrSendMessages() throws {
        var calls = 0
        let client = APIClient(transport: { request in
            calls += 1
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertFalse(request.url!.path.contains("/agata"))
            var object: [String: Any] = [:]
            switch request.url!.path {
            case "/api/chat-v1/capabilities":
                object = ["ai": ["available": false], "voice": ["available": false],
                          "attachments": ["available": false, "mimeTypes": [], "maxBytes": 2097152]]
            case "/api/chat-v1/conversations":
                object = ["conversations": [["id": "fixture", "title": "Offline", "createdAt": "", "updatedAt": ""]]]
            default: object = ["messages": [], "hasMore": false]
            }
            return (try JSONSerialization.data(withJSONObject: object),
                    HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "offline-fixture" })
        let chat = ChatViewController(api: client, ownerId: "fixture", currentOwnerId: { "fixture" })
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        previousWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        windows.append(window)
        window.rootViewController = chat
        window.makeKeyAndVisible()
        // Chat bootstrap uses this fixture too; only measure confirmation.
        let before = calls
        chat.showAgataMenuConfirmation()
        XCTAssertEqual((chat.presentedViewController as? UIAlertController)?.view.accessibilityIdentifier, "chat-agata-confirmation")
        XCTAssertEqual(calls, before)
        XCTAssertFalse(chat.presentedViewController is ChatAgataViewController)
    }
    func testCalendarAndTasksLightDarkSnapshotsUseOnlyFakes() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        previousWindow = scene.windows.first { $0.isKeyWindow }
        for kind in [ChatAgendaKind.calendar, .reminders] {
            for style in [UIUserInterfaceStyle.light, .dark] {
                let fake = Fake()
                fake.calendarAccess = .allowed
                fake.remindersAccess = .allowed
                let vc = ChatDeviceAgendaViewController(kind: kind, store: fake, api: api(task: true), validOwner: { true })
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(x: 0, y: 0, width: 320, height: 640)
                window.overrideUserInterfaceStyle = style // Before presentation.
                window.rootViewController = UINavigationController(rootViewController: vc)
                windows.append(window)
                window.makeKeyAndVisible()
                try await wait {
                    let deviceReady = vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 0)).accessibilityIdentifier == "agenda-item-0"
                    if kind == .calendar { return deviceReady }
                    return deviceReady && vc.tableView(vc.tableView, cellForRowAt: IndexPath(row: 0, section: 1)).accessibilityIdentifier == "agenda-assignment-assignment"
                }
                window.layoutIfNeeded()
                let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                    _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                }
                let attachment = XCTAttachment(image: image)
                attachment.name = "Agenda-\(kind)-\(style.rawValue)"
                attachment.lifetime = .keepAlways
                add(attachment)
                XCTAssertTrue(fake.saved.isEmpty)
                XCTAssertTrue(fake.deleted.isEmpty)
                window.isHidden = true
            }
        }
    }
}
