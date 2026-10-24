import XCTest
@testable import TalkHint

final class CallAudioDeviceRouterTests: XCTestCase {
    private final class Devices {
        var installed: [CallAudioDeviceRouter.Device] = []
        var standard: [Bool] = []
        var copilot: [Bool] = []
        var preparations = 0
        lazy var router = CallAudioDeviceRouter(
            install: { [unowned self] in self.installed.append($0) },
            enableStandard: { [unowned self] in self.standard.append($0) },
            enableCopilot: { [unowned self] in self.copilot.append($0) },
            prepareCopilot: { [unowned self] in self.preparations += 1 }
        )
    }

    func testOrdinaryCallsUseOnlyStandardDeviceAndWaitForCallKit() {
        let devices = Devices()
        XCTAssertTrue(devices.router.prepare(copilot: false, hasSessions: false, hasDisconnectingCalls: false))
        XCTAssertEqual(devices.installed, [.standard])
        XCTAssertEqual(devices.standard.last, false)
        XCTAssertTrue(devices.copilot.isEmpty)
        XCTAssertEqual(devices.preparations, 0)
        devices.router.setEnabled(true)
        XCTAssertEqual(devices.standard.last, true)
        XCTAssertTrue(devices.copilot.isEmpty)
    }

    func testCopilotKeepsItsCustomDeviceAndPrivatePreparation() {
        let devices = Devices()
        XCTAssertTrue(devices.router.prepare(copilot: true, hasSessions: false, hasDisconnectingCalls: false))
        XCTAssertEqual(devices.installed, [.copilot])
        XCTAssertEqual(devices.preparations, 1)
        XCTAssertEqual(devices.copilot.last, false)
        devices.router.setEnabled(true)
        XCTAssertEqual(devices.copilot.last, true)
        XCTAssertFalse(devices.standard.contains(true))
        devices.router.setEnabled(false)
        XCTAssertEqual(devices.copilot.last, false)
    }

    func testNeverSwapsDuringActiveOrDisconnectingCalls() {
        for disconnecting in [false, true] {
            let devices = Devices()
            XCTAssertFalse(devices.router.prepare(
                copilot: true, hasSessions: !disconnecting, hasDisconnectingCalls: disconnecting))
            XCTAssertTrue(devices.installed.isEmpty)
            XCTAssertTrue(devices.standard.isEmpty)
            XCTAssertTrue(devices.copilot.isEmpty)
            XCTAssertEqual(devices.preparations, 0)
        }
    }

    func testNextOrdinaryCallDoesNotInheritCopilotDevice() {
        let devices = Devices()
        devices.router.prepare(copilot: true, hasSessions: false, hasDisconnectingCalls: false)
        devices.router.setEnabled(true)
        devices.router.prepare(copilot: false, hasSessions: false, hasDisconnectingCalls: false)
        XCTAssertEqual(devices.installed, [.copilot, .standard])
        XCTAssertEqual(devices.copilot.last, false)
        XCTAssertEqual(devices.standard.last, false)
        devices.router.setEnabled(true)
        XCTAssertEqual(devices.standard.last, true)
        XCTAssertEqual(devices.copilot.last, false)
    }
}
