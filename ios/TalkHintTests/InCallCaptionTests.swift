import XCTest
@testable import TalkHint

/// Regression tests for the live in-call caption logic in `InCallViewController`:
/// one updating card per speaker, freeze on final, a fresh card for the next
/// utterance, and a pinned suggestion banner that updates in place without
/// adding feed cards.
///
/// The tests drive the view controller through its real `CallHintStreamDelegate`
/// entry point (the same path the `/ui` WebSocket uses) and inspect the rendered
/// view hierarchy by `accessibilityIdentifier`, so they exercise the production
/// upsert/finalize flow rather than a reimplementation of it.
///
/// Must be run on a Mac with Xcode / iOS simulator — these sources cannot be
/// compiled on Linux. `xcodebuild test -scheme TalkHint -destination 'platform=iOS Simulator,name=iPhone 15'`.
final class InCallCaptionTests: XCTestCase {

    /// Interim updates reuse one card, the final freezes it (full opacity), and
    /// the next utterance starts a brand-new card.
    func testGuestTranscriptUpdatesInPlaceFinalizesThenStartsNewCard() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        // First interim → one live (dimmed) card.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "Hel", translation: nil, confidence: nil, isFinal: false))
        XCTAssertEqual(feedCards(vc).count, 1, "interim should create exactly one card")
        XCTAssertEqual(primaryText(feedCards(vc)[0]), "Hel")
        XCTAssertEqual(feedCards(vc)[0].alpha, 0.7, accuracy: 0.001,
                       "interim card should be dimmed")

        // Second interim → same card, text replaced in place.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "Hello there", translation: nil, confidence: nil, isFinal: false))
        XCTAssertEqual(feedCards(vc).count, 1, "interim update must not add a card")
        XCTAssertEqual(primaryText(feedCards(vc)[0]), "Hello there")

        // Final → still the same card, now frozen at full opacity.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "Hello there friend", translation: "Privet drug", confidence: nil, isFinal: true))
        XCTAssertEqual(feedCards(vc).count, 1, "finalizing must not add a card")
        XCTAssertEqual(primaryText(feedCards(vc)[0]), "Hello there friend")
        XCTAssertEqual(feedCards(vc)[0].alpha, 1.0, accuracy: 0.001,
                       "final card should be full opacity")
        XCTAssertEqual(secondaryText(feedCards(vc)[0]), "Privet drug",
                       "translation should be shown on the finalized card")

        // Next utterance → a new card appears after the frozen one.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "Are you still there", translation: nil, confidence: nil, isFinal: false))
        XCTAssertEqual(feedCards(vc).count, 2, "a new utterance must create a new card")
        XCTAssertEqual(primaryText(feedCards(vc)[0]), "Hello there friend",
                       "the previous final card must remain unchanged")
        XCTAssertEqual(primaryText(feedCards(vc)[1]), "Are you still there")
    }

    /// The caller (guest) and owner ("YOU") each keep their own live card, so
    /// interleaved interim events update independently instead of clobbering one
    /// shared card.
    func testGuestAndOwnerLiveCardsAreIndependent() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "guest one", translation: nil, confidence: nil, isFinal: false))
        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "owner one", confidence: nil, isFinal: false))
        XCTAssertEqual(feedCards(vc).count, 2, "guest + owner should be two separate cards")

        // Updating the guest must not touch the owner's live card.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "guest two", translation: nil, confidence: nil, isFinal: false))
        XCTAssertEqual(feedCards(vc).count, 2, "guest update must reuse its own card")
        XCTAssertEqual(lastCardText(vc, identifier: "card-guest"), "guest two")
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "owner one",
                       "owner card must be untouched by guest updates")

        // Finalizing the guest leaves the owner card still live; a new guest line
        // opens a third card while the owner card stays the same instance.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "guest final", translation: nil, confidence: nil, isFinal: true))
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "guest three", translation: nil, confidence: nil, isFinal: false))
        XCTAssertEqual(feedCards(vc).count, 3)
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "owner one",
                       "owner live card persists across guest finalize + new card")

        // Owner's own final updates the owner card in place (no new card).
        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "owner final caption", confidence: nil, isFinal: true))
        XCTAssertEqual(feedCards(vc).count, 3, "owner finalize must not add a card")
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "owner final caption")
    }

    /// Garbled owner finals (too short / known-noise) are dropped so they never
    /// reach the YOU line, while a clean final still renders — matching the web
    /// UI's `isGarbageSTT` guard. Interim text always updates in place.
    func testGarbledOwnerFinalIsSuppressed() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        // Interim is never filtered, even when short.
        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "so", confidence: nil, isFinal: false))
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "so",
                       "interim owner text must always render")

        // A garbled final (too short) must not replace the live card.
        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "um uh", confidence: nil, isFinal: true))
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "so",
                       "garbled owner final must be suppressed, leaving the live card")

        // A clean final still finalizes the card in place.
        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "I would like to book", confidence: nil, isFinal: true))
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "I would like to book",
                       "a clean owner final must render normally")
    }

    /// A low-confidence owner final is dropped even when the text looks fine,
    /// mirroring the web's `confidence < 0.65` check.
    func testLowConfidenceOwnerFinalIsSuppressed() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "I would like to book", confidence: 0.4, isFinal: false))
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "I would like to book")

        vc.callHintStream(stream, didReceive:
            .ownerTranscript(text: "please confirm the booking", confidence: 0.4, isFinal: true))
        XCTAssertEqual(lastCardText(vc, identifier: "card-owner"), "I would like to book",
                       "low-confidence owner final must be suppressed")
    }

    /// Garbled caller (guest) finals (too short / known-noise) are dropped so
    /// they never reach the CALLER line, while a clean final still renders —
    /// matching the web UI's `isGarbageSTT` guard. Interim text always updates
    /// in place.
    func testGarbledGuestFinalIsSuppressed() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        // Interim is never filtered, even when short.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "so", translation: nil, confidence: nil, isFinal: false))
        XCTAssertEqual(lastCardText(vc, identifier: "card-guest"), "so",
                       "interim guest text must always render")

        // A garbled final (too short) must not replace the live card.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "um uh", translation: nil, confidence: nil, isFinal: true))
        XCTAssertEqual(lastCardText(vc, identifier: "card-guest"), "so",
                       "garbled guest final must be suppressed, leaving the live card")

        // A clean final still finalizes the card in place.
        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "I would like to book", translation: nil, confidence: nil, isFinal: true))
        XCTAssertEqual(lastCardText(vc, identifier: "card-guest"), "I would like to book",
                       "a clean guest final must render normally")
    }

    /// A low-confidence caller (guest) final is dropped even when the text looks
    /// fine, mirroring the web's `confidence < 0.65` check.
    func testLowConfidenceGuestFinalIsSuppressed() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "I would like to book", translation: nil, confidence: 0.4, isFinal: false))
        XCTAssertEqual(lastCardText(vc, identifier: "card-guest"), "I would like to book")

        vc.callHintStream(stream, didReceive:
            .guestTranscript(text: "please confirm the booking", translation: nil, confidence: 0.4, isFinal: true))
        XCTAssertEqual(lastCardText(vc, identifier: "card-guest"), "I would like to book",
                       "low-confidence guest final must be suppressed")
    }

    /// The pinned SUGGESTION banner is hidden until the first suggestion, then
    /// becomes visible and updates in place — never adding cards to the feed.
    func testSuggestionBannerShowsAndUpdatesWithoutAddingFeedCards() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        guard let banner = view(withIdentifier: "card-suggestion", in: vc.view) else {
            return XCTFail("suggestion banner not found in hierarchy")
        }
        XCTAssertTrue(banner.isHidden, "banner should start hidden")
        let feedCountBefore = feedCards(vc).count

        vc.callHintStream(stream, didReceive:
            .suggestion(en: "Offer the morning slot", translation: "Predlozhi utro"))
        XCTAssertFalse(banner.isHidden, "banner should become visible on first suggestion")
        XCTAssertEqual(suggestionText(vc), "Offer the morning slot")
        XCTAssertEqual(feedCards(vc).count, feedCountBefore,
                       "a suggestion must not add a feed card")

        // A second suggestion replaces the text in place — still one banner, still
        // no feed cards added.
        vc.callHintStream(stream, didReceive:
            .suggestion(en: "Ask for their name", translation: nil))
        XCTAssertEqual(suggestionText(vc), "Ask for their name",
                       "banner text should update in place")
        XCTAssertEqual(feedCards(vc).count, feedCountBefore,
                       "updating the suggestion must not add a feed card")
        XCTAssertEqual(views(withIdentifierPrefix: "card-suggestion", in: vc.view).count, 1,
                       "there must remain exactly one suggestion banner")
    }

    // MARK: - Helpers

    private func makeLoadedViewController() -> InCallViewController {
        let vc = InCallViewController(callerName: "Tester")
        vc.loadViewIfNeeded()
        vc.view.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        vc.view.layoutIfNeeded()
        return vc
    }

    /// The transcript feed's cards, in display order. The feed lives inside the
    /// scroll view identified by `scroll-incall-feed`; its single stack view's
    /// arranged subviews are the cards.
    private func feedCards(_ vc: UIViewController) -> [UIView] {
        guard let scroll = view(withIdentifier: "scroll-incall-feed", in: vc.view) as? UIScrollView,
              let stack = scroll.subviews.compactMap({ $0 as? UIStackView }).first else {
            return []
        }
        return stack.arrangedSubviews
    }

    private func lastCardText(_ vc: UIViewController, identifier: String) -> String? {
        guard let card = feedCards(vc).last(where: { $0.accessibilityIdentifier == identifier }) else {
            return nil
        }
        return primaryText(card)
    }

    private func suggestionText(_ vc: UIViewController) -> String? {
        (label(withIdentifier: "text-suggestion", in: vc.view))?.text
    }

    /// The primary (top) label of a card: the `text-*` label that is not the
    /// `-translation` secondary line.
    private func primaryText(_ card: UIView) -> String? {
        labels(in: card).first {
            let id = $0.accessibilityIdentifier ?? ""
            return id.hasPrefix("text-") && !id.hasSuffix("-translation")
        }?.text
    }

    private func secondaryText(_ card: UIView) -> String? {
        labels(in: card).first {
            ($0.accessibilityIdentifier ?? "").hasSuffix("-translation")
        }?.text
    }

    // MARK: View-hierarchy traversal

    private func descendants(of root: UIView) -> [UIView] {
        var result: [UIView] = []
        for sub in root.subviews {
            result.append(sub)
            result.append(contentsOf: descendants(of: sub))
        }
        return result
    }

    private func view(withIdentifier id: String, in root: UIView) -> UIView? {
        descendants(of: root).first { $0.accessibilityIdentifier == id }
    }

    private func views(withIdentifierPrefix prefix: String, in root: UIView) -> [UIView] {
        descendants(of: root).filter { ($0.accessibilityIdentifier ?? "").hasPrefix(prefix) }
    }

    private func label(withIdentifier id: String, in root: UIView) -> UILabel? {
        descendants(of: root).compactMap { $0 as? UILabel }.first { $0.accessibilityIdentifier == id }
    }

    private func labels(in root: UIView) -> [UILabel] {
        descendants(of: root).compactMap { $0 as? UILabel }
    }
}
