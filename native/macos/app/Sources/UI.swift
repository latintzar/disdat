import SwiftUI
import AppKit
import AVFoundation

// Brand colors
private let kInk = Color(red: 22/255, green: 17/255, blue: 13/255)
private let kCream = Color(red: 251/255, green: 247/255, blue: 238/255)
private let kOrange = Color(red: 1.0, green: 92/255, blue: 42/255)

// ── Root ───────────────────────────────────────────────────────────────────
struct MainView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        // First-launch onboarding takes over the full window — no sidebar yet.
        if store.pane == .onboarding {
            OnboardingView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(kCream)
        } else if !store.signedIn {
            // Not signed in → the sign-in screen owns the whole window. No
            // sidebar, no "library is private" intermediate step.
            SignInView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            HStack(spacing: 0) {
                Sidebar()
                    .frame(width: 248)
                    .background(
                        // Slightly darker than the main window so the sidebar
                        // visibly stands apart on a cream-on-cream window.
                        ZStack {
                            kCream
                            kInk.opacity(0.06)
                        }
                    )
                    .overlay(Rectangle().fill(kInk.opacity(0.08)).frame(width: 1), alignment: .trailing)
                Group {
                    switch store.pane {
                    case .library: LibraryView()
                    case .settings: SettingsView()
                    case .signin: SignInView()
                    case .onboarding: EmptyView()
                    case .upgrade: UpgradeView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(kCream)
            }
        }
    }
}

// ── Sidebar (logo top, nav, free-tier card, settings + sign-in bottom) ─────
struct Sidebar: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Logo
            HStack {
                BrandLockup(iconSize: 28, textSize: 18)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 18)

            SidebarItem(title: "Library", system: "rectangle.grid.2x2.fill",
                        active: store.pane == .library) { store.pane = .library }
            SidebarItem(title: "Start recording", system: "mic.fill", active: false, accent: true) {
                if store.signedIn {
                    NotificationCenter.default.post(name: .disdatToggleRecording, object: nil)
                } else {
                    store.pane = .signin
                }
            }

            Spacer()

            // Update banner — sits above the usage meter. Appears once a newer
            // build has silently downloaded + staged; Relaunch swaps it in.
            if store.updateReady {
                UpdateBanner().padding(.horizontal, 12).padding(.bottom, 10)
            }

            // Free tier counter (only when not Pro)
            if !store.pro {
                FreeTierCard().padding(.horizontal, 12).padding(.bottom, 10)
            }

            Divider().padding(.horizontal, 12)
            SidebarItem(title: "Settings", system: "gearshape",
                        active: store.pane == .settings) { store.pane = .settings }
            if store.signedIn {
                SidebarItem(title: store.userEmail ?? "Account", system: "person.crop.circle",
                            active: store.pane == .signin) { store.pane = .signin }
            } else {
                SidebarItem(title: "Sign in", system: "person.crop.circle",
                            active: store.pane == .signin) { store.pane = .signin }
            }
            // Version
            HStack { Spacer(); Text("v\(store.currentVersion)").font(.system(size: 10)).foregroundColor(.secondary); Spacer() }
                .padding(.vertical, 8)
        }
    }
}

// Shown above the usage meter when a fresh build is staged on disk. The button
// just relaunches — the swap-and-restart happens transparently in the background.
struct UpdateBanner: View {
    @EnvironmentObject var store: AppStore
    @State private var hovered = false
    var body: some View {
        // Dark card: brand mark · "Relaunch to update" + version · arrow.
        // The whole row is the button — clicking it swaps in the staged build.
        Button(action: { store.installStagedUpdate() }) {
            HStack(spacing: 11) {
                PixelCursorMark(color: kCream)
                    .frame(width: 19, height: 23)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Relaunch to update")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(kCream)
                    if let v = store.updateVersion {
                        Text("v\(v)")
                            .font(.system(size: 12, weight: .regular))
                            .foregroundColor(kCream.opacity(0.5))
                    }
                }
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundColor(kCream.opacity(hovered ? 0.95 : 0.55))
                    .offset(x: hovered ? 2 : 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 14).fill(kInk))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(kCream.opacity(0.12), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.15), value: hovered)
        .onHover { hovered = $0 }
    }
}

struct SidebarItem: View {
    let title: String
    let system: String
    let active: Bool
    var accent: Bool = false
    let action: () -> Void
    @State private var hovered = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: system)
                    .frame(width: 18)
                    .foregroundColor(accent ? kOrange : (active ? kOrange : kInk.opacity(0.85)))
                Text(title)
                    .foregroundColor(kInk)         // always dark — keeps strong contrast on the tinted active pill
                Spacer()
            }
            .font(.system(size: 13, weight: active ? .semibold : .medium))
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(active ? kOrange.opacity(0.14) : (hovered ? kInk.opacity(0.06) : .clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .onHover { hovered = $0 }
    }
}

struct FreeTierCard: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Free plan").font(.system(size: 11, weight: .semibold)).foregroundColor(kInk.opacity(0.75))
                Spacer()
                Text("\(Int(store.freeMinutesUsed)) / \(Int(store.freeMinutesLimit)) min")
                    .font(.system(size: 11, weight: .medium)).foregroundColor(kInk.opacity(0.75))
            }
            UsageBar(value: store.freeMinutesUsed, total: store.freeMinutesLimit)
            if store.freeMinutesUsed >= store.freeMinutesLimit * 0.7 {
                Text("Heads up — you're close to your monthly free limit.")
                    .font(.system(size: 10, weight: .medium)).foregroundColor(kInk.opacity(0.7)).fixedSize(horizontal: false, vertical: true)
            }
            Button(action: {
                if store.signedIn {
                    NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/account?upgrade=1")!)
                } else {
                    store.pane = .signin
                }
            }) {
                HStack { Text("Upgrade to Pro"); Spacer(); Text("$19/mo").opacity(0.8) }
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(kOrange).foregroundColor(.white)
                    .cornerRadius(8)
            }
            .buttonStyle(.plain).padding(.top, 2)
        }
        .padding(12)
        .background(kOrange.opacity(0.06))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(kOrange.opacity(0.18)))
        .cornerRadius(10)
    }
}

// Shown when a free user hits their monthly minute limit (or taps Upgrade).
// Polished, full-pane sell that opens Stripe checkout in the browser.
struct UpgradeView: View {
    @EnvironmentObject var store: AppStore
    @State private var hovered = false
    private let features = [
        ("infinity", "Unlimited recordings", "No more monthly minute cap."),
        ("clock.fill", "Up to 5 min per recording", "Walk through whole flows in one take."),
        ("bolt.fill", "Priority processing", "Your feedback links generate first."),
        ("sparkles", "Early access to new features", "Phone capture and more, first."),
    ]
    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 28)
                ZStack {
                    RoundedRectangle(cornerRadius: 22).fill(kCream)
                        .overlay(RoundedRectangle(cornerRadius: 22).stroke(kInk.opacity(0.08)))
                        .shadow(color: kInk.opacity(0.08), radius: 24, y: 12)
                    VStack(spacing: 0) {
                        // Header band
                        VStack(spacing: 14) {
                            PixelCursorMark(color: kInk).frame(width: 46, height: 56)
                            Text(store.freeMinutesUsed >= store.freeMinutesLimit
                                 ? "You've used your free minutes"
                                 : "Go unlimited with Pro")
                                .font(.system(size: 24, weight: .semibold, design: .serif))
                                .foregroundColor(kInk).multilineTextAlignment(.center)
                            Text("You've recorded \(Int(store.freeMinutesUsed)) of your \(Int(store.freeMinutesLimit)) free minutes this month. Upgrade to keep talking and pointing — your 14-day trial starts now and you won't be charged until it ends.")
                                .font(.system(size: 13))
                                .foregroundColor(kInk.opacity(0.6))
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: 380)
                        }
                        .padding(.top, 30).padding(.horizontal, 32).padding(.bottom, 22)

                        // Feature list
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(features, id: \.0) { f in
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: f.0)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(kOrange).frame(width: 22, height: 22)
                                        .background(kOrange.opacity(0.12)).cornerRadius(7)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(f.1).font(.system(size: 13, weight: .semibold)).foregroundColor(kInk)
                                        Text(f.2).font(.system(size: 11.5)).foregroundColor(kInk.opacity(0.55))
                                    }
                                    Spacer()
                                }
                            }
                        }
                        .padding(.horizontal, 32)

                        // CTA
                        VStack(spacing: 10) {
                            Button(action: {
                                NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/account?upgrade=1")!)
                            }) {
                                HStack(spacing: 6) {
                                    Text("Start 14-day trial — then $19/mo")
                                    Image(systemName: "arrow.up.forward")
                                }
                                .font(.system(size: 14, weight: .semibold))
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(kOrange).foregroundColor(.white).cornerRadius(11)
                                .scaleEffect(hovered ? 1.01 : 1)
                            }
                            .buttonStyle(.plain)
                            .onHover { hovered = $0 }
                            Text("Opens secure Stripe checkout. Cancel anytime before the trial ends.")
                                .font(.system(size: 10.5)).foregroundColor(kInk.opacity(0.45))
                            Button(action: { store.pane = .library }) {
                                Text("Maybe later").font(.system(size: 12, weight: .medium)).foregroundColor(kInk.opacity(0.55))
                            }.buttonStyle(.plain).padding(.top, 2)
                        }
                        .padding(.horizontal, 32).padding(.top, 24).padding(.bottom, 30)
                    }
                }
                .frame(maxWidth: 460)
                .padding(.horizontal, 24)
                Spacer(minLength: 28)
            }
            .frame(maxWidth: .infinity)
        }
    }
}

struct UsageBar: View {
    let value: Double; let total: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3).fill(kInk.opacity(0.08))
                RoundedRectangle(cornerRadius: 3).fill(kOrange)
                    .frame(width: geo.size.width * CGFloat(min(1, value / max(total, 0.001))))
            }
        }.frame(height: 6)
    }
}

// ── Library ────────────────────────────────────────────────────────────────
struct LibraryView: View {
    @EnvironmentObject var store: AppStore
    let cols = [GridItem(.adaptive(minimum: 230, maximum: 320), spacing: 14)]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Library").font(.system(size: 30, weight: .semibold, design: .serif))
                    Spacer()
                    Text("\(store.sessions.count) recordings").font(.system(size: 13)).foregroundColor(.secondary)
                }
                if store.sessions.isEmpty {
                    EmptyLibrary()
                } else {
                    LazyVGrid(columns: cols, spacing: 14) {
                        ForEach(store.sessions) { s in LibraryTile(session: s) }
                    }
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 22)
        }
    }
}

struct EmptyLibrary: View {
    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(kOrange.opacity(0.12)).frame(width: 96, height: 96)
                Image(systemName: "waveform.badge.mic")
                    .font(.system(size: 40, weight: .regular))
                    .foregroundColor(kOrange)
            }
            VStack(spacing: 6) {
                Text("Your library is empty")
                    .font(.system(size: 22, weight: .semibold, design: .serif))
                Text("Press the shortcut anywhere on your Mac to record talk-and-point feedback. The link copies to your clipboard the moment you stop.")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
            }
            HStack(spacing: 6) {
                ForEach(["⌃", "⌥", "⌘", "Space"], id: \.self) { k in
                    Text(k)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Color.white)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(kInk.opacity(0.15)))
                        .cornerRadius(6)
                        .shadow(color: kInk.opacity(0.06), radius: 1, y: 1)
                }
            }
            Button(action: { NotificationCenter.default.post(name: .disdatToggleRecording, object: nil) }) {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill")
                    Text("Start your first recording").font(.system(size: 13, weight: .semibold))
                }
                .padding(.horizontal, 18).padding(.vertical, 11)
                .background(kInk).foregroundColor(.white).cornerRadius(22)
            }
            .buttonStyle(.plain).padding(.top, 4)
        }
        .frame(maxWidth: .infinity, minHeight: 440)
    }
}

struct LibraryTile: View {
    let session: LibrarySession
    @EnvironmentObject var store: AppStore
    @State private var hovering = false
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottomTrailing) {
                Group {
                    if let t = session.thumbnail, let img = NSImage(contentsOf: t) {
                        Image(nsImage: img).resizable().scaledToFill()
                    } else {
                        ZStack {
                            Rectangle().fill(kInk.opacity(0.06))
                            Image(systemName: "photo").font(.system(size: 28)).foregroundColor(.secondary)
                        }
                    }
                }
                .frame(height: 160)
                .frame(maxWidth: .infinity)
                .clipped()
                .overlay(alignment: .topLeading) {
                    if let u = session.url, !u.isEmpty {
                        // little URL pill (top-left)
                        Text(u.replacingOccurrences(of: "https://", with: ""))
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(Color.black.opacity(0.55))
                            .cornerRadius(4).padding(8)
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    if session.durationSec > 0 {
                        Text(formatDuration(session.durationSec))
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(.white)
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(Color.black.opacity(0.6))
                            .cornerRadius(4).padding(8)
                    }
                }
                if hovering {
                    Button(action: { store.copyHandoff(session); copied = true; DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false } }) {
                        HStack(spacing: 5) {
                            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            Text(copied ? "Copied" : "Copy link").font(.system(size: 11, weight: .semibold))
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color(red: 0.97, green: 0.95, blue: 0.91))   // solid cream — no glass
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(kInk.opacity(0.12)))
                        .cornerRadius(8)
                    }
                    .buttonStyle(.plain).padding(8)
                }
            }
            .background(kInk.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(kInk.opacity(0.12)))
            HStack(spacing: 8) {
                Text(session.date.formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 12)).foregroundColor(.primary.opacity(0.75))
                Spacer()
                if let url = session.url, let u = URL(string: url) {
                    Link(destination: u) {
                        Image(systemName: "arrow.up.right.square").font(.system(size: 13)).foregroundColor(.secondary)
                    }
                }
                Menu {
                    Button("Copy link") { store.copyHandoff(session) }
                    if let url = session.url, let u = URL(string: url) {
                        Button("Open in browser") { NSWorkspace.shared.open(u) }
                    }
                    Divider()
                    Button("Delete", role: .destructive) { store.delete(session) }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 13)).foregroundColor(.secondary)
                }.menuStyle(.borderlessButton).frame(width: 18)
            }
        }
        .onHover { hovering = $0 }
    }
}

// ── Settings ───────────────────────────────────────────────────────────────
struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var showDeleteConfirm = false
    @State private var deleting = false
    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1"
        return "v\(v)"
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Settings").font(.system(size: 30, weight: .semibold, design: .serif)).foregroundColor(kInk)

                // ── General: the global shortcut ──────────────────────────
                SettingsCard(title: "General") {
                    SettingsRow(label: "Recording shortcut",
                                detail: "Press anywhere on your Mac to start. ✓ finishes, Esc cancels. Click to rebind.") {
                        ShortcutRecorderField()
                    }
                }

                // ── Microphone: spoken language ───────────────────────────
                SettingsCard(title: "Microphone") {
                    SettingsRow(label: "Spoken language",
                                detail: "Picking one language gives the cleanest transcription. Saved to your preferences.") {
                        LanguageMenu()
                    }
                }

                // ── Plans & billing ───────────────────────────────────────
                SettingsCard(title: "Plans and billing") {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(store.pro ? "Dis Dat Pro" : "Dis Dat Basic (free)")
                                .font(.system(size: 15, weight: .semibold)).foregroundColor(kInk)
                            Text(store.pro ? "$19 / month · 14-day trial" : "Free — upgrade to Pro for unlimited recordings.")
                                .font(.system(size: 12)).foregroundColor(kInk.opacity(0.6))
                        }
                        Spacer()
                        if store.pro {
                            Button("Manage subscription") {
                                NSWorkspace.shared.open(URL(string: "\(DisDatConfig.apiBase)/billing/portal")!)
                            }.buttonStyle(BrandOutlineButton())
                        } else {
                            Button("Upgrade to Pro") {
                                NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/#pricing")!)
                            }.buttonStyle(BrandFilledButton(tint: kOrange))
                        }
                    }
                }

                // ── Account ───────────────────────────────────────────────
                SettingsCard(title: "Account") {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.signedIn ? (store.userEmail ?? "Signed in") : "Not signed in")
                                .font(.system(size: 13, weight: .medium)).foregroundColor(kInk)
                            Text("Recordings sync to this account.")
                                .font(.system(size: 11)).foregroundColor(kInk.opacity(0.55))
                        }
                        Spacer()
                        Button("Sign out") {
                            AuthSession.clear(); store.signedIn = false; store.userEmail = nil; store.pro = false
                        }.buttonStyle(BrandOutlineButton())
                    }
                }

                // ── Storage ───────────────────────────────────────────────
                SettingsCard(title: "Storage") {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Recordings live on this Mac")
                                .font(.system(size: 13, weight: .medium)).foregroundColor(kInk)
                            Text("The annotated handoff link is kept on the server so your agent can fetch it.")
                                .font(.system(size: 11)).foregroundColor(kInk.opacity(0.6))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        Button("Reveal in Finder") {
                            let url = FileManager.default
                                .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                                .appendingPathComponent("LeoFeedback")
                            NSWorkspace.shared.activateFileViewerSelecting([url])
                        }.buttonStyle(BrandOutlineButton())
                    }
                }

                // ── Data & privacy ────────────────────────────────────────
                SettingsCard(title: "Data and privacy") {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Your recordings are tied to your account — nobody else, including us, can read them.")
                            .font(.system(size: 12)).foregroundColor(kInk.opacity(0.65))
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 10) {
                            Button("Export my data") {
                                NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/data-controls")!)
                            }.buttonStyle(BrandOutlineButton())
                            Button(deleting ? "Deleting…" : "Delete account") { showDeleteConfirm = true }
                                .buttonStyle(BrandOutlineButton(danger: true))
                                .disabled(deleting || !store.signedIn)
                            Spacer()
                        }
                    }
                }

                // ── Help ──────────────────────────────────────────────────
                SettingsCard(title: "Help") {
                    VStack(alignment: .leading, spacing: 10) {
                        SettingsLink("Docs · how to record, share and ship faster", "\(DisDatConfig.siteBase)")
                        SettingsLink("Privacy policy", "\(DisDatConfig.siteBase)/privacy")
                        SettingsLink("Email operator@example.invalid", "mailto:operator@example.invalid")
                    }
                }

                HStack {
                    Spacer()
                    Text("Dis Dat \(appVersion)")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(kInk.opacity(0.4))
                    Spacer()
                }.padding(.top, 4)
            }
            .padding(28)
        }
        .alert("Delete your account?", isPresented: $showDeleteConfirm) {
            Button("Cancel", role: .cancel) { }
            Button("Delete", role: .destructive) { deleteAccount() }
        } message: {
            Text("This permanently removes your account and the handoff links stored on our server. Recordings on this Mac are not deleted. This can't be undone.")
        }
    }

    private func deleteAccount() {
        deleting = true
        AuthSession.authorizedRequest(URL(string: "\(DisDatConfig.apiBase)/account")!, method: "DELETE") { req in
            guard let req else { DispatchQueue.main.async { deleting = false }; return }
            URLSession.shared.dataTask(with: req) { _, _, _ in
                DispatchQueue.main.async {
                    AuthSession.clear()
                    store.signedIn = false; store.userEmail = nil; store.pro = false
                    deleting = false
                }
            }.resume()
        }
    }
}

// One labelled settings row: title + helper text on the left, control on the right.
private struct SettingsRow<Control: View>: View {
    let label: String
    let detail: String
    @ViewBuilder let control: () -> Control
    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(.system(size: 13, weight: .medium)).foregroundColor(kInk)
                Text(detail).font(.system(size: 11)).foregroundColor(kInk.opacity(0.55))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            control()
        }
    }
}

// Branded language dropdown bound to store.language.
private struct LanguageMenu: View {
    @EnvironmentObject var store: AppStore
    private var current: (code: String, label: String, flag: String) {
        disdatLanguages.first { $0.code == store.language } ?? disdatLanguages[0]
    }
    var body: some View {
        Menu {
            ForEach(disdatLanguages, id: \.code) { l in
                Button(action: { store.language = l.code }) {
                    Text("\(l.flag)  \(l.label)")
                    if store.language == l.code { Image(systemName: "checkmark") }
                }
            }
        } label: {
            HStack(spacing: 7) {
                Text(current.flag).font(.system(size: 14))
                Text(current.label).font(.system(size: 13, weight: .medium)).foregroundColor(kInk)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundColor(kInk.opacity(0.5))
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.white)
            .overlay(Capsule().stroke(kInk.opacity(0.15)))
            .clipShape(Capsule())
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }
}

private struct SettingsLink: View {
    let title: String
    let urlString: String
    init(_ title: String, _ urlString: String) { self.title = title; self.urlString = urlString }
    var body: some View {
        Button(action: { if let u = URL(string: urlString) { NSWorkspace.shared.open(u) } }) {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 12, weight: .medium)).foregroundColor(kOrange)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold)).foregroundColor(kOrange.opacity(0.7))
            }
        }.buttonStyle(.plain)
    }
}

struct SettingsCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 16, weight: .semibold, design: .serif))
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(kInk.opacity(0.04))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(kInk.opacity(0.10)))
        .cornerRadius(12)
    }
}

// The pixel-art pointer, drawn in code so it scales crisply and can be tinted.
// Same silhouette used in the menu-bar status item and on the landing page.
// Three channels: `k` (ink silhouette) + `w` (interior, drawn in `color`) + `o`
// (the orange click-accent at the tail — always brand orange). The orange bit is
// the "little thing at the bottom" that's part of the logo's identity.
struct PixelCursorMark: View {
    var color: Color = kInk
    private static let art = [
        "k...........", "kk..........", "kwk.........", "kwwk........",
        "kwwwk.......", "kwwwwk......", "kwwwwwk.....", "kwwwwwwk....",
        "kwwwwwwwk...", "kwwwwwwwwk..", "kwwwwwwwwwk.", "kwwwwwooook.",
        "kwwwookk....", "kwwok.kk....", "kwok...kk...", "kkk.....k...",
    ]
    var body: some View {
        Canvas { ctx, size in
            let cw = size.width / 12, ch = size.height / 16
            for (r, line) in Self.art.enumerated() {
                for (c, glyph) in line.enumerated() where glyph != "." {
                    // k + w both take the silhouette color; o is always orange.
                    let fill: Color = glyph == "o" ? kOrange : color
                    ctx.fill(Path(CGRect(x: Double(c) * cw, y: Double(r) * ch,
                                         width: cw + 0.5, height: ch + 0.5)),
                             with: .color(fill))
                }
            }
        }
        .aspectRatio(12.0 / 16.0, contentMode: .fit)
    }
}

// Big brand lockup: the bare pointer next to the "Dis Dat" wordmark.
// Used wherever the logo is shown large.
struct BrandLockup: View {
    var iconSize: CGFloat = 56
    var textSize: CGFloat = 34
    var body: some View {
        HStack(spacing: iconSize * 0.30) {
            PixelCursorMark(color: kInk)
                .frame(width: iconSize * 0.82, height: iconSize)
            Text("Dis Dat").font(.system(size: textSize, weight: .semibold, design: .serif))
                .foregroundColor(kInk)
        }
    }
}

// On-brand button styles — replace the stock .bordered / .borderedProminent look.
struct BrandFilledButton: ButtonStyle {
    var tint: Color = kInk
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background(tint.opacity(configuration.isPressed ? 0.82 : 1))
            .foregroundColor(.white)
            .clipShape(Capsule())
            .shadow(color: tint.opacity(0.18), radius: 8, y: 3)
    }
}

struct BrandOutlineButton: ButtonStyle {
    var danger: Bool = false
    func makeBody(configuration: Configuration) -> some View {
        let fg = danger ? Color(red: 0.78, green: 0.16, blue: 0.12) : kInk
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background((configuration.isPressed ? fg.opacity(0.08) : Color.white))
            .foregroundColor(fg)
            .overlay(Capsule().stroke(fg.opacity(danger ? 0.35 : 0.18)))
            .clipShape(Capsule())
    }
}

// Deepgram language options, shared by onboarding + settings.
let disdatLanguages: [(code: String, label: String, flag: String)] = [
    ("en", "English", "🇬🇧"), ("es", "Spanish", "🇪🇸"), ("fr", "French", "🇫🇷"),
    ("de", "German", "🇩🇪"), ("pt", "Portuguese", "🇵🇹"), ("it", "Italian", "🇮🇹"),
    ("nl", "Dutch", "🇳🇱"), ("ja", "Japanese", "🇯🇵"), ("ko", "Korean", "🇰🇷"),
    ("zh", "Chinese", "🇨🇳"), ("hi", "Hindi", "🇮🇳"), ("multi", "Auto-detect", "🌐"),
]

// ── Sign-in (opens browser; app receives disdat:// callback) ───────────────
// Full-screen, branded. Left: warm marketing panel. Right: the actual CTA.
struct SignInView: View {
    @EnvironmentObject var store: AppStore
    @State private var browserOpened = false
    var body: some View {
        HStack(spacing: 0) {
            brandPanel
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            actionPanel
                .frame(width: 420)
                .frame(maxHeight: .infinity)
                .background(Color.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // Left: warm gradient with the big logo lockup + one-line pitch.
    private var brandPanel: some View {
        ZStack {
            LinearGradient(
                colors: [kCream, Color(red: 0.985, green: 0.94, blue: 0.86)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            RadialGradient(colors: [kOrange.opacity(0.12), .clear],
                           center: .topLeading, startRadius: 40, endRadius: 620)
            VStack(alignment: .leading, spacing: 22) {
                Spacer()
                BrandLockup(iconSize: 60, textSize: 38)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Talk and point.\nYour agent sees it all.")
                        .font(.system(size: 30, weight: .semibold, design: .serif))
                        .foregroundColor(kInk)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Record spoken feedback while you point your cursor — Dis Dat hands your coding agent an annotated link.")
                        .font(.system(size: 14)).foregroundColor(kInk.opacity(0.6))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 360, alignment: .leading)
                }
                Spacer()
            }
            .padding(.horizontal, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // Right: the sign-in CTA (or the signed-in confirmation, kept for the
    // in-app "Account" pane that reuses this view).
    private var actionPanel: some View {
        VStack(spacing: 0) {
            Spacer()
            if store.signedIn, let e = store.userEmail {
                ZStack {
                    Circle().fill(kOrange.opacity(0.10)).frame(width: 72, height: 72)
                    Image(systemName: "checkmark").font(.system(size: 30, weight: .semibold)).foregroundColor(kOrange)
                }.padding(.bottom, 16)
                Text("You're signed in").font(.system(size: 24, weight: .semibold, design: .serif))
                Text(e).font(.system(size: 13)).foregroundColor(.secondary).padding(.top, 4)
                Button(action: {
                    AuthSession.clear(); store.signedIn = false; store.userEmail = nil; store.pro = false
                }) {
                    Text("Sign out").font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 18).padding(.vertical, 9)
                        .background(.white).foregroundColor(kInk)
                        .overlay(Capsule().stroke(kInk.opacity(0.15)))
                        .clipShape(Capsule())
                }.buttonStyle(.plain).padding(.top, 18)
            } else {
                Text("Welcome").font(.system(size: 28, weight: .semibold, design: .serif)).foregroundColor(kInk)
                Text("Sign in to sync your library.")
                    .font(.system(size: 13)).foregroundColor(.secondary)
                    .multilineTextAlignment(.center).padding(.top, 6)
                Button(action: {
                    browserOpened = true
                    NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/account?app=1")!)
                }) {
                    HStack(spacing: 10) {
                        GoogleGGlyph()
                        Text("Continue with Google").font(.system(size: 14, weight: .semibold))
                    }
                    .padding(.vertical, 13)
                    .frame(maxWidth: .infinity)
                    .background(kInk).foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(color: kInk.opacity(0.16), radius: 12, y: 5)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 36)
                .padding(.top, 26)
                HStack(spacing: 7) {
                    Image(systemName: "lock.fill").font(.system(size: 9)).foregroundColor(.secondary.opacity(0.7))
                    Text(browserOpened
                         ? "Browser opened — finish there. We'll catch the redirect."
                         : "Opens your browser. Credentials never touch the app.")
                        .font(.system(size: 11)).foregroundColor(.secondary)
                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: 300).padding(.top, 16)
                if browserOpened {
                    Button(action: {
                        NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/account?app=1")!)
                    }) {
                        Text("Open browser again").font(.system(size: 12, weight: .medium)).foregroundColor(kOrange)
                    }.buttonStyle(.plain).padding(.top, 10)
                }
            }
            Spacer()
            Text("14-day Pro trial · cancel anytime")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.secondary.opacity(0.6))
                .padding(.bottom, 28)
        }
        .padding(.horizontal, 8)
    }
}

// The real four-colour Google "G": a broken ring (red top, blue upper-right,
// green bottom, yellow left) plus the blue horizontal crossbar exiting right.
// Drawn in code so it scales crisply and needs no asset bundle.
struct GoogleGGlyph: View {
    var body: some View {
        Canvas { ctx, size in
            let s = min(size.width, size.height)
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let w = s * 0.22            // ring thickness
            let r = s / 2 - w / 2       // mean radius (so the stroke fits inside)

            let blue   = Color(red: 66/255,  green: 133/255, blue: 244/255)
            let green  = Color(red: 52/255,  green: 168/255, blue: 83/255)
            let yellow = Color(red: 251/255, green: 188/255, blue: 5/255)
            let red    = Color(red: 234/255, green: 67/255,  blue: 53/255)

            // y is down, so increasing angle sweeps clockwise. Angles in degrees,
            // 0° = east. The gap around east is where the crossbar exits.
            func arc(_ from: Double, _ to: Double, _ color: Color) {
                var p = Path()
                let steps = 48
                for i in 0...steps {
                    let deg = from + (to - from) * Double(i) / Double(steps)
                    let a = deg * .pi / 180
                    let pt = CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a))
                    if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                }
                ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: w, lineCap: .butt))
            }
            arc(20, 128, green)
            arc(128, 212, yellow)
            arc(212, 318, red)
            arc(318, 344, blue)

            // Blue crossbar — from the centre out to the ring opening on the right.
            let barRect = CGRect(x: c.x - w * 0.1, y: c.y - w / 2,
                                 width: (c.x + r + w / 2) - (c.x - w * 0.1), height: w)
            ctx.fill(Path(roundedRect: barRect, cornerRadius: w * 0.15), with: .color(blue))
        }
        .frame(width: 18, height: 18)
    }
}

// ── Onboarding wizard ──────────────────────────────────────────────────────
// First screen is the Littlebird-style branded welcome (dark, single cream
// pill CTA → opens browser sign-in). After they sign in, the disdat://
// callback advances the wizard to the permission prompts.
struct OnboardingView: View {
    @EnvironmentObject var store: AppStore
    @State private var stepIndex = 0
    @State private var welcomeAnim = false
    @State private var welcomeTextIn = false
    // 0=welcome, 1=language, 2=screen, 3=mic, 4=accessibility, 5=shortcut, 6=test
    private let stepCount = 7

    private var isDark: Bool { stepIndex == 0 }

    var body: some View {
        ZStack {
            // Theme: welcome is dark; permission steps are cream like the rest of the app.
            if isDark {
                Color(red: 0.04, green: 0.04, blue: 0.05).ignoresSafeArea()
                RadialGradient(colors: [kOrange.opacity(0.10), .clear],
                               center: .top, startRadius: 50, endRadius: 700).ignoresSafeArea()
            } else {
                LinearGradient(
                    colors: [kCream, Color(red: 0.985, green: 0.94, blue: 0.86)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ).ignoresSafeArea()
                RadialGradient(colors: [kOrange.opacity(0.10), .clear],
                               center: .topLeading, startRadius: 50, endRadius: 700).ignoresSafeArea()
            }
            Group {
                switch stepIndex {
                case 0: LittlebirdWelcomeStep(welcomeAnim: welcomeAnim, welcomeTextIn: welcomeTextIn)
                case 1: LanguagePickerStep()
                case 2: PermissionStep(
                    icon: "rectangle.dashed.badge.record",
                    title: "Screen Recording",
                    subtitle: "Dis Dat captures frames of what you're pointing at. We only ever record while the orange ⌃⌥⌘Space overlay is up.",
                    primaryLabel: "Grant Screen Recording",
                    primaryAction: { _ = CGRequestScreenCaptureAccess() },
                    check: { CGPreflightScreenCaptureAccess() },
                    onGranted: { withAnimation(.easeInOut(duration: 0.3)) { stepIndex = 3 } })
                case 3: PermissionStep(
                    icon: "mic.circle",
                    title: "Microphone",
                    subtitle: "We need to hear what you're saying — that's where the agent gets your intent. Audio is uploaded to api.disdat.dev for transcription only.",
                    primaryLabel: "Grant Microphone",
                    primaryAction: { AVCaptureDevice.requestAccess(for: .audio) { _ in } },
                    check: { AVCaptureDevice.authorizationStatus(for: .audio) == .authorized },
                    onGranted: { withAnimation(.easeInOut(duration: 0.3)) { stepIndex = 4 } })
                case 4: PermissionStep(
                    icon: "cursorarrow.click.2",
                    title: "Accessibility",
                    subtitle: "Lets us track your cursor in real time so the red marker lands exactly where you pointed. Open System Settings → Privacy & Security → Accessibility.",
                    primaryLabel: "Open Settings",
                    primaryAction: {
                        if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                            NSWorkspace.shared.open(u)
                        }
                    },
                    check: { AXIsProcessTrusted() },
                    onGranted: { withAnimation(.easeInOut(duration: 0.3)) { stepIndex = 5 } })
                case 5: ShortcutSetupStep()
                case 6: ShortcutTestStep()
                default: EmptyView()
                }
            }
            .frame(maxWidth: 580)
            .padding(40)

            // Welcome step renders its own footer (Terms/Privacy) and no progress
            // dots. Permission steps get the small progress + Next/Open buttons.
            if !isDark {
                VStack {
                    HStack {
                        Spacer()
                        Button(action: { finish() }) {
                            Text("Skip").font(.system(size: 12)).foregroundColor(.secondary)
                        }.buttonStyle(.plain).padding(.top, 16).padding(.trailing, 18)
                    }
                    Spacer()
                }
                VStack {
                    Spacer()
                    HStack(spacing: 14) {
                        HStack(spacing: 6) {
                            ForEach(1..<stepCount, id: \.self) { i in
                                Capsule().fill(i == stepIndex ? kOrange : kInk.opacity(0.18))
                                    .frame(width: i == stepIndex ? 22 : 7, height: 7)
                                    .animation(.easeInOut(duration: 0.25), value: stepIndex)
                            }
                        }
                        Spacer()
                        if stepIndex < stepCount - 1 {
                            Button(action: { stepIndex += 1 }) {
                                HStack(spacing: 8) {
                                    Text("Next").font(.system(size: 14, weight: .semibold))
                                    Image(systemName: "arrow.right")
                                }
                                .padding(.horizontal, 22).padding(.vertical, 12)
                                .background(kInk).foregroundColor(.white).clipShape(Capsule())
                                .shadow(color: kInk.opacity(0.18), radius: 12, y: 5)
                            }.buttonStyle(.plain)
                        } else {
                            Button(action: { finish() }) {
                                Text("Open Dis Dat").font(.system(size: 14, weight: .semibold))
                                    .padding(.horizontal, 22).padding(.vertical, 12)
                                    .background(kOrange).foregroundColor(.white).clipShape(Capsule())
                                    .shadow(color: kOrange.opacity(0.28), radius: 14, y: 6)
                            }.buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 40).padding(.bottom, 30)
                }
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                withAnimation(.spring(response: 0.7, dampingFraction: 0.7)) { welcomeAnim = true }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                withAnimation(.easeOut(duration: 0.5)) { welcomeTextIn = true }
            }
        }
        // When sign-in completes (disdat:// callback flips store.signedIn),
        // automatically advance from the welcome to the permission steps.
        .onChange(of: store.signedIn) { signedIn in
            if signedIn && stepIndex == 0 {
                withAnimation(.easeInOut(duration: 0.3)) { stepIndex = 1 }
            }
        }
    }

    private func finish() {
        UserDefaults.standard.set(true, forKey: "disdat.onboarded.v1")
        store.pane = store.signedIn ? .library : .signin
    }
}

// Littlebird-style branded welcome — dark bg, centred mark, big cream pill.
private struct LittlebirdWelcomeStep: View {
    let welcomeAnim: Bool
    let welcomeTextIn: Bool
    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            // Pixel cursor as the brand mark, cream-tinted on dark
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable().interpolation(.none).scaledToFit()
                .frame(width: 64, height: 64)
                .scaleEffect(welcomeAnim ? 1.0 : 0.6)
                .opacity(welcomeAnim ? 1.0 : 0.0)
                .padding(.bottom, 18)
            Text("Welcome to Dis Dat")
                .font(.system(size: 30, weight: .semibold, design: .serif))
                .foregroundColor(.white)
                .opacity(welcomeTextIn ? 1 : 0)
                .offset(y: welcomeTextIn ? 0 : 10)
            Text("Sign in to your account or create a new one")
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.55))
                .padding(.top, 8)
                .opacity(welcomeTextIn ? 1 : 0)
                .offset(y: welcomeTextIn ? 0 : 10)
            Button(action: {
                NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/account?app=1")!)
            }) {
                Text("Sign Up or Sign In")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.black)
                    .frame(maxWidth: 420)
                    .padding(.vertical, 16)
                    .background(kCream)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
            }
            .buttonStyle(.plain)
            .padding(.top, 28)
            .opacity(welcomeTextIn ? 1 : 0)
            Text("Having issues? Make sure you downloaded the latest version.")
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.45))
                .padding(.top, 18)
                .opacity(welcomeTextIn ? 1 : 0)
            Spacer()
            HStack(spacing: 4) {
                Text("By using Dis Dat, you agree to our").foregroundColor(.white.opacity(0.40))
                Link("Terms", destination: URL(string: "\(DisDatConfig.siteBase)/terms")!).foregroundColor(.white.opacity(0.75))
                Text("and").foregroundColor(.white.opacity(0.40))
                Link("Privacy Policy", destination: URL(string: "\(DisDatConfig.siteBase)/privacy")!).foregroundColor(.white.opacity(0.75))
            }
            .font(.system(size: 11))
            .padding(.bottom, 22)
        }
    }
}

private struct WelcomeStep: View {
    let welcomeAnim: Bool
    let welcomeTextIn: Bool
    var body: some View {
        VStack(spacing: 24) {
            ZStack {
                RoundedRectangle(cornerRadius: 22).fill(Color.white)
                    .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.black.opacity(0.06)))
                    .frame(width: 110, height: 110)
                    .shadow(color: .black.opacity(0.10), radius: 28, y: 12)
                Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                    .resizable().interpolation(.none).scaledToFit().frame(width: 68, height: 68)
                    .scaleEffect(welcomeAnim ? 1.0 : 0.6)
                    .opacity(welcomeAnim ? 1.0 : 0.0)
            }
            VStack(spacing: 8) {
                Text("Welcome to Dis Dat")
                    .font(.system(size: 36, weight: .semibold, design: .serif))
                    .opacity(welcomeTextIn ? 1 : 0)
                    .offset(y: welcomeTextIn ? 0 : 10)
                Text("Talk and point your cursor at stuff.\nYour agent sees it all.")
                    .font(.system(size: 16)).foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .opacity(welcomeTextIn ? 1 : 0)
                    .offset(y: welcomeTextIn ? 0 : 10)
            }
            Text("Next: we'll grant the permissions Dis Dat needs and sign you in.")
                .font(.system(size: 13)).foregroundColor(.secondary.opacity(0.85))
                .multilineTextAlignment(.center).frame(maxWidth: 420).padding(.top, 4)
                .opacity(welcomeTextIn ? 1 : 0)
        }
    }
}

private struct PermissionStep: View {
    let icon: String
    let title: String
    let subtitle: String
    let primaryLabel: String
    let primaryAction: () -> Void
    let check: () -> Bool          // polled to detect grant
    let onGranted: () -> Void      // fires once when granted, drives auto-advance
    @State private var granted = false
    @State private var fired = false
    @State private var timer: Timer?
    var body: some View {
        VStack(spacing: 22) {
            ZStack {
                Circle().fill((granted ? Color.green : kOrange).opacity(0.12)).frame(width: 100, height: 100)
                Image(systemName: granted ? "checkmark.circle.fill" : icon)
                    .font(.system(size: 42, weight: .regular))
                    .foregroundColor(granted ? .green : kOrange)
            }
            Text(title).font(.system(size: 28, weight: .semibold, design: .serif))
                .foregroundColor(kInk)
            Text(subtitle).font(.system(size: 14)).foregroundColor(kInk.opacity(0.65))
                .multilineTextAlignment(.center).frame(maxWidth: 460)
            Button(action: { primaryAction() }) {
                HStack(spacing: 8) {
                    Image(systemName: granted ? "checkmark.circle.fill" : "shield.lefthalf.filled")
                    Text(granted ? "Granted — moving on…" : primaryLabel)
                }
                .font(.system(size: 14, weight: .semibold))
                .padding(.horizontal, 22).padding(.vertical, 11)
                .background(granted ? .green.opacity(0.85) : kInk).foregroundColor(.white)
                .clipShape(Capsule())
                .shadow(color: .black.opacity(0.12), radius: 10, y: 5)
            }
            .buttonStyle(.plain)
            .disabled(granted)
        }
        .onAppear {
            // Fire the OS prompt as soon as the step appears, then poll until
            // it's granted and auto-advance.
            if check() {
                granted = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { onGranted() }
                return
            }
            if !fired { primaryAction(); fired = true }
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { t in
                if check() {
                    DispatchQueue.main.async {
                        granted = true
                        t.invalidate()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { onGranted() }
                    }
                }
            }
        }
        .onDisappear {
            timer?.invalidate(); timer = nil
        }
    }
}

private struct OnboardingSignInStep: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        VStack(spacing: 22) {
            ZStack {
                Circle().fill(kOrange.opacity(0.10)).frame(width: 100, height: 100)
                Image(systemName: "person.crop.circle.badge.checkmark")
                    .font(.system(size: 42, weight: .regular)).foregroundColor(kOrange)
            }
            Text(store.signedIn ? "You're signed in" : "Sign in")
                .font(.system(size: 28, weight: .semibold, design: .serif))
            if store.signedIn, let e = store.userEmail {
                Text(e).foregroundColor(.secondary)
            } else {
                Text("Your library and recordings sync to your account.\nWe open your browser — credentials never live in the app.")
                    .font(.system(size: 14)).foregroundColor(.secondary)
                    .multilineTextAlignment(.center).frame(maxWidth: 460)
                Button(action: {
                    NSWorkspace.shared.open(URL(string: "\(DisDatConfig.siteBase)/account?app=1")!)
                }) {
                    HStack(spacing: 10) {
                        GoogleGGlyph()
                        Text("Continue with Google").font(.system(size: 14, weight: .semibold))
                    }
                    .padding(.horizontal, 22).padding(.vertical, 12)
                    .frame(minWidth: 280)
                    .background(kInk).foregroundColor(.white).clipShape(Capsule())
                    .shadow(color: kInk.opacity(0.18), radius: 14, y: 6)
                }.buttonStyle(.plain)
            }
        }
    }
}

private struct LanguagePickerStep: View {
    @EnvironmentObject var store: AppStore
    private var langs: [(code: String, label: String, flag: String)] { disdatLanguages }
    private let cols = [GridItem(.adaptive(minimum: 130), spacing: 10)]
    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().fill(kOrange.opacity(0.10)).frame(width: 100, height: 100)
                Image(systemName: "globe").font(.system(size: 42, weight: .regular)).foregroundColor(kOrange)
            }
            Text("What language do you speak?").font(.system(size: 26, weight: .semibold, design: .serif)).foregroundColor(kInk)
            Text("Picking a single language gives the cleanest transcription. You can change this any time in Settings.")
                .font(.system(size: 13)).foregroundColor(kInk.opacity(0.65))
                .multilineTextAlignment(.center).frame(maxWidth: 460)
            LazyVGrid(columns: cols, spacing: 10) {
                ForEach(langs, id: \.code) { l in
                    Button(action: { store.language = l.code }) {
                        let selected = store.language == l.code
                        HStack(spacing: 8) {
                            Text(l.flag).font(.system(size: 16))
                            Text(l.label).font(.system(size: 13, weight: selected ? .semibold : .medium))
                            Spacer()
                            if selected {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 11, weight: .semibold)).foregroundColor(kOrange)
                            }
                        }
                        .foregroundColor(kInk)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(selected ? kOrange.opacity(0.10) : Color.white)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(selected ? kOrange.opacity(0.45) : kInk.opacity(0.10))
                        )
                    }.buttonStyle(.plain)
                }
            }
            .frame(maxWidth: 460)
        }
    }
}

extension Notification.Name {
    static let disdatToggleRecording = Notification.Name("disdat.toggle.recording")
}

private func formatDuration(_ s: Double) -> String {
    let total = Int(s.rounded())
    let m = total / 60
    let sec = total % 60
    return String(format: "%d:%02d", m, sec)
}
