import XCTest
@testable import TalkHint

final class ChatVoiceClientPolicyTests: XCTestCase {
    func testOnlyExactHTTPSProductionOriginIsPermitted() {
        for value in ["https://talkhint.app", "https://talkhint.app/", "https://talkhint.app:443"] {
            XCTAssertTrue(ChatVoiceClientPolicy.allows(origin: URL(string: value)!,
                                                       build: .productionOwnerPilot), value)
        }
    }

    func testProductionDoesNotTrustOtherOrigins() {
        for value in ["http://talkhint.app", "https://talkhint.app.evil.invalid",
                      "https://other.talkhint.app", "https://voice.replit.dev",
                      "https://talkhint.app:444", "https://user@talkhint.app",
                      "https://talkhint.app/path", "https://talkhint.app?mode=voice",
                      "https://talkhint.app#voice", "https://talkhint-native-tests.invalid"] {
            XCTAssertFalse(ChatVoiceClientPolicy.allows(origin: URL(string: value)!,
                                                        build: .productionOwnerPilot), value)
        }
    }

    func testDevelopmentDoesNotEnableProduction() {
        XCTAssertTrue(ChatVoiceClientPolicy.allows(origin: URL(string: "https://voice.replit.dev")!,
                                                   build: .development))
        for value in ["https://talkhint.app", "https://replit.dev", "http://voice.replit.dev",
                      "https://voice.replit.dev.evil.invalid"] {
            XCTAssertFalse(ChatVoiceClientPolicy.allows(origin: URL(string: value)!,
                                                        build: .development), value)
        }
    }

    func testIsolatedPreviewAndValidationNeverEnableVoice() {
        for value in ["https://talkhint.app", "https://voice.replit.dev",
                      "https://talkhint-native-tests.invalid"] {
            XCTAssertFalse(ChatVoiceClientPolicy.allows(origin: URL(string: value)!,
                                                        build: .isolated), value)
        }
    }

    func testCompiledValidationBuildRemainsIsolated() {
        #if TALKHINT_NATIVE_VALIDATION || TALKHINT_CHAT_PREVIEW
        XCTAssertFalse(ChatVoiceClientPolicy.allows(origin: URL(string: "https://talkhint.app")!,
                                                    build: ChatVoiceClientPolicy.currentBuild))
        #endif
    }
}
