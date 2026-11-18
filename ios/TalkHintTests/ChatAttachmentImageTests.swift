import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
@testable import TalkHint

final class ChatAttachmentImageTests: XCTestCase {
    @MainActor
    private func image(_ size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.black.setFill()
            context.fill(CGRect(x: 10, y: 10, width: 100, height: 50))
        }
    }

    private func properties(_ data: Data) throws -> [CFString: Any] {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, UTType.jpeg.identifier)
        return try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    }

    @MainActor
    func testCameraBecomesJPEGAtMost2000PixelsAndTwoMiB() throws {
        let data = try ChatAttachmentImageEncoding.prepare(cameraImage: image(CGSize(width: 4000, height: 3000)))
        XCTAssertLessThanOrEqual(data.count, 2 * 1024 * 1024)
        let p = try properties(data)
        XCTAssertEqual(p[kCGImagePropertyPixelWidth] as? Int, 2000)
        XCTAssertEqual(p[kCGImagePropertyPixelHeight] as? Int, 1500)
        XCTAssertNil(p[kCGImagePropertyGPSDictionary])
    }

    @MainActor
    func testCameraOrientationIsBakedIntoPixels() throws {
        let raw = try XCTUnwrap(image(CGSize(width: 4000, height: 3000)).cgImage)
        let rotated = UIImage(cgImage: raw, scale: 1, orientation: .right)
        let p = try properties(ChatAttachmentImageEncoding.prepare(cameraImage: rotated))
        XCTAssertEqual(p[kCGImagePropertyPixelWidth] as? Int, 1500)
        XCTAssertEqual(p[kCGImagePropertyPixelHeight] as? Int, 2000)
        XCTAssertEqual(p[kCGImagePropertyOrientation] as? Int, 1)
    }

    @MainActor
    func testSmallImageIsNotUpscaled() throws {
        let p = try properties(ChatAttachmentImageEncoding.prepare(cameraImage: image(CGSize(width: 80, height: 60))))
        XCTAssertEqual(p[kCGImagePropertyPixelWidth] as? Int, 80)
        XCTAssertEqual(p[kCGImagePropertyPixelHeight] as? Int, 60)
    }

    @MainActor
    func testImpossibleByteLimitReturnsErrorNeverOriginalBytes() throws {
        XCTAssertThrowsError(try ChatAttachmentImageEncoding.prepare(
            cameraImage: image(CGSize(width: 80, height: 60)), maxBytes: 1)) {
            XCTAssertEqual($0 as? ChatAttachmentImageError, .tooLarge)
        }
    }

    func testInvalidPhotoFileReturnsReadableError() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".heic")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("not an image".utf8).write(to: url)
        XCTAssertThrowsError(try ChatAttachmentImageEncoding.prepare(fileURL: url)) {
            XCTAssertEqual($0 as? ChatAttachmentImageError, .invalid)
            XCTAssertNotEqual($0.localizedDescription, "chat.image.invalid")
        }
    }

    @MainActor
    func testPhotoDownsamplesAndDropsLocationAndCameraMetadata() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
        defer { try? FileManager.default.removeItem(at: url) }
        let destination = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
        let raw = try XCTUnwrap(image(CGSize(width: 3000, height: 4000)).cgImage)
        CGImageDestinationAddImage(destination, raw, [
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 1.0, kCGImagePropertyGPSLatitudeRef: "N"],
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFMake: "SyntheticCamera"]
        ] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let data = try ChatAttachmentImageEncoding.prepare(fileURL: url)
        let p = try properties(data)
        XCTAssertLessThanOrEqual(data.count, ChatAttachmentImageEncoding.maximumBytes)
        XCTAssertEqual(p[kCGImagePropertyPixelWidth] as? Int, 1500)
        XCTAssertEqual(p[kCGImagePropertyPixelHeight] as? Int, 2000)
        XCTAssertNil(p[kCGImagePropertyGPSDictionary])
        XCTAssertNil((p[kCGImagePropertyTIFFDictionary] as? [CFString: Any])?[kCGImagePropertyTIFFMake])
    }

    @MainActor
    func testHEICPhotoIsConvertedToJPEGWithOrientation() throws {
        guard (CGImageDestinationCopyTypeIdentifiers() as! [String]).contains(UTType.heic.identifier) else {
            throw XCTSkip("HEIC encoder unavailable on this test destination; verify on iPhone.")
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".heic")
        defer { try? FileManager.default.removeItem(at: url) }
        let destination = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.heic.identifier as CFString, 1, nil))
        let raw = try XCTUnwrap(image(CGSize(width: 1200, height: 800)).cgImage)
        CGImageDestinationAddImage(destination, raw, [kCGImagePropertyOrientation: 6] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let p = try properties(ChatAttachmentImageEncoding.prepare(fileURL: url))
        XCTAssertEqual(p[kCGImagePropertyPixelWidth] as? Int, 800)
        XCTAssertEqual(p[kCGImagePropertyPixelHeight] as? Int, 1200)
    }
}
