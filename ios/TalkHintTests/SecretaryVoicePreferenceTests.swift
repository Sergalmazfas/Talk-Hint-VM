import XCTest
@testable import TalkHint

final class SecretaryVoicePreferenceTests: XCTestCase {
    func testDefaultDoesNotInheritTranslatorProvider() {
        let defaults = UserDefaults.standard
        let keys = ["talkhint.secretary.voice.provider", "talkhint.voice.provider"]
        let previous = keys.map { defaults.object(forKey: $0) }
        defer {
            for (key, value) in zip(keys, previous) {
                if let value { defaults.set(value, forKey: key) }
                else { defaults.removeObject(forKey: key) }
            }
        }
        defaults.removeObject(forKey: keys[0])
        SessionStore.shared.voiceProvider = .cartesia
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .openai)
        SessionStore.shared.secretaryVoiceProvider = .elevenlabs
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .elevenlabs)
        XCTAssertEqual(SessionStore.shared.voiceProvider, .cartesia)
        defaults.set("invalid", forKey: keys[0])
        XCTAssertEqual(SessionStore.shared.secretaryVoiceProvider, .openai)
    }

    func testOldPersistedDraftStillDecodesItsExplicitProvider() throws {
        for provider in ["elevenlabs", "cartesia", "openai"] {
            let json = """
            {"instruction":"Test","confirmationToken":"fixture","clientRequestId":"00000000-0000-0000-0000-000000000001","voiceProvider":"\(provider)","phoneNumber":null,"requestAttempted":true}
            """
            let draft = try JSONDecoder().decode(SessionStore.SecretaryCallDraft.self, from: Data(json.utf8))
            XCTAssertEqual(draft.voiceProvider.rawValue, provider)
            XCTAssertTrue(draft.requestAttempted)
        }
    }
}
