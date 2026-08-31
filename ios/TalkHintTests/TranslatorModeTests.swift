import XCTest
import AVFoundation
@testable import TalkHint

/// Simulator-level contract checks for the standalone translator path.
/// Run on macOS with:
/// xcodebuild test -scheme TalkHint \
///   -destination 'platform=iOS Simulator,name=iPhone 15'
final class TranslatorModeTests: XCTestCase {
    func testTranslatorUsesItsOwnAuthenticatedWebSocketPath() throws {
        let base = try XCTUnwrap(URL(string: "wss://example.test/root"))
        let url = try XCTUnwrap(TranslatorStream.websocketURL(baseURL: base, token: "session token"))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertEqual(components.path, "/root/translator")
        XCTAssertEqual(components.queryItems?.first?.name, "token")
        XCTAssertEqual(components.queryItems?.first?.value, "session token")
        XCTAssertNotEqual(components.path, "/ui")
    }

    func testTranslatorDecodesBothTranscriptAndAudioEvents() throws {
        guard case .sourceTranscript(let source)? =
                TranslatorStream.decode(#"{"type":"source_transcript","text":"Привет"}"#) else {
            return XCTFail("Expected source transcript")
        }
        XCTAssertEqual(source, "Привет")

        guard case .translatedTranscriptDone(let translated)? =
                TranslatorStream.decode(#"{"type":"translated_transcript_done","text":"Hello"}"#) else {
            return XCTFail("Expected translated transcript")
        }
        XCTAssertEqual(translated, "Hello")

        guard case .audio(let audio)? =
                TranslatorStream.decode(#"{"type":"audio","data":"AQI="}"#) else {
            return XCTFail("Expected translated audio")
        }
        XCTAssertEqual(audio, Data([1, 2]))
    }

    func testMicrophoneAudioIsDownsampledToPCM16Mono24k() throws {
        let format = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 48_000,
            channels: 1,
            interleaved: false
        ))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 480))
        buffer.frameLength = 480
        let samples = try XCTUnwrap(buffer.floatChannelData?[0])
        for index in 0..<480 {
            samples[index] = 0.5
        }

        let output = try XCTUnwrap(TranslatorViewController.makePCM16Mono24k(buffer: buffer))
        XCTAssertEqual(output.count, 240 * MemoryLayout<Int16>.size)
        var first: Int16 = 0
        withUnsafeMutableBytes(of: &first) { destination in
            output.copyBytes(to: destination, count: MemoryLayout<Int16>.size)
        }
        XCTAssertEqual(Int(first), Int(Float(Int16.max) * 0.5), accuracy: 1)
    }
}