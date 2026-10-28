import AppKit

/// Scrolling waveform: newest sample enters at the right and slides left.
/// Noise-gated — quiet input draws near-flat so speaking is visually obvious.
final class WaveformView: NSView {
    private var levels: [CGFloat] = []
    private let capacity = 90
    private let gate: CGFloat = 0.06

    // Brand orange for active voice; dim white for silence.
    var voiceColor = NSColor(calibratedRed: 1.0, green: 92/255, blue: 42/255, alpha: 1.0)

    func push(_ level: Float) {
        var l = CGFloat(level)
        if l < gate { l = 0.015 }                 // noise gate
        levels.append(min(1, l))
        if levels.count > capacity { levels.removeFirst(levels.count - capacity) }
        needsDisplay = true
    }

    func reset() { levels.removeAll(); needsDisplay = true }

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        let w = bounds.width, h = bounds.height
        let barW: CGFloat = 3, gap: CGFloat = 2
        let step = barW + gap
        let maxBars = Int(w / step)
        let count = min(levels.count, maxBars)
        guard count > 0 else { return }

        for i in 0..<count {
            let level = levels[levels.count - count + i]
            let bh = max(2, level * (h - 4))
            let x = w - CGFloat(count - i) * step
            let rect = CGRect(x: x, y: (h - bh) / 2, width: barW, height: bh)
            let path = NSBezierPath(roundedRect: rect, xRadius: barW / 2, yRadius: barW / 2)
            let speaking = level > 0.05
            let color = speaking
                ? voiceColor                                       // brand orange = voice
                : NSColor(calibratedWhite: 1.0, alpha: 0.28)       // dim = silence
            color.setFill()
            path.fill()
        }
    }
}
