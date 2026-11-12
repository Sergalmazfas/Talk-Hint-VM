import XCTest
@testable import TalkHint

@MainActor
final class ChatPhoneContextTests: XCTestCase {
    func testActionContextDoesNotRequireAProfession() {
        XCTAssertTrue(ChatPhoneContextCollector.isRelevant("Fontaine, I-44 E, only near the highway"))
        XCTAssertTrue(ChatPhoneContextCollector.isRelevant("Buy EarthLite Harmony DX, Missouri to Michigan"))
        XCTAssertTrue(ChatPhoneContextCollector.isRelevant("Записаться через два часа"))
        XCTAssertFalse(ChatPhoneContextCollector.isRelevant("Hello"))
    }
    func testOutboxPersistsExactPhoneSnapshotForIdempotentRetry() throws {
        let context = ChatPhoneContext(localTime: "2026-11-09T18:00:00Z", timeZone: "America/Chicago",
            location: .init(latitude: 37.2, longitude: -93.3, accuracyMeters: 900,
                            capturedAt: "2026-11-09T18:00:00Z", label: "Springfield, MO"))
        var pending = ChatPendingSend(id: UUID(), conversationId: "chat", text: "Find a shop",
                                     attachmentIds: [], language: "en", state: .uncertain)
        pending.context = context
        let restored = try JSONDecoder().decode(ChatPendingSend.self, from: JSONEncoder().encode(pending))
        XCTAssertEqual(restored.context, context)
        XCTAssertEqual(restored.id, pending.id)
    }
    func testLegacyOutboxWithoutContextStillDecodes() throws {
        let json = """
        {"id":"00000000-0000-4000-a000-000000000001","conversationId":"chat","text":"Hello",
        "attachmentIds":[],"language":"en","state":"uncertain"}
        """
        XCTAssertNil(try JSONDecoder().decode(ChatPendingSend.self, from: Data(json.utf8)).context)
    }
}
