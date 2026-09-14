import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {

    private lazy var statusItem: NSStatusItem =
        NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    private let popover = NSPopover()

    let stats = SystemStatsEngine()
    let codex = CodexUsageProvider()
    let daat = DaatProgressProvider()

    private var frames: [NSImage] = []
    private var frameIndex = 0
    private var runnerTimer: Timer?
    private var speedTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        frames = CatFrames.load()
        setupStatusItem()
        setupPopover()

        stats.start()
        codex.start()
        daat.start()

        startRunning()
        observeSleepWake()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopRunning()
        stats.stop()
    }

    // MARK: - Status item / cat animation

    private func setupStatusItem() {
        // Remember the slot across launches and force the item visible — on a
        // crowded menu bar macOS silently hides items that don't fit, and a
        // freshly re-added item lands exactly in the hidden zone.
        statusItem.autosaveName = "DAATCat"
        statusItem.isVisible = true

        guard let button = statusItem.button else { return }
        button.image = frames.first
        button.imagePosition = .imageOnly
        button.action = #selector(togglePopover(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.target = self
    }

    private func setupPopover() {
        popover.behavior = .transient
        popover.animates = false
        popover.delegate = self
        let root = PopoverView(stats: stats, codex: codex, daat: daat) { [weak self] in
            self?.popover.performClose(nil)
        }
        popover.contentViewController = NSHostingController(rootView: root)
    }

    @objc private func togglePopover(_ sender: Any?) {
        if popover.isShown {
            popover.performClose(sender)
            return
        }

        guard let button = statusItem.button else { return }

        codex.refreshSoon()
        daat.refreshNow()

        // Never taller than the screen: the full panel is ~700pt, which is
        // more than a MacBook leaves under the menu bar — unclamped, the
        // popover overflowed off the top of the display.
        let available = (NSScreen.main?.visibleFrame.height ?? 800) - 24
        let height = min(704, max(360, available))
        let root = PopoverView(stats: stats, codex: codex, daat: daat) { [weak self] in
            self?.popover.performClose(nil)
        }
        .frame(width: 372, height: height)

        popover.contentViewController = NSHostingController(rootView: root)
        popover.contentSize = NSSize(width: 372, height: height)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
    }

    /// Cat pace — RunCat's idea (speed ∝ load), recalibrated to a calmer
    /// range: blend CPU with memory pressure, trot at ~2 fps when idle and
    /// top out near 12 fps flat-out instead of a permanent sprint.
    private func animationInterval() -> TimeInterval {
        let cpu = stats.cpu.totalUsage
        let ram = stats.memory.pressurePercent
        let load = min(100.0, max(0.0, cpu * 0.7 + ram * 0.3))
        let fps = 2.0 + (load / 100.0) * 10.0

        return 1.0 / fps
    }

    private func startRunning() {
        speedTimer = Timer(timeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.retimeRunner()
        }
        RunLoop.main.add(speedTimer!, forMode: .common)
        speedTimer?.fire()
    }

    private func retimeRunner() {
        let interval = animationInterval()
        runnerTimer?.invalidate()
        runnerTimer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            self?.advanceFrame()
        }
        RunLoop.main.add(runnerTimer!, forMode: .common)
    }

    private func advanceFrame() {
        guard !frames.isEmpty else { return }
        frameIndex = (frameIndex + 1) % frames.count
        statusItem.button?.image = frames[frameIndex]
    }

    private func stopRunning() {
        runnerTimer?.invalidate()
        speedTimer?.invalidate()
    }

    // MARK: - Sleep / wake

    private func observeSleepWake() {
        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.stopRunning()
        }
        nc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.startRunning()
        }
    }
}

// MARK: - Cat frame loading

enum CatFrames {
    /// Loads cat0–cat4 template images. Looks in the app bundle first,
    /// then falls back to the repo location for `swift run` during development.
    static func load() -> [NSImage] {
        let candidates: [URL] = [
            Bundle.main.resourceURL?.appendingPathComponent("cat"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("Resources/cat"),
            URL(fileURLWithPath: NSHomeDirectory())
                .appendingPathComponent("Documents/Dashboard/DaatCat/Resources/cat"),
        ].compactMap { $0 }

        for dir in candidates {
            let images: [NSImage] = (0..<5).compactMap { n in
                let url = dir.appendingPathComponent("cat\(n).png")
                guard let img = NSImage(contentsOf: url) else { return nil }
                img.size = NSSize(width: 28, height: 18)
                img.isTemplate = true // adapts to light/dark menu bar like RunCat
                return img
            }
            if images.count == 5 { return images }
        }
        // Last-resort placeholder so the app still runs without assets.
        let fallback = NSImage(systemSymbolName: "cat", accessibilityDescription: "cat")
            ?? NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: "cat")!
        fallback.isTemplate = true
        return [fallback]
    }
}
