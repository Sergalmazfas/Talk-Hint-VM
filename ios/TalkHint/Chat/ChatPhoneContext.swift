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
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard pending != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        case .denied, .restricted: finish(nil)
        default: break
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, pending != nil else { finish(nil); return }
        capturedLocation = location
        Task {
            let place = (try? await geocoder.reverseGeocodeLocation(location))?.first
            let label = [place?.locality, place?.administrativeArea].compactMap { $0 }.joined(separator: ", ")
            finish(location, label: label.isEmpty ? nil : label)
        }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(nil) }
}
