import AppKit
import Carbon.HIToolbox
import ApplicationServices
import SwiftUI

// Dis Dat — the full app.
// Real window (sidebar + Library + Settings + Sign in) + menu-bar status item
// + global hotkey + recording overlay + disdat:// URL handler for the browser
// Google sign-in callback.

final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = AppStore()
    private var statusItem: NSStatusItem!
    private var window: NSWindow?
    private var hotKeyRef: EventHotKeyRef?
    private var recording = false
    private var session: FeedbackSession?
    // Sessions whose capture has stopped but whose background upload (and, for
    // onboarding, transcript poll) is still in flight. Holding a strong ref here
    // keeps the FeedbackSession — and its upload-completion clipboard write — alive
    // even after `session` is cleared for the next recording.
    private var inFlightSessions: [FeedbackSession] = []
    private let keyTap = KeyTap()
    private let recorderPill = RecorderPill()
    private var toggleObserver: NSObjectProtocol?
    private var updateTimer: Timer?

    func applicationDidFinishLaunching(_ note: Notification) {
        // Force light appearance app-wide — the brand is cream/ink, and the
        // dynamic system colors (windowBackgroundColor etc.) otherwise resolve
        // dark in dark mode and clash with our dark ink text.
        NSApp.appearance = NSAppearance(named: .aqua)

        // ── Application menu bar — gives us a working ⌘Q, About, Settings, etc.
        NSApp.mainMenu = buildAppMenuBar()

        // ── Status item in the system menu bar (white pixel cursor)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateStatusIcon()
        let menu = NSMenu()
        let toggleItem = NSMenuItem(title: "Start Recording  (⌃⌥⌘Space)",
                                    action: #selector(toggle), keyEquivalent: "")
        toggleItem.target = self; menu.addItem(toggleItem)
        let openItem = NSMenuItem(title: "Open Dis Dat", action: #selector(showWindow), keyEquivalent: "")
        openItem.target = self; menu.addItem(openItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Dis Dat",
                                action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu

        installHotKeyHandler()
        registerHotKey()
        NotificationCenter.default.addObserver(
            self, selector: #selector(shortcutChanged),
            name: .disdatShortcutChanged, object: nil)
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }
        let opts = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        keyTap.onTrigger = { [weak self] in self?.toggle() }
        keyTap.start()

        // Sidebar "Start recording" button posts this notification
        toggleObserver = NotificationCenter.default.addObserver(
            forName: .disdatToggleRecording, object: nil, queue: .main
        ) { [weak self] _ in self?.toggle() }

        // Persistent bottom-center recorder pill. Idle click / ✓ finishes,
        // ✕ cancels, and a click while idle starts.
        recorderPill.onStart  = { [weak self] in self?.startRecording() }
        recorderPill.onFinish = { [weak self] in self?.stopRecording() }
        recorderPill.onCancel = { [weak self] in self?.cancelRecording() }
        recorderPill.show()

        // ── Main window with SwiftUI content
        store.loadSessions()
        let content = MainView().environmentObject(store)
        let host = NSHostingController(rootView: content)
        // Don't let SwiftUI content drive the window's min/max size — it was
        // forcing the window absurdly tall (snapping past the screen bottom and
        // refusing to resize). We pick the size ourselves.
        host.sizingOptions = []
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1160, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        win.title = "Dis Dat"
        // Programmatic NSWindows default to isReleasedWhenClosed = true: closing the
        // window frees it while our `self.window` strong ref still points at it, so the
        // next dock-icon reopen messages freed memory and crashes (EXC_BAD_ACCESS in
        // applicationShouldHandleReopen → makeKeyAndOrderFront). We keep the window and
        // just hide/show it, so it must NOT be released on close.
        win.isReleasedWhenClosed = false
        win.titlebarAppearsTransparent = true
        win.titleVisibility = .hidden
        win.isMovableByWindowBackground = true
        win.contentViewController = host
        // Assigning contentViewController makes the window snap to the hosting
        // controller's fitting size — which, with host.sizingOptions = [] and no
        // explicit frame on the SwiftUI root, collapses to ~1×0. That discarded the
        // 1160×860 contentRect above and opened the window as a 1px sliver ("the
        // window won't open"). Force the real content size back AFTER the VC is set.
        win.setContentSize(NSSize(width: 1160, height: 860))
        win.minSize = NSSize(width: 900, height: 600)
        // Open on whatever Space the user is currently looking at (e.g. a second
        // desktop) instead of the Space the app happened to launch on — otherwise
        // clicking the pill appears to do nothing because the window is off-Space.
        win.collectionBehavior = [.moveToActiveSpace]
        // Center on the screen the user is actually on (cursor's display), not just
        // the main one — NSWindow.center() / a saved autosave frame can land it
        // off-screen or on the wrong monitor. A touch above true center reads best.
        let activeScreen = NSScreen.screens.first(where: { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }) ?? NSScreen.main
        if let vf = activeScreen?.visibleFrame {
            let s = win.frame.size
            win.setFrameOrigin(NSPoint(x: vf.midX - s.width / 2,
                                       y: vf.midY - s.height / 2 + vf.height * 0.04))
        } else {
            win.center()
        }
        win.makeKeyAndOrderFront(nil)
        self.window = win
        NSLog("[DD] launch window frame=\(NSStringFromRect(win.frame)) contentSize=\(NSStringFromSize(win.contentLayoutRect.size))")

        // First-run onboarding (only until the user dismisses it).
        if !UserDefaults.standard.bool(forKey: "disdat.onboarded.v1") {
            store.pane = .onboarding
        }

        // Restore signed-in state from Keychain on launch. A token in the Keychain
        // means the user is signed in — flip `signedIn` IMMEDIATELY, synchronously,
        // so a click/hotkey right after launch records instead of bouncing to the
        // signin pane. Gating this on the async /me round-trip meant a returning user
        // couldn't record during the network window, and was locked out entirely if
        // /me ever failed. /me now only refines email + pro status in the background.
        if AuthSession.isSignedIn {
            store.signedIn = true
            store.userEmail = AuthSession.email ?? ""
            AuthSession.authorizedRequest(URL(string: "\(DisDatConfig.apiBase)/me")!) { req in
                guard let req else { return }
                URLSession.shared.dataTask(with: req) { data, _, _ in
                    let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
                    let email = obj?["email"] as? String ?? AuthSession.email
                    let status = obj?["subscription_status"] as? String ?? "none"
                    let isPro = (status == "active" || status == "trialing")
                    DispatchQueue.main.async {
                        self.store.signedIn = true
                        self.store.userEmail = email
                        self.store.pro = isPro
                    }
                }.resume()
            }
        }

        // ── In-app updater: check shortly after launch, then every 6 hours.
        // Downloads + stages silently in the background; the sidebar shows a
        // "Relaunch to update" banner once a newer build is ready.
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.store.checkForUpdate() }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            self?.store.checkForUpdate()
        }

        NSLog("[Dis Dat] launched")

        // Debug-only: drive a recording start without Accessibility (ssh can't
        // synthesize the global hotkey). Gated by env var so it never fires in shipped builds.
        if ProcessInfo.processInfo.environment["DD_DEBUG_AUTOSTART"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                NSLog("[DD] DD_DEBUG_AUTOSTART → calling toggle()")
                self.toggle()
            }
        }
        if ProcessInfo.processInfo.environment["DD_DEBUG_FULLSCREEN"] != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                NSLog("[DD] DD_DEBUG_FULLSCREEN → toggling window fullscreen")
                self.window?.toggleFullScreen(nil)
            }
        }
    }

    // Browser sign-in returns here via disdat:// scheme
    func application(_ app: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "disdat-local" { handleAuthCallback(url) }
    }

    // Closing the last window keeps the app alive in the dock — like Wispr Flow.
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
        return false
    }

    // When the user clicks the dock icon after closing the window, re-open it.
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { showWindow() }
        return true
    }

    // Coming back to the app (e.g. after finishing the Stripe upgrade in the
    // browser) re-checks subscription status so Pro flips on without a relaunch.
    func applicationDidBecomeActive(_ notification: Notification) {
        refreshSubscription()
        store.checkForUpdate()
    }

    // Hit /me and update signed-in + Pro state. Safe to call repeatedly.
    private func refreshSubscription() {
        guard AuthSession.isSignedIn else { return }
        AuthSession.authorizedRequest(URL(string: "\(DisDatConfig.apiBase)/me")!) { req in
            guard let req else { return }
            URLSession.shared.dataTask(with: req) { data, _, _ in
                let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
                let email = obj?["email"] as? String ?? AuthSession.email
                let status = obj?["subscription_status"] as? String ?? "none"
                let isPro = (status == "active" || status == "trialing")
                DispatchQueue.main.async {
                    self.store.signedIn = true
                    self.store.userEmail = email
                    self.store.pro = isPro
                    // Leaving the limit-gate Upgrade screen once they actually upgraded.
                    if isPro && self.store.pane == .upgrade { self.store.pane = .library }
                }
            }.resume()
        }
    }

    // ── Application menu bar (the one across the top of the screen) ──────────
    private func buildAppMenuBar() -> NSMenu {
        let main = NSMenu()
        // App menu (named "Dis Dat") — About, Settings, Hide, Quit.
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Dis Dat")
        appMenu.addItem(NSMenuItem(title: "About Dis Dat", action: #selector(showAbout), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: ""))
        appMenu.addItem(.separator())
        let settings = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        appMenu.addItem(settings)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Hide Dis Dat", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Dis Dat", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu
        main.addItem(appItem)

        // File menu
        let fileItem = NSMenuItem(); fileItem.title = "File"
        let fileMenu = NSMenu(title: "File")
        let newRec = NSMenuItem(title: "Start Recording", action: #selector(toggle), keyEquivalent: " ")
        newRec.keyEquivalentModifierMask = [.control, .option, .command]
        fileMenu.addItem(newRec)
        fileMenu.addItem(.separator())
        let closeWin = NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenu.addItem(closeWin)
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        // Edit menu — standard Cmd-X/C/V/A
        let editItem = NSMenuItem(); editItem.title = "Edit"
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu
        main.addItem(editItem)

        // Window menu
        let winItem = NSMenuItem(); winItem.title = "Window"
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        winMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""))
        winMenu.addItem(.separator())
        winMenu.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: ""))
        winItem.submenu = winMenu
        main.addItem(winItem)

        // Help menu
        let helpItem = NSMenuItem(); helpItem.title = "Help"
        let helpMenu = NSMenu(title: "Help")
        helpMenu.addItem(NSMenuItem(title: "Open Dis Dat Help", action: #selector(openHelp), keyEquivalent: "?"))
        helpItem.submenu = helpMenu
        main.addItem(helpItem)
        return main
    }

    @objc private func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(nil)
    }
    @objc private func checkForUpdates() {
        store.checkForUpdate(userInitiated: true)
    }
    @objc private func openSettings() {
        showWindow()
        DispatchQueue.main.async { self.store.pane = .settings }
    }
    @objc private func openHelp() {
        NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)")!)
    }

    private func handleAuthCallback(_ url: URL) {
        // Supabase OAuth round-trip lands here: disdat://auth#access_token=...&refresh_token=...&expires_in=...&email=...
        NSLog("[Dis Dat] auth callback: \(url.absoluteString)")
        let fragment = url.fragment ?? url.query ?? ""
        var parts: [String: String] = [:]
        for kv in fragment.split(separator: "&") {
            let pair = kv.split(separator: "=", maxSplits: 1).map(String.init)
            if pair.count == 2 { parts[pair[0]] = pair[1].removingPercentEncoding ?? pair[1] }
        }
        guard let access = parts["access_token"], !access.isEmpty else {
            NSLog("[Dis Dat] auth callback missing access_token"); return
        }
        let refresh = parts["refresh_token"]
        let expIn = parts["expires_in"].flatMap { Int($0) }
        let email = parts["email"]
        AuthSession.save(accessToken: access, refreshToken: refresh, expiresIn: expIn, email: email)
        // Hit /me to confirm + populate subscription status.
        AuthSession.authorizedRequest(URL(string: "\(DisDatConfig.apiBase)/me")!) { req in
            guard let req else { return }
            URLSession.shared.dataTask(with: req) { data, _, _ in
                let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
                let serverEmail = obj?["email"] as? String
                let status = obj?["subscription_status"] as? String ?? "none"
                let isPro = (status == "active" || status == "trialing")
                DispatchQueue.main.async {
                    self.store.signedIn = true
                    self.store.userEmail = serverEmail ?? email
                    self.store.pro = isPro
                    self.showWindow()
                }
            }.resume()
        }
    }

    @objc func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        if let w = window {
            NSLog("[DD] showWindow: visible=\(w.isVisible) onActiveSpace=\(w.isOnActiveSpace) miniaturized=\(w.isMiniaturized) frame=\(NSStringFromRect(w.frame)) collectionBehavior=\(w.collectionBehavior.rawValue)")
        } else {
            NSLog("[DD] showWindow: window is NIL")
        }
    }

    private func updateStatusIcon() {
        guard let button = statusItem.button else { return }
        if recording {
            // While recording — solid red dot.
            let img = NSImage(systemSymbolName: "record.circle.fill", accessibilityDescription: "Dis Dat (recording)")
            img?.isTemplate = false
            button.image = img
            button.contentTintColor = NSColor.systemRed
        } else {
            // Idle — the white pixel cursor mark (drawn programmatically as a
            // template image so macOS tints it correctly on light/dark menubars).
            button.image = AppDelegate.makeCursorStatusImage()
            button.contentTintColor = nil
        }
        if let item = statusItem.menu?.items.first {
            let combo = RecorderShortcut.current.display
            item.title = (recording ? "Stop Recording  (" : "Start Recording  (") + combo + ")"
        }
    }

    private static func makeCursorStatusImage() -> NSImage {
        // Same pixel-cursor silhouette used everywhere else in the brand.
        let art = [
            "X...........",
            "XX..........",
            "XXX.........",
            "XXXX........",
            "XXXXX.......",
            "XXXXXX......",
            "XXXXXXX.....",
            "XXXXXXXX....",
            "XXXXXXXXX...",
            "XXXXXXXXXX..",
            "XXXXXXXXXXX.",
            "XXXXXXXXXXX.",
            "XXXXXXX.....",
            "XXXX.XX.....",
            "XXX...XX....",
            "XXX.....X..."
        ]
        let cols = 12, rows = 16
        let scale: CGFloat = 1.15
        let size = NSSize(width: CGFloat(cols) * scale, height: CGFloat(rows) * scale)
        let img = NSImage(size: size, flipped: false) { _ in
            NSColor.labelColor.setFill()
            for (rowIndex, line) in art.enumerated() {
                for (colIndex, ch) in line.enumerated() where ch != "." {
                    let y = CGFloat(rows - 1 - rowIndex) * scale
                    NSRect(x: CGFloat(colIndex) * scale, y: y, width: scale, height: scale).fill()
                }
            }
            return true
        }
        img.isTemplate = true
        return img
    }

    // Hotkey / menu entry point — toggles between start and finish.
    @objc func toggle() {
        if recording { stopRecording() } else { startRecording() }
    }

    private func startRecording() {
        NSLog("[DD] startRecording entry: recording=\(recording) signedIn=\(store.signedIn) pro=\(store.pro) freeUsed=\(store.freeMinutesUsed) freeLimit=\(store.freeMinutesLimit)")
        guard !recording else { NSLog("[DD] startRecording: bail — already recording"); return }
        // Recording requires sign-in — uploads need a Supabase JWT or the server returns 401.
        if !store.signedIn {
            NSLog("[DD] startRecording: bail — not signed in → signin pane")
            DispatchQueue.main.async {
                self.store.pane = .signin
                self.showWindow()
            }
            return
        }
        // Free tier: once the monthly minutes are used up, send them to the
        // in-app Upgrade screen instead of starting another recording.
        if !store.pro && store.freeMinutesUsed >= store.freeMinutesLimit {
            NSLog("[DD] startRecording: bail — free minutes exhausted → upgrade pane")
            DispatchQueue.main.async {
                self.store.pane = .upgrade
                self.showWindow()
            }
            return
        }
        NSLog("[DD] startRecording: proceeding → recording=true")
        recording = true
        recorderPill.enterRecording()
        let s = FeedbackSession()
        s.onLevel = { [weak self] level in self?.recorderPill.pushLevel(level) }

        // Onboarding "test the shortcut" recording: keep it quiet (no clipboard
        // handoff) and route the transcript to the store for playback.
        let onboardingTest = store.awaitingOnboardingTest
        if onboardingTest {
            s.quiet = true
            store.onboardingRecording = true
            store.onboardingResult = OnboardingResult(audioURL: s.audioURL)
            s.onResult = { [weak self] result in
                guard let self else { return }
                self.store.onboardingResult = OnboardingResult(
                    audioURL: s.audioURL,
                    transcript: result.transcript,
                    words: result.words)
                self.retire(s)                 // transcript poll done — release the session
            }
        }

        // Capture stopped (✓ / hotkey): clear the active slot so a new recording
        // can start, and put the pill into "Saving…" until the signed link lands.
        s.onCaptureStopped = { [weak self] in
            guard let self else { return }
            self.recording = false
            self.session = nil
            self.updateStatusIcon()
            if onboardingTest {
                self.store.onboardingRecording = false
                self.recorderPill.returnToIdle()   // onboarding: no clipboard handoff
            } else {
                self.recorderPill.enterProcessing()
            }
        }

        // Signed meta.json written — refresh the library so the manual "Copy link"
        // uses the working ?t= URL (fires for onboarding too; harmless reload).
        s.onUploaded = { [weak self] in self?.store.loadSessions() }

        // Signed link is on the clipboard — flip "Saving…" → "Copied!", then idle.
        s.onCopied = { [weak self] in
            guard let self else { return }
            self.recorderPill.enterDone()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
                self?.recorderPill.returnToIdle()
            }
            self.retire(s)
        }

        s.onUploadFailed = { [weak self] in
            guard let self else { return }
            self.recorderPill.returnToIdle()
            self.retire(s)
        }

        // Cancelled (✕ / Esc): drop everything, back to idle.
        s.onCancelled = { [weak self] in
            guard let self else { return }
            self.recording = false
            self.session = nil
            self.updateStatusIcon()
            self.recorderPill.returnToIdle()
            if onboardingTest {
                self.store.onboardingRecording = false
                self.store.onboardingResult = nil   // discarded — never show a dead result
            }
            self.retire(s)
        }

        s.start()
        session = s
        inFlightSessions.append(s)
        updateStatusIcon()
    }

    private func retire(_ s: FeedbackSession) {
        inFlightSessions.removeAll { $0 === s }
    }

    // ✓ / hotkey-stop: finish, upload, copy the signed link.
    private func stopRecording() {
        guard recording else { return }
        session?.finish()                      // fires onCaptureStopped → pill "Saving…"
    }

    // ✕: drop the recording without transcribing or pasting.
    private func cancelRecording() {
        guard recording else { return }
        session?.cancel()                      // fires onCancelled → pill idle
    }

    // Carbon global hotkey — combo comes from RecorderShortcut.current and can be
    // rebound in Settings. The handler is installed once; registerHotKey() can be
    // called repeatedly to swap the active combo.
    private func installHotKeyHandler() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                 eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, userData) -> OSStatus in
            guard let userData else { return noErr }
            let me = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { me.toggle() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
    }

    private func registerHotKey() {
        if let existing = hotKeyRef { UnregisterEventHotKey(existing); hotKeyRef = nil }
        let sc = RecorderShortcut.current
        let hotID = EventHotKeyID(signature: OSType(0x4C46_4244), id: 1)
        RegisterEventHotKey(sc.keyCode, sc.carbonModifiers, hotID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    @objc private func shortcutChanged() {
        registerHotKey()
        updateStatusIcon()   // refreshes the menu item title
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)   // real window + dock icon (not menu-bar-only)
app.run()
