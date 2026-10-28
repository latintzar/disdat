import Foundation
import AppKit
import CryptoKit

/// Sparkle-lite in-app updater.
///
/// Flow:
///   1. `checkForUpdate()` GETs \(DisDatConfig.apiBase)/app/latest — a JSON manifest
///      {version, build, url, sha256, notes, minSystem}.
///   2. If the manifest version is newer than this build, silently download the zip
///      to a temp file, verify its sha256, `ditto -xk` unzip it, locate the `.app`
///      inside, and stage it. `updateReady` flips true.
///   3. The sidebar shows an "Update ready" banner; tapping Relaunch calls
///      `installStagedUpdate()`, which writes a tiny detached bash swapper that waits
///      for this process to quit, replaces the bundle in place, and relaunches.
///
/// All network/disk work happens off the main thread; @Published flips back on main.
extension AppStore {
    private static let manifestURL = URL(string: "\(DisDatConfig.apiBase)/app/latest")!

    /// Poll the manifest. `userInitiated` shows an alert when already up to date or
    /// on error (for the "Check for Updates…" menu item); the silent launch/periodic
    /// checks pass false.
    func checkForUpdate(userInitiated: Bool = false) {
        // Updating contacts and installs from the configured server on explicit request.
        guard userInitiated, DisDatConfig.apiBase != "https://example.invalid" else { return }
        if updateDownloading || updateReady {
            if userInitiated { presentUpToDate(alreadyStaged: updateReady) }
            return
        }
        var req = URLRequest(url: Self.manifestURL)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 15
        URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
            guard let self else { return }
            guard let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let version = obj["version"] as? String,
                  let urlStr = obj["url"] as? String, let url = URL(string: urlStr) else {
                if userInitiated { DispatchQueue.main.async { self.presentUpToDate(alreadyStaged: false) } }
                return
            }
            let notes = obj["notes"] as? String ?? ""
            let sha = (obj["sha256"] as? String ?? "").lowercased()
            guard Self.isNewer(version, than: self.currentVersion) else {
                if userInitiated { DispatchQueue.main.async { self.presentUpToDate(alreadyStaged: false) } }
                return
            }
            DispatchQueue.main.async {
                self.updateVersion = version
                self.updateNotes = notes
                self.updateDownloading = true
            }
            self.downloadAndStage(from: url, expectedSHA: sha, version: version)
        }.resume()
    }

    private func downloadAndStage(from url: URL, expectedSHA: String, version: String) {
        var req = URLRequest(url: url)
        req.timeoutInterval = 120
        URLSession.shared.downloadTask(with: req) { [weak self] tmpURL, _, err in
            guard let self else { return }
            func fail(_ why: String) {
                NSLog("[updater] stage failed: \(why)")
                DispatchQueue.main.async { self.updateDownloading = false }
            }
            guard let tmpURL, let zipData = try? Data(contentsOf: tmpURL) else { return fail("download \(String(describing: err))") }
            // Verify integrity before we trust the bytes.
            if !expectedSHA.isEmpty {
                let digest = SHA256.hash(data: zipData)
                let hex = digest.map { String(format: "%02x", $0) }.joined()
                guard hex == expectedSHA else { return fail("sha mismatch \(hex) != \(expectedSHA)") }
            }
            let fm = FileManager.default
            let work = fm.temporaryDirectory.appendingPathComponent("disdat-update-\(version)", isDirectory: true)
            try? fm.removeItem(at: work)
            try? fm.createDirectory(at: work, withIntermediateDirectories: true)
            let zipPath = work.appendingPathComponent("update.zip")
            guard (try? zipData.write(to: zipPath)) != nil else { return fail("write zip") }
            // ditto -x -k unzips a macOS-created archive faithfully (preserves the
            // signature, resource forks and symlinks inside the .app).
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            p.arguments = ["-x", "-k", zipPath.path, work.path]
            do { try p.run(); p.waitUntilExit() } catch { return fail("ditto \(error)") }
            guard p.terminationStatus == 0 else { return fail("ditto status \(p.terminationStatus)") }
            // Find the .app inside the unzipped tree.
            guard let appURL = Self.findApp(in: work) else { return fail("no .app in archive") }
            DispatchQueue.main.async {
                self.stagedUpdateApp = appURL
                self.updateDownloading = false
                self.updateReady = true
                NSLog("[updater] staged \(version) at \(appURL.path)")
            }
        }.resume()
    }

    /// Swap the staged build in place and relaunch. Writes a detached bash helper
    /// that waits for this PID to exit, replaces the running bundle, and reopens it.
    func installStagedUpdate() {
        guard let staged = stagedUpdateApp else { return }
        let dst = Bundle.main.bundleURL
        let pid = ProcessInfo.processInfo.processIdentifier
        let script = """
        #!/bin/bash
        STAGED="$1"; DST="$2"; PID="$3"
        # wait for Dis Dat to fully quit
        while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
        sleep 0.3
        rm -rf "$DST"
        /usr/bin/ditto "$STAGED" "$DST"
        /usr/bin/xattr -dr com.apple.quarantine "$DST" 2>/dev/null
        /usr/bin/open "$DST"
        """
        let fm = FileManager.default
        let scriptURL = fm.temporaryDirectory.appendingPathComponent("disdat-swap-\(pid).sh")
        do {
            try script.write(to: scriptURL, atomically: true, encoding: .utf8)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)
        } catch {
            NSLog("[updater] failed writing swap script: \(error)")
            return
        }
        // Launch detached via setsid so it outlives our termination.
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [scriptURL.path, staged.path, dst.path, String(pid)]
        do { try p.run() } catch {
            NSLog("[updater] failed launching swapper: \(error)")
            return
        }
        // Give it a beat to start watching, then quit so the swap can proceed.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NSApp.terminate(nil)
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────
    private func presentUpToDate(alreadyStaged: Bool) {
        let a = NSAlert()
        if alreadyStaged {
            a.messageText = "Update ready"
            a.informativeText = "Dis Dat \(updateVersion ?? "") is downloaded. Relaunch to apply it."
            a.addButton(withTitle: "Relaunch")
            a.addButton(withTitle: "Later")
            NSApp.activate(ignoringOtherApps: true)
            if a.runModal() == .alertFirstButtonReturn { installStagedUpdate() }
        } else {
            a.messageText = "You're up to date"
            a.informativeText = "Dis Dat \(currentVersion) is the latest version."
            a.addButton(withTitle: "OK")
            NSApp.activate(ignoringOtherApps: true)
            a.runModal()
        }
    }

    private static func findApp(in dir: URL) -> URL? {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return nil }
        if let app = items.first(where: { $0.pathExtension == "app" }) { return app }
        // one level down (e.g. archives that wrap in a folder)
        for sub in items where (try? sub.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
            if let nested = (try? fm.contentsOfDirectory(at: sub, includingPropertiesForKeys: nil))?
                .first(where: { $0.pathExtension == "app" }) { return nested }
        }
        return nil
    }

    /// True when semantic version `a` is strictly greater than `b` ("0.2.0" > "0.1.9").
    static func isNewer(_ a: String, than b: String) -> Bool {
        func parts(_ s: String) -> [Int] {
            s.split(separator: ".").map { Int($0.prefix(while: \.isNumber)) ?? 0 }
        }
        let pa = parts(a), pb = parts(b)
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}
