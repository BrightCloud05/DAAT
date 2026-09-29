import Foundation
import Combine

struct DaatProgress {
    var connected = false
    var projectName: String?
    var taskTitle: String?
    var phase: String?          // running / idle / stopped
    var percent: Double?        // 0–100 when a source provides it
    var detail: String?         // current step, e.g. "receiving stream response"
    var model: String?
    var messageCount: Int?
    var toolCallCount: Int?
    var activeSessions: Int = 0
    var gatewayState: String?
    var activeAgents: Int?
    var updatedAt: Date?
    var source: String = "–"

    var isRunning: Bool { phase == "running" }
}

/// 진행사항 (progress) of whatever DAAT is running right now.
///
/// Reads the selected DAAT profile's optional feed, then its runtime state.
final class DaatProgressProvider: ObservableObject {

    @Published private(set) var progress = DaatProgress()

    private var timer: Timer?
    private var runtimeHome = DaatAppStateReader.hermesHome
    private var mode = "local"
    private var enabled = true
    private var feedURL: URL { runtimeHome.appendingPathComponent("menubar.json") }

    func configure(home: URL, mode: String, enabled: Bool) {
        let changed = self.runtimeHome != home || self.mode != mode || self.enabled != enabled
        self.runtimeHome = home
        self.mode = mode
        self.enabled = enabled
        if changed { refreshNow() }
    }

    func start() {
        guard timer == nil else { return }
        refreshNow()
        timer = Timer(timeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.refreshNow()
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func refreshNow() {
        guard enabled else { progress = DaatProgress(); return }
        guard mode == "local" else {
            var result = DaatProgress()
            result.source = "Remote DAAT"
            result.detail = "Open DAAT to view remote task progress."
            progress = result
            return
        }
        let selectedHome = runtimeHome
        // File/DB reads are cheap but keep them off the main thread anyway.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let result = self.readFeedFile()
                ?? DaatAppStateReader.read(home: selectedHome)
            DispatchQueue.main.async {
                guard self.runtimeHome == selectedHome, self.enabled, self.mode == "local" else { return }
                self.progress = result ?? DaatProgress()
            }
        }
    }

    // MARK: 1. Dedicated feed file (manual override)

    /// Schema (only "project" is required):
    /// { "project": "IDTAX", "task": "BAS draft", "phase": "running",
    ///   "percent": 62.5, "detail": "step 3/5", "updated_at": "ISO8601" }
    private func readFeedFile() -> DaatProgress? {
        guard let data = try? Data(contentsOf: feedURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let project = json["project"] as? String else { return nil }
        var p = DaatProgress()
        p.connected = true
        p.source = "feed"
        p.projectName = project
        p.taskTitle = json["task"] as? String
        p.phase = json["phase"] as? String
        p.percent = (json["percent"] as? NSNumber)?.doubleValue
        p.detail = json["detail"] as? String
        if let ts = json["updated_at"] as? String {
            p.updatedAt = ISO8601DateFormatter().date(from: ts)
        }
        // A stale feed (>1 h) yields to live DAAT state.
        if let updated = p.updatedAt, Date().timeIntervalSince(updated) > 3600 { return nil }
        return p
    }

}
