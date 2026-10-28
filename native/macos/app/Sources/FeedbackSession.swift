import Foundation
import AppKit

/// Thin recorder: captures mic audio + periodic screen frames + cursor track,
/// then uploads the raw session to the server (which transcribes, detects
/// markers, annotates, and runs Claude) and copies the handoff URL.
final class FeedbackSession {
    let startedAt = Date()
    let dir: URL
    let mouse = MouseTracker()
    let audio = AudioEngine()

    /// Live mic level forwarded to the persistent recorder pill (set by AppDelegate).
    var onLevel: ((Float) -> Void)?

    /// Fired when the background upload finishes, carrying the transcript +
    /// word timings (used by onboarding to play the recording back with subtitles).
    var onResult: ((UploadResult) -> Void)?

    /// When true (onboarding test recording), skip the "link copied — paste into
    /// your agent" clipboard write + notification; the recording is still uploaded
    /// so we can show the transcript, but we don't surface a handoff link.
    var quiet = false

    /// The local audio file for this session — available immediately on finish,
    /// so onboarding can start playback before the transcript returns.
    var audioURL: URL { dir.appendingPathComponent("audio.caf") }

    private struct Frame { let idx: Int; let t: Double; let url: URL; let dW: CGFloat; let dH: CGFloat }
    private var frames: [Frame] = []
    private var frameTimer: Timer?
    private var frameIndex = 0
    private var rawDir: URL { dir.appendingPathComponent("raw") }

    /// Capture stopped (✓ or shortcut) — the upload is now in flight. UI shows "Saving…".
    var onCaptureStopped: (() -> Void)?
    /// Recording discarded (✕ or Esc) — UI returns to idle, nothing is uploaded.
    var onCancelled: (() -> Void)?
    /// Signed handoff link is on the clipboard — UI flips to "Copied!".
    var onCopied: (() -> Void)?
    /// Upload failed permanently — UI returns to idle, nothing copied.
    var onUploadFailed: (() -> Void)?
    /// Signed meta.json was written — reload the library so manual Copy uses the ?t= link.
    var onUploaded: (() -> Void)?

    private var finishing = false
    private var escMonitor: Any?
    // Client-generated so we can copy the handoff link INSTANTLY and upload in the background.
    let sessionId: String = "dd" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LeoFeedback")
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmmss"
        dir = base.appendingPathComponent("session-\(f.string(from: startedAt))")
        try? FileManager.default.createDirectory(at: rawDir, withIntermediateDirectories: true)
    }

    func start() {
        mouse.start()
        audio.onLevel = { [weak self] level in self?.onLevel?(level) }
        audio.prepare(fileURL: dir.appendingPathComponent("audio.caf"))
        audio.start()
        startFrameCapture()
        // Esc cancels (discards) the recording — matches the ✕ button. The ✓
        // button and the global shortcut are what finish + paste.
        escMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] ev in
            if ev.keyCode == 53 { self?.cancel() }
        }
        NSLog("[Dis Dat] session started → \(dir.path)")
    }

    func finish() {
        guard !finishing else { return }
        finishing = true
        removeEsc()
        frameTimer?.invalidate(); frameTimer = nil
        mouse.stop()
        // Write the (unsigned) placeholder meta so the library has a card immediately,
        // then upload. We DON'T clipboard anything yet: only the SIGNED link returned by
        // the server is fetchable by an account-less agent, so the pill stays on "Saving…"
        // until uploadInBackground() puts the working link on the clipboard.
        writeMeta(url: "\(DisDatConfig.apiBase)/r/\(sessionId)")
        onCaptureStopped?()
        audio.stop { [weak self] in self?.uploadInBackground() }
    }

    func cancel() {
        guard !finishing else { return }
        finishing = true
        removeEsc()
        frameTimer?.invalidate(); frameTimer = nil
        mouse.stop()
        audio.stop { }
        try? FileManager.default.removeItem(at: dir)
        NSLog("[Dis Dat] cancelled, discarded")
        DispatchQueue.main.async { [weak self] in self?.onCancelled?() }
    }

    private func removeEsc() { if let m = escMonitor { NSEvent.removeMonitor(m); escMonitor = nil } }

    // MARK: - Frame capture

    private func startFrameCapture() {
        captureFrame()
        frameTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            self?.captureFrame()
        }
    }

    private func captureFrame() {
        let t = Date().timeIntervalSince(startedAt)
        Task { [weak self] in
            guard let self, let shot = await ScreenCapture.snapshot() else { return }
            let idx = await MainActor.run { () -> Int in self.frameIndex += 1; return self.frameIndex }
            let url = self.rawDir.appendingPathComponent("f\(idx).jpg")
            ScreenCapture.saveJPEG(shot.image, to: url)
            await MainActor.run {
                self.frames.append(Frame(idx: idx, t: t, url: url, dW: shot.displayWidth, dH: shot.displayHeight))
            }
        }
    }

    // MARK: - Upload

    private func handoffMessage(url: String) -> String {
        """
        I recorded spoken feedback. Go to \(url) — fetch it and apply each item in order. It links \
        annotated screenshots with numbered red markers showing exactly where I pointed. If it says \
        "still processing", wait ~15 seconds and re-fetch the same URL. Ask me if anything is ambiguous.
        """
    }

    private func writeMeta(url: String) {
        let meta: [String: Any] = [
            "sessionId": sessionId,
            "url": url,
            "startedAt": ISO8601DateFormatter().string(from: startedAt),
            "durationSec": Date().timeIntervalSince(startedAt),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted]) {
            try? data.write(to: dir.appendingPathComponent("meta.json"))
        }
    }

    private func uploadInBackground() {
        // Spoken language for Deepgram (defaults to "multi" if the user
        // skipped onboarding). Reading from UserDefaults keeps this file
        // independent of SwiftUI's @EnvironmentObject plumbing.
        let language = UserDefaults.standard.string(forKey: "disdat.language") ?? "multi"
        let meta: [String: Any] = [
            "session_id": sessionId,
            "startedAt": ISO8601DateFormatter().string(from: startedAt),
            "displayW": frames.first.map { Double($0.dW) } ?? 0,
            "displayH": frames.first.map { Double($0.dH) } ?? 0,
            "language": language,
            "frames": frames.map { ["idx": $0.idx, "t": $0.t] },
            "points": mouse.points.map { ["t": $0.t, "x": $0.x, "y": $0.y] },
            "clicks": mouse.clicks.map { ["t": $0.t, "x": $0.x, "y": $0.y, "button": $0.button] },
        ]
        guard let metaData = try? JSONSerialization.data(withJSONObject: meta) else { return }
        let frameFiles: [(String, Data)] = frames.compactMap {
            guard let d = try? Data(contentsOf: $0.url) else { return nil }
            return ($0.url.lastPathComponent, d)
        }
        let audioURL = dir.appendingPathComponent("audio.caf")
        let audioArg = FileManager.default.fileExists(atPath: audioURL.path) ? audioURL : nil
        Uploader.uploadSession(audioURL: audioArg, frames: frameFiles, metaJSON: metaData) { [weak self] result in
            guard let self else { return }
            NSLog("[Dis Dat] background upload finished: \(result.url?.absoluteString ?? "FAILED") (\(result.markers) markers)")
            // The server returns the SIGNED handoff URL (?t=…) — the only link an
            // account-less agent can fetch. Put it on the clipboard + in the
            // library so the pasted link actually works.
            if let signed = result.url?.absoluteString {
                // Persist the SIGNED link first so the library's manual Copy uses the
                // working ?t= URL, then reload the library, then put it on the clipboard.
                self.writeMeta(url: signed)
                DispatchQueue.main.async {
                    self.onUploaded?()
                    if !self.quiet {
                        self.setClipboard(self.handoffMessage(url: signed))
                        self.notify("Your Dis Dat link is ready — copied to your clipboard.")
                        self.onCopied?()
                    }
                }
            } else {
                DispatchQueue.main.async {
                    if !self.quiet {
                        self.notify("Upload failed — check your connection and try again.")
                        self.onUploadFailed?()
                    }
                }
            }
            // Transcript is produced by the server's background pipeline, so it's
            // not in the upload response. Onboarding polls /transcript for it.
            if self.onResult != nil {
                self.pollTranscript(base: result)
            }
        }
    }

    /// Onboarding: long-poll the server for the transcript + word timings, then
    /// hand them to `onResult` for the playback subtitles.
    private func pollTranscript(base result: UploadResult, attempt: Int = 0) {
        guard let url = URL(string: "\(DisDatConfig.apiBase)/transcript/\(sessionId)") else { onResult?(result); return }
        AuthSession.authorizedRequest(url) { [weak self] req in
            guard let self else { return }
            guard let req else { self.onResult?(result); return }
            URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
                guard let self else { return }
                let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
                if (obj?["ready"] as? Bool) == true {
                    let transcript = obj?["transcript"] as? String ?? ""
                    let words: [WordTiming] = (obj?["words"] as? [[String: Any]] ?? []).compactMap {
                        guard let w = $0["w"] as? String, let t = $0["t"] as? Double else { return nil }
                        return WordTiming(w: w, t: t)
                    }
                    self.onResult?(UploadResult(url: result.url, markers: result.markers, transcript: transcript, words: words))
                } else if attempt < 20 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.pollTranscript(base: result, attempt: attempt + 1) }
                } else {
                    self.onResult?(result)   // give up; playback shows without subtitles
                }
            }.resume()
        }
    }

    private func setClipboard(_ s: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(s, forType: .string)
    }

    private func notify(_ text: String) {
        NSSound(named: "Glass")?.play()
        let n = NSUserNotification()
        n.title = "Dis Dat"
        n.informativeText = text
        NSUserNotificationCenter.default.deliver(n)
    }
}
