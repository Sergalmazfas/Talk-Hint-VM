import XCTest
@testable import TalkHint

final class SecretaryAffirmativeRecognitionTests: XCTestCase {
    func testRecognizesExactShortAffirmativesAcrossSupportedLanguages() {
        [
            "yes", "YES, please!", "Yes, I confirm.", "да, подтверждаю", "ДА",
            "sí, confirmo", "иә", "так, підтверджую",
        ].forEach { XCTAssertTrue(SecretaryAffirmativeRecognition.isAffirmative($0), $0) }
    }

    func testDoesNotRecognizeLongerTaskTextOrUncertainPhrases() {
        [
            "yes, ask about the delivery date",
            "да, спроси когда будет готово",
            "I think that is probably right",
            "not yet",
            "",
        ].forEach { XCTAssertFalse(SecretaryAffirmativeRecognition.isAffirmative($0), $0) }
    }
}