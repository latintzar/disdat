import AppKit
import SwiftUI
import ScreenCaptureKit

// MARK: - Singleton controller

/// Manages the fullscreen transparent overlay for selecting a screen region.
class RegionSelectorController: NSObject {
    static let shared = RegionSelectorController()

    // Use NSPanel (no custom subclass) — avoids AppKit autorelease-pool corruption
    // that occurs when custom NSWindow subclasses are deallocated during event dispatch.
    private var panels: [NSPanel] = []
    weak var appState: AppState?

    // Snapshot the frontmost app BEFORE we show the overlay (which steals focus).
    // AX position hit-testing after overlay dismissal would return our own panels or
    // whatever window gains focus next — not the app the user was actually looking at.
    private var targetPID: pid_t = 0
    private var targetAppName: String = "Unknown"

    private override init() {}

    func show() {
        // Record the target app NOW, before our overlay appears and takes focus.
        if let front = NSWorkspace.shared.frontmostApplication {
            targetPID     = front.processIdentifier
            targetAppName = front.localizedName ?? "Unknown"
            print("[RegionSelector] target app: \(targetAppName) pid=\(targetPID)")
        }
        dismissPanels()
        for screen in NSScreen.screens {
            let panel = makePanel(for: screen)
            panels.append(panel)
            panel.makeKeyAndOrderFront(nil)
        }
        NSCursor.crosshair.set()
    }

    private func makePanel(for screen: NSScreen) -> NSPanel {
        let panel = NSPanel(
            contentRect: screen.frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true          // lazy backing store — safer for overlay panels
        )
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.screenSaverWindow)) - 1)
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.ignoresMouseEvents = false
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false

        let view = RegionSelectorView(screen: screen)
        view.frame = NSRect(origin: .zero, size: screen.frame.size)

        // Capture rect by value; dispatch callback OUT of the mouseUp event call stack
        // so the panel is never touched during event dispatch.
        view.onSelection = { [weak self] rect in
            DispatchQueue.main.async { [weak self] in
                self?.selectionFinished(rect: rect, onScreen: screen)
            }
        }
        view.onCancel = { [weak self] in
            DispatchQueue.main.async { [weak self] in
                self?.dismissPanels()
            }
        }
        panel.contentView = view
        return panel
    }

    private func dismissPanels() {
        NSCursor.arrow.set()
        let toClose = panels
        panels = []
        // Hide immediately so user sees no overlay
        for p in toClose { p.alphaValue = 0; p.ignoresMouseEvents = true }
        // Order out and release on next tick — never during event dispatch
        DispatchQueue.main.async {
            for p in toClose { p.orderOut(nil) }
        }
    }

    /// Called (always async) after user finishes drawing.
    private func selectionFinished(rect: CGRect, onScreen screen: NSScreen) {
        dismissPanels()
        guard let appState else { return }

        // Use the app that was frontmost BEFORE the overlay — captured in show().
        let savedPID     = targetPID
        let savedAppName = targetAppName.isEmpty ? "Unknown" : targetAppName

        let capturePoint = CGPoint(x: rect.origin.x + rect.width / 2,
                                   y: rect.origin.y + rect.height / 2)

        Task { @MainActor in
            appState.isCapturing = false
            appState.isProcessing = true

            do {
                let screenshotData = try await ScreenCaptureService.captureRegion(rect)

                // Use saved PID for AX tree — avoids hitting our own panel or Cursor
                // after the overlay has been dismissed and focus has shifted.
                // Pass isBrowser so the AX tree prunes toolbar/tab chrome for browser windows.
                let isBrowser = BrowserBridge.isBrowser(pid: savedPID)
                let axTree = AccessibilityService.captureTree(pid: savedPID, selectionRect: rect, isBrowser: isBrowser)

                var browserDOM: String? = nil
                if savedPID != 0 {
                    browserDOM = await BrowserBridge.extractDOM(at: capturePoint, windowPID: savedPID)
                }

                let scale = Int(screen.backingScaleFactor)
                let vp = ViewportInfo(width: Int(screen.frame.width),
                                      height: Int(screen.frame.height),
                                      scale: scale)

                let input = CapturePackager.CaptureInput(
                    screenshotData: screenshotData,
                    selectionRect: rect,
                    appName: savedAppName,
                    sourceURL: savedAppName,
                    axTree: axTree,
                    browserDOM: browserDOM,
                    note: nil,
                    viewport: vp
                )
                let saveDir = appState.capturesDirectory
                let pkg = try await Task.detached(priority: .userInitiated) {
                    try CapturePackager.package(input, saveTo: saveDir)
                }.value
                appState.addCapture(pkg)
                appState.isProcessing = false
                showCompletionFeedback(near: rect)

                // One-time alert: if this was a browser capture and DOM extraction failed,
                // show a macOS alert guiding the user to grant Automation permission.
                let automationAlertKey = "hasShownAutomationAlert"
                if isBrowser &&
                   browserDOM == BrowserBridge.automationNotGrantedSentinel &&
                   !UserDefaults.standard.bool(forKey: automationAlertKey) {
                    UserDefaults.standard.set(true, forKey: automationAlertKey)
                    showAutomationPermissionAlert(for: savedAppName)
                }

            } catch {
                appState.isProcessing = false
                appState.lastError = error.localizedDescription
                print("[RegionSelector] capture failed: \(error)")
            }
        }
    }

    // MARK: - Automation permission alert

    private func showAutomationPermissionAlert(for appName: String) {
        let browserName: String
        let lower = appName.lowercased()
        if lower.contains("chrome") { browserName = "Google Chrome" }
        else if lower.contains("safari") { browserName = "Safari" }
        else if lower.contains("edge") { browserName = "Microsoft Edge" }
        else if lower.contains("arc") { browserName = "Arc" }
        else if lower.contains("brave") { browserName = "Brave Browser" }
        else { browserName = appName }

        let alert = NSAlert()
        alert.messageText = "Grant Automation access to \(browserName)"
        alert.informativeText = "Smart Capture captured a screenshot, but couldn't extract the page structure, tech stack, design tokens, or animations.\n\nThese are only available when Automation permission is granted for \(browserName). Without it, your AI agent only gets a screenshot — not the full context.\n\nGrant it in: System Settings → Privacy & Security → Automation → Smart Capture → enable \(browserName)"
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Skip")
        alert.alertStyle = .warning

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - Completion HUD

    private var hudPanel: NSPanel?

    private func showCompletionFeedback(near rect: CGRect) {
        let hudRect = NSRect(x: rect.maxX - 120, y: rect.minY - 40, width: 110, height: 30)
        let panel = NSPanel(contentRect: hudRect,
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered,
                            defer: true)
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.level = .floating
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false

        let label = NSTextField(labelWithString: "  ✓ Captured  ")
        label.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        label.backgroundColor = NSColor.black.withAlphaComponent(0.75)
        label.textColor = .white
        label.wantsLayer = true
        label.layer?.cornerRadius = 7
        label.frame = panel.contentView!.bounds
        panel.contentView?.addSubview(label)
        panel.orderFront(nil)
        hudPanel = panel

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            panel.orderOut(nil)
            self?.hudPanel = nil
        }
    }
}

// MARK: - RegionSelectorView

/// NSView that handles mouse events for drawing the selection rectangle.
/// Never closes or touches its parent window — all lifecycle is handled by the controller.
class RegionSelectorView: NSView {
    var onSelection: ((CGRect) -> Void)?
    var onCancel: (() -> Void)?

    private let screen: NSScreen
    private var startPoint: NSPoint?
    private var currentRect: NSRect = .zero
    private var isDragging = false

    private let dimColor            = NSColor.black.withAlphaComponent(0.35)
    private let selectionBorderColor = NSColor.white.withAlphaComponent(0.9)
    private let handleColor         = NSColor.white

    init(screen: NSScreen) {
        self.screen = screen
        super.init(frame: .zero)
        self.wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - Mouse events

    override func mouseDown(with event: NSEvent) {
        startPoint = convert(event.locationInWindow, from: nil)
        currentRect = .zero
        isDragging = true
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = startPoint else { return }
        let current = convert(event.locationInWindow, from: nil)
        currentRect = NSRect(
            x: min(start.x, current.x),
            y: min(start.y, current.y),
            width: abs(current.x - start.x),
            height: abs(current.y - start.y)
        )
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard isDragging, currentRect.width > 4, currentRect.height > 4 else {
            onCancel?()
            return
        }
        isDragging = false
        // Convert while window still exists, then hand off via callback
        let screenRect = convertSelectionToScreenCoords(currentRect)
        // Nil the closures so the view holds no strong cycle after this
        let callback = onSelection
        onSelection = nil
        onCancel = nil
        callback?(screenRect)
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { // Escape
            isDragging = false
            currentRect = .zero
            needsDisplay = true
            let callback = onCancel
            onSelection = nil
            onCancel = nil
            callback?()
        }
    }

    // MARK: - Drawing

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.setFillColor(dimColor.cgColor)
        ctx.fill(bounds)

        if isDragging && currentRect.width > 0 {
            ctx.setBlendMode(.clear)
            ctx.fill(currentRect)
            ctx.setBlendMode(.normal)
            ctx.setStrokeColor(selectionBorderColor.cgColor)
            ctx.setLineWidth(1.5)
            ctx.stroke(currentRect.insetBy(dx: 0.75, dy: 0.75))
            drawHandles(ctx: ctx, rect: currentRect)
            drawSizeLabel(ctx: ctx, rect: currentRect)
        } else if !isDragging && currentRect == .zero {
            let hint = "Click and drag to select a region   Esc to cancel"
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 14, weight: .medium),
                .foregroundColor: NSColor.white.withAlphaComponent(0.8),
            ]
            let str = NSAttributedString(string: hint, attributes: attrs)
            let sz = str.size()
            str.draw(in: CGRect(x: bounds.midX - sz.width / 2,
                                y: bounds.midY - sz.height / 2,
                                width: sz.width, height: sz.height))
        }
    }

    private func drawHandles(ctx: CGContext, rect: NSRect) {
        let s: CGFloat = 6
        let corners: [CGPoint] = [
            CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
            CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.maxX, y: rect.maxY),
        ]
        ctx.setFillColor(handleColor.cgColor)
        for c in corners { ctx.fillEllipse(in: CGRect(x: c.x - s/2, y: c.y - s/2, width: s, height: s)) }
    }

    private func drawSizeLabel(ctx: CGContext, rect: NSRect) {
        let text = "\(Int(rect.width)) × \(Int(rect.height))"
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .medium),
            .foregroundColor: NSColor.white,
        ]
        let str = NSAttributedString(string: text, attributes: attrs)
        let sz = str.size()
        let pad: CGFloat = 6
        let bg = CGRect(x: rect.midX - sz.width/2 - pad, y: rect.maxY + 6,
                        width: sz.width + pad*2, height: sz.height + 4)
        ctx.setFillColor(NSColor.black.withAlphaComponent(0.6).cgColor)
        ctx.addPath(CGPath(roundedRect: bg, cornerWidth: 4, cornerHeight: 4, transform: nil))
        ctx.fillPath()
        str.draw(at: CGPoint(x: bg.origin.x + pad, y: bg.origin.y + 2))
    }

    private func convertSelectionToScreenCoords(_ viewRect: NSRect) -> CGRect {
        guard let win = window else { return viewRect }
        return win.convertToScreen(convert(viewRect, to: nil))
    }

    override var acceptsFirstResponder: Bool { true }
}
