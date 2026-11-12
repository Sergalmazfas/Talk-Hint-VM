import XCTest
import SwiftUI
import UIKit
@testable import TalkHint

@MainActor
final class ChatVoiceOrbTests: XCTestCase {
    func testLevelRejectsInvalidSamples() {
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(.nan), 0)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(.infinity), 0)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(-1), 0)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(2), 1)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(0.5), 0.5)
    }

    func testAudioScaleUsesOnlyListeningAndSpeaking() {
        for phase in [ChatVoiceOrbView.Phase.listening, .speaking] {
            XCTAssertEqual(ChatVoiceOrbView.scale(phase: phase, level: 0), 0.92, accuracy: 0.001)
            XCTAssertEqual(ChatVoiceOrbView.scale(phase: phase, level: 1), 1, accuracy: 0.001)
        }
        for phase in [ChatVoiceOrbView.Phase.idle, .thinking, .unavailable] {
            XCTAssertEqual(ChatVoiceOrbView.scale(phase: phase, level: 1), 0.92, accuracy: 0.001)
        }
    }

    func testRenderAllStatesWithBothThemesAndFallback() {
        for phase in ChatVoiceOrbView.Phase.allCases {
            for fallback in [false, true] {
                for dark in [false, true] {
                    let root = ChatVoiceOrbView(phase: phase, level: 0.5, forceFallback: fallback)
                        .environment(\.scenePhase, .active)
                        .preferredColorScheme(dark ? .dark : .light)
                    let host = UIHostingController(rootView: root)
                    host.loadViewIfNeeded()
                    host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 320)
                    host.view.layoutIfNeeded()
                    XCTAssertFalse(host.view.subviews.isEmpty)
                }
            }
        }
    }

    func testReduceMotionRendersWithoutAudio() {
        XCTAssertNil(ChatVoiceOrbView(phase: .speaking).reduceMotionOverride)
        let fixture = ChatVoiceOrbView(phase: .speaking, level: 0.8, reduceMotionOverride: true)
        XCTAssertTrue(fixture.effectiveReduceMotion)
        XCTAssertFalse(ChatVoiceOrbView(phase: .speaking, reduceMotionOverride: false).effectiveReduceMotion)
        let root = fixture
            .environment(\.scenePhase, .active)
        let host = UIHostingController(rootView: root)
        host.loadViewIfNeeded()
        host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 320)
        host.view.layoutIfNeeded()
        XCTAssertFalse(host.view.subviews.isEmpty)
    }
}
