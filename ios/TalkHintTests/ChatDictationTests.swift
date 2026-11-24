import XCTest
import UIKit
import AVFoundation
import Speech
@testable import TalkHint

final class ChatDictationTests: XCTestCase {
    func testFallbackWavIsMono16kAndContainsAllCaptureBuffersWithoutMicrophone() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("offline-\(UUID()).wav")
        defer { try? FileManager.default.removeItem(at: url) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true // No recognition task / authorization / microphone.
        let sink = try DictationAudioSink(input: format, request: request, file: url)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800))
        buffer.frameLength = 4800
        let channel = try XCTUnwrap(buffer.floatChannelData?[0])
        for i in 0..<4800 { channel[i] = sin(Float(i) * 0.05) * 0.1 }
        for _ in 0..<10 { XCTAssertGreaterThan(sink.append(buffer), 0) }
        XCTAssertTrue(sink.finish())
        let file = try AVAudioFile(forReading: url)
        XCTAssertEqual(file.fileFormat.sampleRate, 16000)
        XCTAssertEqual(file.fileFormat.channelCount, 1)
        // Converter priming may retain a bounded tail, never most of the utterance.
        XCTAssertGreaterThan(file.length, 15000)
        XCTAssertLessThan(try Data(contentsOf: url).count, 100000)
    }
    func testPartialHypothesisReplacesOnlyCapturedSelectionWithoutSending() throws {
        var state = try recording("Позвони Тому завтра", selection: NSRange(location: 8, length: 4))
        XCTAssertEqual(state.preview(transcript: "Анне")?.text, "Позвони Анне завтра")
        XCTAssertEqual(state.preview(transcript: "Анне Ивановой")?.text, "Позвони Анне Ивановой завтра")
        XCTAssertEqual(state.phase, .recording)
        XCTAssertNil(state.attemptId)
        state.cancel()
        XCTAssertNil(state.preview(transcript: "late callback"))
    }
    func testPartialDoesNotChangeOriginalDraftOrAcceptFinalWithoutStop() throws {
        var state = try recording("draft")
        _ = state.preview(transcript: "partial")
        XCTAssertEqual(state.capture?.text, "draft")
        XCTAssertNil(state.finish(UUID(), context: context, transcript: "must not send"))
        let attempt = try XCTUnwrap(state.recognize())
        XCTAssertEqual(state.finish(attempt, context: context, transcript: "final")?.text, "draft final")
        XCTAssertEqual(state.phase, .idle)
    }
    private let context = ChatDictationState.Context(ownerId: "alice", conversationId: "chat", draftRevision: 7)

    private func recording(_ text: String = "", selection: NSRange? = nil) throws -> ChatDictationState {
        var state = ChatDictationState()
        let id = try XCTUnwrap(state.begin(context: context, text: text, selection: selection ?? NSRange(location: text.utf16.count, length: 0)))
        XCTAssertTrue(state.allow(id))
        return state
    }
    func testPermissionAndRecordingAreSingleFlight() throws {
        var state = ChatDictationState()
        let id = try XCTUnwrap(state.begin(context: context, text: "draft", selection: NSRange(location: 5, length: 0)))
        XCTAssertNil(state.begin(context: context, text: "other", selection: .init(location: 0, length: 0)))
        XCTAssertFalse(state.allow(UUID()))
        XCTAssertTrue(state.allow(id))
        XCTAssertFalse(state.allow(id))
        XCTAssertEqual(state.phase, .recording)
    }
    func testDeniedOrCancelledPermissionCannotStartLate() throws {
        var state = ChatDictationState()
        let id = try XCTUnwrap(state.begin(context: context, text: "", selection: .init(location: 0, length: 0)))
        state.cancel()
        XCTAssertFalse(state.allow(id))
        XCTAssertEqual(state.phase, .idle)
    }
    func testStopAndRetryCannotDuplicateActiveRecognition() throws {
        var state = try recording()
        XCTAssertNotNil(state.recognize())
        XCTAssertNil(state.recognize())
    }
    func testRecognitionOnlyProducesEditableTextNotSend() throws {
        var state = try recording()
        let attempt = try XCTUnwrap(state.recognize())
        XCTAssertEqual(state.finish(attempt, context: context, transcript: "  hello  ")?.text, "hello")
        XCTAssertEqual(state.phase, .idle)
        XCTAssertNil(state.finish(attempt, context: context, transcript: "duplicate"))
    }
    func testExistingDraftIsNotOverwritten() throws {
        var state = try recording("Keep this")
        let attempt = try XCTUnwrap(state.recognize())
        let result = try XCTUnwrap(state.finish(attempt, context: context, transcript: "and this"))
        XCTAssertEqual(result.text, "Keep this and this")
        XCTAssertEqual(result.caret, result.text.utf16.count)
    }
    func testSelectedTextAndUTF16AreHandled() throws {
        var state = try recording("🚚 old price", selection: NSRange(location: 3, length: 3))
        let attempt = try XCTUnwrap(state.recognize())
        XCTAssertEqual(state.finish(attempt, context: context, transcript: "new")?.text, "🚚 new price")
    }
    func testSilencePreservesCaptureAndRequiresExplicitRetry() throws {
        var state = try recording("Keep")
        let attempt = try XCTUnwrap(state.recognize())
        XCTAssertNil(state.finish(attempt, context: context, transcript: " \n "))
        XCTAssertEqual(state.phase, .failed)
        XCTAssertEqual(state.capture?.text, "Keep")
    }
    func testErrorDoesNotAutomaticallyRetry() throws {
        var state = try recording()
        let attempt = try XCTUnwrap(state.recognize())
        state.fail(attempt)
        XCTAssertEqual(state.phase, .failed)
        XCTAssertNil(state.attemptId)
        let retry = try XCTUnwrap(state.recognize())
        XCTAssertNotEqual(retry, attempt)
        XCTAssertFalse(state.accepts(attempt, context: context))
        XCTAssertTrue(state.accepts(retry, context: context))
    }
    func testCancelMakesLateNetworkResultInert() throws {
        var state = try recording()
        let attempt = try XCTUnwrap(state.recognize())
        state.cancel()
        XCTAssertNil(state.finish(attempt, context: context, transcript: "late"))
        XCTAssertNil(state.capture)
    }
    func testDifferentOwnerConversationOrDraftRevisionCannotReceiveResult() throws {
        var state = try recording()
        let attempt = try XCTUnwrap(state.recognize())
        for wrong in [
            ChatDictationState.Context(ownerId: "bob", conversationId: "chat", draftRevision: 7),
            .init(ownerId: "alice", conversationId: "other", draftRevision: 7),
            .init(ownerId: "alice", conversationId: "chat", draftRevision: 8)
        ] {
            XCTAssertNil(state.finish(attempt, context: wrong, transcript: "wrong"))
        }
        XCTAssertEqual(state.finish(attempt, context: context, transcript: "right")?.text, "right")
    }
    func testDraftAndAttachmentRestoreIsOwnerAndOriginScoped() throws {
        let suite = "chat-dictation-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let alice = ChatOutbox(owner: "alice", origin: "https://dev.invalid", defaults: defaults)
        let file = ChatAttachment(id: "f", name: "a.pdf", mimeType: "application/pdf", size: 4, status: "ready")
        alice.composerDrafts = ["chat": ChatComposerDraft(text: "draft", attachments: [file])]
        let restored = ChatOutbox(owner: "alice", origin: "https://dev.invalid", defaults: defaults)
        XCTAssertEqual(restored.composerDrafts["chat"]?.text, "draft")
        XCTAssertEqual(restored.composerDrafts["chat"]?.attachments, [file])
        XCTAssertTrue(ChatOutbox(owner: "bob", origin: "https://dev.invalid", defaults: defaults).composerDrafts.isEmpty)
        XCTAssertTrue(ChatOutbox(owner: "alice", origin: "https://prod.invalid", defaults: defaults).composerDrafts.isEmpty)
        alice.clear()
        XCTAssertTrue(alice.composerDrafts.isEmpty)
    }
    @MainActor
    func testBarCancelStopAndRetryAreSeparateWithoutAudio() {
        let bar = ChatDictationBar()
        var stops = 0, cancels = 0, retries = 0
        bar.onCancel = { cancels += 1 }; bar.onStop = { stops += 1 }; bar.onRetry = { retries += 1 }
        func buttons(_ view: UIView) -> [UIButton] {
            (view as? UIButton).map { [$0] } ?? view.subviews.flatMap { buttons($0) }
        }
        let controls = buttons(bar)
        bar.configure(mode: .recording)
        controls.first { $0.accessibilityLabel == NSLocalizedString("chat.dictation.stop", comment: "") }?.sendActions(for: .touchUpInside)
        bar.configure(mode: .recognizing)
        XCTAssertTrue(controls.filter { !$0.isHidden }.allSatisfy { $0.accessibilityLabel == NSLocalizedString("chat.dictation.cancel", comment: "") })
        bar.configure(mode: .failed)
        controls.first { $0.accessibilityLabel == NSLocalizedString("chat.dictation.retry", comment: "") }?.sendActions(for: .touchUpInside)
        controls.first { $0.accessibilityLabel == NSLocalizedString("chat.dictation.cancel", comment: "") }?.sendActions(for: .touchUpInside)
        XCTAssertEqual(stops, 1); XCTAssertEqual(cancels, 1); XCTAssertEqual(retries, 1)
        bar.update(level: 0); bar.update(level: 1); bar.update(level: .nan)
    }
    @MainActor
    func testOrbStaysDisabledAndComposerHasSeparateMicrophone() throws {
        let controller = ChatViewController()
        controller.loadViewIfNeeded() // no viewWillAppear, API call or microphone
        func buttons(_ view: UIView) -> [UIButton] {
            (view as? UIButton).map { [$0] } ?? view.subviews.flatMap { buttons($0) }
        }
        let controls = buttons(controller.view)
        let orb = try XCTUnwrap(controls.first { $0.accessibilityLabel == NSLocalizedString("chat.orb.unavailable", comment: "") })
        XCTAssertFalse(orb.isEnabled)
        XCTAssertTrue(orb.allTargets.isEmpty)
        XCTAssertNotNil(controls.first { $0.accessibilityLabel == NSLocalizedString("chat.voice", comment: "") })
    }
}
