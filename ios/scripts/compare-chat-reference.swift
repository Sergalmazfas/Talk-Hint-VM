// macOS utility, not part of the iOS target. No third-party dependencies.
import AppKit
import Foundation

guard CommandLine.arguments.count == 4 else {
    fputs("Usage: swift compare-chat-reference.swift owner-reference.jpg native.png output-directory\n", stderr)
    exit(2)
}
let args = CommandLine.arguments
let out = URL(fileURLWithPath: args[3], isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func export(_ path: String, name: String, cropReference: Bool) throws {
    guard let image = NSImage(contentsOfFile: path),
          let data = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: data) else {
        throw NSError(domain: "ChatComparison", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Cannot decode \(path)"])
    }
    image.size = NSSize(width: CGFloat(bitmap.pixelsWide), height: CGFloat(bitmap.pixelsHigh))
    if cropReference && (bitmap.pixelsWide != 960 || bitmap.pixelsHigh != 1517) {
        throw NSError(domain: "ChatComparison", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Expected the approved 960×1517 owner JPEG; refusing a different reference."])
    }
    // Only trim the source's side frame; its top is already clipped.
    let source = cropReference
        ? NSRect(x: 50, y: 0, width: 890, height: CGFloat(bitmap.pixelsHigh))
        : NSRect(origin: .zero, size: image.size)
    let width = 1170
    let height = Int((CGFloat(width) * source.height / source.width).rounded())
    guard let result = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width,
        pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: result) else {
        throw NSError(domain: "ChatComparison", code: 3)
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)),
               from: source, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = result.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "ChatComparison", code: 4)
    }
    try png.write(to: out.appendingPathComponent(name))
}
try export(args[1], name: "owner-reference-same-width.png", cropReference: true)
try export(args[2], name: "native-same-width.png", cropReference: false)
print("Saved two separate 1170px-wide images. Reference width is normalized, not known device metadata; the reference top is clipped. This is NOT a pixel-perfect comparison.")
