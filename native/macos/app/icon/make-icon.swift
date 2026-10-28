import AppKit

// Renders the Dis Dat macOS app icon into an .iconset directory (argv[1]).
// Apple's dock icons leave a transparent margin around a rounded "squircle";
// filling the whole tile makes our icon look oversized next to neighbors. So we
// inset the cream squircle ~8.5% and center the pixel cursor at ~half the tile —
// the same cursor:tile ratio the landing's dock mock uses.

let ink    = NSColor(calibratedRed: 22/255,  green: 17/255, blue: 13/255, alpha: 1)
let cream  = NSColor(calibratedRed: 251/255, green: 247/255, blue: 238/255, alpha: 1)
let orange = NSColor(calibratedRed: 1.0, green: 92/255, blue: 42/255, alpha: 1)

let art = [
    "k...........", "kk..........", "kwk.........", "kwwk........",
    "kwwwk.......", "kwwwwk......", "kwwwwwk.....", "kwwwwwwk....",
    "kwwwwwwwk...", "kwwwwwwwwk..", "kwwwwwwwwwk.", "kwwwwwooook.",
    "kwwwookk....", "kwwok.kk....", "kwok...kk...", "kkk.....k...",
]
let cols = 12, rows = 16

func render(_ N: Int) -> Data? {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: N, pixelsHigh: N,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    ctx.imageInterpolation = .high

    let n = CGFloat(N)
    let inset = n * 0.085
    let side = n - inset * 2
    let radius = side * 0.2237                 // Apple-ish continuous corner
    let rect = NSRect(x: inset, y: inset, width: side, height: side)
    let squircle = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    cream.setFill(); squircle.fill()
    ink.withAlphaComponent(0.08).setStroke(); squircle.lineWidth = max(1, n * 0.004); squircle.stroke()

    // Cursor — black silhouette + orange accent, centered, ~52% of the squircle.
    let cell = (side * 0.52) / CGFloat(rows)
    let cw = CGFloat(cols) * cell, ch = CGFloat(rows) * cell
    let ox = rect.midX - cw / 2
    let oy = rect.midY - ch / 2
    for (r, line) in art.enumerated() {
        for (c, chr) in line.enumerated() where chr != "." {
            (chr == "o" ? orange : ink).setFill()
            let x = ox + CGFloat(c) * cell
            let y = oy + CGFloat(rows - 1 - r) * cell      // AppKit y is bottom-up
            NSRect(x: x, y: y, width: cell + 0.5, height: cell + 0.5).fill()
        }
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
let specs: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
for (name, N) in specs {
    guard let data = render(N) else { continue }
    try? data.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}
print("  ✓ generated AppIcon.iconset (\(specs.count) sizes)")
