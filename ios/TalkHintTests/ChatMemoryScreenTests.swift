import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class ChatMemoryScreenTests: XCTestCase {
    private func views(_ root: UIView) -> [UIView] { [root] + root.subviews.flatMap { views($0) } }
    private func button(_ root: UIView, _ name: String) throws -> UIButton {
        try XCTUnwrap(views(root).first { $0.accessibilityIdentifier == "chat.memory.\(name)" } as? UIButton)
    }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Memory UI did not finish its offline request")
    }
    private func screen(owner: @escaping () -> String?, transport: @escaping APIClient.Transport) -> ChatViewController {
        let suite = "ChatMemoryScreenTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        let api = APIClient(transport: transport, tokenProvider: { owner() == "alice" ? "synthetic" : nil })
        return ChatViewController(api: api, ownerId: "alice", currentOwnerId: owner,
            draftStore: ChatOutbox(owner: "alice", origin: "https://fixture.invalid", defaults: defaults))
    }
    private func apply(_ c: ChatViewController) throws {
        c.applyOfflineMemoryFixture(conversation: ChatConversation(id: ChatMemoryFixture.conversation,
            title: "Fixture", createdAt: "2026-11-17T20:00:00Z", updatedAt: "2026-11-17T20:00:00Z"),
            messages: [try ChatMemoryFixture.message()])
        c.view.frame = CGRect(x: 0, y: 0, width: 320, height: 568)
        c.view.layoutIfNeeded()
    }

    func testCardShowsBeforeAfterProvenanceAndAssumptionWithoutSideEffects() throws {
        var saves = 0, cancels = 0
        let action = try XCTUnwrap(ChatMemoryFixture.message().memoryAction)
        let card = ChatMemoryCardView(action: action, pending: false, onSave: { saves += 1 }, onCancel: { cancels += 1 })
        card.frame = CGRect(x: 0, y: 0, width: 290, height: 800); card.layoutIfNeeded()
        let text = views(card).compactMap { ($0 as? UILabel)?.text }.joined(separator: "\n")
        XCTAssertTrue(text.contains("unit 00321")); XCTAssertTrue(text.contains("unit 00322"))
        XCTAssertTrue(text.contains(NSLocalizedString("chat.memory.assumed", comment: "")))
        XCTAssertTrue(text.contains(NSLocalizedString("chat.memory.source.user", comment: "")))
        XCTAssertEqual(saves, 0); XCTAssertEqual(cancels, 0)
        try button(card, "save").sendActions(for: .touchUpInside)
        XCTAssertEqual(saves, 1); XCTAssertEqual(cancels, 0)
    }

    func testExpiredStaleSavedAndPendingButtonsCannotSubmitEvenProgrammatically() throws {
        for state in ["expired", "stale", "saved", "cancelled", "proposed"] {
            var count = 0
            let action = try XCTUnwrap(ChatMemoryFixture.message(status: state).memoryAction)
            let card = ChatMemoryCardView(action: action, pending: state == "proposed",
                onSave: { count += 1 }, onCancel: { count += 1 })
            for name in ["save", "cancel"] {
                let b = try button(card, name)
                XCTAssertFalse(b.isEnabled)
                b.sendActions(for: .touchUpInside)
            }
            XCTAssertEqual(count, 0)
        }
    }

    func testFullChatSaveIsButtonOnlyAndDoubleTapSendsOneRequest() async throws {
        var requests: [URLRequest] = []
        let c = screen(owner: { "alice" }, transport: { req in
            requests.append(req)
            await Task.yield()
            return try ChatMemoryFixture.reply(req, body: ["message": ChatMemoryFixture.json(status: "saved"), "dialed": false])
        })
        try apply(c)
        XCTAssertTrue(requests.isEmpty)
        let save = try button(c.view, "save")
        save.sendActions(for: .touchUpInside); save.sendActions(for: .touchUpInside)
        try await eventually { self.views(c.view).compactMap { ($0 as? UILabel)?.text }.contains(NSLocalizedString("chat.memory.saved", comment: "")) }
        XCTAssertEqual(requests.count, 1)
        XCTAssertTrue(requests[0].url!.path.hasSuffix("/memory/save"))
    }

    func testFullChatCancelAndServerStaleRefreshAreIndependentOfCallPlan() async throws {
        for decision in ["cancel", "save"] {
            var paths: [String] = []
            let c = screen(owner: { "alice" }, transport: { req in
                paths.append(req.url!.path)
                if decision == "save" && req.httpMethod == "POST" {
                    return try ChatMemoryFixture.reply(req, status: 409, body: ["error": "MEMORY_STALE"])
                }
                return try ChatMemoryFixture.reply(req, body: [
                    "message": ChatMemoryFixture.json(status: decision == "cancel" ? "cancelled" : "stale"), "dialed": false])
            })
            try apply(c)
            try button(c.view, decision).sendActions(for: .touchUpInside)
            let key = decision == "cancel" ? "cancelled" : "stale"
            try await eventually { self.views(c.view).compactMap { ($0 as? UILabel)?.text }.contains(NSLocalizedString("chat.memory.\(key)", comment: "")) }
            XCTAssertTrue(paths.allSatisfy { !$0.contains("confirm-plan") && !$0.contains("start") })
            XCTAssertEqual(paths.count, decision == "cancel" ? 1 : 2)
        }
    }

    func testOwnerChangeRejectsOldCardBeforeTransport() async throws {
        var owner: String? = "alice", count = 0
        let c = screen(owner: { owner }, transport: { req in
            count += 1
            return try ChatMemoryFixture.reply(req, body: [:])
        })
        try apply(c); owner = "bob"
        try button(c.view, "save").sendActions(for: .touchUpInside)
        await Task.yield()
        XCTAssertEqual(count, 0)
    }
}
