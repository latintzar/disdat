import AppKit
import CoreGraphics

/// Persistent Wispr-Flow-style recorder, anchored bottom-center and dock-aware.
///
/// States:
///   • idle      — tiny 10×10 solid-black dot with a brand-orange outline.
///   • hover     — grows to a 30×30 solid-orange circle with a white mic glyph;
///                 a dark shortcut bubble floats above it (Wispr-style).
///   • recording — wider solid-black pill: ✕ cancel (left), orange waveform, ✓ finish (right).
///   • done      — solid-black "Copied!" confirmation, then back to idle.
///
/// Callbacks: `onStart` (click while idle), `onFinish` (✓), `onCancel` (✕).
final class RecorderPill: NSObject {
    enum State { case idle, recording, done }

    var onStart:  (() -> Void)?
    var onFinish: (() -> Void)?
    var onCancel: (() -> Void)?

    private let brandOrange = NSColor(calibratedRed: 1.0, green: 92/255, blue: 42/255, alpha: 1.0)
    private let bottomGap: CGFloat = 15          // the VISIBLE pill's bottom edge sits this far above the dock (if shown) or the screen edge
    private let wisprShift: CGFloat = 100        // slide this far right of centre when Wispr Flow is running (its pill is centred)
    // Transparent margin baked into the panel on every side, so the hover + click
    // hit area extends this far beyond the visible pill (easy to grab the tiny dot).
    private let hitPad: CGFloat = 12

    private let idleDot     = NSSize(width: 10, height: 10)   // unhovered: tiny dot
    private let hoverCircle = NSSize(width: 30, height: 30)   // grows on hover
    private let recSize     = NSSize(width: 150, height: 34)
    private let doneSize    = NSSize(width: 96, height: 30)

    private var panel: NSPanel?
    private var content: PillContentView!
    private var pill: NSView!                     // the visible pill, inset by hitPad inside `content`
    private let waveform = WaveformView(frame: .zero)
    private var iconView: NSImageView!
    private var cancelBtn: CircleButton!
    private var finishBtn: CircleButton!
    private var copiedLabel: NSTextField!
    private let glow = RecordingGlow()
    private let bubble = ShortcutBubble()

    private(set) var state: State = .idle
    private var hovering = false
    private var watchdog: Timer?
    private var lastTarget: NSRect?              // last frame we ASKED for (dedup, even mid-animation)
    private var doneText = "Copied!"             // label shown in the .done pill

    // MARK: - Lifecycle

    func show() {
        if panel == nil { build() }
        apply(.idle)
        panel?.orderFrontRegardless()
        startWatchdog()
    }

    func enterRecording() { hovering = false; bubble.hide(); apply(.recording) }
    /// Capture stopped, upload in flight — show "Saving…" until the signed link lands.
    func enterProcessing() { doneText = "Saving…"; apply(.done) }
    /// Signed link is on the clipboard — flip to the "Copied!" confirmation.
    func enterDone()      { doneText = "Copied!"; apply(.done) }

    func returnToIdle() { apply(.idle) }

    func pushLevel(_ level: Float) { waveform.push(level) }

    // MARK: - Build

    private func build() {
        let initSize = panelSize(for: recSize)
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: initSize),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .statusBar
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true
        p.ignoresMouseEvents = false
        p.hidesOnDeactivate = false
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]

        // `content` fills the whole panel (incl. the transparent hitPad ring) so
        // hover + clicks register up to 20px beyond the visible pill.
        let c = PillContentView(frame: NSRect(origin: .zero, size: initSize))
        c.onClick = { [weak self] in self?.handleBodyClick() }
        c.onHover = { [weak self] inside in if inside { self?.hoverChanged(true) } }
        c.wantsLayer = true
        c.layer?.backgroundColor = NSColor.clear.cgColor

        // The visible pill — inset by hitPad inside `content`. Solid (non-translucent);
        // carries the background, border and corner radius. ArrowCursorView so the
        // visible dot (which sits on top of `content`) keeps the arrow cursor instead
        // of letting the I-beam from the app behind the transparent panel show through.
        let pv = ArrowCursorView(frame: NSRect(x: hitPad, y: hitPad, width: recSize.width, height: recSize.height))
        pv.wantsLayer = true
        pv.layer?.masksToBounds = true
        c.addSubview(pv)
        pill = pv

        pv.addSubview(waveform)

        let iv = NSImageView()
        iv.imageScaling = .scaleProportionallyDown
        iv.contentTintColor = .white
        pv.addSubview(iv)
        iconView = iv

        cancelBtn = CircleButton(glyph: "xmark", tint: .white,
                                 fill: NSColor(calibratedWhite: 1.0, alpha: 0.18))
        cancelBtn.onClick = { [weak self] in self?.onCancel?() }
        pv.addSubview(cancelBtn)

        finishBtn = CircleButton(glyph: "checkmark", tint: .white, fill: brandOrange)
        finishBtn.onClick = { [weak self] in self?.onFinish?() }
        pv.addSubview(finishBtn)

        let lbl = NSTextField(labelWithString: "Copied!")
        lbl.font = .systemFont(ofSize: 12.5, weight: .semibold)
        lbl.textColor = .white
        lbl.alignment = .center
        lbl.isHidden = true
        pv.addSubview(lbl)
        copiedLabel = lbl

        p.contentView = c
        panel = p
        content = c

        NotificationCenter.default.addObserver(
            self, selector: #selector(screenChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
        // Entering/leaving another app's fullscreen is a Space change, NOT a screen-
        // parameter change — without this the pill keeps the old (dock-aware) anchor
        // until the 0.25s watchdog catches up. Reposition instantly on Space switches.
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(screenChanged),
            name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
    }

    private func handleBodyClick() {
        // The ✕/✓ buttons handle their own clicks while recording; a click on
        // the bare idle circle starts a recording.
        NSLog("[DD] pill handleBodyClick state=\(state) onStart=\(onStart != nil)")
        if state == .idle { onStart?() }
    }

    // MARK: - State

    private func apply(_ s: State) {
        state = s
        if s == .recording { glow.show() } else { glow.hide() }
        let size = currentSize()
        layoutSubviews(for: size)
        render()
        setFrame(size: size)
        updateBubble()
    }

    private func hoverChanged(_ inside: Bool) {
        guard state == .idle else { return }   // hover only matters when idle
        if hovering == inside { return }
        hovering = inside
        let size = currentSize()
        layoutSubviews(for: size)
        render()
        setFrame(size: size, animate: true)    // grow 10→30 (or shrink back)
        updateBubble()
    }

    private func currentSize() -> NSSize {
        switch state {
        case .recording: return recSize
        case .done:      return doneSize
        case .idle:      return hovering ? hoverCircle : idleDot
        }
    }

    private func layoutSubviews(for size: NSSize) {
        let b = NSRect(origin: .zero, size: size)
        // Centre the visible pill inside the padded panel.
        pill.frame = NSRect(x: hitPad, y: hitPad, width: size.width, height: size.height)
        switch state {
        case .recording:
            let d: CGFloat = 22, pad: CGFloat = 8
            cancelBtn.frame = NSRect(x: pad, y: (size.height - d) / 2, width: d, height: d)
            finishBtn.frame = NSRect(x: size.width - pad - d, y: (size.height - d) / 2, width: d, height: d)
            waveform.frame = NSRect(x: pad + d + 6, y: 6,
                                    width: size.width - 2 * (pad + d + 6), height: size.height - 12)
        case .done:
            copiedLabel.frame = NSRect(x: 0, y: (size.height - 16) / 2, width: size.width, height: 16)
        default:
            iconView.frame = b.insetBy(dx: 8, dy: 8)
            waveform.frame = b.insetBy(dx: 8, dy: 8)
        }
    }

    private func render() {
        guard let layer = pill.layer else { return }
        let radius = currentSize().height / 2

        cancelBtn.isHidden = state != .recording
        finishBtn.isHidden = state != .recording
        copiedLabel.isHidden = state != .done

        switch state {
        case .idle:
            if hovering {
                // hover: solid orange circle + white mic
                layer.backgroundColor = brandOrange.cgColor
                layer.borderWidth = 0
                waveform.isHidden = true; waveform.reset()
                iconView.isHidden = false
                iconView.image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "Record")
            } else {
                // idle: tiny SOLID black dot with a brand-orange outline (non-translucent)
                layer.backgroundColor = NSColor.black.cgColor
                layer.borderColor = brandOrange.cgColor
                layer.borderWidth = 1
                waveform.isHidden = true
                iconView.isHidden = true
            }
        case .recording:
            // solid black background + ✕/waveform/✓
            layer.backgroundColor = NSColor.black.cgColor
            layer.borderColor = brandOrange.withAlphaComponent(0.4).cgColor
            layer.borderWidth = 1
            iconView.isHidden = true
            waveform.isHidden = false
        case .done:
            // solid black "Saving…" / "Copied!" confirmation
            copiedLabel.stringValue = doneText
            layer.backgroundColor = NSColor.black.cgColor
            layer.borderColor = brandOrange.withAlphaComponent(0.4).cgColor
            layer.borderWidth = 1
            waveform.isHidden = true; waveform.reset()
            iconView.isHidden = true
        }
        layer.cornerRadius = radius
    }

    // MARK: - Shortcut bubble

    private func updateBubble() {
        if state == .idle && hovering, let p = panel {
            // Anchor above the VISIBLE pill (inset by hitPad inside the panel).
            let visible = NSRect(x: p.frame.minX + hitPad, y: p.frame.minY + hitPad,
                                 width: currentSize().width, height: currentSize().height)
            bubble.present(above: visible)
        } else {
            bubble.hide()
        }
    }

    // MARK: - Positioning (bottom-center, dock-aware)

    /// Panel size = the visible pill grown by the transparent hitPad on every side.
    private func panelSize(for visible: NSSize) -> NSSize {
        NSSize(width: visible.width + 2 * hitPad, height: visible.height + 2 * hitPad)
    }

    /// The screen the user is actually working on. A non-activating utility panel
    /// never owns the key window, so `NSScreen.main` (the key window's screen) can
    /// point at the wrong display; the screen under the cursor is what we want.
    private func anchorScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })
            ?? NSScreen.main ?? NSScreen.screens.first
    }

    /// Where the VISIBLE pill's bottom-left should sit (bottom edge + horizontal
    /// centre), resolved once so positioning and hit-testing never diverge.
    ///
    /// Always bottom-CENTRED. The bottom edge sits `bottomGap` above the dock's top
    /// when the dock is showing, else `bottomGap` above the true screen edge.
    private func anchor(visibleWidth: CGFloat) -> (bottom: CGFloat, centerX: CGFloat)? {
        guard let screen = anchorScreen() else { return nil }
        // Wispr Flow's own pill sits dead-centre; if it's running, slide ours 100px
        // right so the two don't overlap.
        let centerX = screen.frame.midX + (wisprRunning() ? wisprShift : 0)
        return (bottomBaseline(on: screen) + bottomGap, centerX)
    }

    /// True if Wispr Flow is installed and currently running.
    private func wisprRunning() -> Bool {
        NSWorkspace.shared.runningApplications.contains { app in
            let name = app.localizedName?.lowercased() ?? ""
            let bid = app.bundleIdentifier?.lowercased() ?? ""
            return name.contains("wispr") || bid.contains("wispr")
        }
    }

    /// The Y the pill's bottom edge sits above: the dock's top when the dock is
    /// genuinely on screen, else the true screen bottom.
    ///
    /// We can't just trust `visibleFrame.minY`: when the active Space is a FULLSCREEN
    /// app the dock is hidden, yet `visibleFrame` still reports the desktop Space's
    /// dock inset — which would float the pill ~50px up over a fullscreen app. So if
    /// a window covers the entire screen (incl. the menu-bar strip ⇒ fullscreen
    /// Space), anchor to the real screen bottom instead.
    private func bottomBaseline(on screen: NSScreen) -> CGFloat {
        let frame = screen.frame
        if isFullscreenSpace(on: screen) { return frame.minY }
        let vf = screen.visibleFrame
        let dockVisible = (vf.minY - frame.minY) > 1
        return dockVisible ? vf.minY : frame.minY
    }

    /// True if the active Space on `screen` is a fullscreen app — detected by a
    /// normal (layer-0) window that covers the whole screen, including the band
    /// where the menu bar would be (a windowed/maximised app stays below it).
    private func isFullscreenSpace(on screen: NSScreen) -> Bool {
        guard let list = CGWindowListCopyWindowInfo(
                [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return false }
        let primaryH = NSScreen.screens.first?.frame.height ?? screen.frame.height
        let f = screen.frame
        for info in list {
            guard (info[kCGWindowLayer as String] as? Int) == 0,
                  let b = info[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = b["X"], let y = b["Y"], let w = b["Width"], let h = b["Height"]
            else { continue }
            let rect = NSRect(x: x, y: primaryH - y - h, width: w, height: h)   // CG → AppKit
            if abs(rect.minX - f.minX) < 3, abs(rect.maxX - f.maxX) < 3,
               abs(rect.minY - f.minY) < 3, abs(rect.maxY - f.maxY) < 3 {
                return true
            }
        }
        return false
    }

    private func setFrame(size: NSSize, animate: Bool = false) {
        guard let p = panel, let a = anchor(visibleWidth: size.width) else { return }
        // Offset by hitPad so the VISIBLE pill (inset inside the panel) lands exactly
        // on the resolved bottom edge, centred on the resolved centreX.
        let pSize = panelSize(for: size)
        let origin = NSPoint(x: a.centerX - pSize.width / 2, y: a.bottom - hitPad)
        let target = NSRect(origin: origin, size: pSize)
        // Dedup against the last REQUESTED frame (not the live frame, which is mid-
        // animation): the watchdog calls this ~8×/s to follow the dock, and re-issuing
        // the same target would restart the animation every tick and look janky.
        if let lt = lastTarget, lt.equalTo(target) { return }
        lastTarget = target
        let fs = anchorScreen().map { isFullscreenSpace(on: $0) } ?? false
        NSLog("[DD] pill move state=\(state) fullscreen=\(fs) wispr=\(wisprRunning()) target=\(NSStringFromRect(target)) anchorBottom=\(a.bottom) centerX=\(a.centerX)")
        p.setFrame(target, display: true, animate: animate)
    }

    @objc private func screenChanged() {
        setFrame(size: currentSize())
        updateBubble()
        if state == .recording { glow.show() }   // re-fit glow to the new screen
    }

    // MARK: - Watchdog: live dock-awareness + hover reconciliation

    private func startWatchdog() {
        watchdog?.invalidate()
        // didChangeScreenParameters does NOT fire on dock auto-hide, so poll the
        // visibleFrame to follow the dock. Also reconcile a stuck hover: if a fast
        // mouse pass left without us getting mouseExited, clear it here.
        watchdog = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
            guard let self else { return }
            // animate: smoothly glide between the dock-shown and dock-hidden anchors.
            self.setFrame(size: self.currentSize(), animate: true)
            // Hover follows a zone 20px beyond the idle dot (easier to hit), and
            // clears only when the cursor leaves that zone.
            if self.state == .idle {
                let inside = self.idleHoverZone().contains(NSEvent.mouseLocation)
                if self.hovering != inside { self.hoverChanged(inside) }
            }
        }
    }

    /// The full hit area for the idle pill — the visible dot grown by hitPad on
    /// every side (this is exactly the padded panel's on-screen rect).
    private func idleHoverZone() -> NSRect {
        let visible = currentSize()
        guard let a = anchor(visibleWidth: visible.width) else { return .zero }
        let origin = NSPoint(x: a.centerX - visible.width / 2, y: a.bottom)
        return NSRect(origin: origin, size: visible).insetBy(dx: -hitPad, dy: -hitPad)
    }

}

/// Hosting view that forwards clicks + hover and keeps a normal arrow cursor.
private final class PillContentView: NSView {
    var onClick: (() -> Void)?
    var onHover: ((Bool) -> Void)?
    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds,
                               options: [.activeAlways, .mouseEnteredAndExited, .cursorUpdate],
                               owner: self, userInfo: nil)
        addTrackingArea(t); tracking = t
    }

    // Keep a normal arrow over the pill — the mic glyph is an NSImageView, which
    // otherwise lets the I-beam (text) cursor show through.
    override func resetCursorRects() { addCursorRect(bounds, cursor: .arrow) }
    override func cursorUpdate(with event: NSEvent) { NSCursor.arrow.set() }

    // Deliver the click even when our panel isn't focused (don't steal the
    // editor's focus just to start a recording).
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent)  { onHover?(false) }
    override func mouseDown(with event: NSEvent)    { onClick?() }
}

/// Plain container view that always shows the arrow cursor. Used for the visible
/// pill so the I-beam from the app behind the transparent panel can't bleed through.
private final class ArrowCursorView: NSView {
    private var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds,
                               options: [.activeAlways, .cursorUpdate],
                               owner: self, userInfo: nil)
        addTrackingArea(t); tracking = t
    }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .arrow) }
    override func cursorUpdate(with event: NSEvent) { NSCursor.arrow.set() }
}

/// Small circular glyph button (✕ / ✓) used in the recording pill.
private final class CircleButton: NSView {
    var onClick: (() -> Void)?
    private let imageView = NSImageView()
    private let fill: NSColor

    init(glyph: String, tint: NSColor, fill: NSColor) {
        self.fill = fill
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = fill.cgColor
        imageView.image = NSImage(systemSymbolName: glyph, accessibilityDescription: glyph)
        imageView.contentTintColor = tint
        imageView.imageScaling = .scaleProportionallyDown
        addSubview(imageView)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        layer?.cornerRadius = bounds.height / 2
        imageView.frame = bounds.insetBy(dx: 5, dy: 5)
    }

    override func resetCursorRects() { addCursorRect(bounds, cursor: .arrow) }
    override func cursorUpdate(with event: NSEvent) { NSCursor.arrow.set() }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onClick?() }
}

/// Dark rounded bubble floating above the idle pill on hover, showing the
/// global shortcut as keycaps (Wispr-Flow style). Read from UserDefaults so it
/// stays in sync once the shortcut becomes user-rebindable.
final class ShortcutBubble {
    private var panel: NSPanel?

    private var keys: [String] {
        // Stored display form, e.g. "⌃ ⌥ ⌘ Space". Falls back to the default combo.
        let raw = UserDefaults.standard.string(forKey: "disdat.shortcut.display") ?? "⌃ ⌥ ⌘ Space"
        return raw.split(separator: " ").map(String.init)
    }

    func present(above pillFrame: NSRect) {
        let view = BubbleView(keys: keys)
        let size = view.intrinsicSize
        if panel == nil { build(size: size) }
        guard let p = panel else { return }
        view.frame = NSRect(origin: .zero, size: size)
        p.setContentSize(size)
        p.contentView = view
        let x = pillFrame.midX - size.width / 2
        let y = pillFrame.maxY + 10
        p.setFrameOrigin(NSPoint(x: x, y: y))
        p.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    private func build(size: NSSize) {
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: size),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .statusBar
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true
        p.ignoresMouseEvents = true
        p.hidesOnDeactivate = false
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel = p
    }
}

/// Draws the shortcut bubble: a dark rounded-rect with a row of keycap chips.
private final class BubbleView: NSView {
    private let keys: [String]
    private let h: CGFloat = 30
    private let padX: CGFloat = 10, gap: CGFloat = 6
    private let capH: CGFloat = 20, capPadX: CGFloat = 8
    private let font = NSFont.systemFont(ofSize: 12, weight: .semibold)

    init(keys: [String]) { self.keys = keys; super.init(frame: .zero) }
    required init?(coder: NSCoder) { fatalError() }

    private func capWidth(_ s: String) -> CGFloat {
        let w = (s as NSString).size(withAttributes: [.font: font]).width
        return max(capH, w + 2 * capPadX)
    }

    var intrinsicSize: NSSize {
        let caps = keys.map(capWidth).reduce(0, +)
        let gaps = CGFloat(max(0, keys.count - 1)) * gap
        return NSSize(width: padX * 2 + caps + gaps, height: h)
    }

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        // Bubble background
        let bg = NSColor(calibratedWhite: 0.10, alpha: 0.96)
        let bgPath = NSBezierPath(roundedRect: bounds, xRadius: h / 2, yRadius: h / 2)
        bg.setFill(); bgPath.fill()

        // Keycap chips
        var x = padX
        let y = (h - capH) / 2
        for key in keys {
            let w = capWidth(key)
            let rect = NSRect(x: x, y: y, width: w, height: capH)
            let cap = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
            NSColor(calibratedWhite: 1.0, alpha: 0.16).setFill(); cap.fill()
            let attrs: [NSAttributedString.Key: Any] = [
                .font: font, .foregroundColor: NSColor.white,
            ]
            let str = key as NSString
            let ts = str.size(withAttributes: attrs)
            str.draw(at: NSPoint(x: rect.midX - ts.width / 2, y: rect.midY - ts.height / 2), withAttributes: attrs)
            x += w + gap
        }
    }
}

/// Full-screen, click-through orange edge-glow shown while recording — a soft,
/// translucent brand-colored vignette so it's obvious the screen is being captured.
/// It's one of our own windows, so ScreenCapture's PID filter keeps it out of frames.
final class RecordingGlow {
    private var panel: NSPanel?

    func show() {
        guard let screen = NSScreen.main else { return }
        if panel == nil { build() }
        panel?.setFrame(screen.frame, display: true)
        (panel?.contentView as? GlowView)?.needsDisplay = true
        panel?.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    private func build() {
        let p = NSPanel(contentRect: NSScreen.main?.frame ?? .zero,
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .statusBar
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = false
        p.ignoresMouseEvents = true                // fully click-through
        p.hidesOnDeactivate = false
        p.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        p.contentView = GlowView()
        panel = p
    }
}

/// Draws a soft orange fade hugging each screen edge (transparent at the center).
private final class GlowView: NSView {
    private let orange = NSColor(calibratedRed: 1.0, green: 92/255, blue: 42/255, alpha: 1.0)
    private let band: CGFloat = 24          // how far the glow reaches inward (thin)
    private let peak: CGFloat = 0.30        // max edge opacity (translucent)

    override var isFlipped: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }   // never intercept clicks

    override func draw(_ dirtyRect: NSRect) {
        let edge = orange.withAlphaComponent(peak)
        let clear = orange.withAlphaComponent(0)
        guard let grad = NSGradient(starting: edge, ending: clear) else { return }
        let w = bounds.width, h = bounds.height
        // Each edge fades from the border (angle points inward) over `band`px.
        grad.draw(in: NSRect(x: 0, y: h - band, width: w, height: band), angle: -90)  // top
        grad.draw(in: NSRect(x: 0, y: 0, width: w, height: band), angle: 90)          // bottom
        grad.draw(in: NSRect(x: 0, y: 0, width: band, height: h), angle: 0)           // left
        grad.draw(in: NSRect(x: w - band, y: 0, width: band, height: h), angle: 180)  // right
    }
}
