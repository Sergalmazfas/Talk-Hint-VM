import Foundation
import CoreLocation

struct ChatPhoneContext: Codable, Equatable {
    struct Location: Codable, Equatable {
        let latitude: Double
        let longitude: Double
        let accuracyMeters: Double
        let capturedAt: String
        let label: String?
    }
    let localTime: String
    let timeZone: String
    let location: Location?
}

/// Value-only boundary between a CoreLocation delegate callback and the main actor.
/// Do not transfer a CLLocationManager, CLLocation or Error object in that task.
struct ChatPhoneLocationFix: Sendable {
    let latitude: Double
    let longitude: Double
    let altitude: Double
    let horizontalAccuracy: Double
    let verticalAccuracy: Double
    let course: Double
    let speed: Double
    let timestamp: TimeInterval

    init(_ location: CLLocation) {
        latitude = location.coordinate.latitude
        longitude = location.coordinate.longitude
        altitude = location.altitude
        horizontalAccuracy = location.horizontalAccuracy
        verticalAccuracy = location.verticalAccuracy
        course = location.course
        speed = location.speed
        timestamp = location.timestamp.timeIntervalSince1970
    }

    var location: CLLocation {
        CLLocation(coordinate: .init(latitude: latitude, longitude: longitude),
                   altitude: altitude, horizontalAccuracy: horizontalAccuracy,
                   verticalAccuracy: verticalAccuracy, course: course, speed: speed,
                   timestamp: Date(timeIntervalSince1970: timestamp))
    }
}

/// Foreground only. No tracking, no per-send permission popup after denial.
@MainActor
final class ChatPhoneContextCollector: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<ChatPhoneContext, Never>?
    private var deadline: Task<Void, Never>?
    private let geocoder = CLGeocoder()
    private var capturedLocation: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    static func isRelevant(_ text: String) -> Bool {
        let value = text.lowercased()
        return ["near", "route", "buy", "book", "shop", "where", "today", "tomorrow", "price",
                "рядом", "маршрут", "куп", "запис", "най", "где", "сегодня", "завтра", "цен",
                "шины", "запчаст", "стол", "час", "время", "hour", "minute", "when", "fontaine", "earthlite", "i-44", "cerca", "ruta",
                "compr", "reserv", "hoy", "mañana", "поруч", "call", "позвон"]
            .contains(where: value.contains)
    }

    func collect() async -> ChatPhoneContext {
        guard pending == nil else { return context(nil) }
        capturedLocation = nil
        return await withCheckedContinuation { continuation in
            pending = continuation
            deadline = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { return }
                guard let self else { return }
                self.finish(self.capturedLocation)
            }
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
            default: finish(nil)
            }
        }
    }
    private func context(_ location: CLLocation?, label: String? = nil) -> ChatPhoneContext {
        let position = location.flatMap { point -> ChatPhoneContext.Location? in
            guard point.horizontalAccuracy >= 0, point.horizontalAccuracy <= 10000,
                  abs(point.timestamp.timeIntervalSinceNow) <= 120 else { return nil }
            return .init(latitude: point.coordinate.latitude, longitude: point.coordinate.longitude,
                         accuracyMeters: point.horizontalAccuracy,
                         capturedAt: ISO8601DateFormatter().string(from: point.timestamp), label: label)
        }
        return .init(localTime: ISO8601DateFormatter().string(from: Date()),
                     timeZone: TimeZone.current.identifier, location: position)
    }
    private func finish(_ location: CLLocation?, label: String? = nil) {
        guard let continuation = pending else { return }
        pending = nil
        deadline?.cancel()
        deadline = nil
        geocoder.cancelGeocode()
        continuation.resume(returning: context(location, label: label))
    }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.authorizationChanged() }
    }
    private func authorizationChanged() {
        guard pending != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        case .denied, .restricted: finish(nil)
        default: break
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fix = locations.last.map(ChatPhoneLocationFix.init)
        Task { @MainActor [weak self] in self?.receivedLocation(fix) }
    }
    private func receivedLocation(_ fix: ChatPhoneLocationFix?) {
        guard let location = fix?.location, pending != nil else { finish(nil); return }
        capturedLocation = location
        Task {
            let place = (try? await geocoder.reverseGeocodeLocation(location))?.first
            let label = [place?.locality, place?.administrativeArea].compactMap { $0 }.joined(separator: ", ")
            finish(location, label: label.isEmpty ? nil : label)
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in self?.finish(nil) }
    }
}
