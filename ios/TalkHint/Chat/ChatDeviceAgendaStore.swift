import EventKit
import Foundation

enum ChatAgendaKind: Equatable { case calendar, reminders }
enum ChatAgendaAccess: Equatable { case notRequested, allowed, denied, restricted }

struct ChatAgendaItem: Equatable {
    let id: String
    let title: String
    let date: Date?
    let subtitle: String
    let completed: Bool
    let editable: Bool
}

enum ChatAgendaError: LocalizedError {
    case unavailable, noCalendar, missing, titleRequired, readFailed
    var errorDescription: String? {
        let key: String
        switch self {
        case .unavailable: key = "agenda.access.denied"
        case .noCalendar: key = "agenda.noWritableCalendar"
        case .missing: key = "agenda.missing"
        case .titleRequired: key = "agenda.titleRequired"
        case .readFailed: key = "agenda.error"
        }
        return NSLocalizedString(key, comment: "")
    }
}

/// Device data never passes through APIClient, chat messages, or a model.
@MainActor
protocol ChatDeviceAgendaProviding: AnyObject {
    func access(_ kind: ChatAgendaKind) -> ChatAgendaAccess
    func requestAccess(_ kind: ChatAgendaKind) async throws -> Bool
    func items(_ kind: ChatAgendaKind, on day: Date) async throws -> [ChatAgendaItem]
    func reminder(_ id: String) throws -> ChatReminderDraft
    func saveReminder(_ draft: ChatReminderDraft) throws
    func deleteReminder(_ id: String) throws
}

struct ChatReminderDraft {
    var id: String?
    var title: String
    var due: Date?
    var completed: Bool
    var dueEdited = false
}

@MainActor
final class ChatDeviceAgendaStore: ChatDeviceAgendaProviding {
    // Lazy: opening a chat or the menu does not even construct an EventKit store.
    lazy var eventStore = EKEventStore()
    private var displayedEvents: [String: EKEvent] = [:]

    func access(_ kind: ChatAgendaKind) -> ChatAgendaAccess {
        let status = EKEventStore.authorizationStatus(for: kind == .calendar ? .event : .reminder)
        if #available(iOS 17.0, *), status == .fullAccess { return .allowed }
        if #unavailable(iOS 17.0), status == .authorized { return .allowed }
        if status == .restricted { return .restricted }
        if status == .denied { return .denied }
        // iOS 17 write-only is insufficient for this read/write screen.
        return .notRequested
    }

    func requestAccess(_ kind: ChatAgendaKind) async throws -> Bool {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
            let done: (Bool, Error?) -> Void = { allowed, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: allowed) }
            }
            if #available(iOS 17.0, *) {
                if kind == .calendar { eventStore.requestFullAccessToEvents(completion: done) }
                else { eventStore.requestFullAccessToReminders(completion: done) }
            } else {
                eventStore.requestAccess(to: kind == .calendar ? .event : .reminder, completion: done)
            }
        }
    }

    func items(_ kind: ChatAgendaKind, on day: Date) async throws -> [ChatAgendaItem] {
        guard access(kind) == .allowed else { throw ChatAgendaError.unavailable }
        if kind == .calendar {
            let start = Calendar.current.startOfDay(for: day)
            guard let end = Calendar.current.date(byAdding: .day, value: 1, to: start) else {
                throw ChatAgendaError.readFailed
            }
            let events = eventStore.events(matching: eventStore.predicateForEvents(
                withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }
            displayedEvents.removeAll()
            return events.map { event in
                // Keep the exact occurrence, not just the series identifier.
                let key = UUID().uuidString
                displayedEvents[key] = event
                return ChatAgendaItem(id: key, title: event.title ?? "", date: event.startDate,
                    subtitle: [event.calendar.title, event.isAllDay ? NSLocalizedString("agenda.allDay", comment: "") : event.location]
                        .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                    completed: false, editable: event.calendar.allowsContentModifications)
            }
        }
        let reminders: [EKReminder] = try await withCheckedThrowingContinuation { continuation in
            eventStore.fetchReminders(matching: eventStore.predicateForReminders(in: nil)) { rows in
                guard let rows else { continuation.resume(throwing: ChatAgendaError.readFailed); return }
                continuation.resume(returning: rows)
            }
        }
        try Task.checkCancellation()
        return reminders.map { reminder in
            ChatAgendaItem(id: reminder.calendarItemIdentifier, title: reminder.title ?? "",
                date: Self.dueDate(reminder.dueDateComponents),
                subtitle: reminder.calendar.title, completed: reminder.isCompleted,
                editable: reminder.calendar.allowsContentModifications)
        }.sorted {
            if $0.completed != $1.completed { return !$0.completed }
            return ($0.date ?? .distantFuture) < ($1.date ?? .distantFuture)
        }
    }

    func event(_ id: String) throws -> EKEvent {
        guard access(.calendar) == .allowed else { throw ChatAgendaError.unavailable }
        guard let event = displayedEvents[id] else { throw ChatAgendaError.missing }
        return event
    }

    func newEvent(on day: Date) throws -> EKEvent {
        guard access(.calendar) == .allowed else { throw ChatAgendaError.unavailable }
        guard let calendar = eventStore.defaultCalendarForNewEvents,
              calendar.allowsContentModifications else { throw ChatAgendaError.noCalendar }
        let event = EKEvent(eventStore: eventStore)
        event.calendar = calendar
        let start = Calendar.current.isDateInToday(day) ? Date() : Calendar.current.startOfDay(for: day)
        event.startDate = start
        event.endDate = start.addingTimeInterval(3600)
        return event // Not saved: native editor requires the user's Save action.
    }

    private func storedReminder(_ id: String) throws -> EKReminder {
        guard access(.reminders) == .allowed else { throw ChatAgendaError.unavailable }
        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw ChatAgendaError.missing
        }
        return reminder
    }
    func reminder(_ id: String) throws -> ChatReminderDraft {
        let row = try storedReminder(id)
        guard row.calendar.allowsContentModifications else { throw ChatAgendaError.unavailable }
        return ChatReminderDraft(id: id, title: row.title ?? "", due: Self.dueDate(row.dueDateComponents),
                                 completed: row.isCompleted)
    }
    static func dueDate(_ components: DateComponents?) -> Date? {
        guard let components else { return nil }
        return (components.calendar ?? Calendar.current).date(from: components)
    }
    func saveReminder(_ draft: ChatReminderDraft) throws {
        guard access(.reminders) == .allowed else { throw ChatAgendaError.unavailable }
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw ChatAgendaError.titleRequired }
        let row: EKReminder
        if let id = draft.id { row = try storedReminder(id) }
        else {
            guard let calendar = eventStore.defaultCalendarForNewReminders(),
                  calendar.allowsContentModifications else { throw ChatAgendaError.noCalendar }
            row = EKReminder(eventStore: eventStore)
            row.calendar = calendar
        }
        guard row.calendar.allowsContentModifications else { throw ChatAgendaError.unavailable }
        row.title = title
        if row.isCompleted != draft.completed { row.isCompleted = draft.completed }
        // Editing a title must not silently turn an all-day due date into a
        // timed midnight reminder, or reset its original calendar/time zone.
        if draft.id == nil || draft.dueEdited {
            if let due = draft.due {
                var components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
                components.calendar = Calendar.current
                components.timeZone = .current
                row.dueDateComponents = components
            } else { row.dueDateComponents = nil }
        }
        try eventStore.save(row, commit: true)
    }
    func deleteReminder(_ id: String) throws {
        let row = try storedReminder(id)
        guard row.calendar.allowsContentModifications else { throw ChatAgendaError.unavailable }
        try eventStore.remove(row, commit: true)
    }
}
