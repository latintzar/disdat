import AppKit
import Carbon.HIToolbox

/// The user-rebindable global recording shortcut.
///
/// Persisted to UserDefaults as a raw keyCode + Carbon modifier mask plus a
/// pre-rendered display string (e.g. "⌃ ⌥ ⌘ Space") that the Settings keycaps
/// and the pill's hover bubble both read. `RecorderShortcut.current` is the
/// single source of truth; writing it posts `.disdatShortcutChanged` so the
/// Carbon hotkey re-registers live.
struct RecorderShortcut: Equatable {
    var keyCode: UInt32
    var carbonModifiers: UInt32   // controlKey | optionKey | cmdKey | shiftKey
    var display: String           // space-separated glyphs, e.g. "⌃ ⌥ ⌘ Space"

    static let `default` = RecorderShortcut(
        keyCode: UInt32(kVK_Space),
        carbonModifiers: UInt32(controlKey | optionKey | cmdKey),
        display: "⌃ ⌥ ⌘ Space")

    private static let kCode = "disdat.shortcut.keyCode"
    private static let kMods = "disdat.shortcut.carbonMods"
    private static let kDisp = "disdat.shortcut.display"

    static var current: RecorderShortcut {
        get {
            let d = UserDefaults.standard
            guard d.object(forKey: kCode) != nil else { return .default }
            return RecorderShortcut(
                keyCode: UInt32(d.integer(forKey: kCode)),
                carbonModifiers: UInt32(d.integer(forKey: kMods)),
                display: d.string(forKey: kDisp) ?? RecorderShortcut.default.display)
        }
        set {
            let d = UserDefaults.standard
            d.set(Int(newValue.keyCode), forKey: kCode)
            d.set(Int(newValue.carbonModifiers), forKey: kMods)
            d.set(newValue.display, forKey: kDisp)
            NotificationCenter.default.post(name: .disdatShortcutChanged, object: nil)
        }
    }

    /// The display string split into individual keycap labels.
    var keys: [String] { display.split(separator: " ").map(String.init) }

    /// Build from a captured key event. Returns nil if no non-shift modifier is
    /// held (a bare key or shift-only combo is too easy to trigger accidentally).
    static func from(event: NSEvent) -> RecorderShortcut? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let hasReal = flags.contains(.command) || flags.contains(.control) || flags.contains(.option)
        guard hasReal else { return nil }

        var carbon: UInt32 = 0
        var glyphs: [String] = []
        if flags.contains(.control) { carbon |= UInt32(controlKey); glyphs.append("⌃") }
        if flags.contains(.option)  { carbon |= UInt32(optionKey);  glyphs.append("⌥") }
        if flags.contains(.shift)   { carbon |= UInt32(shiftKey);   glyphs.append("⇧") }
        if flags.contains(.command) { carbon |= UInt32(cmdKey);     glyphs.append("⌘") }

        let code = UInt32(event.keyCode)
        glyphs.append(label(for: code, event: event))
        return RecorderShortcut(keyCode: code, carbonModifiers: carbon, display: glyphs.joined(separator: " "))
    }

    /// Human label for a key code. Special keys are named; everything else falls
    /// back to the typed character (uppercased).
    private static func label(for code: UInt32, event: NSEvent) -> String {
        if let named = specialKeys[Int(code)] { return named }
        let chars = (event.charactersIgnoringModifiers ?? "").uppercased()
        // Filter out control characters that some keys produce.
        let clean = chars.unicodeScalars.filter { $0.value >= 32 }.map(String.init).joined()
        return clean.isEmpty ? "Key\(code)" : clean
    }

    private static let specialKeys: [Int: String] = [
        kVK_Space: "Space", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Delete: "⌫",
        kVK_Escape: "⎋", kVK_ForwardDelete: "⌦",
        kVK_LeftArrow: "←", kVK_RightArrow: "→", kVK_UpArrow: "↑", kVK_DownArrow: "↓",
        kVK_Home: "↖", kVK_End: "↘", kVK_PageUp: "⇞", kVK_PageDown: "⇟",
        kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6",
        kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
    ]
}

extension Notification.Name {
    static let disdatShortcutChanged = Notification.Name("disdat.shortcut.changed")
}
