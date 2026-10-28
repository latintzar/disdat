import Foundation
import AppKit

/// Assembles a capture package: writes screenshot.png, context.md, manifest.json, notes.md
/// into ~/Documents/SmartCaptures/<name>--<timestamp>/
/// All file I/O runs on a background thread via Task.detached.
class CapturePackager {

    struct CaptureInput {
        let screenshotData: Data
        let selectionRect: CGRect          // in screen coords
        let appName: String                // the captured app/page name
        let sourceURL: String              // URL (for web) or app name
        let axTree: AXNode?
        let browserDOM: String?
        let note: String?
        let viewport: ViewportInfo
    }

    // MARK: - Public

    static func package(_ input: CaptureInput, saveTo baseDir: URL) throws -> CapturePackage {
        let timestamp = Date()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime]

        let safeName = sanitizeName(input.appName)
        let tsString = iso.string(from: timestamp)
            .replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "+", with: "")
        let dirName = "\(safeName)--\(tsString)"
        let dir = baseDir.appendingPathComponent(dirName)

        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        print("[CapturePackager] writing to \(dir.path)")

        // 1. screenshot.png
        let ssURL = dir.appendingPathComponent("screenshot.png")
        try input.screenshotData.write(to: ssURL)

        // 2. context.md
        let contextMD = buildContextMD(input: input, timestamp: timestamp, dirName: dirName)
        let contextURL = dir.appendingPathComponent("context.md")
        try contextMD.write(to: contextURL, atomically: true, encoding: .utf8)

        // 3. notes.md (if note provided)
        var files = ["screenshot.png", "context.md", "manifest.json"]
        if let note = input.note, !note.isEmpty {
            let notesURL = dir.appendingPathComponent("notes.md")
            try "# Notes\n\n\(note)\n".write(to: notesURL, atomically: true, encoding: .utf8)
            files.append("notes.md")
        }

        // 4. manifest.json
        let manifest: [String: Any] = [
            "version": 1,
            "name": dirName,
            "url": input.sourceURL,
            "timestamp": iso.string(from: timestamp),
            "viewport": [
                "width": input.viewport.width,
                "height": input.viewport.height,
                "scale": input.viewport.scale,
            ],
            "selectionRect": [
                "x": Int(input.selectionRect.origin.x),
                "y": Int(input.selectionRect.origin.y),
                "width": Int(input.selectionRect.width),
                "height": Int(input.selectionRect.height),
            ],
            "note": input.note ?? "",
            "files": files,
        ]
        let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try manifestData.write(to: dir.appendingPathComponent("manifest.json"))

        let ssSize = input.screenshotData.count
        let ctxSize = contextMD.utf8.count
        print("[CapturePackager] done — screenshot \(ssSize/1024)KB, context \(ctxSize/1024)KB")

        return CapturePackage(
            directoryURL: dir,
            name: dirName,
            url: input.sourceURL,
            timestamp: timestamp,
            viewport: input.viewport,
            note: input.note,
            files: files
        )
    }

    // MARK: - context.md builder

    private static func buildContextMD(input: CaptureInput, timestamp: Date, dirName: String) -> String {
        let dateStr = ISO8601DateFormatter().string(from: timestamp)
        var L: [String] = []

        L.append("# Smart Capture")
        L.append("")
        L.append("| Field | Value |")
        L.append("|-------|-------|")
        L.append("| App / URL | \(input.sourceURL) |")
        L.append("| Captured | \(dateStr) |")
        L.append("| Selection | \(Int(input.selectionRect.width))x\(Int(input.selectionRect.height)) at (\(Int(input.selectionRect.origin.x)), \(Int(input.selectionRect.origin.y))) |")
        L.append("| Viewport | \(input.viewport.width)x\(input.viewport.height) @\(input.viewport.scale)x |")
        L.append("")

        if let note = input.note, !note.isEmpty {
            L.append("## Note")
            L.append("")
            L.append(note)
            L.append("")
        }

        L.append("## Screenshot")
        L.append("")
        L.append("See `screenshot.png` — attach it alongside this file when prompting an AI agent.")
        L.append("Elements marked **← IN SELECTION** in the trees below are in the screenshot region.")
        L.append("The rest provide surrounding window context.")
        L.append("")

        // Accessibility tree
        if let tree = input.axTree {
            L.append("## Accessibility Tree")
            L.append("")
            L.append("How the OS accessibility layer sees this window. Roles, names, states.")
            L.append("Elements marked `← IN SELECTION` are within the captured region.")
            L.append("")
            L.append("```yaml")
            L.append(tree.toYAML(indent: 0, selectionRect: input.selectionRect))
            L.append("```")
            L.append("")

            // Element catalog
            let catalog = tree.flatCatalog()
            if !catalog.isEmpty {
                L.append("## Element Catalog")
                L.append("")
                L.append("\(catalog.count) interactive / semantic elements. ✓ = inside selection:")
                L.append("")
                L.append("| # | Tag | Text / Label | Size | Position |")
                L.append("|---|-----|-------------|------|----------|")
                for (i, node) in catalog.prefix(150).enumerated() {
                    L.append(node.catalogRow(index: i + 1))
                }
                L.append("")
            }
        } else {
            L.append("## Accessibility Tree")
            L.append("")
            L.append("_Not available — grant Accessibility permission in System Settings > Privacy & Security > Accessibility._")
            L.append("")
        }

        // Browser deep extraction (JSON from JS injection)
        if let raw = input.browserDOM, !raw.isEmpty {
            if raw == BrowserBridge.automationNotGrantedSentinel {
                // Automation permission was denied — render a clear actionable warning
                let appName = input.appName.lowercased()
                let browserName: String
                if appName.contains("chrome") { browserName = "Google Chrome" }
                else if appName.contains("safari") { browserName = "Safari" }
                else if appName.contains("edge") { browserName = "Microsoft Edge" }
                else if appName.contains("arc") { browserName = "Arc" }
                else if appName.contains("brave") { browserName = "Brave Browser" }
                else { browserName = "your browser" }

                L.append("## Browser DOM")
                L.append("")
                L.append("> **NOT AVAILABLE** — Automation permission not granted for \(browserName).")
                L.append(">")
                L.append("> Without this, Smart Capture can only see accessibility labels — not the actual page")
                L.append("> structure, tech stack, design tokens, animations, or computed styles.")
                L.append(">")
                L.append("> **Grant it:** System Settings → Privacy & Security → Automation → Smart Capture → enable \(browserName)")
                L.append(">")
                L.append("> Then capture again to get the full DOM tree and all extraction data.")
                L.append("")
            } else if let data = raw.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                renderBrowserExtraction(json, into: &L)
            } else {
                // Fallback: raw DOM string (old format or parse failure)
                L.append("## Browser DOM")
                L.append("")
                L.append("```html")
                L.append(raw.trimmingCharacters(in: .whitespacesAndNewlines))
                L.append("```")
                L.append("")
            }
        }

        L.append("## How to use this file")
        L.append("")
        L.append("1. Drag `screenshot.png` into your AI chat for visual context")
        L.append("2. Drag or paste `context.md` for structural understanding")
        L.append("3. In Cursor: `@\(dirName)/`")
        L.append("4. In Claude Code / CLI agents: point to the full path of this file")
        L.append("")

        return L.joined(separator: "\n")
    }

    // MARK: - Browser extraction renderer

    private static func renderBrowserExtraction(_ json: [String: Any], into L: inout [String]) {
        let url = json["url"] as? String ?? ""

        // Tech Stack
        if let stack = json["techStack"] as? [String], !stack.isEmpty {
            L.append("## Tech Stack")
            L.append("")
            L.append(stack.joined(separator: " · "))
            L.append("")
        }

        // URL
        if !url.isEmpty {
            L.append("**URL:** \(url)")
            L.append("")
        }

        // Meta
        if let meta = json["meta"] as? [String: Any] {
            let lang = meta["lang"] as? String ?? ""
            let viewport = meta["viewport"] as? String ?? ""
            let theme = meta["themeColor"] as? String ?? ""
            if !lang.isEmpty || !viewport.isEmpty || !theme.isEmpty {
                L.append("## Page Meta")
                L.append("")
                if !lang.isEmpty { L.append("- **Language:** \(lang)") }
                if !viewport.isEmpty { L.append("- **Viewport:** \(viewport)") }
                if !theme.isEmpty { L.append("- **Theme Color:** \(theme)") }
                L.append("")
            }
        }

        // CSS Custom Properties (design tokens)
        if let vars = json["cssVars"] as? [String: String], !vars.isEmpty {
            L.append("## CSS Custom Properties (Design Tokens)")
            L.append("")
            L.append("Variables defined on `:root` — the design system of this page:")
            L.append("")
            L.append("```css")
            for (key, val) in vars.sorted(by: { $0.key < $1.key }).prefix(50) {
                L.append("\(key): \(val);")
            }
            L.append("```")
            L.append("")
        }

        // Color Palette + Font Families
        if let colors = json["colorPalette"] as? [String], !colors.isEmpty {
            L.append("## Color Palette")
            L.append("")
            L.append(colors.joined(separator: ", "))
            L.append("")
        }
        if let fonts = json["fontFamilies"] as? [String], !fonts.isEmpty {
            L.append("## Font Families")
            L.append("")
            L.append(fonts.joined(separator: " · "))
            L.append("")
        }

        // Loaded Fonts
        if let loaded = json["fonts"] as? [[String: Any]], !loaded.isEmpty {
            L.append("## Loaded Fonts")
            L.append("")
            for f in loaded.prefix(15) {
                let family = f["family"] as? String ?? "?"
                let weight = f["weight"] as? String ?? "400"
                let style = f["style"] as? String ?? "normal"
                L.append("- \(family) \(weight) \(style)")
            }
            L.append("")
        }

        // Animations (with keyframes)
        if let anims = json["animations"] as? [[String: Any]], !anims.isEmpty {
            L.append("## Animations")
            L.append("")
            for a in anims.prefix(20) {
                let name = a["name"] as? String ?? "?"
                let target = a["target"] as? String ?? "?"
                let dur = a["duration"] as? Double
                let easing = a["easing"] as? String ?? ""
                let delay = a["delay"] as? Double ?? 0
                let iters = a["iterations"] as? Double
                let dir = a["direction"] as? String ?? ""
                var line = "**\(name)** → `\(target)`"
                if let d = dur { line += " | \(Int(d))ms" }
                if !easing.isEmpty { line += " | \(easing)" }
                if delay > 0 { line += " | delay \(Int(delay))ms" }
                if let it = iters, it != 1 { line += " | \(it == .infinity ? "∞" : String(Int(it))) iterations" }
                if !dir.isEmpty && dir != "normal" { line += " | \(dir)" }
                L.append(line)
                // Keyframes
                if let kfs = a["keyframes"] as? [[String: Any]], !kfs.isEmpty {
                    for kf in kfs {
                        let offset = kf["offset"] as? Double ?? 0
                        let kfEasing = kf["easing"] as? String ?? ""
                        let props = kf.filter { !["offset", "easing"].contains($0.key) }
                            .map { "\($0.key): \($0.value)" }.joined(separator: "; ")
                        L.append("  - \(Int(offset * 100))%: \(props)\(kfEasing.isEmpty ? "" : " (\(kfEasing))")")
                    }
                }
            }
            L.append("")
        }

        // Transitions
        if let trans = json["transitions"] as? [[String: Any]], !trans.isEmpty {
            L.append("## CSS Transitions")
            L.append("")
            for t in trans.prefix(20) {
                let target = t["target"] as? String ?? "?"
                let prop = t["property"] as? String ?? ""
                let dur = t["duration"] as? String ?? ""
                let easing = t["easing"] as? String ?? ""
                L.append("- `\(target)` → \(prop) \(dur) \(easing)")
            }
            L.append("")
        }

        // WebGL / Canvas
        if let canvases = json["canvases"] as? [[String: Any]], !canvases.isEmpty {
            L.append("## Canvas / WebGL")
            L.append("")
            for c in canvases {
                let size = c["size"] as? String ?? "?"
                let ctx = c["contextType"] as? String ?? "2D"
                let hasGL = c["hasWebGL"] as? Bool ?? false
                L.append("- \(size) canvas — \(hasGL ? ctx : "2D context")")
            }
            L.append("")
        }

        // Scroll behavior
        if let scroll = json["scroll"] as? [String: Any] {
            let behavior = scroll["behavior"] as? String ?? "auto"
            let snap = scroll["snapType"] as? String ?? "none"
            let overscroll = scroll["overscrollBehavior"] as? String ?? "auto"
            if behavior != "auto" || snap != "none" || overscroll != "auto" {
                L.append("## Scroll Behavior")
                L.append("")
                if behavior != "auto" { L.append("- scroll-behavior: \(behavior)") }
                if snap != "none" { L.append("- scroll-snap-type: \(snap)") }
                if overscroll != "auto" { L.append("- overscroll-behavior: \(overscroll)") }
                L.append("")
            }
        }

        // Responsive breakpoints
        if let bp = json["breakpoints"] as? [Int], !bp.isEmpty {
            L.append("## Responsive Breakpoints")
            L.append("")
            L.append(bp.map { "\($0)px" }.joined(separator: " · "))
            L.append("")
        }

        // External scripts
        if let scripts = json["scripts"] as? [String], !scripts.isEmpty {
            L.append("## External Scripts")
            L.append("")
            for s in scripts.prefix(15) {
                let short = s.count > 100 ? String(s.prefix(100)) + "…" : s
                L.append("- \(short)")
            }
            L.append("")
        }

        // Stylesheets
        if let sheets = json["stylesheets"] as? [String], !sheets.isEmpty {
            L.append("## Stylesheets")
            L.append("")
            for s in sheets.prefix(10) {
                let short = s.count > 100 ? String(s.prefix(100)) + "…" : s
                L.append("- \(short)")
            }
            L.append("")
        }

        // DOM tree
        if let dom = json["dom"] as? String, !dom.isEmpty {
            L.append("## Browser DOM")
            L.append("")
            L.append("Full DOM tree (12 levels). Per-element inline styles: color, bg, font-size, font-weight,")
            L.append("border-radius, shadow, opacity, transform, position, display, gap.")
            L.append("")
            L.append("```html")
            L.append(dom.trimmingCharacters(in: .whitespacesAndNewlines))
            L.append("```")
            L.append("")
        }
    }

    // MARK: - Helpers

    private static func sanitizeName(_ name: String) -> String {
        let clean = name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return clean.isEmpty ? "capture" : String(clean.prefix(40))
    }
}
