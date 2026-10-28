import AppKit

/// Tracks the cursor path (polled, no permission needed) and clicks (best-effort
/// global monitor). Coordinates are screen points, bottom-left origin (AppKit).
final class MouseTracker {
    struct Point { let t: Double; let x: Double; let y: Double }
    struct Click { let t: Double; let x: Double; let y: Double; let button: String }

    private(set) var points: [Point] = []
    private(set) var clicks: [Click] = []
    private var timer: Timer?
    private var monitor: Any?
    private var t0 = Date()

    func start() {
        points.removeAll(); clicks.removeAll(); t0 = Date()

        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            let p = NSEvent.mouseLocation
            self.points.append(Point(t: Date().timeIntervalSince(self.t0),
                                     x: Double(p.x), y: Double(p.y)))
        }

        monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] ev in
            guard let self else { return }
            let p = NSEvent.mouseLocation
            let button = ev.type == .rightMouseDown ? "right" : "left"
            self.clicks.append(Click(t: Date().timeIntervalSince(self.t0),
                                     x: Double(p.x), y: Double(p.y), button: button))
        }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    }
}
