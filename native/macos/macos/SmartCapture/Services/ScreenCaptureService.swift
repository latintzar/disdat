import Foundation
import ScreenCaptureKit
import CoreGraphics
import AppKit

/// Captures a screen region using ScreenCaptureKit (macOS 14+).
/// Falls back to CGWindowListCreateImage on macOS 13.
@MainActor
class ScreenCaptureService {

    static func captureRegion(_ rect: CGRect) async throws -> Data {
        if #available(macOS 14.0, *) {
            return try await captureWithSCKit(rect)
        } else {
            return try captureWithCGWindow(rect)
        }
    }

    @available(macOS 14.0, *)
    private static func captureWithSCKit(_ rect: CGRect) async throws -> Data {
        print("[ScreenCaptureService] SCScreenshotManager capture rect=\(rect)")

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

        guard let display = content.displays.first(where: {
            CGDisplayBounds($0.displayID).intersects(rect)
        }) ?? content.displays.first else {
            throw CaptureError.noDisplayForRect
        }

        let displayBounds = CGDisplayBounds(display.displayID)
        let scRect = CGRect(
            x: rect.origin.x - displayBounds.origin.x,
            y: displayBounds.height - (rect.origin.y - displayBounds.origin.y) - rect.height,
            width: rect.width,
            height: rect.height
        )

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.sourceRect = scRect
        config.width = Int(rect.width * 2)
        config.height = Int(rect.height * 2)
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.captureResolution = .best
        config.showsCursor = false

        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: config
        )

        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw CaptureError.encodingFailed
        }
        print("[ScreenCaptureService] captured \(png.count / 1024)KB PNG")
        return png
    }

    private static func captureWithCGWindow(_ rect: CGRect) throws -> Data {
        print("[ScreenCaptureService] CGWindowListCreateImage fallback rect=\(rect)")

        let flippedRect = flipRectToScreen(rect)

        guard let cgImage = CGWindowListCreateImage(
            flippedRect,
            .optionOnScreenOnly,
            kCGNullWindowID,
            [.boundsIgnoreFraming, .bestResolution]
        ) else {
            throw CaptureError.cgCaptureFailed
        }

        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            throw CaptureError.encodingFailed
        }
        return png
    }

    private static func flipRectToScreen(_ rect: CGRect) -> CGRect {
        guard let screen = NSScreen.main else { return rect }
        let screenHeight = screen.frame.height
        return CGRect(
            x: rect.origin.x,
            y: screenHeight - rect.origin.y - rect.height,
            width: rect.width,
            height: rect.height
        )
    }
}

enum CaptureError: LocalizedError {
    case noDisplayForRect
    case cgCaptureFailed
    case encodingFailed
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .noDisplayForRect: return "Could not find a display containing the selected region."
        case .cgCaptureFailed: return "Screen capture failed."
        case .encodingFailed: return "Failed to encode captured image."
        case .permissionDenied: return "Screen Recording permission is required. Enable it in System Settings > Privacy & Security > Screen Recording."
        }
    }
}
