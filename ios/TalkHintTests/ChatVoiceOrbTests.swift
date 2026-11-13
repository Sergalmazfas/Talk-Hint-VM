import XCTest
import SwiftUI
import UIKit
import QuartzCore
@testable import TalkHint

@MainActor
final class ChatVoiceOrbTests: XCTestCase {
    func testLevelRejectsInvalidSamples() {
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(.nan), 0)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(.infinity), 0)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(-1), 0)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(2), 1)
        XCTAssertEqual(ChatVoiceOrbView.boundedLevel(0.5), 0.5)
        XCTAssertTrue(ChatVoiceOrbView(phase: .listening, screenActive: true).active)
        XCTAssertFalse(ChatVoiceOrbView(phase: .listening, screenActive: false).active)
        XCTAssertTrue(ChatVoiceOrbView(phase: .listening, reduceMotionOverride: true,
                                      screenActive: true).effectiveReduceMotion)
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

    func testRenderAllStatesWithBothThemesAndFallback() throws {
        // A transparent control catches an accidentally opaque snapshot background.
        XCTAssertEqual(try renderedPixelCount(Color.clear, name: "transparent-control"), 0)
        for phase in ChatVoiceOrbView.Phase.allCases {
            for fallback in [false, true] {
                for dark in [false, true] {
                    let root = ChatVoiceOrbView(phase: phase, level: 0.5, forceFallback: fallback)
                        .environment(\.scenePhase, .active)
                        .preferredColorScheme(dark ? .dark : .light)
                    let name = "\(phase)-fallback-\(fallback)-dark-\(dark)"
                    XCTAssertGreaterThan(try renderedPixelCount(root, name: name), 1_000, name)
                }
            }
        }
    }

    func testReduceMotionRendersWithoutAudio() throws {
        XCTAssertNil(ChatVoiceOrbView(phase: .speaking).reduceMotionOverride)
        let fixture = ChatVoiceOrbView(phase: .speaking, level: 0.8, reduceMotionOverride: true)
        XCTAssertTrue(fixture.effectiveReduceMotion)
        XCTAssertFalse(ChatVoiceOrbView(phase: .speaking, reduceMotionOverride: false).effectiveReduceMotion)
        let root = fixture
            .environment(\.scenePhase, .active)
        XCTAssertEqual(try renderedPixelCount(Color.clear, name: "reduce-motion-control"), 0)
        XCTAssertGreaterThan(try renderedPixelCount(root, name: "reduce-motion"), 1_000)
    }

    /// Assert visible output, not SwiftUI's private UIKit subview implementation.
    /// A 320pt transparent fixture at 1x gives a stable, inspectable RGBA image.
    private func renderedPixelCount<Content: View>(_ root: Content, name: String) throws -> Int {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.first)
        let previousKeyWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 320)
        window.backgroundColor = .clear
        let host = UIHostingController(rootView: root)
        host.loadViewIfNeeded()
        host.view.backgroundColor = .clear
        window.rootViewController = host
        defer {
            window.isHidden = true
            window.rootViewController = nil
            previousKeyWindow?.makeKey()
        }
        window.makeKeyAndVisible()
        window.layoutIfNeeded()
        host.view.layoutIfNeeded()
        CATransaction.flush()

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        var rendered = false
        let image = UIGraphicsImageRenderer(size: host.view.bounds.size, format: format).image { _ in
            rendered = host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        XCTAssertTrue(rendered, "Snapshot failed: \(name)")
        let attachment = XCTAttachment(image: image)
        attachment.name = "orb-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)

        let cgImage = try XCTUnwrap(image.cgImage)
        let width = cgImage.width
        let height = cgImage.height
        XCTAssertEqual(width, 320)
        XCTAssertEqual(height, 320)
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        try rgba.withUnsafeMutableBytes { bytes in
            let context = try XCTUnwrap(CGContext(
                data: bytes.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue))
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        }
        // Ignore near-transparent antialiasing, not actual artwork.
        return stride(from: 3, to: rgba.count, by: 4).reduce(0) { count, index in
            count + (rgba[index] > 16 ? 1 : 0)
        }
    }
}
