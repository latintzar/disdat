import Foundation
import Security

/// Keychain-backed Supabase token store. The access token is what api.disdat.dev expects
/// in Authorization: Bearer; we keep the refresh token to renew it when it expires.
enum AuthSession {
    // Credentials and endpoints are supplied through the operator configuration.
    static let supabaseURL = "\(DisDatConfig.supabaseBase)"
    static let supabaseAnonKey = UserDefaults.standard.string(forKey: "DISDAT_SUPABASE_ANON_KEY")
        ?? ProcessInfo.processInfo.environment["DISDAT_SUPABASE_ANON_KEY"] ?? ""

    // Product-branded keychain service. The repeated "Dis Dat wants to use
    // confidential information stored in …" prompt is NOT caused by this string —
    // it appears when the app's code signature changes between launches (ad-hoc or
    // a different identity each build). A consistently Developer-ID-signed,
    // notarized build keeps the same designated requirement, so macOS stops
    // prompting. See build.sh: release builds refuse to ad-hoc sign for this reason.
    private static let service = "dev.latintzar.disdat"
    private static let accessAccount = "supabase.access"
    private static let refreshAccount = "supabase.refresh"
    private static let emailAccount = "user.email"
    private static let expiresAccount = "supabase.expires"

    private static func write(_ account: String, _ value: String) {
        let data = Data(value.utf8)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = data
        // Readable after the first unlock without re-prompting — lets background
        // token refresh succeed even while the screen is locked.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func read(_ account: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data, let s = String(data: data, encoding: .utf8) else {
            return nil
        }
        return s
    }

    private static func remove(_ account: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(q as CFDictionary)
    }

    static func save(accessToken: String, refreshToken: String?, expiresIn: Int?, email: String?) {
        write(accessAccount, accessToken)
        if let r = refreshToken { write(refreshAccount, r) }
        if let e = expiresIn { write(expiresAccount, String(Int(Date().timeIntervalSince1970) + e)) }
        if let m = email { write(emailAccount, m) }
    }

    static func clear() {
        remove(accessAccount); remove(refreshAccount); remove(emailAccount); remove(expiresAccount)
    }

    static var accessToken: String? { read(accessAccount) }
    static var refreshToken: String? { read(refreshAccount) }
    static var email: String? { read(emailAccount) }
    static var isSignedIn: Bool { accessToken != nil }
    static var accessExpiresAt: Date? {
        guard let s = read(expiresAccount), let t = Double(s) else { return nil }
        return Date(timeIntervalSince1970: t)
    }

    /// Refresh the access token via Supabase's grant_type=refresh_token endpoint
    /// only if the cached one is missing or within 120s of expiry. Returns the
    /// usable access token (cached or freshly minted).
    static func refreshIfNeeded(completion: @escaping (String?) -> Void) {
        guard let access = accessToken else { completion(nil); return }
        if let exp = accessExpiresAt, exp.timeIntervalSinceNow > 120 {
            completion(access); return
        }
        guard let refresh = refreshToken else { completion(access); return }
        performRefresh(refresh, completion: completion)
    }

    /// Unconditionally exchange the refresh token for a new access token. Used
    /// when the server rejects a token mid-flight (401): the cached access token
    /// may be stale even though it hasn't hit its expiry clock yet, so we force a
    /// fresh one before retrying rather than re-sending the rejected one.
    static func forceRefresh(completion: @escaping (String?) -> Void) {
        guard let refresh = refreshToken else { completion(nil); return }
        performRefresh(refresh, completion: completion)
    }

    /// POST grant_type=refresh_token, persist the result, hand back the new access token.
    private static func performRefresh(_ refresh: String, completion: @escaping (String?) -> Void) {
        var req = URLRequest(url: URL(string: "\(supabaseURL)/auth/v1/token?grant_type=refresh_token")!)
        req.httpMethod = "POST"
        req.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["refresh_token": refresh]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let newAccess = obj["access_token"] as? String else {
                completion(nil); return
            }
            let newRefresh = obj["refresh_token"] as? String
            let expIn = obj["expires_in"] as? Int
            save(accessToken: newAccess, refreshToken: newRefresh, expiresIn: expIn, email: email)
            completion(newAccess)
        }.resume()
    }

    /// Build an authorized request with auto-refresh.
    static func authorizedRequest(_ url: URL, method: String = "GET", body: Data? = nil, completion: @escaping (URLRequest?) -> Void) {
        refreshIfNeeded { token in
            guard let token else { completion(nil); return }
            var req = URLRequest(url: url)
            req.httpMethod = method
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            completion(req)
        }
    }
}
