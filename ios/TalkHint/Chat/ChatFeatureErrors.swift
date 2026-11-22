import Foundation

enum ChatFeatureErrors {
    enum Feature: Equatable { case speech, tables }
    static func key(_ error: Error, feature: Feature) -> String {
        if error is URLError { return "chat.feature.error.network" }
        guard case let APIError.http(status, code) = error else {
            return feature == .speech ? "chat.read.error.failed" : "chat.tables.error.failed"
        }
        if status == 401 || status == 403 { return "chat.feature.error.auth" }
        switch feature {
        case .speech:
            if ["AUDIO_BUSY", "READ_ALOUD_BUSY"].contains(code) { return "chat.read.error.busy" }
            if status == 429 { return "chat.read.error.limit" }
            if status == 503 { return "chat.read.error.unavailable" }
            return "chat.read.error.failed"
        case .tables:
            if ["TABLE_STALE_READ_AGAIN", "TABLE_REQUEST_CONFLICT"].contains(code) { return "chat.tables.error.stale" }
            if ["TABLE_HIDDEN", "TABLE_PURGED", "TABLE_NOT_FOUND"].contains(code) { return "chat.tables.error.hidden" }
            if status == 202 || code == "TABLE_EXPORT_NOT_READY" { return "chat.tables.error.pending" }
            if status == 503 { return "chat.tables.error.unavailable" }
            return "chat.tables.error.failed"
        }
    }
    static func message(_ error: Error, feature: Feature, bundle: Bundle = .main) -> String {
        bundle.localizedString(forKey: key(error, feature: feature), value: nil, table: nil)
    }
}
