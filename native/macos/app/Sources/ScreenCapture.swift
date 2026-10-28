import ScreenCaptureKit
import AppKit

/// On-demand full-screen snapshots via ScreenCaptureKit (macOS 14+).
enum ScreenCapture {
    /// Capture the main display. Returns the CGImage and the display's point size
    /// (needed to map AppKit cursor coords onto the image).
    static func snapshot() async -> (image: CGImage, displayWidth: CGFloat, displayHeight: CGFloat)? {
        guard #available(macOS 14.0, *) else { return nil }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { return nil }
            // Exclude Dis Dat's own windows (recorder pill, recording glow, main
            // window) so they never bleed into the feedback screenshots.
            let myPID = ProcessInfo.processInfo.processIdentifier
            let ownWindows = content.windows.filter { $0.owningApplication?.processID == myPID }
            let filter = SCContentFilter(display: display, excludingWindows: ownWindows)
            let cfg = SCStreamConfiguration()
            cfg.width = display.width
            cfg.height = display.height
            cfg.showsCursor = true
            let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
            return (img, CGFloat(display.width), CGFloat(display.height))
        } catch {
            NSLog("[LeoFeedback] snapshot failed: \(error.localizedDescription)")
            return nil
        }
    }

    /// Downscale (the display capture is large) + JPEG-encode to keep uploads small/fast.
    /// Reporting display *points* as displayW/H keeps the server's cursor→image mapping correct.
    static func saveJPEG(_ image: CGImage, to url: URL, quality: CGFloat = 0.55, maxWidth: CGFloat = 1280) {
        let scaled = downscale(image, maxWidth: maxWidth)
        let rep = NSBitmapImageRep(cgImage: scaled)
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else { return }
        try? data.write(to: url)
    }

    private static func downscale(_ image: CGImage, maxWidth: CGFloat) -> CGImage {
        let w = CGFloat(image.width)
        guard w > maxWidth else { return image }
        let nw = Int(maxWidth), nh = Int(CGFloat(image.height) * (maxWidth / w))
        guard let ctx = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
        ctx.interpolationQuality = .medium
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: nw, height: nh))
        return ctx.makeImage() ?? image
    }
}
