import SwiftUI
import AppKit

@main
struct SmartCaptureApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // No windows — this is a menu bar only app (LSUIElement = true)
        Settings {
            EmptyView()
        }
    }
}

/// AppDelegate manages the NSStatusItem (menu bar icon) and orchestrates the app lifecycle.
@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var popover: NSPopover?
    var appState: AppState!
    var hotkeyService: HotkeyService!
    var eventMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        CrashReporter.shared.start()

        NSApp.setActivationPolicy(.accessory)

        appState = AppState()
        hotkeyService = HotkeyService(appState: appState)
        RegionSelectorController.shared.appState = appState

        setupStatusItem()
        setupPopover()
        hotkeyService.register()
        checkPermissions()

        print("[SmartCapture] launched — captures saved to \(appState.capturesDirectory.path)")
    }

    func applicationWillTerminate(_ notification: Notification) {
        hotkeyService.unregister()
    }

    // MARK: - Status Item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem?.button {
            // SF Symbol camera.viewfinder — falls back to text if unavailable
            if let img = NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: "Smart Capture") {
                img.isTemplate = true  // adapts to light/dark menu bar
                button.image = img
            } else {
                button.title = "SC"
            }
            button.action = #selector(togglePopover)
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
    }

    @objc private func togglePopover() {
        guard let button = statusItem?.button else { return }
        if let popover, popover.isShown {
            popover.performClose(nil)
            removeEventMonitor()
        } else {
            popover?.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
            addEventMonitor()
        }
    }

    // MARK: - Popover

    private func setupPopover() {
        let popover = NSPopover()
        popover.contentSize = NSSize(width: 380, height: 420)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(
            rootView: GridPopoverView()
                .environmentObject(appState)
        )
        self.popover = popover
    }

    // Click outside to dismiss
    private func addEventMonitor() {
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.popover?.performClose(nil)
            self?.removeEventMonitor()
        }
    }

    private func removeEventMonitor() {
        if let m = eventMonitor { NSEvent.removeMonitor(m) }
        eventMonitor = nil
    }

    // MARK: - Permissions

    private func checkPermissions() {
        // Screen Recording: prompt if not granted
        if !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess()
        }
        // Accessibility: prompt user to enable in Settings if not trusted
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false]
        let trusted = AXIsProcessTrustedWithOptions(options)
        if !trusted {
            print("[SmartCapture] Accessibility not granted — UI tree extraction unavailable until user enables in Settings > Privacy > Accessibility")
        }
        appState.accessibilityGranted = trusted
        appState.screenRecordingGranted = CGPreflightScreenCaptureAccess()
    }
}
