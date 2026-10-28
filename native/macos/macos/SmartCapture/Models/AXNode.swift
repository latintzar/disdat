import Foundation
import AppKit

/// A node in the Accessibility tree — serializable representation of an AXUIElement.
struct AXNode {
    let role: String
    let title: String?
    let value: String?
    let label: String?          // AXDescription / aria-label equivalent
    let frame: CGRect           // screen coordinates
    var children: [AXNode]
    var inSelection: Bool       // true if frame intersects the captured region

    // MARK: - YAML serialization for context.md

    func toYAML(indent: Int = 0, selectionRect: CGRect? = nil) -> String {
        let pad = String(repeating: "  ", count: indent)
        var lines: [String] = []

        var summary = role
        if let t = title, !t.isEmpty { summary += " \"\(t.prefix(80).replacingOccurrences(of: "\"", with: "'"))\"" }
        if let l = label, !l.isEmpty, l != title { summary += " [\(l.prefix(60))]" }
        if let v = value, !v.isEmpty, v != title { summary += ": \(v.prefix(80))" }

        let sizeNote = frame.width > 0 ? " # \(Int(frame.width))x\(Int(frame.height))" : ""
        let selNote = inSelection ? " ← IN SELECTION" : ""

        lines.append("\(pad)- \(summary)\(sizeNote)\(selNote)")

        for child in children {
            lines.append(child.toYAML(indent: indent + 1, selectionRect: selectionRect))
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Element catalog row

    func catalogRow(index: Int) -> String {
        let tag = role.lowercased()
        let display = (label ?? title ?? value ?? "—").prefix(50).replacingOccurrences(of: "|", with: "/")
        let size = "\(Int(frame.width))x\(Int(frame.height))"
        let pos = "\(Int(frame.origin.x)),\(Int(frame.origin.y))"
        let sel = inSelection ? " ✓" : ""
        return "| \(index) | `<\(tag)>` | \(display)\(sel) | \(size) | \(pos) |"
    }

    // MARK: - Flat catalog

    func flatCatalog() -> [AXNode] {
        let SEMANTIC_ROLES: Set<String> = [
            "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXCheckBox",
            "AXRadioButton", "AXComboBox", "AXPopUpButton", "AXMenuItem",
            "AXMenuButton", "AXTab", "AXCell", "AXImage",
            "AXHeading", "AXStaticText", "AXGroup", "AXList", "AXTable",
            "AXNavigationBar", "AXToolbar", "AXScrollArea",
        ]
        var result: [AXNode] = []
        if SEMANTIC_ROLES.contains(role) {
            result.append(self)
        }
        for child in children {
            result.append(contentsOf: child.flatCatalog())
        }
        return result
    }
}
