import Foundation
import AppKit

/// Walks the macOS Accessibility tree for any window/app and serializes it into AXNode trees.
class AccessibilityService {

    // MARK: - Public API

    /// Capture the AX tree for a specific process (by PID).
    /// Using PID directly avoids the hit-test timing bug where the overlay or focus-shift
    /// causes AXUIElementCopyElementAtPosition to return the wrong app's window.
    /// Pass `isBrowser: true` to strip browser chrome (toolbars, tab bar) from the output.
    static func captureTree(pid: pid_t, selectionRect: CGRect, isBrowser: Bool = false) -> AXNode? {
        guard AXIsProcessTrusted() else {
            print("[AccessibilityService] Not trusted — Accessibility permission not granted")
            return nil
        }
        guard pid != 0 else {
            print("[AccessibilityService] No target PID")
            return nil
        }

        let axSelectionRect = flipRectToTopLeft(selectionRect)
        let appElement = AXUIElementCreateApplication(pid)

        // Get the frontmost window of this application
        var windowVal: AnyObject?
        AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowVal)
        var window = windowVal.map { $0 as! AXUIElement }

        // Fallback: first window in the windows list
        if window == nil {
            var windowsVal: AnyObject?
            AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsVal)
            window = (windowsVal as? [AXUIElement])?.first
        }

        guard let rootElement = window else {
            print("[AccessibilityService] No window found for pid=\(pid)")
            return nil
        }

        print("[AccessibilityService] capturing tree for pid=\(pid) isBrowser=\(isBrowser)")
        return buildNode(from: rootElement, selectionRect: axSelectionRect, depth: 0, maxDepth: 12, stripBrowserChrome: isBrowser)
    }

    // MARK: - Tree walking

    private static func findWindow(from element: AXUIElement) -> AXUIElement? {
        var current: AXUIElement = element
        for _ in 0..<20 {
            var role: AnyObject?
            AXUIElementCopyAttributeValue(current, kAXRoleAttribute as CFString, &role)
            if let r = role as? String, r == kAXWindowRole {
                return current
            }
            var parent: AnyObject?
            let res = AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &parent)
            guard res == .success, let p = parent, CFGetTypeID(p as CFTypeRef) == AXUIElementGetTypeID() else {
                break
            }
            current = (p as! AXUIElement)
        }
        return current
    }

    // Roles belonging to browser chrome UI (toolbar, tab bar, bookmarks bar).
    // Stripped when isBrowser=true so context.md only contains the page content.
    private static let browserChromeRoles: Set<String> = ["AXToolbar", "AXTabGroup"]

    private static func buildNode(
        from element: AXUIElement,
        selectionRect: CGRect,
        depth: Int,
        maxDepth: Int,
        stripBrowserChrome: Bool = false
    ) -> AXNode {
        guard depth <= maxDepth else {
            return AXNode(role: "…", title: nil, value: nil, label: nil, frame: .zero, children: [], inSelection: false)
        }

        let role = stringAttr(element, kAXRoleAttribute) ?? "AXUnknown"
        let title = stringAttr(element, kAXTitleAttribute)
        let value = stringAttr(element, kAXValueAttribute)
        let label = stringAttr(element, kAXDescriptionAttribute) ?? stringAttr(element, kAXHelpAttribute)

        let frame = frameAttr(element)
        let inSelection = !selectionRect.isEmpty && selectionRect.intersects(frame)

        // Strip browser chrome (toolbars, tab bar) — noise when capturing a web page.
        // The AXWebArea (actual page content) is always kept.
        if stripBrowserChrome && browserChromeRoles.contains(role) {
            return AXNode(role: role, title: title, value: value, label: label, frame: frame, children: [], inSelection: false)
        }

        // Skip invisible elements
        var isVisible = true
        var hiddenVal: AnyObject?
        if AXUIElementCopyAttributeValue(element, kAXHiddenAttribute as CFString, &hiddenVal) == .success {
            if let h = hiddenVal as? Bool, h { isVisible = false }
        }
        if !isVisible { return AXNode(role: role, title: title, value: value, label: label, frame: frame, children: [], inSelection: false) }

        // Skip off-screen Electron webview panels: AXWebArea nodes with zero size that are
        // kept in memory by Electron but aren't actually visible (different from the active tab).
        if role == "AXWebArea" && frame.size == .zero && depth > 2 {
            return AXNode(role: role, title: title, value: value, label: nil, frame: frame, children: [], inSelection: false)
        }

        // Recurse into children
        var childrenVal: AnyObject?
        var childNodes: [AXNode] = []
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenVal) == .success,
           let children = childrenVal as? [AXUIElement] {
            for child in children {
                let childNode = buildNode(from: child, selectionRect: selectionRect, depth: depth + 1, maxDepth: maxDepth, stripBrowserChrome: stripBrowserChrome)
                if !shouldSkip(childNode) {
                    childNodes.append(childNode)
                }
            }
        }

        return AXNode(role: role, title: title, value: value, label: label, frame: frame, children: childNodes, inSelection: inSelection)
    }

    // MARK: - AX attribute helpers

    private static func stringAttr(_ el: AXUIElement, _ attr: String) -> String? {
        var val: AnyObject?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &val) == .success else { return nil }
        let str = val as? String ?? (val as? NSAttributedString)?.string
        return str.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.flatMap { $0.isEmpty ? nil : String($0.prefix(200)) }
    }

    private static func frameAttr(_ el: AXUIElement) -> CGRect {
        var posVal: AnyObject?
        var sizeVal: AnyObject?
        guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posVal) == .success,
              AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeVal) == .success
        else { return .zero }

        guard CFGetTypeID(posVal as CFTypeRef) == AXValueGetTypeID(),
              CFGetTypeID(sizeVal as CFTypeRef) == AXValueGetTypeID()
        else { return .zero }

        var pos = CGPoint.zero
        var size = CGSize.zero
        AXValueGetValue(posVal as! AXValue, .cgPoint, &pos)
        AXValueGetValue(sizeVal as! AXValue, .cgSize, &size)

        return CGRect(origin: pos, size: size)
    }

    // MARK: - Coordinate helpers (AppKit bottom-left → CG top-left)

    private static func flipPointToTopLeft(_ point: CGPoint) -> CGPoint {
        guard let screen = NSScreen.main else { return point }
        return CGPoint(x: point.x, y: screen.frame.height - point.y)
    }

    private static func flipRectToTopLeft(_ rect: CGRect) -> CGRect {
        guard let screen = NSScreen.main else { return rect }
        let y = screen.frame.height - rect.origin.y - rect.height
        return CGRect(x: rect.origin.x, y: y, width: rect.width, height: rect.height)
    }

    private static func shouldSkip(_ node: AXNode) -> Bool {
        let SKIP_ROLES: Set<String> = ["AXUnknown", "AXSeparator"]
        if SKIP_ROLES.contains(node.role) && node.children.isEmpty { return true }
        if node.frame.width == 0 && node.frame.height == 0 && node.children.isEmpty { return true }
        return false
    }
}
