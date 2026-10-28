import Foundation

/// One transcribed word with its start time (seconds) — used to karaoke-sync
/// the onboarding playback subtitles.
struct WordTiming { let w: String; let t: Double }

/// What the server returns for a finished upload.
struct UploadResult {
    let url: URL?
    let markers: Int
    let transcript: String
    let words: [WordTiming]
}

/// Uploads a raw session (audio + raw frames + cursor meta) to the server, which
/// transcribes, detects markers, annotates, runs Claude, and hosts the result.
enum Uploader {
    // Hetzner dev server — public, so anyone (incl. a friend's Claude Code) can reach the result URLs.
    static let endpoint = URL(string: "\(DisDatConfig.apiBase)/upload")!

    // A dropped upload used to silently lose the whole recording (and never copy a
    // link). We now retry transient failures with backoff so a flaky network or a
    // briefly-rejected token recovers on its own. Delays precede attempts 2/3/4.
    private static let maxAttempts = 4
    private static let backoff: [Double] = [2, 5, 12]

    static func uploadSession(audioURL: URL?,
                              frames: [(name: String, data: Data)],
                              metaJSON: Data,
                              attempt: Int = 0,
                              completion: @escaping (UploadResult) -> Void) {
        // The server requires a Supabase JWT now. Refresh if necessary, then upload.
        AuthSession.refreshIfNeeded { token in
            guard let token else {
                NSLog("[Dis Dat] upload aborted: not signed in")
                DispatchQueue.main.async { completion(UploadResult(url: nil, markers: 0, transcript: "", words: [])) }
                return
            }
            performUpload(audioURL: audioURL, frames: frames, metaJSON: metaJSON, token: token) { result, status in
                if result.url != nil {
                    DispatchQueue.main.async { completion(result) }
                    return
                }
                // No usable URL → decide whether to retry. 4xx that won't change on
                // retry (bad request, trial ended, forbidden, too large) are permanent;
                // everything else (network error, 401, 408/429, 5xx) is worth retrying.
                let code = status ?? -1
                let permanent = [400, 402, 403, 413].contains(code)
                guard !permanent, attempt + 1 < maxAttempts else {
                    NSLog("[Dis Dat] upload giving up after \(attempt + 1) attempt(s) (status \(code))")
                    DispatchQueue.main.async { completion(result) }
                    return
                }
                let delay = backoff[min(attempt, backoff.count - 1)]
                NSLog("[Dis Dat] upload attempt \(attempt + 1) failed (status \(code)) — retrying in \(delay)s")
                let again = {
                    uploadSession(audioURL: audioURL, frames: frames, metaJSON: metaJSON,
                                  attempt: attempt + 1, completion: completion)
                }
                if code == 401 {
                    // Token rejected mid-flight — force a fresh access token before retrying.
                    AuthSession.forceRefresh { _ in
                        DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: again)
                    }
                } else {
                    DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: again)
                }
            }
        }
    }

    private static func performUpload(audioURL: URL?,
                                      frames: [(name: String, data: Data)],
                                      metaJSON: Data,
                                      token: String,
                                      completion: @escaping (UploadResult, Int?) -> Void) {
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.timeoutInterval = 180
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let boundary = "----leofb-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }

        add("--\(boundary)\r\n")
        add("Content-Disposition: form-data; name=\"meta\"\r\n\r\n")
        body.append(metaJSON)
        add("\r\n")

        if let a = audioURL, let d = try? Data(contentsOf: a) {
            add("--\(boundary)\r\n")
            add("Content-Disposition: form-data; name=\"audio\"; filename=\"audio.caf\"\r\n")
            add("Content-Type: audio/x-caf\r\n\r\n")
            body.append(d)
            add("\r\n")
        }

        for f in frames {
            add("--\(boundary)\r\n")
            add("Content-Disposition: form-data; name=\"frames\"; filename=\"\(f.name)\"\r\n")
            add("Content-Type: image/jpeg\r\n\r\n")
            body.append(f.data)
            add("\r\n")
        }
        add("--\(boundary)--\r\n")
        req.httpBody = body

        URLSession.shared.dataTask(with: req) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode
            if let error { NSLog("[LeoFeedback] upload failed: \(error.localizedDescription)") }
            guard let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let s = obj["url"] as? String, let url = URL(string: s) else {
                completion(UploadResult(url: nil, markers: 0, transcript: "", words: []), status)
                return
            }
            let markers = obj["markers"] as? Int ?? 0
            let transcript = obj["transcript"] as? String ?? ""
            let words: [WordTiming] = (obj["words"] as? [[String: Any]] ?? []).compactMap {
                guard let w = $0["w"] as? String, let t = $0["t"] as? Double else { return nil }
                return WordTiming(w: w, t: t)
            }
            completion(UploadResult(url: url, markers: markers, transcript: transcript, words: words), status)
        }.resume()
    }
}
