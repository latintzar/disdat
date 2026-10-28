import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Grid Popover root

/// The "Downloads stack" grid — a compact grid of recent captures in the menu bar popover.
struct GridPopoverView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedCapture: CapturePackage? = nil
    @State private var showingAnnotation: CapturePackage? = nil

    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
    private let cardSize: CGFloat = 102

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Smart Capture")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.primary)
                Spacer()
                if appState.isProcessing {
                    HStack(spacing: 4) {
                        ProgressView().scaleEffect(0.6)
                        Text("Capturing…")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("\(appState.captures.count)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                Button {
                    appState.loadCaptures()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .help("Refresh")

                Button {
                    RegionSelectorController.shared.show()
                } label: {
                    Image(systemName: "camera.viewfinder")
                        .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.plain)
                .foregroundColor(.accentColor)
                .help("Capture region (⌘⇧X)")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            // Permissions warning banner
            if !appState.screenRecordingGranted || !appState.accessibilityGranted {
                permissionsBanner
            }

            if appState.captures.isEmpty {
                emptyState
            } else {
                // Capture grid
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(appState.captures) { capture in
                            CaptureCardView(
                                capture: capture,
                                isSelected: selectedCapture?.id == capture.id
                            )
                            .onTapGesture(count: 2) {
                                showingAnnotation = capture
                            }
                            .onTapGesture(count: 1) {
                                selectedCapture = capture
                            }
                            .contextMenu {
                                captureContextMenu(for: capture)
                            }
                        }
                    }
                    .padding(8)
                }
                .frame(maxHeight: 340)
                // Cmd+C copies both image + context.md simultaneously
                .background(
                    Button("") {
                        if let cap = selectedCapture {
                            copyCapture(cap)
                        }
                    }
                    .keyboardShortcut("c", modifiers: .command)
                    .opacity(0)
                )
            }

            Divider()

            // Footer
            HStack {
                Button("Open Folder") {
                    let dir = appState.capturesDirectory
                    NSWorkspace.shared.open(dir)
                }
                .font(.system(size: 11))
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)

                Spacer()

                Button("Send Logs") {
                    CrashReporter.shared.uploadCurrentLog()
                }
                .font(.system(size: 11))
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)

                Button("Quit") {
                    NSApp.terminate(nil)
                }
                .font(.system(size: 11))
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .frame(width: 368)
        .sheet(item: $showingAnnotation) { capture in
            AnnotationSheet(capture: capture) {
                showingAnnotation = nil
                appState.loadCaptures()
            }
        }
        .alert("Error", isPresented: .constant(appState.lastError != nil), actions: {
            Button("OK") { appState.lastError = nil }
        }, message: {
            Text(appState.lastError ?? "")
        })
    }

    // MARK: - Permissions banner

    private var permissionsBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.system(size: 11))
                Text("Permissions needed for full captures")
                    .font(.system(size: 11, weight: .medium))
                Spacer()
            }
            if !appState.accessibilityGranted {
                permissionRow("Accessibility — UI tree, app names", "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            }
            if !appState.screenRecordingGranted {
                permissionRow("Screen Recording — screenshot capture", "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.08))
    }

    private func permissionRow(_ label: String, _ urlString: String) -> some View {
        Button {
            if let url = URL(string: urlString) { NSWorkspace.shared.open(url) }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.red).font(.system(size: 10))
                Text(label).font(.system(size: 10)).underline()
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "camera.viewfinder")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("No captures yet")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)

            Button {
                RegionSelectorController.shared.show()
            } label: {
                Label("Capture Now", systemImage: "viewfinder")
                    .font(.system(size: 12, weight: .medium))
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)

            Text("or press ⌘⇧X")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - Context menu

    @ViewBuilder
    private func captureContextMenu(for capture: CapturePackage) -> some View {
        Button("Open in Finder") {
            NSWorkspace.shared.selectFile(capture.screenshotURL.path, inFileViewerRootedAtPath: "")
        }
        Button("Copy context.md") {
            copyCapture(capture)
        }
        Button("Copy Screenshot") {
            if let img = NSImage(contentsOf: capture.screenshotURL) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([img])
            }
        }
        Divider()
        Button("Add Note…") {
            showingAnnotation = capture
        }
        Divider()
        Button("Delete", role: .destructive) {
            appState.deleteCapture(capture)
        }
    }

    /// Copy context.md as text — works the same everywhere.
    /// Paste into Cursor, Claude, ChatGPT, any text field: always gets the full markdown.
    /// To also share the image: right-click → Copy Screenshot, or drag from the capture folder.
    func copyCapture(_ cap: CapturePackage) {
        guard let text = try? String(contentsOf: cap.contextURL, encoding: .utf8) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func openPrivacySettings() {
        let screenURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!
        NSWorkspace.shared.open(screenURL)
    }
}

// MARK: - Capture Card

struct CaptureCardView: View {
    let capture: CapturePackage
    let isSelected: Bool

    @State private var thumbnail: NSImage? = nil
    @State private var isHovered = false
    @State private var copied = false

    var body: some View {
        VStack(spacing: 3) {
            // Thumbnail
            ZStack(alignment: .topTrailing) {
                Group {
                    if let img = thumbnail {
                        Image(nsImage: img)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else {
                        Rectangle()
                            .fill(Color.secondary.opacity(0.12))
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundStyle(.tertiary)
                                    .font(.system(size: 16))
                            )
                    }
                }
                .frame(width: 102, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 5))

                // Hover copy button (top-right)
                if isHovered || isSelected {
                    Button {
                        copyContext()
                        copied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                    } label: {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 9, weight: .semibold))
                            .padding(4)
                            .background(Color.black.opacity(0.65))
                            .foregroundStyle(copied ? .green : .white)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                    .buttonStyle(.plain)
                    .padding(4)
                    .help("Copy context.md")
                    .transition(.opacity)
                }

                // Badges (bottom-right)
                HStack(spacing: 2) {
                    if capture.hasNote {
                        badge("note")
                    }
                    if capture.hasVoice {
                        badge("voice")
                    }
                }
                .padding(3)
            }
            .onHover { isHovered = $0 }

            // Label
            Text(capture.displayName)
                .font(.system(size: 9, weight: .medium))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(width: 102)
                .foregroundStyle(.primary)

            Text(capture.formattedTimestamp)
                .font(.system(size: 8))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 7)
                .fill(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7)
                .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 1.5)
        )
        // Drag support — drag context.md out of the grid
        .onDrag {
            let provider = NSItemProvider(contentsOf: capture.contextURL)
            return provider ?? NSItemProvider()
        }
        .onAppear { loadThumbnail() }
    }

    private func badge(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 7, weight: .semibold))
            .padding(.horizontal, 3)
            .padding(.vertical, 1)
            .background(Color.black.opacity(0.6))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    private func copyContext() {
        guard let text = try? String(contentsOf: capture.contextURL, encoding: .utf8) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func loadThumbnail() {
        guard thumbnail == nil else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let img = NSImage(contentsOf: capture.screenshotURL)
            DispatchQueue.main.async {
                thumbnail = img
            }
        }
    }
}
