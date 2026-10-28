import Foundation

// Configure with app defaults or environment on a Mac you control.
enum DisDatConfig {
    private static func value(_ name: String) -> String {
        let raw = UserDefaults.standard.string(forKey: name)
            ?? ProcessInfo.processInfo.environment[name] ?? ""
        guard let url = URL(string: raw), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            return "https://example.invalid"
        }
        return raw.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
    static let apiBase = value("DISDAT_API_BASE")
    static let siteBase = value("DISDAT_SITE_BASE")
    static let supabaseBase = value("DISDAT_SUPABASE_URL")
}
