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


if __name__ == "__main__":
    unittest.main()
