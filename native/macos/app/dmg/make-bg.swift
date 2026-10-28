import AppKit

// Renders the Dis Dat DMG background: cream brand backdrop, pixel-cursor logo +
// "Dis Dat" wordmark up top, a soft orange arrow pointing toward Applications,
// and a "drag to install" instruction. Output path is argv[1].
//
// Drawn in 600×400 points at 2× (1200×800 px) so it stays crisp on Retina.
// Coordinates are bottom-left origin (AppKit); the Finder icon positions in
// build.sh use top-left, so y_topLeft = 400 - y here.

let W: CGFloat = 600, H: CGFloat = 400
let px = 2
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(W) * px, pixelsHigh: Int(H) * px,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: W, height: H)     // makes the context 2× (points → pixels)

let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx

let ink    = NSColor(calibratedRed: 22/255,  green: 17/255, blue: 13/255, alpha: 1)
let cream  = NSColor(calibratedRed: 251/255, green: 247/255, blue: 238/255, alpha: 1)
let cream2 = NSColor(calibratedRed: 244/255, green: 236/255, blue: 221/255, alpha: 1)
let orange = NSColor(calibratedRed: 1.0, green: 92/255, blue: 42/255, alpha: 1)

// Backdrop
NSGradient(starting: cream, ending: cream2)?.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)

// ── Arrow pointing right, between the two icon slots (icon centers x=150 / x=450) ──
let ay: CGFloat = H - 205            // matches icon vertical center (top-left y=205)
let ax0: CGFloat = 248, ax1: CGFloat = 352
let arrow = NSBezierPath()
arrow.lineWidth = 6
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: ax0, y: ay))
arrow.line(to: NSPoint(x: ax1, y: ay))
arrow.move(to: NSPoint(x: ax1 - 15, y: ay + 13))
arrow.line(to: NSPoint(x: ax1, y: ay))
arrow.line(to: NSPoint(x: ax1 - 15, y: ay - 13))
orange.withAlphaComponent(0.55).setStroke()
arrow.stroke()

// ── Pixel-cursor logo + "Dis Dat" wordmark, centered up top ──
let art = [
    "X...........", "XX..........", "XXX.........", "XXXX........",
    "XXXXX.......", "XXXXXX......", "XXXXXXX.....", "XXXXXXXX....",
    "XXXXXXXXX...", "XXXXXXXXXX..", "XXXXXXXXXXX.", "XXXXXXXXXXX.",
    "XXXXXXX.....", "XXXX.XX.....", "XXX...XX....", "XXX.....X...",
]
let cols = 12, rows = 16
let cell: CGFloat = 1.7
let cursorW = CGFloat(cols) * cell, cursorH = CGFloat(rows) * cell

let title = NSAttributedString(string: "Dis Dat", attributes: [
    .font: NSFont(name: "Georgia-Bold", size: 30) ?? NSFont.boldSystemFont(ofSize: 30),
    .foregroundColor: ink,
])
let ts = title.size()
let gap: CGFloat = 12
let groupW = cursorW + gap + ts.width
let groupX = (W - groupW) / 2
let topY: CGFloat = H - 78           // baseline-ish for the lockup

// cursor (drawn from its top-left, so flip rows into bottom-left space)
ink.setFill()
let curX = groupX
let curTop = topY + ts.height * 0.78
for (r, line) in art.enumerated() {
    for (c, ch) in line.enumerated() where ch != "." {
        let x = curX + CGFloat(c) * cell
        let y = curTop - CGFloat(r + 1) * cell
        NSRect(x: x, y: y, width: cell, height: cell).fill()
    }
}
title.draw(at: NSPoint(x: groupX + cursorW + gap, y: topY))

// ── Instruction, centered below the icons ──
let instr = NSAttributedString(string: "Drag Dis Dat onto Applications to install", attributes: [
    .font: NSFont.systemFont(ofSize: 13, weight: .medium),
    .foregroundColor: ink.withAlphaComponent(0.6),
])
let isz = instr.size()
instr.draw(at: NSPoint(x: (W - isz.width) / 2, y: H - 320))

NSGraphicsContext.restoreGraphicsState()

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "dmg-bg.png"
guard let data = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("make-bg: PNG encode failed\n".utf8)); exit(1)
}
do { try data.write(to: URL(fileURLWithPath: out)) }
catch { FileHandle.standardError.write(Data("make-bg: write failed: \(error)\n".utf8)); exit(1) }
