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
/// Sources, tried in priority order every poll:
///   1. ~/.daat/menubar.json — optional dedicated feed (manual override)
///   2. DAAT runtime state in HERMES_HOME (~/.hermes) — the real thing
///   3. ~/.codex/session_index.jsonl — standalone Codex CLI, last resort
final class DaatProgressProvider: ObservableObject {

    @Published private(set) var progress = DaatProgress()

    private var timer: Timer?
    private let home = FileManager.default.homeDirectoryForCurrentUser

    private var feedURL: URL { home.appendingPathComponent(".daat/menubar.json") }
    private var codexSessionIndex: URL {
        home.appendingPathComponent(".codex/session_index.jsonl")
    }

    func start() {
        refreshNow()
        timer = Timer(timeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.refreshNow()
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func refreshNow() {
        // File/DB reads are cheap but keep them off the main thread anyway.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let result = self.readFeedFile()
                ?? DaatAppStateReader.read(supportDir: self.home)
                ?? self.readCodexSessions()
            DispatchQueue.main.async {
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

    // MARK: 3. Codex CLI fallback

    /// Newest entry in the standalone Codex CLI session index. Only used when
    /// DAAT state is unavailable; labeled accordingly.
    private func readCodexSessions() -> DaatProgress? {
        guard let text = try? String(contentsOf: codexSessionIndex, encoding: .utf8)
        else { return nil }
        for line in text.split(separator: "\n").reversed() {
            guard let data = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }

            let cwd = (json["cwd"] ?? json["workdir"] ?? json["path"]) as? String
            let title = (json["title"] ?? json["summary"] ?? json["preview"]) as? String

            var p = DaatProgress()
            p.connected = true
            p.source = "Codex CLI"
            p.projectName = cwd.map { URL(fileURLWithPath: $0).lastPathComponent }
            p.taskTitle = title.map { String($0.prefix(120)) }

            if let ts = (json["updated_at"] ?? json["timestamp"] ?? json["created_at"]) as? String {
                p.updatedAt = ISO8601DateFormatter().date(from: ts) ?? Self.flexibleDate(ts)
            } else if let epoch = ((json["updated_at"] ?? json["timestamp"]) as? NSNumber)?.doubleValue {
                p.updatedAt = Date(timeIntervalSince1970: epoch)
            }
            if let updated = p.updatedAt {
                p.phase = Date().timeIntervalSince(updated) < 15 * 60 ? "running" : "idle"
            }
            return p
        }
        return nil
    }

    private static func flexibleDate(_ s: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f.date(from: s)
    }
}
