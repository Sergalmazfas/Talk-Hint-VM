"""Static privacy/compatibility guards; native XCTest and device consent remain separate."""
import plistlib
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "ios/TalkHint"


class ChatDeviceAgendaContracts(unittest.TestCase):
    def setUp(self):
        self.store = (APP / "Chat/ChatDeviceAgendaStore.swift").read_text()
        self.ui = (APP / "Chat/ChatDeviceAgendaViewController.swift").read_text()
        self.editor = (APP / "Chat/ChatReminderEditor.swift").read_text()
        self.chat = (APP / "Chat/ChatViewController.swift").read_text()

    def test_os_permissions_are_separate_and_ios15_is_preserved(self):
        for text in ("#available(iOS 17.0", "requestFullAccessToEvents",
                     "requestFullAccessToReminders", "requestAccess(to:",
                     "kind == .calendar ? .event : .reminder"):
            self.assertIn(text, self.store)
        self.assertIn("guard access(kind) == .allowed", self.store)
        self.assertIn("lazy var eventStore = EKEventStore()", self.store)
        reload = self.ui.split("@objc private func reload()", 1)[1].split("override func numberOfSections", 1)[0]
        self.assertNotIn("requestAccess(", reload)
        self.assertIn("guard isViewLoaded, active", reload)

    def test_store_has_no_server_or_model_transport(self):
        for text in ("URLSession", "URLRequest", "JSONEncoder", "print(", "NSLog(",
                     "APIClient.", "chatSend", "OpenAI", "Google"):
            self.assertNotIn(text, self.store)
        self.assertIn("Calendar.current.startOfDay(for: day)", self.store)
        self.assertIn("value: 1", self.store)
        self.assertIn("displayedEvents[key] = event", self.store)
        self.assertIn("guard let rows else", self.store)

    def test_every_write_checks_access_and_calendar_and_uses_existing_default(self):
        save = self.store.split("func saveReminder(_ draft:", 2)[2].split("func deleteReminder", 1)[0]
        self.assertIn("guard access(.reminders) == .allowed", save)
        self.assertIn("guard !title.isEmpty", save)
        self.assertIn("allowsContentModifications", save)
        self.assertIn("defaultCalendarForNewReminders()", save)
        self.assertIn("eventStore.save(row, commit: true)", save)
        delete = self.store.split("func deleteReminder(_ id:", 2)[2]
        self.assertIn("try storedReminder(id)", delete)
        self.assertIn("allowsContentModifications", delete)
        self.assertNotIn("EKCalendar(for:", self.store)
        new = self.store.split("func newEvent(on", 1)[1].split("private func storedReminder", 1)[0]
        self.assertNotIn("eventStore.save", new)

    def test_editor_cancel_and_open_are_not_writes_and_save_is_single_flight(self):
        cancel = self.editor.split("@objc private func cancel()", 1)[1].split("@objc private func save()", 1)[0]
        self.assertNotIn("saveReminder", cancel)
        self.assertNotIn("deleteReminder", cancel)
        self.assertIn("guard !finishing", self.editor)
        self.assertIn("guard !draft.title.isEmpty", self.editor)
        self.assertIn("style: .destructive", self.editor)
        self.assertIn("validOwner()", self.editor)
        self.assertIn("completion: onSaved", self.editor)

    def test_existing_assignments_use_only_existing_read_api_and_report(self):
        self.assertIn("self.api.secretaryTasks()", self.ui)
        self.assertIn("SecretaryTaskDetailViewController(task:", self.ui)
        for text in ("createSecretaryTask", "startSecretary", "hangupSecretary", "confirmChatPlan",
                     "chatMessages", "saveChat", "JSONSerialization", 'method: "POST"'):
            self.assertNotIn(text, self.ui)
        self.assertIn("agenda.assignments.error", self.ui)
        self.assertIn("agenda-assignments-retry", self.ui)

    def test_account_and_late_callback_guards_hide_revoked_data(self):
        self.assertIn("guard validOwner() else { clearForInvalidOwner(); return }", self.ui)
        self.assertIn("self.validOwner(), self.revision == version", self.ui)
        self.assertIn("Task.isCancelled", self.ui)
        self.assertIn("private func clearForInvalidOwner()", self.ui)
        self.assertIn("rows = []", self.ui)
        self.assertIn("assignments = []", self.ui)
        self.assertIn("UIApplication.didBecomeActiveNotification", self.ui)

    def test_native_event_editor_is_used_without_an_implicit_save(self):
        self.assertIn("EKEventEditViewController()", self.ui)
        self.assertIn("editor.eventStore = real.eventStore", self.ui)
        self.assertIn("EKEventViewController()", self.ui)
        self.assertIn("viewer.allowsEditing = false", self.ui)
        self.assertNotIn("eventStore.save", self.ui)

    def test_agata_menu_requires_confirmation_then_existing_gates(self):
        entry = self.chat.split("func showAgataMenuConfirmation()", 1)[1].split("private func openDeviceAgenda", 1)[0]
        self.assertIn("UIAlertController", entry)
        self.assertIn('NSLocalizedString("agenda.agata.start"', entry)
        self.assertIn("style: .cancel", entry)
        self.assertIn("alert?.dismiss(animated: true)", entry)
        self.assertIn("self?.openVoiceMode()", entry)
        self.assertNotIn("ChatAgataViewController(", entry)
        self.assertIn("agata.isEnabled = Self.voiceClientEnabled && capabilities?.voiceMode?.available == true", self.chat)
        self.assertIn("unavailableGroup.addArrangedSubview(agata)", self.chat)

    def test_legacy_and_modern_usage_descriptions_exist_in_all_languages(self):
        info = plistlib.loads((APP / "Info.plist").read_bytes())
        keys = ("NSCalendarsUsageDescription", "NSCalendarsFullAccessUsageDescription",
                "NSRemindersUsageDescription", "NSRemindersFullAccessUsageDescription")
        for key in keys:
            self.assertTrue(info[key])
        for lang in ("en", "ru", "es", "kk", "uk"):
            strings = (APP / f"Resources/{lang}.lproj/InfoPlist.strings").read_text()
            for key in keys:
                self.assertEqual(len(re.findall(r'"' + key + r'"\s*=', strings)), 1)

    def test_all_new_native_tests_are_registered_and_fake_only(self):
        native = (ROOT / "ios/TalkHintTests/ChatDeviceAgendaTests.swift").read_text()
        registry = (ROOT / "ios/scripts/verify-xcresult.py").read_text()
        names = re.findall(r"func (test\w+)\(", native)
        self.assertEqual(len(names), 12)
        for name in names:
            self.assertIn('"' + name + '"', registry)
        self.assertIn("ChatDeviceAgendaProviding", native)
        self.assertNotIn("EKEventStore()", native)
        self.assertIn("request.httpBody", native)

    def test_settings_capture_establishes_light_theme_before_push(self):
        native = (ROOT / "ios/TalkHintTests/ChatNavigationTests.swift").read_text()
        capture = native.split("func testSettingsFullWidthLabelsAndLightDarkSnapshots()", 1)[1].split("private func snapshot(", 1)[0]
        self.assertLess(capture.index("window?.overrideUserInterfaceStyle = .light"),
                        capture.index('button("chat-settings"'))
        self.assertIn("1_500_000_000", capture)
