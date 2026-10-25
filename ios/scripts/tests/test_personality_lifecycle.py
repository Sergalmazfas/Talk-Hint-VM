"""Source guards only; these do not execute UIKit or replace native XCTest."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


def body(source, signature):
    tail = source.split(signature, 1)[1]
    start = tail.index("{")
    depth = 1
    for index in range(start + 1, len(tail)):
        depth += (tail[index] == "{") - (tail[index] == "}")
        if depth == 0:
            return tail[start + 1:index]
    raise AssertionError("Unclosed function: " + signature)


class PersonalityLifecycleGuards(unittest.TestCase):
    def setUp(self):
        self.screen = (ROOT / "TalkHint/UI/SecretaryPersonalityViewController.swift").read_text()
        self.picker = (ROOT / "TalkHint/UI/SecretaryPersonalityPickerViewController.swift").read_text()
        self.tests = (ROOT / "TalkHintTests/SecretaryPersonalityUITests.swift").read_text()

    def test_leaving_both_controllers_invalidates_requests_and_drain_is_available(self):
        for source in (self.screen, self.picker):
            self.assertIn("cancelPendingOperations()", body(source, "override func viewWillDisappear"))
            cancel = body(source, "func cancelPendingOperations()")
            self.assertIn("suspended = true", cancel)
            self.assertIn("$0.cancel()", cancel)
            drain = body(source, "func finishPendingOperations()")
            self.assertIn("cancelPendingOperations()", drain)
            self.assertIn("await task.value", drain)

    def test_save_checks_epoch_owner_origin_and_cancellation_before_shared_writes(self):
        current = body(self.screen, "private func isCurrent(")
        for check in ("!Task.isCancelled", "!suspended", "epoch == generation",
                      "SessionStore.shared.userId == owner", "AppConfig.baseURL.absoluteString == origin"):
            self.assertIn(check, current)
        save = body(self.screen, "private func save()")
        self.assertLess(save.index("guard self.isCurrent(epoch)"),
                        save.index("SessionStore.shared.pendingSecretaryCall"))
        self.assertIn("guard self.isCurrent(epoch)", save.split("} catch {", 1)[1])

    def test_alerts_require_attached_visible_controllers(self):
        for source, signature in ((self.screen, "private func showPendingNotice()"),
                                  (self.picker, "private func show(")):
            show = body(source, signature)
            for check in ("appeared", "viewIfLoaded?.window != nil",
                          "topViewController === self", "presentedViewController == nil"):
                self.assertLess(show.index(check), show.index("present(alert"))

    def test_teardown_cancels_then_releases_then_drains_before_restoring_preferences(self):
        teardown = body(self.tests, "override func tearDown()")
        cancel = teardown.index(".cancelPendingOperations()")
        release = teardown.index("await gate.release()")
        drain = teardown.index("await screen.finishPendingOperations()")
        restore = teardown.index("SessionStore.shared.clear()")
        self.assertLess(cancel, release)
        self.assertLess(release, drain)
        self.assertLess(drain, restore)

    def test_window_dismissal_and_save_wait_for_real_transitions(self):
        self.assertIn("UIWindow(windowScene: scene)", self.tests)
        dismiss = body(self.tests, "private func dismissAlert()")
        self.assertIn("presented.presentingViewController", dismiss)
        self.assertIn("presenter.dismiss(animated: false)", dismiss)
        self.assertIn("presenter.presentedViewController == nil", dismiss)
        save = body(self.tests, "private func save(_ screen:")
        self.assertIn("writes == before + 1", save)
        self.assertIn("Date().addingTimeInterval(4)", self.tests)

    def test_timeout_reports_callsite_and_sanitized_fixture_requests(self):
        wait = body(self.tests, "private func waitUntil(")
        for check in ("file: file, line: line", "fixtureRequests=", ".httpMethod", ".url?.path"):
            self.assertIn(check, wait)
        for private in ("httpBody", "Authorization", "token"):
            self.assertNotIn(private, wait)

    def test_return_readback_requires_new_request_and_completed_ui_not_only_old_cells(self):
        test = body(self.tests, "func testReturnAfterInterruptedSaveReadsSameLineWithoutAnotherPUT()")
        self.assertLess(test.index("let readsBeforeReturn"), test.index("nav.popViewController"))
        self.assertIn("reads > readsBeforeReturn", test)
        self.assertIn('self.cell(screen, 5).textLabel?.text == NSLocalizedString("secretary.personality.save"', test)
        self.assertIn('XCTAssertEqual(requests.filter { $0.httpMethod == "PUT" }.count, 1)', test)

    def test_interrupted_save_observes_departure_before_release_and_drain(self):
        test = body(self.tests, "func testReturnAfterInterruptedSaveReadsSameLineWithoutAnotherPUT()")
        push = test.index("nav.pushViewController(away, animated: false)")
        departure = test.index("screen.viewIfLoaded?.window == nil", push)
        release = test.index("await gate.release()", push)
        drain = test.index("await screen.finishPendingOperations()", push)
        pop = test.index("nav.popViewController(animated: false)", push)
        self.assertLess(departure, release)
        self.assertLess(release, drain)
        self.assertLess(drain, pop)
        self.assertIn("self.nav.topViewController === screen", test[:push])
        self.assertIn("self.nav.transitionCoordinator == nil", test[:push])
        self.assertIn("self.nav.topViewController === away", test[push:release])
        self.assertIn("away.viewIfLoaded?.window === self.window", test[push:release])
        self.assertIn("self.nav.transitionCoordinator == nil", test[push:release])
        self.assertIn("screen.viewIfLoaded?.window === self.window", test[pop:])


    def test_provider_selection_waits_for_settings_and_sheet_appearance(self):
        test = body(self.tests, "func testGPTAndRetellSelectionOnlyChangesFutureDrafts()")
        pop = test.index("nav.popToRootViewController(animated: false)")
        select = test.index("select(settings, 3, 0)")
        dismiss = test.index("try await dismissAlert()")
        returned = test[pop:select]
        for check in ("self.nav.topViewController === self.settings",
                      "self.settings.viewIfLoaded?.window === self.window",
                      "screen.viewIfLoaded?.window == nil",
                      "self.nav.transitionCoordinator == nil"):
            self.assertIn(check, returned)
        appearance = test[select:dismiss]
        for check in ("let presenter = sheet.presentingViewController",
                      "(presenter === self.settings || presenter === self.nav)",
                      "presenter.presentedViewController === sheet",
                      "presenter.viewIfLoaded?.window === self.window",
                      "sheet.viewIfLoaded?.window === self.window",
                      "!sheet.isBeingPresented", "!sheet.isBeingDismissed",
                      "sheet.transitionCoordinator == nil",
                      "presenter.transitionCoordinator == nil",
                      "self.settings.transitionCoordinator == nil"):
            self.assertIn(check, appearance)
        self.assertNotIn("sheet.presentingViewController === self.settings", appearance)
        # Preserve the behavioral assertions, not just the sheet interaction.
        self.assertIn("XCTAssertEqual(changed.clientRequestId, pending.clientRequestId)", test)
        self.assertIn('XCTAssertEqual(stored.numberId, "work-line")', test)


if __name__ == "__main__":
    unittest.main()
