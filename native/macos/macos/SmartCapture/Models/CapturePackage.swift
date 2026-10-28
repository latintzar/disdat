import Foundation
import AppKit

/// A capture package — one directory containing screenshot + context + metadata.
struct CapturePackage: Identifiable, Codable {
    let id: String              // directory name, e.g. "my-app--2026-04-15T12-30-00"
    let directoryURL: URL
    let name: String            // human-readable name (without timestamp suffix)
    let url: String             // source URL or app name
    let timestamp: Date
    let viewport: ViewportInfo
    let note: String?
    var files: [String]

    // MARK: - Derived

    var screenshotURL: URL { directoryURL.appendingPathComponent("screenshot.png") }
    var contextURL: URL { directoryURL.appendingPathComponent("context.md") }
    var manifestURL: URL { directoryURL.appendingPathComponent("manifest.json") }
    var notesURL: URL { directoryURL.appendingPathComponent("notes.md") }
    var voiceURL: URL { directoryURL.appendingPathComponent("voice.m4a") }

    var hasVoice: Bool { FileManager.default.fileExists(atPath: voiceURL.path) }
    var hasNote: Bool { FileManager.default.fileExists(atPath: notesURL.path) }

    var displayName: String {
        // Strip timestamp from id for display
        return name.components(separatedBy: "--").first ?? name
    }

    var formattedTimestamp: String {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f.string(from: timestamp)
    }

    // MARK: - Init from directory

    init?(directoryURL: URL) {
        let manifestURL = directoryURL.appendingPathComponent("manifest.json")
        guard FileManager.default.fileExists(atPath: manifestURL.path),
              let data = try? Data(contentsOf: manifestURL),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        self.directoryURL = directoryURL
        self.id = directoryURL.lastPathComponent
        self.name = raw["name"] as? String ?? directoryURL.lastPathComponent
        self.url = raw["url"] as? String ?? ""
        self.files = raw["files"] as? [String] ?? []
        self.note = raw["note"] as? String

        // Parse timestamp
        let tsString = raw["timestamp"] as? String ?? ""
        let iso = ISO8601DateFormatter()
        self.timestamp = iso.date(from: tsString) ?? Date()

        // Viewport
        if let vp = raw["viewport"] as? [String: Any] {
            self.viewport = ViewportInfo(
                width: vp["width"] as? Int ?? 1440,
                height: vp["height"] as? Int ?? 900,
                scale: vp["scale"] as? Int ?? 2
            )
        } else {
            self.viewport = ViewportInfo(width: 1440, height: 900, scale: 2)
        }
    }

    // MARK: - Init for new capture

    init(
        directoryURL: URL,
        name: String,
        url: String,
        timestamp: Date,
        viewport: ViewportInfo,
        note: String? = nil,
        files: [String] = []
    ) {
        self.directoryURL = directoryURL
        self.id = directoryURL.lastPathComponent
        self.name = name
        self.url = url
        self.timestamp = timestamp
        self.viewport = viewport
        self.note = note
        self.files = files
    }

    // MARK: - Codable (custom for URL)
    enum CodingKeys: String, CodingKey {
        case id, name, url, timestamp, viewport, note, files
        case directoryPath
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(url, forKey: .url)
        try c.encode(timestamp, forKey: .timestamp)
        try c.encode(viewport, forKey: .viewport)
        try c.encodeIfPresent(note, forKey: .note)
        try c.encode(files, forKey: .files)
        try c.encode(directoryURL.path, forKey: .directoryPath)
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decode(String.self, forKey: .id)
        self.name = try c.decode(String.self, forKey: .name)
        self.url = try c.decode(String.self, forKey: .url)
        self.timestamp = try c.decode(Date.self, forKey: .timestamp)
        self.viewport = try c.decode(ViewportInfo.self, forKey: .viewport)
        self.note = try c.decodeIfPresent(String.self, forKey: .note)
        self.files = try c.decode([String].self, forKey: .files)
        let path = try c.decode(String.self, forKey: .directoryPath)
        self.directoryURL = URL(fileURLWithPath: path)
    }
}

struct ViewportInfo: Codable {
    let width: Int
    let height: Int
    let scale: Int
}
