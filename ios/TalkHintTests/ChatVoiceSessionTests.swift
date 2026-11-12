import XCTest
@testable import TalkHint

final class ChatVoiceSessionTests: XCTestCase {
    func testYesAloneCannotAuthorizeAnything() {
        var state = ChatVoiceSessionState()
        for answer in ["yes", "да", "звони", "sí"] {
            XCTAssertFalse(state.takeApproval(text: answer, messageID: "card", planHash: "hash"))
        }
    }
    func testOnlyCompleteAudibleReadbackCanArmExactPlanOnce() {
        var state = ChatVoiceSessionState()
        state.transition(.speaking)
        state.didFinishAudibleReadback(messageID: "card", planHash: "hash", revision: state.revision)
        XCTAssertTrue(state.takeApproval(text: "Да!", messageID: "card", planHash: "hash"))
        XCTAssertFalse(state.takeApproval(text: "Да!", messageID: "card", planHash: "hash"))
    }
    func testInterruptedAudioCannotArmApproval() {
        var state = ChatVoiceSessionState()
        state.transition(.speaking)
        let old = state.revision
        state.interrupt()
        state.didFinishAudibleReadback(messageID: "card", planHash: "hash", revision: old)
        XCTAssertFalse(state.takeApproval(text: "да", messageID: "card", planHash: "hash"))
    }
    func testQueuedTextIsNotAnAudibleReadback() {
        var state = ChatVoiceSessionState()
        state.transition(.thinking)
        state.didFinishAudibleReadback(messageID: "card", planHash: "hash", revision: state.revision)
        XCTAssertFalse(state.takeApproval(text: "yes", messageID: "card", planHash: "hash"))
    }
    func testCorrectionStaleCardAndNoNeverApprove() {
        for answer in ["no", "нет", "не звони", "yes but change the price", "да, но до 200", "maybe"] {
            var state = ChatVoiceSessionState()
            state.transition(.speaking)
            state.didFinishAudibleReadback(messageID: "card", planHash: "hash", revision: state.revision)
            XCTAssertFalse(state.takeApproval(text: answer, messageID: "card", planHash: "hash"))
        }
        var state = ChatVoiceSessionState()
        state.transition(.speaking)
        state.didFinishAudibleReadback(messageID: "card", planHash: "old", revision: state.revision)
        XCTAssertFalse(state.takeApproval(text: "yes", messageID: "card", planHash: "new"))
    }
    func testCloseInvalidatesPermissionAndReadbackCallbacks() {
        var state = ChatVoiceSessionState()
        state.microphone(true)
        let old = state.revision
        state.close()
        XCTAssertNotEqual(state.revision, old)
        XCTAssertFalse(state.microphoneEnabled)
        XCTAssertEqual(state.phase, .closed)
        state.didFinishAudibleReadback(messageID: "card", planHash: "hash", revision: old)
        XCTAssertNil(state.readback)
    }
}
