import Foundation
import AppKit

/// Logs all app output to ~/Library/Logs/SmartCapture/ and uploads crash reports to the server.
/// On launch, checks for unsent crash logs from previous sessions and POSTs them.
class CrashReporter {

    static let shared = CrashReporter()

    private let logDir: URL
    private var uploadURL: URL? {
        guard let raw = UserDefaults.standard.string(forKey: "DISDAT_CRASH_REPORT_URL"),
              let url = URL(string: raw), url.scheme == "https", url.host != nil else { return nil }
        return url
    }
    private var logFileHandle: FileHandle?
    private var sessionLogURL: URL?

    private init() {
        let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        logDir = lib.appendingPathComponent("Logs/SmartCapture")
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
    }

    func start() {
        let ts = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let logFile = logDir.appendingPathComponent("session-\(ts).log")
        sessionLogURL = logFile

        FileManager.default.createFile(atPath: logFile.path, contents: nil)
        logFileHandle = try? FileHandle(forWritingTo: logFile)

        writeHeader()
        redirectStdStreams(to: logFile)
        installSignalHandlers()
        installExceptionHandler()

        // Crash reports remain local until a user explicitly submits one.

        print("[CrashReporter] logging to \(logFile.path)")
    }

    // MARK: - Header with system info

    private func writeHeader() {
        let info = ProcessInfo.processInfo
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        let header = """
        === SmartCapture Session Log ===
        Version: \(version) (\(build))
        macOS: \(info.operatingSystemVersionString)
        Date: \(Date())
        Machine: \(info.hostName)
        RAM: \(info.physicalMemory / 1_073_741_824)GB
        ================================

        """
        logFileHandle?.write(Data(header.utf8))
    }

    // MARK: - Redirect stdout/stderr to log file

    private func redirectStdStreams(to logFile: URL) {
        freopen(logFile.path.cString(using: .utf8), "a", stdout)
        freopen(logFile.path.cString(using: .utf8), "a", stderr)
    }

    // MARK: - Signal handlers (SIGSEGV, SIGABRT, SIGBUS, etc.)

    private func installSignalHandlers() {
        let signals: [Int32] = [SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGTRAP]
        for sig in signals {
            signal(sig) { sigNum in
                let name: String
                switch sigNum {
                case SIGSEGV: name = "SIGSEGV"
                case SIGABRT: name = "SIGABRT"
                case SIGBUS:  name = "SIGBUS"
                case SIGFPE:  name = "SIGFPE"
                case SIGILL:  name = "SIGILL"
                case SIGTRAP: name = "SIGTRAP"
                default:      name = "SIG\(sigNum)"
                }

                let crash = """
                \n\n!!! CRASH: \(name) (signal \(sigNum)) at \(Date())
                Thread: \(Thread.current)
                \(Thread.callStackSymbols.joined(separator: "\n"))
                """

                // Write directly via file descriptor (signal-safe-ish)
                if let logDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first {
                    let crashFile = logDir.appendingPathComponent("Logs/SmartCapture/CRASH-LAST.log")
                    try? crash.write(to: crashFile, atomically: false, encoding: .utf8)
                }

                // Write to stderr (which goes to our log)
                fputs(crash, stderr)
                fflush(stderr)

                // Re-raise to get default behavior
                signal(sigNum, SIG_DFL)
                raise(sigNum)
            }
        }
    }

    // MARK: - NSException handler

    private func installExceptionHandler() {
        NSSetUncaughtExceptionHandler { exception in
            let crash = """
            \n\n!!! UNCAUGHT EXCEPTION at \(Date())
            Name: \(exception.name.rawValue)
            Reason: \(exception.reason ?? "nil")
            Call stack:
            \(exception.callStackSymbols.joined(separator: "\n"))
            """

            if let logDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first {
                let crashFile = logDir.appendingPathComponent("Logs/SmartCapture/CRASH-LAST.log")
                try? crash.write(to: crashFile, atomically: false, encoding: .utf8)
            }

            fputs(crash, stderr)
            fflush(stderr)
        }
    }

    // MARK: - Upload pending crash logs on launch

    private func uploadPendingCrashLogs() {
        let crashFile = logDir.appendingPathComponent("CRASH-LAST.log")
        guard FileManager.default.fileExists(atPath: crashFile.path),
              let crashData = try? Data(contentsOf: crashFile),
              !crashData.isEmpty
        else { return }

        print("[CrashReporter] found pending crash log — uploading to server")

        // Also grab the most recent session log for context
        var body = String(data: crashData, encoding: .utf8) ?? "binary"
        if let sessionLogs = mostRecentSessionLog(), let text = try? String(contentsOf: sessionLogs, encoding: .utf8) {
            let lastLines = text.split(separator: "\n").suffix(200).joined(separator: "\n")
            body += "\n\n=== LAST 200 LOG LINES ===\n" + lastLines
        }

        upload(body)

        // Clean up after upload
        try? FileManager.default.removeItem(at: crashFile)
    }

    /// Upload a crash report string to the server
    func upload(_ text: String) {
        guard let uploadURL else { return }
        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"
        request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        request.setValue("SmartCapture/1.0", forHTTPHeaderField: "User-Agent")
        request.httpBody = Data(text.utf8)
        request.timeoutInterval = 10

        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error {
                print("[CrashReporter] upload failed: \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse {
                print("[CrashReporter] uploaded crash report — HTTP \(http.statusCode)")
            }
        }.resume()
    }

    /// Upload the current session log right now (for manual "send logs" button)
    func uploadCurrentLog() {
        guard let url = sessionLogURL, let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        upload("=== MANUAL LOG UPLOAD ===\n\n" + text)
    }

    private func mostRecentSessionLog() -> URL? {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: logDir, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles]
        ) else { return nil }

        return files
            .filter { $0.lastPathComponent.hasPrefix("session-") }
            .sorted {
                let d1 = (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                let d2 = (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
                return d1 > d2
            }
            .first
    }
}
