import AppKit
import CoreGraphics

/// Global key event tap for `fn + cmd + R` (the simple hotkey API can't see the
/// fn/Globe modifier). Requires Accessibility permission; falls back silently
/// to the Carbon hotkey if not granted yet.
final class KeyTap {
    var onTrigger: (() -> Void)?
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?

    func start() {
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: { _, _, event, refcon in
                guard let refcon else { return Unmanaged.passUnretained(event) }
                let me = Unmanaged<KeyTap>.fromOpaque(refcon).takeUnretainedValue()
                let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
                let flags = event.flags
                // R == 15; require fn (secondaryFn) + command.
                if keyCode == 15,
                   flags.contains(.maskSecondaryFn),
                   flags.contains(.maskCommand) {
                    DispatchQueue.main.async { me.onTrigger?() }
                    return nil   // consume so it doesn't trigger a reload, etc.
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            NSLog("[LeoFeedback] fn+cmd+R tap unavailable — grant Accessibility to enable it (Carbon hotkey still works)")
            return
        }
        self.tap = tap
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        NSLog("[LeoFeedback] fn+cmd+R tap active")
    }
}
