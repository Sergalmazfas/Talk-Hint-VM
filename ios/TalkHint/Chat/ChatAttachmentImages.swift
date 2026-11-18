import UIKit
import AVFoundation
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

enum ChatAttachmentImageError: String, Error, LocalizedError {
    case unavailable, permissionDenied, invalid, tooLarge
    var errorDescription: String? {
        NSLocalizedString("chat.image.\(rawValue)", comment: "")
    }
}

/// Re-encode selected pixels only: no HEIC, EXIF/GPS or original-bytes fallback.
enum ChatAttachmentImageEncoding {
    static let maximumLongSide = 2000
    static let maximumBytes = 2 * 1024 * 1024

    static func prepare(fileURL: URL, maxBytes: Int = maximumBytes) throws -> Data {
        guard let source = CGImageSourceCreateWithURL(fileURL as CFURL,
            [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumLongSide,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw ChatAttachmentImageError.invalid }
        return try encode(image, maxBytes: maxBytes)
    }

    @MainActor
    static func prepare(cameraImage: UIImage, maxBytes: Int = maximumBytes) throws -> Data {
        let width = cameraImage.size.width * cameraImage.scale
        let height = cameraImage.size.height * cameraImage.scale
        guard width.isFinite, height.isFinite, width > 0, height > 0 else {
            throw ChatAttachmentImageError.invalid
        }
        let ratio = min(1, CGFloat(maximumLongSide) / max(width, height))
        let size = CGSize(width: max(1, floor(width * ratio)), height: max(1, floor(height * ratio)))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let normalized = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            cameraImage.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let image = normalized.cgImage else { throw ChatAttachmentImageError.invalid }
        return try encode(image, maxBytes: maxBytes)
    }

    private static func encode(_ image: CGImage, maxBytes: Int) throws -> Data {
        let limit = min(maxBytes, maximumBytes)
        guard limit > 0 else { throw ChatAttachmentImageError.tooLarge }
        for quality in [0.9, 0.8, 0.65, 0.5, 0.35, 0.2] {
            let data = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else {
                throw ChatAttachmentImageError.invalid
            }
            CGImageDestinationAddImage(destination, image, [
                kCGImageDestinationLossyCompressionQuality: quality,
                kCGImagePropertyOrientation: 1
            ] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { throw ChatAttachmentImageError.invalid }
            if data.length <= limit { return data as Data }
        }
        throw ChatAttachmentImageError.tooLarge
    }
}

/// One explicit camera/photo selection, not a background import or recognition.
/// PHPicker grants access only to the selected item; no full-library permission.
@MainActor
final class ChatAttachmentImagePicker: NSObject, UIImagePickerControllerDelegate,
                                       UINavigationControllerDelegate, PHPickerViewControllerDelegate {
    private weak var presenter: UIViewController?
    private let validContext: () -> Bool
    private let completion: (Result<Data, ChatAttachmentImageError>?) -> Void
    private let maxBytes: Int
    private var finished = false

    init(presenter: UIViewController, maxBytes: Int, validContext: @escaping () -> Bool,
         completion: @escaping (Result<Data, ChatAttachmentImageError>?) -> Void) {
        self.presenter = presenter
        self.maxBytes = maxBytes
        self.validContext = validContext
        self.completion = completion
    }

    func showCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            finish(.failure(.unavailable)); return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: presentCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                Task { @MainActor in
                    guard let self else { return }
                    if allowed { self.presentCamera() } else { self.finish(.failure(.permissionDenied)) }
                }
            }
        default: finish(.failure(.permissionDenied))
        }
    }

    private func presentCamera() {
        guard validContext(), let presenter, presenter.presentedViewController == nil else {
            finish(nil); return
        }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier]
        picker.allowsEditing = false
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    func showPhotos() {
        guard validContext(), let presenter, presenter.presentedViewController == nil else {
            finish(nil); return
        }
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        configuration.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { [weak self] in self?.finish(nil) }
    }

    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        guard validContext() else {
            picker.dismiss(animated: true) { [weak self] in self?.finish(nil) }; return
        }
        let result: Result<Data, ChatAttachmentImageError>
        if let image = info[.originalImage] as? UIImage {
            do { result = .success(try ChatAttachmentImageEncoding.prepare(cameraImage: image, maxBytes: maxBytes)) }
            catch { result = .failure((error as? ChatAttachmentImageError) ?? .invalid) }
        } else { result = .failure(.invalid) }
        picker.dismiss(animated: true) { [weak self] in self?.finish(result) }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let provider = results.first?.itemProvider
        picker.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            guard self.validContext(), let provider else { self.finish(nil); return }
            let limit = self.maxBytes
            // Temporary URL is only valid inside this callback: downsample before returning.
            provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] url, error in
                let result: Result<Data, ChatAttachmentImageError>
                if error == nil, let url {
                    do { result = .success(try ChatAttachmentImageEncoding.prepare(fileURL: url, maxBytes: limit)) }
                    catch { result = .failure((error as? ChatAttachmentImageError) ?? .invalid) }
                } else { result = .failure(.invalid) }
                Task { @MainActor in self?.finish(result) }
            }
        }
    }

    private func finish(_ result: Result<Data, ChatAttachmentImageError>?) {
        guard !finished else { return }
        finished = true
        completion(validContext() ? result : nil)
    }
}
