import Foundation

/// Transport and text never imply successful audio rendering.
struct SecretaryMonitorState {
    private(set) var connected = false
    private(set) var received = false
    private(set) var played = false
    mutating func connect() { connected = true }
    mutating func receiveAudio() { received = true }
    mutating func renderAudio() { if received { played = true } }
    mutating func resetAudio() { received = false; played = false }
    mutating func reset() { self = SecretaryMonitorState() }
    var statusKey: String {
        if played { return "secretary.live.audio_playing" }
        if received { return "secretary.live.audio_receiving" }
        if connected { return "secretary.live.transcript_only" }
        return "secretary.live.connecting"
    }
}
