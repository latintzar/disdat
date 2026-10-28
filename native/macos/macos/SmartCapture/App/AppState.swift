import Foundation
import SwiftUI
import Combine
import Carbon

/// Central observable state shared across the entire app via @EnvironmentObject.
@MainActor
class AppState: ObservableObject {
    // MARK: - Permissions
    @Published var screenRecordingGranted: Bool = false
    @Published var accessibilityGranted: Bool = false

    // MARK: - Captures
    @Published var captures: [CapturePackage] = []

    // MARK: - UI State
    @Published var isCapturing: Bool = false      // overlay is active
    @Published var isProcessing: Bool = false      // post-selection processing
    @Published var lastError: String? = nil

    // MARK: - Settings (persisted via UserDefaults)
    @Published var capturesSavePath: String {
        didSet { UserDefaults.standard.set(capturesSavePath, forKey: "capturesSavePath") }
    }
    @Published var hotkeyModifiers: UInt32 {
        didSet { UserDefaults.standard.set(hotkeyModifiers, forKey: "hotkeyModifiers") }
    }
    @Published var hotkeyKeyCode: UInt32 {
        didSet { UserDefaults.standard.set(hotkeyKeyCode, forKey: "hotkeyKeyCode") }
    }

    // MARK: - Computed paths

    var capturesDirectory: URL {
        let custom = capturesSavePath
        if !custom.isEmpty {
            return URL(fileURLWithPath: custom)
        }
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("SmartCaptures")
    }

    // MARK: - Init

    init() {
        self.capturesSavePath = UserDefaults.standard.string(forKey: "capturesSavePath") ?? ""
        // Default hotkey: Cmd+Shift+X  (keyCode 7 = X, modifiers = Cmd+Shift)
        let storedMod = UserDefaults.standard.integer(forKey: "hotkeyModifiers")
        self.hotkeyModifiers = UInt32(storedMod == 0 ? (Int(Carbon.cmdKey) | Int(Carbon.shiftKey)) : storedMod)
        let storedKey = UserDefaults.standard.integer(forKey: "hotkeyKeyCode")
        self.hotkeyKeyCode = UInt32(storedKey == 0 ? 7 : storedKey)

        ensureCapturesDirectory()
        loadCaptures()
    }

    // MARK: - Captures management

    func ensureCapturesDirectory() {
        let dir = capturesDirectory
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    func loadCaptures() {
        let dir = capturesDirectory
        Task.detached(priority: .userInitiated) { [weak self] in
            guard let entries = try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.isDirectoryKey, .creationDateKey],
                options: [.skipsHiddenFiles]
            ) else { return }

            var loaded: [CapturePackage] = []
            for entry in entries {
                var isDir: ObjCBool = false
                FileManager.default.fileExists(atPath: entry.path, isDirectory: &isDir)
                guard isDir.boolValue else { continue }
                if let pkg = CapturePackage(directoryURL: entry) {
                    loaded.append(pkg)
                }
            }
            let sorted = loaded.sorted { $0.timestamp > $1.timestamp }
            print("[AppState] loaded \(loaded.count) captures from \(dir.path)")

            await MainActor.run { [weak self] in
                self?.captures = sorted
            }
        }
    }

    func addCapture(_ package: CapturePackage) {
        captures.insert(package, at: 0)
    }

    func deleteCapture(_ package: CapturePackage) {
        try? FileManager.default.removeItem(at: package.directoryURL)
        captures.removeAll { $0.id == package.id }
    }

    func refreshPermissions() {
        screenRecordingGranted = CGPreflightScreenCaptureAccess()
        let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false]
        accessibilityGranted = AXIsProcessTrustedWithOptions(options)
    }
}
