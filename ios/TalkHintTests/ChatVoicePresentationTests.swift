import XCTest
@testable import TalkHint

final class ChatVoicePresentationTests: XCTestCase {
    func testVoiceViewportShowsOnlyLatestNonemptyUtterance() {
        XCTAssertEqual(ChatVoicePresentation.latestUtterance(["Earlier question", "Latest answer", " \n"]), "Latest answer")
        XCTAssertEqual(ChatVoicePresentation.latestUtterance(["Old answer", "New question"]), "New question")
        XCTAssertEqual(ChatVoicePresentation.latestUtterance([]), "")
        XCTAssertEqual(ChatVoicePresentation.latestUtterance([" \n"]), "")
    }

    func testRussianEnglishAndSpanishVoiceStringsAreLocalizedAndProviderFree() throws {
        for (language, listening) in [("ru", "Слушаю"), ("en", "Listening"), ("es", "Escuchando")] {
            let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
            let bundle = try XCTUnwrap(Bundle(path: path))
            XCTAssertEqual(bundle.localizedString(forKey: "chat.voiceMode.listening", value: nil, table: nil), listening)
            for key in ["aiDisclosure", "noOutput", "inputRestarted", "captureError", "open"] {
                let fullKey = "chat.voiceMode." + key
                let text = bundle.localizedString(forKey: fullKey, value: nil, table: nil)
                XCTAssertNotEqual(text, fullKey)
                for technical in ["ElevenLabs", "Flash", "Dev:"] { XCTAssertFalse(text.contains(technical)) }
            }
        }
    }
}
