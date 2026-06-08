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

    /// Drives the controller through its real `CallHintStreamDelegate` across the
    /// full recovery lifecycle — connect → disconnect(retry) → terminal — and
    /// asserts the reconnect spinner animates only during the transient retry
    /// state, the status label surfaces the escalating "attempt N of M" progress
    /// while retrying, and the manual retry button stays hidden until the socket
    /// finally gives up. This covers the view-controller wiring that the pure
    /// `reconnectingStatusText` unit tests cannot reach.
    func testReconnectIndicatorAcrossFullRetryCycle() {
        let vc = makeLoadedViewController()
        let stream = CallHintStream()

        // Baseline: nothing in flight, so the spinner is stopped and the manual
        // retry affordance is hidden.
        XCTAssertFalse(reconnectSpinner(vc).isAnimating,
                       "spinner must be stopped before any disconnect")
        XCTAssertTrue(retryButton(vc).isHidden,
                      "retry button must be hidden before terminal failure")

        // Connected: still no spinner, still no retry button.
        vc.callHintStreamDidConnect(stream)
        XCTAssertFalse(reconnectSpinner(vc).isAnimating,
                       "spinner must not animate in the connected state")
        XCTAssertTrue(retryButton(vc).isHidden,
                      "retry button must stay hidden while connected")
        XCTAssertEqual(statusText(vc), "Live assistant connected")

        // First retry: spinner spins, status names attempt 1 of 5, retry hidden.
        vc.callHintStream(stream, didDisconnectWillRetryAttempt: 1, of: 5)
        XCTAssertTrue(reconnectSpinner(vc).isAnimating,
                      "spinner must animate during a reconnect attempt")
        XCTAssertTrue(retryButton(vc).isHidden,
                      "retry button must stay hidden mid-retry")
        let firstStatus = statusText(vc) ?? ""
        XCTAssertTrue(firstStatus.contains("1"), "status should name attempt 1")
        XCTAssertTrue(firstStatus.contains("5"), "status should name the ceiling")
        XCTAssertTrue(firstStatus.lowercased().contains("attempt"),
                      "status should mention the attempt count")

        // Later retry: spinner keeps spinning, status advances to attempt 2,
        // retry still hidden, and the wording changes (never frozen).
        vc.callHintStream(stream, didDisconnectWillRetryAttempt: 2, of: 5)
        XCTAssertTrue(reconnectSpinner(vc).isAnimating,
                      "spinner must keep animating across successive retries")
        XCTAssertTrue(retryButton(vc).isHidden,
                      "retry button must stay hidden across successive retries")
        let secondStatus = statusText(vc) ?? ""
        XCTAssertTrue(secondStatus.contains("2"), "status should advance to attempt 2")
        XCTAssertNotEqual(firstStatus, secondStatus,
                          "status must change between retries so it never looks frozen")

        // Terminal: socket gave up — spinner stops, retry button appears, and the
        // status reflects the unavailable state.
        vc.callHintStreamDidFailTerminally(stream)
        XCTAssertFalse(reconnectSpinner(vc).isAnimating,
                       "spinner must stop once recovery has terminally failed")
        XCTAssertFalse(retryButton(vc).isHidden,
                       "retry button must appear in the terminal state")
        XCTAssertEqual(statusText(vc), "Live assistant unavailable. Check your connection.")

        // Recovery after a manual retry: a fresh connect re-hides the retry button
        // and stops the spinner, returning to the steady connected state.
        vc.callHintStreamDidConnect(stream)
        XCTAssertFalse(reconnectSpinner(vc).isAnimating,
                       "spinner must be stopped again after reconnecting")
        XCTAssertTrue(retryButton(vc).isHidden,
                      "retry button must hide again after a successful reconnect")
        XCTAssertEqual(statusText(vc), "Live assistant connected")
    }

    /// Drives the controller into the terminal "gave up" state and then taps the
    /// real "Reconnect" button, asserting the manual recovery path actually
    /// re-arms the live stream — not just relabels the status. Without this, a
    /// regression in `retryTapped` (e.g. dropping the `stream.retry()` call, or
    /// not re-hiding the button) would strand users on the terminal screen with
    /// no way back, undetected by the delegate-driven lifecycle test above.
    func testManualReconnectButtonReArmsStreamAfterTerminalFailure() {
        // A signed-in user: the live socket can authenticate, so a manual retry
        // genuinely re-opens the stream. (The signed-out case is covered by
        // `testNoTokenReconnectSurfacesSignInState`.)
        SessionStore.shared.save(token: "test-token", userId: "u1", email: "u1@example.com")
        defer { SessionStore.shared.clear() }

        let vc = makeLoadedViewController()
        // Drive the controller's *own* stream — the same instance the Reconnect
        // button calls `retry()` on — so the assertion exercises the real path.
        let stream = vc.hintStream

        // Reproduce the post-terminal state: the failure path leaves the stream
        // inactive (give-up resets `isActive`), and the controller has shown the
        // terminal UI via the delegate callback.
        stream.disconnect()
        XCTAssertFalse(stream.isActive,
                       "precondition: a terminally failed stream is no longer active")
        vc.callHintStreamDidFailTerminally(stream)
        XCTAssertFalse(retryButton(vc).isHidden,
                       "retry button must be visible in the terminal state")
        XCTAssertEqual(statusText(vc), "Live assistant unavailable. Check your connection.")

        // Tap the actual button so the production target/action wiring runs.
        retryButton(vc).sendActions(for: .touchUpInside)

        // The button hides again and the status returns to the reconnecting copy.
        XCTAssertTrue(retryButton(vc).isHidden,
                      "retry button must hide again once a manual reconnect starts")
        XCTAssertEqual(statusText(vc), "Reconnecting to live assistant…",
                       "status must update to the reconnecting wording on manual retry")

        // The decisive assertion: `stream.retry()` actually re-armed the stream
        // (connect() ran rather than no-opping), so the manual button genuinely
        // reconnects the live assistant instead of only changing the label.
        XCTAssertTrue(stream.isActive,
                      "manual retry must re-open the live stream, not just relabel the status")
    }

    /// The silent-failure case the manual-reconnect test above cannot cover: when
    /// the user is signed out (no session token), tapping "Reconnect" must NOT
    /// leave the stream stuck "active" behind a frozen "Reconnecting…" label.
    /// Instead `openSocket()` must stop the stream (`isActive == false`) and the
    /// controller must surface an actionable "sign in" message with the retry
    /// button still available — not spin forever with no recovery.
    func testNoTokenReconnectSurfacesSignInState() {
        // Ensure the signed-out precondition regardless of prior test state.
        SessionStore.shared.clear()
        XCTAssertNil(SessionStore.shared.token,
                     "precondition: no session token (signed out)")

        let vc = makeLoadedViewController()
        let stream = vc.hintStream

        // viewDidLoad already called connect(); with no token the stream must have
        // immediately stopped rather than staying active and retrying forever.
        XCTAssertFalse(stream.isActive,
                       "a signed-out connect must not leave the stream active")

        // Tap the real "Reconnect" button so the production retryTapped → retry()
        // → connect() → openSocket() path runs end to end.
        retryButton(vc).sendActions(for: .touchUpInside)

        // The stream must stop again synchronously inside openSocket — never left
        // active behind the "Reconnecting…" label that retryTapped set.
        XCTAssertFalse(stream.isActive,
                       "a signed-out manual retry must stop the stream, not strand it active")

        // The sign-in delegate hops to the main queue, so pump the run loop before
        // asserting the surfaced UI.
        pumpMainQueue()

        XCTAssertEqual(statusText(vc), "Sign in to use the live assistant",
                       "signed-out retry must show an actionable sign-in message")
        XCTAssertFalse(retryButton(vc).isHidden,
                       "the retry button must stay available after a signed-out retry")
        XCTAssertFalse(reconnectSpinner(vc).isAnimating,
                       "the reconnect spinner must not spin in the signed-out state")
    }

    /// In the signed-out state the retry button must become an actionable "Sign
    /// in" affordance (not a plain "Reconnect"), and tapping it must route the
    /// user to the login screen — closing the loop so they can actually recover
    /// the live assistant. A later successful connect must restore the button to
    /// its normal "Reconnect" role. Without this, a regression in the label/route
    /// wiring would leave the user tapping "Reconnect" into the same failure.
    func testSignedOutStateRoutesRetryButtonToLogin() {
        SessionStore.shared.clear()
        defer { SessionStore.shared.clear() }

        let vc = makeLoadedViewController()
        // A real window so `present(_:animated:)` has somewhere to attach.
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = vc
        window.makeKeyAndVisible()
        let stream = vc.hintStream

        vc.callHintStreamDidRequireSignIn(stream)
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Sign in",
                       "signed-out state must relabel the button as a sign-in action")
        XCTAssertFalse(retryButton(vc).isHidden,
                       "the sign-in button must be visible when signed out")

        // Tapping must present the login screen rather than re-trying the socket.
        retryButton(vc).sendActions(for: .touchUpInside)
        let presented = expectation(description: "login presented")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { presented.fulfill() }
        wait(for: [presented], timeout: 2.0)
        let nav = vc.presentedViewController as? UINavigationController
        XCTAssertTrue(nav?.viewControllers.first is LoginViewController,
                      "tapping the sign-in button must route to the login screen")

        // A subsequent successful connect restores the plain "Reconnect" role.
        vc.callHintStreamDidConnect(stream)
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Reconnect",
                       "a successful connect must restore the normal reconnect label")
    }

    /// The session-expiry path: when the live `/ui` socket drops because the
    /// session is no longer valid, `CallHintStream.handleDisconnect` fires
    /// `callHintStreamDidRequireSignIn` (rather than the terminal give-up). This
    /// drives the controller through that exact delegate callback and asserts it
    /// surfaces the *sign-in* affordance — an actionable status, a visible "Sign
    /// in" button, no spinner — and specifically NOT the misleading "connection
    /// lost" terminal copy. To make the distinction unambiguous, the controller is
    /// first put into the terminal "connection lost" state, then the auth-rejected
    /// disconnect must flip it over. Without this, a regression that routed an
    /// expired session into the terminal path (or left a stale "Reconnect" label)
    /// would strand the user with no way back into the live assistant.
    func testAuthRejectedDisconnectFlipsToSignInNotConnectionLost() {
        let vc = makeLoadedViewController()
        let stream = vc.hintStream

        // Establish the contrast: drive the controller into the terminal
        // "connection lost" state first, so we can prove the sign-in callback
        // actually replaces it rather than coincidentally matching.
        vc.callHintStreamDidFailTerminally(stream)
        XCTAssertEqual(statusText(vc), "Live assistant unavailable. Check your connection.",
                       "precondition: controller is in the terminal connection-lost state")
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Reconnect",
                       "precondition: terminal state offers a plain reconnect")

        // The auth-rejection branch of handleDisconnect fires this callback.
        vc.callHintStreamDidRequireSignIn(stream)

        // The status must switch to the actionable sign-in message — never the
        // "connection lost" terminal copy that would imply a transient network blip.
        XCTAssertEqual(statusText(vc), "Sign in to use the live assistant",
                       "an auth-rejected disconnect must surface the sign-in message")
        XCTAssertNotEqual(statusText(vc), "Live assistant unavailable. Check your connection.",
                          "the sign-in state must not read as the connection-lost terminal state")

        // The retry affordance becomes an actionable, visible "Sign in" button and
        // the reconnect spinner is stopped (we are not mid-retry).
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Sign in",
                       "the retry button must relabel to a sign-in action")
        XCTAssertFalse(retryButton(vc).isHidden,
                       "the sign-in button must stay visible so the user can recover")
        XCTAssertFalse(reconnectSpinner(vc).isAnimating,
                       "the reconnect spinner must not spin in the sign-in state")
    }

    /// The recovery path Task #63 wired up but left untested: after the in-call
    /// screen drops into the sign-in state, the user taps "Sign in", logs in
    /// successfully, and `resumeAfterSignIn` must re-arm the live assistant. This
    /// drives the real flow end to end — require-sign-in → tap "Sign in" → present
    /// login → fire `LoginViewController.onLoggedIn` (with a freshly saved session,
    /// as the real login does) → dismiss → resume — and asserts the stream is
    /// genuinely re-armed (`isActive == true`), the login screen is gone, and the
    /// retry button returns to its hidden "Reconnect" role with a reconnecting/
    /// connected status. Without this, a regression in `presentSignIn`/
    /// `resumeAfterSignIn` would strand users on the sign-in prompt even after a
    /// successful login.
    func testSignInSuccessReArmsStreamAndRestoresReconnect() {
        SessionStore.shared.clear()
        defer { SessionStore.shared.clear() }

        let vc = makeLoadedViewController()
        // A real window so `present`/`dismiss` have somewhere to attach.
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = vc
        window.makeKeyAndVisible()
        let stream = vc.hintStream

        // Session expired mid-call: surface the actionable sign-in affordance.
        vc.callHintStreamDidRequireSignIn(stream)
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Sign in",
                       "precondition: the retry button is in its sign-in role")
        XCTAssertFalse(stream.isActive,
                       "precondition: a signed-out stream is not active")

        // Tap "Sign in" → the login screen is presented over the call.
        retryButton(vc).sendActions(for: .touchUpInside)
        waitForMainQueue(seconds: 0.4)
        guard let nav = vc.presentedViewController as? UINavigationController,
              let login = nav.viewControllers.first as? LoginViewController else {
            return XCTFail("tapping sign-in must present the login screen")
        }

        // Simulate a successful login exactly as `LoginViewController` does: persist
        // the new session first, then fire its `onLoggedIn` completion.
        SessionStore.shared.save(token: "test-token", userId: "u1", email: "u1@example.com")
        login.onLoggedIn?()

        // `onLoggedIn` dismisses the login screen and, on the dismiss completion,
        // calls `resumeAfterSignIn` (which re-arms the stream) — pump the run loop
        // long enough for the dismiss animation + completion to run.
        waitForMainQueue(seconds: 0.6)

        XCTAssertTrue(stream.isActive,
                      "a successful sign-in must re-arm the live stream")
        XCTAssertNil(vc.presentedViewController,
                     "the login screen must be dismissed after a successful sign-in")
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Reconnect",
                       "the retry button must return to its plain reconnect role")
        XCTAssertTrue(retryButton(vc).isHidden,
                      "the retry button must hide once recovery is underway")
        let status = statusText(vc) ?? ""
        XCTAssertTrue(status == "Reconnecting to live assistant…"
                        || status == "Live assistant connected",
                      "status must reflect reconnecting/connected after sign-in, got: \(status)")
    }

    /// The cancel branch of the same recovery flow: if the user opens the login
    /// screen from the in-call sign-in prompt but cancels instead of logging in,
    /// the controller must leave the sign-in prompt exactly as it was — button
    /// still labeled "Sign in" and visible, status still asking them to sign in,
    /// and the stream NOT re-armed — so they can simply try again. A regression
    /// that cleared the sign-in state on cancel would strand them with no way back.
    func testSignInCancelLeavesSignInPromptInPlace() {
        SessionStore.shared.clear()
        defer { SessionStore.shared.clear() }

        let vc = makeLoadedViewController()
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = vc
        window.makeKeyAndVisible()
        let stream = vc.hintStream

        vc.callHintStreamDidRequireSignIn(stream)
        retryButton(vc).sendActions(for: .touchUpInside)
        waitForMainQueue(seconds: 0.4)
        guard let nav = vc.presentedViewController as? UINavigationController,
              let cancelItem = nav.viewControllers.first?.navigationItem.leftBarButtonItem else {
            return XCTFail("tapping sign-in must present a login screen with a cancel button")
        }

        // Tap the real cancel bar-button (its production target/action) so the
        // dismiss-without-login path runs end to end.
        _ = cancelItem.target?.perform(cancelItem.action, with: cancelItem)
        waitForMainQueue(seconds: 0.6)

        XCTAssertNil(vc.presentedViewController,
                     "cancelling must dismiss the login screen")
        XCTAssertFalse(stream.isActive,
                       "cancelling sign-in must not re-arm the live stream")
        XCTAssertEqual(retryButton(vc).title(for: .normal), "Sign in",
                       "cancelling must leave the sign-in affordance in place")
        XCTAssertFalse(retryButton(vc).isHidden,
                       "the sign-in button must stay visible after cancel so the user can retry")
        XCTAssertEqual(statusText(vc), "Sign in to use the live assistant",
                       "status must still prompt the user to sign in after cancel")
    }

    // MARK: - Helpers

    /// Runs the main run loop for a fixed interval so presentation/dismissal
    /// animations and their completion handlers (e.g. `resumeAfterSignIn` on the
    /// dismiss completion) finish before assertions.
    private func waitForMainQueue(seconds: TimeInterval) {
        let expectation = expectation(description: "wait \(seconds)s")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { expectation.fulfill() }
        wait(for: [expectation], timeout: seconds + 1.0)
    }

    /// Runs the main run loop briefly so `DispatchQueue.main.async` delegate
    /// callbacks (e.g. the sign-in notification) are delivered before assertions.
    private func pumpMainQueue() {
        let expectation = expectation(description: "drain main queue")
        DispatchQueue.main.async { expectation.fulfill() }
        wait(for: [expectation], timeout: 1.0)
    }

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

    private func statusText(_ vc: UIViewController) -> String? {
        (label(withIdentifier: "text-incall-status", in: vc.view))?.text
    }

    private func reconnectSpinner(_ vc: UIViewController) -> UIActivityIndicatorView {
        guard let spinner = descendants(of: vc.view)
            .compactMap({ $0 as? UIActivityIndicatorView })
            .first(where: { $0.accessibilityIdentifier == "spinner-incall-reconnect" }) else {
            XCTFail("reconnect spinner not found in hierarchy")
            return UIActivityIndicatorView()
        }
        return spinner
    }

    private func retryButton(_ vc: UIViewController) -> UIButton {
        guard let button = descendants(of: vc.view)
            .compactMap({ $0 as? UIButton })
            .first(where: { $0.accessibilityIdentifier == "button-incall-retry" }) else {
            XCTFail("retry button not found in hierarchy")
            return UIButton()
        }
        return button
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
