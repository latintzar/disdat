import SwiftUI
import AppKit
import AVFoundation

// Brand colors (mirrored from UI.swift, which keeps its copies private).
private let kInk = Color(red: 22/255, green: 17/255, blue: 13/255)
private let kCream = Color(red: 251/255, green: 247/255, blue: 238/255)
private let kOrange = Color(red: 1.0, green: 92/255, blue: 42/255)

// ── Audio playback controller ───────────────────────────────────────────────
/// Plays a local recording and publishes currentTime so subtitles can karaoke.
final class PlaybackController: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var playing = false
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0

    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var loadedURL: URL?

    func load(_ url: URL) {
        guard loadedURL != url else { return }
        loadedURL = url
        stopTimer()
        player = try? AVAudioPlayer(contentsOf: url)
        player?.delegate = self
        player?.prepareToPlay()
        duration = player?.duration ?? 0
        currentTime = 0
        playing = false
    }

    func toggle() { playing ? pause() : play() }

    func play() {
        guard let p = player else { return }
        if currentTime >= duration { p.currentTime = 0; currentTime = 0 }
        p.play()
        playing = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { [weak self] _ in
            guard let self, let p = self.player else { return }
            self.currentTime = p.currentTime
        }
    }

    func pause() {
        player?.pause()
        playing = false
        stopTimer()
    }

    func seek(toFraction f: Double) {
        guard let p = player, duration > 0 else { return }
        let t = max(0, min(duration, f * duration))
        p.currentTime = t
        currentTime = t
    }

    private func stopTimer() { timer?.invalidate(); timer = nil }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            self.playing = false
            self.currentTime = self.duration
            self.stopTimer()
        }
    }

    deinit { stopTimer() }
}

// ── Recording playback with karaoke subtitles ───────────────────────────────
/// Plays the user's recording back and shows the transcript as subtitles that
/// light up word-by-word in time. Deliberately shows *only* audio + words — not
/// the screenshots — so onboarding stays "this is just a recording."
struct RecordingPlaybackView: View {
    let result: OnboardingResult
    @StateObject private var pc = PlaybackController()

    var body: some View {
        VStack(spacing: 16) {
            // Player bar: play/pause + progress + time
            HStack(spacing: 14) {
                Button(action: { pc.toggle() }) {
                    ZStack {
                        Circle().fill(kOrange).frame(width: 44, height: 44)
                            .shadow(color: kOrange.opacity(0.3), radius: 8, y: 3)
                        Image(systemName: pc.playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                            .offset(x: pc.playing ? 0 : 1)
                    }
                }.buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 6) {
                    ProgressScrubber(fraction: pc.duration > 0 ? pc.currentTime / pc.duration : 0,
                                     onSeek: { pc.seek(toFraction: $0) })
                        .frame(height: 8)
                    HStack {
                        Text(clock(pc.currentTime)).font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(kInk.opacity(0.55))
                        Spacer()
                        Text(clock(pc.duration)).font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundColor(kInk.opacity(0.55))
                    }
                }
            }

            // Subtitles
            subtitles
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(kInk.opacity(0.08)))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(kInk.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(kInk.opacity(0.08)))
        .onAppear { pc.load(result.audioURL) }
        .onChange(of: result.audioURL) { url in pc.load(url) }
    }

    @ViewBuilder private var subtitles: some View {
        if result.transcript == nil {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Transcribing what you said…")
                    .font(.system(size: 13)).foregroundColor(kInk.opacity(0.55))
            }
        } else if let t = result.transcript, t.isEmpty {
            Text("I didn't catch any speech — try recording again and talk through a change.")
                .font(.system(size: 13)).foregroundColor(kInk.opacity(0.55))
        } else if result.words.isEmpty {
            // Server returned a transcript but no word timings — show it plain.
            Text(result.transcript ?? "")
                .font(.system(size: 15, weight: .medium)).foregroundColor(kInk)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(karaoke(result.words, upTo: pc.currentTime))
                .font(.system(size: 15, weight: .medium))
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Build an AttributedString where words already spoken are inked, the word
    /// currently being spoken is orange, and upcoming words are dimmed.
    private func karaoke(_ words: [WordTiming], upTo t: Double) -> AttributedString {
        let currentIdx = words.lastIndex(where: { $0.t <= t + 0.01 })
        var out = AttributedString()
        for (i, wd) in words.enumerated() {
            var run = AttributedString(wd.w + " ")
            if i == currentIdx && pc.playing {
                run.foregroundColor = kOrange
            } else if let c = currentIdx, i <= c {
                run.foregroundColor = kInk
            } else {
                run.foregroundColor = kInk.opacity(0.3)
            }
            out += run
        }
        return out
    }

    private func clock(_ s: Double) -> String {
        guard s.isFinite else { return "0:00" }
        let total = Int(s.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// Slim tap/drag-to-seek progress bar.
private struct ProgressScrubber: View {
    let fraction: Double
    let onSeek: (Double) -> Void
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(kInk.opacity(0.10))
                Capsule().fill(kOrange).frame(width: max(0, min(1, fraction)) * geo.size.width)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                onSeek(v.location.x / geo.size.width)
            })
        }
    }
}

// ── Settings: click-to-record shortcut field ────────────────────────────────
/// Click to start listening, then press the new combo. Saves to
/// RecorderShortcut.current (which re-registers the global hotkey live).
struct ShortcutRecorderField: View {
    @State private var listening = false
    @State private var shortcut = RecorderShortcut.current
    @State private var monitor: Any?

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                if listening {
                    Text("Press keys…")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(kOrange)
                    Image(systemName: "circle.fill").font(.system(size: 7)).foregroundColor(kOrange)
                        .opacity(0.9)
                } else {
                    KeycapRow(keys: shortcut.keys)
                    Image(systemName: "pencil").font(.system(size: 10, weight: .semibold))
                        .foregroundColor(kInk.opacity(0.4))
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 9)
                .fill(listening ? kOrange.opacity(0.08) : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 9)
                .stroke(listening ? kOrange.opacity(0.5) : kInk.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .onDisappear(perform: stop)
    }

    private func toggle() { listening ? stop() : start() }

    private func start() {
        listening = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { ev in
            // Bare Escape cancels.
            if ev.keyCode == 53 && ev.modifierFlags.intersection(.deviceIndependentFlagsMask).isEmpty {
                DispatchQueue.main.async { stop() }
                return nil
            }
            if let sc = RecorderShortcut.from(event: ev) {
                RecorderShortcut.current = sc      // persists + posts .disdatShortcutChanged
                DispatchQueue.main.async { shortcut = sc; stop() }
            }
            return nil   // swallow so we don't fire menu equivalents while capturing
        }
    }

    private func stop() {
        listening = false
        if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
    }
}

/// Renders a shortcut as a row of keycaps.
struct KeycapRow: View {
    let keys: [String]
    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(keys.enumerated()), id: \.offset) { _, k in
                Text(k)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundColor(kInk)
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(Color.white)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(kInk.opacity(0.15)))
                    .cornerRadius(6)
                    .shadow(color: kInk.opacity(0.06), radius: 1, y: 1)
            }
        }
    }
}

// ── Onboarding: shortcut setup + test steps ─────────────────────────────────
struct ShortcutSetupStep: View {
    @State private var shortcut = RecorderShortcut.current
    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().fill(kOrange.opacity(0.10)).frame(width: 100, height: 100)
                Image(systemName: "command").font(.system(size: 40, weight: .regular)).foregroundColor(kOrange)
            }
            Text("Your recording shortcut").font(.system(size: 26, weight: .semibold, design: .serif)).foregroundColor(kInk)
            VStack(spacing: 6) {
                Text("Press this anywhere on your Mac to start recording.")
                Text("✓ on the pill finishes and pastes; Esc cancels.")
            }
            .font(.system(size: 13)).foregroundColor(kInk.opacity(0.65))
            .multilineTextAlignment(.center).frame(maxWidth: 460)

            HStack(spacing: 10) {
                KeycapRow(keys: shortcut.keys).scaleEffect(1.15)
            }
            .padding(.vertical, 6)

            HStack(spacing: 8) {
                Text("Prefer a different combo?").font(.system(size: 12)).foregroundColor(kInk.opacity(0.55))
                ShortcutRecorderField()
            }
            .onReceive(NotificationCenter.default.publisher(for: .disdatShortcutChanged)) { _ in
                shortcut = RecorderShortcut.current
            }
        }
    }
}

struct ShortcutTestStep: View {
    @EnvironmentObject var store: AppStore
    @State private var shortcut = RecorderShortcut.current

    var body: some View {
        VStack(spacing: 18) {
            if let result = store.onboardingResult, !store.onboardingRecording {
                // Result: play their recording back with subtitles.
                ZStack {
                    Circle().fill(Color.green.opacity(0.12)).frame(width: 72, height: 72)
                    Image(systemName: "waveform").font(.system(size: 30)).foregroundColor(.green)
                }
                Text("That's what your agent hears")
                    .font(.system(size: 24, weight: .semibold, design: .serif)).foregroundColor(kInk)
                Text("Your voice — transcribed. (Behind the scenes we also send where you pointed.)")
                    .font(.system(size: 13)).foregroundColor(kInk.opacity(0.6))
                    .multilineTextAlignment(.center).frame(maxWidth: 460)
                RecordingPlaybackView(result: result).frame(maxWidth: 520)
                Button(action: { store.onboardingResult = nil }) {
                    Text("Record again").font(.system(size: 12, weight: .medium)).foregroundColor(kOrange)
                }.buttonStyle(.plain)
            } else if store.onboardingRecording {
                // Live: pill is on-screen at the bottom; nudge them to talk + point.
                ZStack {
                    Circle().fill(kOrange.opacity(0.12)).frame(width: 100, height: 100)
                    Image(systemName: "mic.fill").font(.system(size: 40)).foregroundColor(kOrange)
                }
                Text("Listening…").font(.system(size: 26, weight: .semibold, design: .serif)).foregroundColor(kInk)
                Text("Point your cursor at something on this screen and say what you'd change. Press ✓ on the pill (bottom center) or your shortcut again to finish — Esc cancels.")
                    .font(.system(size: 13)).foregroundColor(kInk.opacity(0.65))
                    .multilineTextAlignment(.center).frame(maxWidth: 460)
            } else {
                // Prompt to test.
                ZStack {
                    Circle().fill(kOrange.opacity(0.10)).frame(width: 100, height: 100)
                    Image(systemName: "hand.point.up.left.fill").font(.system(size: 38)).foregroundColor(kOrange)
                }
                Text("Try it now").font(.system(size: 26, weight: .semibold, design: .serif)).foregroundColor(kInk)
                Text("Press your shortcut, then talk and point at anything on screen. We'll play it right back so you can see what gets captured.")
                    .font(.system(size: 13)).foregroundColor(kInk.opacity(0.65))
                    .multilineTextAlignment(.center).frame(maxWidth: 460)
                KeycapRow(keys: shortcut.keys).scaleEffect(1.1).padding(.top, 4)
            }
        }
        .onAppear {
            store.awaitingOnboardingTest = true
            shortcut = RecorderShortcut.current
        }
        .onDisappear {
            store.awaitingOnboardingTest = false
            store.onboardingRecording = false
            store.onboardingResult = nil
        }
    }
}
