import Foundation
import Carbon
import AppKit

/// Registers global hotkeys:
///   - Cmd+Shift+X  → capture overlay
///   - Cmd+Shift+V  → smart paste (most recent capture: text then image)
@MainActor
class HotkeyService {
    private weak var appState: AppState?

    // Capture hotkey
    private var captureHotKeyRef: EventHotKeyRef?
    private var captureEventHandler: EventHandlerRef?

    // Smart paste hotkey
    private var pasteHotKeyRef: EventHotKeyRef?
    private var pasteEventHandler: EventHandlerRef?

    private var registeredModifiers: UInt32 = 0
    private var registeredKeyCode: UInt32 = 0

    init(appState: AppState) {
        self.appState = appState
    }

    func register() {
        unregister()

        guard let appState else { return }
        registeredModifiers = appState.hotkeyModifiers
        registeredKeyCode   = appState.hotkeyKeyCode

        // Single event handler dispatches to the right action based on hotkey ID signature.
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let rawSelf = Unmanaged.passUnretained(self).toOpaque()

        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData -> OSStatus in
            guard let userData, let event else { return noErr }
            var hkID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject),
                              EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &hkID)
            let service = Unmanaged<HotkeyService>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async {
                switch hkID.signature {
                case OSType(0x5343_4150): service.captureHotkeyFired()   // "SCAP"
                case OSType(0x5343_5056): service.smartPasteFired()      // "SCPV"
                default: break
                }
            }
            return noErr
        }, 1, &eventType, rawSelf, &captureEventHandler)

        // Capture: Cmd+Shift+X (configurable)
        let captureID = EventHotKeyID(signature: OSType(0x5343_4150), id: 1)
        RegisterEventHotKey(registeredKeyCode, registeredModifiers, captureID,
                            GetApplicationEventTarget(), 0, &captureHotKeyRef)

        // Smart paste: Cmd+Shift+V (keyCode 9)
        let pasteID = EventHotKeyID(signature: OSType(0x5343_5056), id: 2)
        RegisterEventHotKey(9, UInt32(cmdKey | shiftKey), pasteID,
                            GetApplicationEventTarget(), 0, &pasteHotKeyRef)

        print("[HotkeyService] registered capture=Cmd+Shift+X paste=Cmd+Shift+V")
    }

    func unregister() {
        if let ref = captureHotKeyRef { UnregisterEventHotKey(ref); captureHotKeyRef = nil }
        if let ref = pasteHotKeyRef   { UnregisterEventHotKey(ref); pasteHotKeyRef = nil }
        if let h = captureEventHandler { RemoveEventHandler(h); captureEventHandler = nil }
        if let h = pasteEventHandler   { RemoveEventHandler(h); pasteEventHandler = nil }
    }

    private func captureHotkeyFired() {
        print("[HotkeyService] capture fired")
        appState?.isCapturing = true
        RegionSelectorController.shared.show()
    }

    private func smartPasteFired() {
        guard let appState, let capture = appState.captures.first else {
            print("[HotkeyService] smart paste: no captures yet")
            return
        }

        print("[HotkeyService] smart paste firing for capture: \(capture.name)")

        // Step 1 — paste context.md text
        if let text = try? String(contentsOf: capture.contextURL, encoding: .utf8) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            simulatePaste()
            print("[HotkeyService] smart paste step 1: context.md pasted (\(text.count) chars)")
        }

        // Step 2 — paste screenshot image (120ms later — enough for the app to process step 1)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            guard let img = NSImage(contentsOf: capture.screenshotURL),
                  let tiff = img.tiffRepresentation else {
                print("[HotkeyService] smart paste step 2: screenshot not found")
                return
            }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setData(tiff, forType: .tiff)
            self.simulatePaste()
            print("[HotkeyService] smart paste step 2: screenshot pasted")
        }
    }

    /// Simulate Cmd+V in the frontmost app via CGEvent.
    private func simulatePaste() {
        let src = CGEventSource(stateID: .hidSystemState)
        guard let keyDown = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: true),
              let keyUp   = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: false) else { return }
        keyDown.flags = .maskCommand
        keyUp.flags   = .maskCommand
        keyDown.post(tap: .cgAnnotatedSessionEventTap)
        keyUp.post(tap: .cgAnnotatedSessionEventTap)
    }
}
