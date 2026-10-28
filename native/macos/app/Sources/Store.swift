import Foundation
import AppKit

enum AppPane: String { case library, settings, signin, onboarding, upgrade }

struct LibrarySession: Identifiable {
    let id: String          // dir name
    let dir: URL
    let date: Date
    let thumbnail: URL?
    let sessionId: String?
    let durationSec: Double
    let storedURL: String?  // signed handoff URL persisted after upload (carries ?t=)
    // Prefer the signed URL the server returned (the only one an agent can fetch);
    // fall back to the unsigned form for sessions recorded before upload finished.
    var url: String? { storedURL ?? sessionId.map { "\(DisDatConfig.apiBase)/r/\($0)" } }

    var handoffMessage: String? {
        guard let u = url else { return nil }
        return """
        I recorded spoken feedback. Go to \(u) — fetch it and apply each item in order. It links \
        annotated screenshots with numbered red markers showing exactly where I pointed. If it says \
        "still processing", wait ~15 seconds and re-fetch the same URL. Ask me if anything is ambiguous.
        """
    }
}

/// Result of the onboarding test recording: the local audio (playable
/// immediately) plus the transcript + word timings (arrive after upload).
struct OnboardingResult {
    var audioURL: URL
    var durationHint: Double = 0
    var transcript: String? = nil          // nil while still transcribing
    var words: [WordTiming] = []
}

final class AppStore: ObservableObject {
    @Published var sessions: [LibrarySession] = []
    @Published var pane: AppPane = .library
    @Published var signedIn: Bool = false
    @Published var userEmail: String? = nil
    @Published var pro: Bool = false                 // upgraded to Pro
    @Published var freeMinutesUsed: Double = 0       // updated as recordings finish
    let freeMinutesLimit: Double = 10                // per month, free tier

    // ── Onboarding "test the shortcut" state ──────────────────────────────
    // The onboarding test step sets `awaitingOnboardingTest` so AppDelegate
    // routes the next recording's result here instead of the clipboard handoff.
    @Published var awaitingOnboardingTest: Bool = false
    @Published var onboardingRecording: Bool = false       // true while capturing
    @Published var onboardingResult: OnboardingResult? = nil

    // ── In-app auto-updater state (see Updater.swift) ─────────────────────
    // checkForUpdate() polls /app/latest, silently downloads + verifies the new
    // build in the background, and flips `updateReady` true when it's staged and
    // a one-click relaunch will swap it in.
    @Published var updateVersion: String? = nil    // newer version available (e.g. "0.2.0")
    @Published var updateNotes: String = ""
    @Published var updateDownloading: Bool = false
    @Published var updateReady: Bool = false        // staged on disk, relaunch will apply
    var stagedUpdateApp: URL? = nil                 // unzipped .app waiting to be swapped in

    /// This build's marketing version (CFBundleShortVersionString), e.g. "0.1.0".
    var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.1.0"
    }
    // Deepgram language code (ISO-639). Persisted across launches.
    @Published var language: String = UserDefaults.standard.string(forKey: "disdat.language") ?? "en" {
        didSet { UserDefaults.standard.set(language, forKey: "disdat.language") }
    }

    // Scans Application Support off the main thread so launch never blocks on a
    // large library; results are published back on main when ready.
    func loadSessions() {
        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("LeoFeedback")
            guard let entries = try? fm.contentsOfDirectory(at: base, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles]) else {
                DispatchQueue.main.async { self.sessions = [] }
                return
            }
            var loaded: [LibrarySession] = []
            var totalSec: Double = 0
            for url in entries where url.lastPathComponent.hasPrefix("session-") {
                let date = (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate ?? Date()
                // pick a frame dir (raw/ during/just-after recording; _raw_done/ after server upload)
                var frameDir = url.appendingPathComponent("raw")
                if !fm.fileExists(atPath: frameDir.path) {
                    frameDir = url.appendingPathComponent("_raw_done")
                }
                let frames = (try? fm.contentsOfDirectory(at: frameDir, includingPropertiesForKeys: nil))?
                    .filter { $0.lastPathComponent.hasPrefix("f") && $0.pathExtension == "jpg" }
                    .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
                // meta.json contains sessionId + duration
                var sessionId: String? = nil
                var duration: Double = 0
                var storedURL: String? = nil
                let metaURL = url.appendingPathComponent("meta.json")
                if let data = try? Data(contentsOf: metaURL),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    sessionId = json["sessionId"] as? String
                    duration = (json["durationSec"] as? Double) ?? 0
                    storedURL = json["url"] as? String
                }
                totalSec += duration
                loaded.append(LibrarySession(
                    id: url.lastPathComponent, dir: url, date: date,
                    thumbnail: frames.first, sessionId: sessionId, durationSec: duration, storedURL: storedURL
                ))
            }
            loaded.sort { $0.date > $1.date }
            let usedMin = totalSec / 60.0
            DispatchQueue.main.async {
                self.sessions = loaded
                self.freeMinutesUsed = usedMin
            }
        }
    }

    func copyHandoff(_ session: LibrarySession) {
        guard let msg = session.handoffMessage else { return }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(msg, forType: .string)
    }

    func delete(_ session: LibrarySession) {
        try? FileManager.default.removeItem(at: session.dir)
        loadSessions()
    }
}
