import SwiftUI
import AppKit
import AVFoundation

/// Annotation sheet — text note + voice recording for a capture.
/// Opened by double-clicking a card in the grid.
struct AnnotationSheet: View {
    let capture: CapturePackage
    let onDone: () -> Void

    @State private var noteText: String = ""
    @State private var isRecording: Bool = false
    @State private var recorder: AVAudioRecorder? = nil
    @State private var hasVoice: Bool = false
    @State private var saveStatus: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "camera.viewfinder")
                    .foregroundStyle(.secondary)
                Text(capture.displayName)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Spacer()
                Button("Done", action: save)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
            .padding()

            Divider()

            // Screenshot preview
            if let img = NSImage(contentsOf: capture.screenshotURL) {
                Image(nsImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxHeight: 200)
                    .padding(.horizontal)
                    .padding(.top, 12)
            }

            // Note field
            VStack(alignment: .leading, spacing: 6) {
                Label("Note", systemImage: "text.alignleft")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)

                TextEditor(text: $noteText)
                    .font(.system(size: 13))
                    .frame(minHeight: 80)
                    .scrollContentBackground(.hidden)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                    .overlay(
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                    )
            }
            .padding()

            // Voice note
            VStack(alignment: .leading, spacing: 8) {
                Label("Voice Note", systemImage: "waveform")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)

                HStack(spacing: 12) {
                    Button {
                        toggleRecording()
                    } label: {
                        Label(
                            isRecording ? "Stop Recording" : (hasVoice ? "Re-record" : "Record"),
                            systemImage: isRecording ? "stop.circle.fill" : "mic.circle.fill"
                        )
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(isRecording ? .red : .primary)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    if isRecording {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(.red)
                                .frame(width: 6, height: 6)
                                .opacity(0.9)
                            Text("Recording…")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }
                    } else if hasVoice {
                        Text("Voice note saved")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }

                if !saveStatus.isEmpty {
                    Text(saveStatus)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
        .frame(width: 420)
        .onAppear {
            loadExistingNote()
            hasVoice = capture.hasVoice
        }
    }

    // MARK: - Note persistence

    private func loadExistingNote() {
        if let text = try? String(contentsOf: capture.notesURL, encoding: .utf8) {
            noteText = text
                .replacingOccurrences(of: "^# Notes\\n+", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private func save() {
        // Save text note
        if !noteText.isEmpty {
            let content = "# Notes\n\n\(noteText)\n"
            try? content.write(to: capture.notesURL, atomically: true, encoding: .utf8)
        }
        saveStatus = "Saved"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            onDone()
        }
    }

    // MARK: - Voice recording

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let rec = try AVAudioRecorder(url: capture.voiceURL, settings: settings)
            rec.record()
            recorder = rec
            isRecording = true
            print("[AnnotationSheet] recording started to \(capture.voiceURL.path)")
        } catch {
            saveStatus = "Mic error: \(error.localizedDescription)"
            print("[AnnotationSheet] recording failed: \(error)")
        }
    }

    private func stopRecording() {
        recorder?.stop()
        recorder = nil
        isRecording = false
        hasVoice = true
        saveStatus = "Voice note saved"
        print("[AnnotationSheet] recording stopped")
    }
}
