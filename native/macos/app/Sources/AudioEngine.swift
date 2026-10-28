import AVFoundation

/// Thin audio recorder: writes mic audio to a file (for server-side Deepgram)
/// and emits RMS levels for the waveform. No on-device transcription anymore.
final class AudioEngine {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private var fileURL: URL?
    var onLevel: ((Float) -> Void)?

    func prepare(fileURL: URL) { self.fileURL = fileURL }

    func start() {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] ok in
            guard ok else { NSLog("[LeoFeedback] microphone denied"); return }
            DispatchQueue.main.async { self?.begin() }
        }
    }

    private func begin() {
        let input = engine.inputNode
        let fmt = input.inputFormat(forBus: 0)
        if let url = fileURL {
            do { file = try AVAudioFile(forWriting: url, settings: fmt.settings) }
            catch { NSLog("[LeoFeedback] audio file open failed: \(error.localizedDescription)") }
        }
        input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buffer, _ in
            if let f = self?.file { try? f.write(from: buffer) }
            self?.emitLevel(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch { NSLog("[LeoFeedback] audio engine start failed: \(error.localizedDescription)") }
    }

    func stop(_ done: @escaping () -> Void) {
        if engine.isRunning {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        file = nil                      // closes/finalizes the audio file
        DispatchQueue.main.async { done() }
    }

    private func emitLevel(_ buffer: AVAudioPCMBuffer) {
        guard let ch = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { let s = ch[i]; sum += s * s }
        let level = min(1, sqrtf(sum / Float(n)) * 22)
        DispatchQueue.main.async { [weak self] in self?.onLevel?(level) }
    }
}
