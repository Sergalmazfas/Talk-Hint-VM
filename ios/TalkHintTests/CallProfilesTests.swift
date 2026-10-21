import XCTest
import UIKit
@testable import TalkHint

final class CallProfilesTests: XCTestCase {
    func testCardProfileIsAQueryAndNotAnEncodedPath() throws {
        for scope in CallProfileScope.allCases {
            let url = try APIClient.requestURL("/api/cards", queryItems: [
                URLQueryItem(name: "profile", value: scope.rawValue)
            ])
            XCTAssertEqual(url.path, "/api/cards")
            XCTAssertEqual(url.scheme, "https")
            XCTAssertFalse(url.absoluteString.contains("%3F"))
            let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
            XCTAssertEqual(query.count, 1)
            XCTAssertEqual(query.first?.name, "profile")
            XCTAssertEqual(query.first?.value, scope.rawValue)
        }
    }

    func testNonQueryPathsKeepTheirExistingDestination() throws {
        for path in ["/api/call-profiles", "/api/call-profiles/work-number", "/api/cards"] {
            let url = try APIClient.requestURL(path)
            XCTAssertEqual(url.path, path)
            XCTAssertNil(url.query)
        }
        XCTAssertThrowsError(try APIClient.requestURL("/api/cards?profile=work"))
    }

    private let fixture = """
    {
      "profiles": [
        {"id":"personal","numbers":[{"id":"p","phoneNumber":"+15550000001","name":"Personal","type":"personal"}],"secretaryOutboundReady":true},
        {"id":"work","numbers":[],"secretaryOutboundReady":false}
      ],
      "recommendedWorkNumber":{"id":"candidate","phoneNumber":"+15550000002","available":true,"existingBindingMove":true},
      "incomingAiEnabled":false,"calendarConnected":false
    }
    """

    func testDecodesBackendProfileContractWithoutPretendingCDLIsConnected() throws {
        let result = try JSONDecoder().decode(CallProfilesSnapshot.self, from: Data(fixture.utf8))
        XCTAssertEqual(result.profile(.personal)?.numbers.first?.phoneNumber, "+15550000001")
        XCTAssertEqual(result.profile(.work)?.numbers.count, 0)
        XCTAssertEqual(result.recommendedWorkNumber.existingBindingMove, true)
        XCTAssertFalse(result.incomingAiEnabled)
        XCTAssertFalse(result.calendarConnected)
        XCTAssertEqual(result.profile(.work)?.secretaryOutboundReady, false)
    }

    func testDecodesOlderOptionalMoveFlagButRejectsUnknownScope() throws {
        let old = fixture.replacingOccurrences(of: ",\"existingBindingMove\":true", with: "")
        let result = try JSONDecoder().decode(CallProfilesSnapshot.self, from: Data(old.utf8))
        XCTAssertNil(result.recommendedWorkNumber.existingBindingMove)
        let invalid = fixture.replacingOccurrences(of: "\"id\":\"work\"", with: "\"id\":\"unknown\"")
        XCTAssertThrowsError(try JSONDecoder().decode(CallProfilesSnapshot.self, from: Data(invalid.utf8)))
    }

    @MainActor func testSettingsExposeWorkNumberAndProfileCards() {
        let settings = SettingsViewController()
        settings.loadViewIfNeeded()
        let section = settings.numberOfSections(in: settings.tableView) - 2
        XCTAssertEqual(settings.tableView(settings.tableView, numberOfRowsInSection: section), 3)
        let work = settings.tableView(settings.tableView, cellForRowAt: IndexPath(row: 1, section: section))
        let cards = settings.tableView(settings.tableView, cellForRowAt: IndexPath(row: 2, section: section))
        XCTAssertEqual(work.accessibilityIdentifier, "cell-work-number")
        XCTAssertEqual(cards.accessibilityIdentifier, "cell-call-profiles")
    }

    @MainActor func testAllCardScopesAreReachableWithoutConnectingANumber() {
        let screen = CallProfilesViewController()
        screen.loadViewIfNeeded()
        XCTAssertEqual(screen.numberOfSections(in: screen.tableView), 3)
        for (section, scope) in CallProfileScope.allCases.enumerated() {
            let row = scope == .shared ? 0 : 1
            let cell = screen.tableView(screen.tableView, cellForRowAt: IndexPath(row: row, section: section))
            XCTAssertEqual(cell.accessibilityIdentifier, "profile-cards-\(scope.rawValue)")
        }
    }
}
