import XCTest
import UIKit
@testable import TalkHint

@MainActor
final class PreparedHintPlansTests: XCTestCase {
    private func response(executor: String = "hint", expires: String = "2036-11-03T00:00:00.000Z") throws -> PreparedHintPlansResponse {
        let object: [String: Any] = [
            "serverTime": "2026-11-02T00:00:00.000Z",
            "plans": [[
                "id": "fixture", "planHash": "hash", "createdAt": "2026-11-02T00:00:00.000Z", "expiresAt": expires,
                "plan": ["goal": "Ask about tires", "ownerFacts": ["295/75 R22.5"], "sayAsk": ["Total price?"],
                         "expectedQuestions": [["q": "Size?", "answer": "295/75 R22.5"], ["q": "Arrival?", "answer": NSNull()]],
                         "unknowns": ["Arrival"], "disclosurePolicy": ["allowed": ["Size"], "forbidden": ["Payment"]],
                         "language": "en", "executor": executor, "targetPhone": "+12025550123"]
            ]]
        ]
        return try JSONDecoder().decode(PreparedHintPlansResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }
    private func labels(_ root: UIView) -> [UILabel] {
        (root as? UILabel).map { [$0] } ?? root.subviews.flatMap { labels($0) }
    }
    private func identifiers(_ root: UIView) -> [String] {
        [root.accessibilityIdentifier].compactMap { $0 } + root.subviews.flatMap { identifiers($0) }
    }

    func testDecodesCommonPlanAndUnknownAnswers() throws {
        let saved = try response().plans[0]
        XCTAssertNil(saved.plan.expectedQuestions[1].answer)
        XCTAssertEqual(saved.plan.disclosurePolicy.forbidden, ["Payment"])
        XCTAssertNotNil(saved.expiration)
    }
    func testAuthenticatedPreviewUsesGETAndNoBody() async throws {
        // Use the exact server envelope, not a synthesized model constructor.
        let body = Data("{\"plans\":[],\"serverTime\":\"2026-11-02T00:00:00.000Z\"}".utf8)
        var requests = 0
        let client = APIClient(transport: { req in
            requests += 1
            XCTAssertEqual(req.url?.path, "/api/prepare/hint-plans")
            XCTAssertEqual(req.httpMethod, "GET")
            XCTAssertNil(req.httpBody)
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-session")
            return (body, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "fixture-session" })
        let saved = try await client.preparedHintPlans()
        XCTAssertTrue(saved.plans.isEmpty)
        XCTAssertEqual(requests, 1)
    }
    func testMissingLoginDoesNotReadPlans() async {
        let client = APIClient(transport: { _ in
            XCTFail("Unauthenticated transport must never run")
            throw APIError.notAuthenticated
        }, tokenProvider: { nil })
        do { _ = try await client.preparedHintPlans(); XCTFail("Expected auth error") }
        catch APIError.notAuthenticated {} catch { XCTFail("Unexpected error") }
    }
    func testPreviewServiceFailureIsNotEmpty() async {
        let client = APIClient(transport: { req in
            (Data("{\"error\":\"Unavailable\"}".utf8),
             HTTPURLResponse(url: req.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!)
        }, tokenProvider: { "fixture-session" })
        do { _ = try await client.preparedHintPlans(); XCTFail("503 must not become an empty plan list") }
        catch APIError.http(let status, _) { XCTAssertEqual(status, 503) }
        catch { XCTFail("Unexpected error") }
    }
    func testPreviewDisplaysGoalNumberAnswersAndExpiry() throws {
        let view = PreparedHintPlansView()
        view.render(try response(), at: Date(timeIntervalSince1970: 1_790_000_000))
        let text = labels(view).compactMap(\.text).joined(separator: "\n")
        for value in ["Ask about tires", "+12025550123", "295/75 R22.5", "Total price?", "Arrival?"] {
            XCTAssertTrue(text.contains(value))
        }
        XCTAssertTrue(text.contains(NSLocalizedString("prepare.saved.unknown_answer", comment: "")))
        XCTAssertTrue(text.contains(NSLocalizedString("prepare.saved.expires", comment: "")))
    }
    func testExpiredAndNonHintPlansAreHidden() throws {
        let view = PreparedHintPlansView()
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        for saved in [try response(expires: "2020-01-01T00:00:00Z"),
                      try response(expires: "invalid"), try response(executor: "secretary")] {
            view.render(saved, at: now)
            XCTAssertFalse(identifiers(view).contains("prepare-saved-plan-fixture"))
            XCTAssertTrue(labels(view).contains { $0.text == NSLocalizedString("prepare.saved.empty", comment: "") })
        }
    }
    func testReadOnlyViewHasNoCallControls() throws {
        let view = PreparedHintPlansView()
        view.render(try response(), at: Date(timeIntervalSince1970: 1_790_000_000))
        let ids = identifiers(view)
        XCTAssertTrue(ids.contains("button-prepare-saved-refresh"))
        XCTAssertFalse(ids.contains { $0.contains("confirm") || $0.contains("dial") || $0.contains("start-call") })
    }
    func testRefreshFailureShowsErrorNotEmpty() async {
        let view = PreparedHintPlansView()
        view.loadPlans = { throw APIError.http(503, "Unavailable") }
        view.refresh()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(labels(view).contains { $0.text == NSLocalizedString("prepare.saved.error", comment: "") })
        view.stopLoading()
    }
    func testCancelledRefreshCannotRepopulatePlan() async throws {
        let view = PreparedHintPlansView()
        var continuation: CheckedContinuation<PreparedHintPlansResponse, Error>?
        view.loadPlans = { try await withCheckedThrowingContinuation { continuation = $0 } }
        view.refresh()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertNotNil(continuation)
        view.stopLoading()
        continuation?.resume(returning: try response())
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(identifiers(view).contains("prepare-saved-plan-fixture"))
    }

    // Offline render of the real production view, not an approximate mockup.
    // Hosted in a real UIWindow on the active scene (as SecretaryPersonalityUITests does)
    // so UIKit actually applies the requested appearance and Dynamic Type.
    private struct Fixture {
        let window: UIWindow
        let host: UIViewController
        let scroll: UIScrollView
        let plans: PreparedHintPlansView
        let traits: UITraitCollection
    }
    private var fixtureWindows: [UIWindow] = []
    private var previousKeyWindow: UIWindow?

    override func tearDown() async throws {
        for window in fixtureWindows {
            window.isHidden = true
            window.rootViewController = nil
        }
        fixtureWindows = []
        previousKeyWindow?.makeKey()
        previousKeyWindow = nil
        try await super.tearDown()
    }

    private func fixture(style: UIUserInterfaceStyle, largeType: Bool = false,
                         configure: (PreparedHintPlansView) -> Void) throws -> Fixture {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive })
        if previousKeyWindow == nil { previousKeyWindow = scene.windows.first { $0.isKeyWindow } }
        let traits = UITraitCollection(traitsFrom: [
            UITraitCollection(userInterfaceStyle: style),
            UITraitCollection(preferredContentSizeCategory: largeType ? .accessibilityExtraExtraExtraLarge : .large)
        ])
        let host = UIViewController()
        host.overrideUserInterfaceStyle = style
        host.view.backgroundColor = .systemBackground
        let child = UIViewController()
        host.addChild(child)
        host.view.addSubview(child.view)
        child.didMove(toParent: host)
        host.setOverrideTraitCollection(traits, forChild: child)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 568)
        window.overrideUserInterfaceStyle = style
        window.rootViewController = host
        window.makeKeyAndVisible()
        fixtureWindows.append(window)
        child.view.frame = host.view.bounds
        child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let scroll = UIScrollView(frame: child.view.bounds)
        scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        child.view.addSubview(scroll)
        var plans: PreparedHintPlansView!
        traits.performAsCurrent {
            plans = PreparedHintPlansView()
            // Even an accidental refresh must never use APIClient/production.
            plans.loadPlans = { throw APIError.http(503, "offline fixture") }
            configure(plans)
        }
        plans.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(plans)
        NSLayoutConstraint.activate([
            plans.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16),
            plans.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            plans.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
            plans.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            plans.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32)
        ])
        window.layoutIfNeeded()
        host.view.layoutIfNeeded()
        scroll.layoutIfNeeded()
        // The real view must have received the requested traits, not just the fixture request.
        XCTAssertTrue(plans.window === window)
        XCTAssertEqual(plans.traitCollection.userInterfaceStyle, style)
        XCTAssertEqual(plans.traitCollection.preferredContentSizeCategory, traits.preferredContentSizeCategory)
        return Fixture(window: window, host: host, scroll: scroll, plans: plans, traits: traits)
    }
    @discardableResult
    private func attach(_ fixture: Fixture, name: String) -> UIImage {
        fixture.window.layoutIfNeeded()
        fixture.host.view.layoutIfNeeded()
        var image = UIImage()
        fixture.traits.performAsCurrent {
            image = UIGraphicsImageRenderer(bounds: fixture.host.view.bounds).image {
                fixture.host.view.layer.render(in: $0.cgContext)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        return image
    }
    /// Relative luminance (0 black ... 1 white) of one rendered pixel, read from the image itself.
    private func luminance(_ image: UIImage, at point: CGPoint) throws -> CGFloat {
        let cg = try XCTUnwrap(image.cgImage)
        let x = Int(point.x * image.scale), y = Int(point.y * image.scale)
        var pixel = [UInt8](repeating: 0, count: 4)
        try pixel.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(
                data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(cg, in: CGRect(x: -x, y: y - cg.height + 1, width: cg.width, height: cg.height))
        }
        return (0.2126 * CGFloat(pixel[0]) + 0.7152 * CGFloat(pixel[1]) + 0.0722 * CGFloat(pixel[2])) / 255
    }
    private func assertRenderedBackground(_ image: UIImage, style: UIUserInterfaceStyle, name: String) throws {
        // Top-left margin is the host's systemBackground, outside the plan card.
        let background = try luminance(image, at: CGPoint(x: 4, y: 4))
        if style == .dark {
            XCTAssertLessThan(background, 0.2, "Dark frame \(name) must actually render a dark background")
        } else {
            XCTAssertGreaterThan(background, 0.8, "Light frame \(name) must actually render a light background")
        }
    }
    private func checkSavedFixture(largeType: Bool) throws {
        let saved = try response()
        for style in [UIUserInterfaceStyle.light, .dark] {
            let screen = try fixture(style: style, largeType: largeType) {
                $0.render(saved, at: Date(timeIntervalSince1970: 1_790_000_000))
            }
            let name = "\(style == .dark ? "dark" : "light")-\(largeType ? "large-type" : "normal")"
            XCTAssertFalse(screen.plans.hasAmbiguousLayout)
            for label in labels(screen.plans) where !(label.text ?? "").isEmpty {
                XCTAssertGreaterThan(label.bounds.width, 0)
                XCTAssertGreaterThan(label.bounds.height, 0)
                let needed = label.sizeThatFits(CGSize(width: label.bounds.width, height: .greatestFiniteMagnitude))
                XCTAssertGreaterThanOrEqual(label.bounds.height + 1, needed.height, "Clipped text in \(name)")
            }
            if largeType {
                XCTAssertTrue(labels(screen.plans).contains { $0.font.pointSize > 30 },
                              "Fixture must actually apply accessibility Dynamic Type")
            }
            let top = attach(screen, name: "Prepare-\(name)-top")
            try assertRenderedBackground(top, style: style, name: "\(name)-top")
            XCTAssertGreaterThan(screen.scroll.contentSize.height, screen.scroll.bounds.height)
            screen.scroll.setContentOffset(CGPoint(x: 0, y: screen.scroll.contentSize.height - screen.scroll.bounds.height),
                                           animated: false)
            screen.host.view.layoutIfNeeded()
            let last = try XCTUnwrap(labels(screen.plans).last)
            let bottom = last.convert(last.bounds, to: screen.host.view).maxY
            XCTAssertLessThanOrEqual(bottom, screen.host.view.bounds.maxY + 1)
            XCTAssertGreaterThan(bottom, 0, "End of plan must be reachable")
            attach(screen, name: "Prepare-\(name)-bottom")
            screen.plans.stopLoading()
        }
    }
    func testVisualFixturesSavedPlanCompactLightAndDark() throws {
        try checkSavedFixture(largeType: false)
    }
    func testVisualFixturesLargeTypeReachesLastField() throws {
        try checkSavedFixture(largeType: true)
    }
    func testVisualFixturesLoadingEmptyAndError() async throws {
        let screen = try fixture(style: .light) { $0.refresh() }
        defer { screen.plans.stopLoading() }
        XCTAssertTrue(labels(screen.plans).contains { $0.text == NSLocalizedString("prepare.saved.loading", comment: "") })
        attach(screen, name: "Prepare-loading")
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(labels(screen.plans).contains { $0.text == NSLocalizedString("prepare.saved.error", comment: "") })
        attach(screen, name: "Prepare-error")
        screen.plans.render(PreparedHintPlansResponse(plans: [], serverTime: "2026-11-02T00:00:00.000Z"), at: Date())
        XCTAssertTrue(labels(screen.plans).contains { $0.text == NSLocalizedString("prepare.saved.empty", comment: "") })
        attach(screen, name: "Prepare-empty")
    }
}
