import Foundation
import SQLite3

/// Reads DAAT's real runtime state from HERMES_HOME (default ~/.hermes).
///
/// DAAT (Daat.app) is the desktop shell of the hermes agent; it persists:
///   desktop/interrupted_turns.json — live marker for the turn running right now
///   state.db (sqlite, WAL)        — sessions with step text + activity heartbeat
///   projects.db                   — project names + folder mappings
///   gateway_state.json            — gateway daemon health / active agents
/// Everything is opened strictly read-only; the DB is hot (agent writes to it).
enum DaatAppStateReader {

    static var hermesHome: URL {
        if let env = ProcessInfo.processInfo.environment["HERMES_HOME"], !env.isEmpty {
            return URL(fileURLWithPath: (env as NSString).expandingTildeInPath)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hermes")
    }

    static func read(supportDir: URL) -> DaatProgress? {
        let home = hermesHome
        guard FileManager.default.fileExists(atPath: home.path) else { return nil }

        var p = DaatProgress()
        p.connected = true
        p.source = "DAAT"

        let turn = liveTurn(home: home)
        let session = activeSession(home: home)

        if session == nil && turn == nil {
            // DAAT installed but nothing running.
            p.phase = "idle"
        }

        if let s = session {
            p.taskTitle = s.title
            p.model = s.model
            p.detail = s.step
            p.messageCount = s.messageCount
            p.toolCallCount = s.toolCallCount
            p.updatedAt = s.lastActive
            p.activeSessions = s.activeCount
            p.phase = s.isActive ? "running" : "idle"
            if let dir = s.gitRepoRoot ?? s.cwd {
                if let mapped = projectName(home: home, forPath: dir) {
                    p.projectName = mapped
                } else {
                    // A session running in ~ (or another meaningless root) has
                    // no real project — "joseph" is a username, not a project.
                    let url = URL(fileURLWithPath: dir).standardizedFileURL
                    let homeDir = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL
                    if url.path != homeDir.path, url.path != "/", url.path != "/tmp" {
                        p.projectName = url.lastPathComponent
                    }
                }
            }
        }

        // The turn marker is fresher than the DB heartbeat (which can lag ~60 s).
        if let turn {
            p.phase = "running"
            if p.taskTitle == nil || p.taskTitle?.isEmpty == true {
                p.taskTitle = turn.prompt
            }
            if let ts = turn.startedAt {
                if p.updatedAt == nil || ts > p.updatedAt! { p.updatedAt = ts }
            }
        }

        if p.taskTitle == nil { p.taskTitle = session?.id }

        // Gateway health (best effort).
        if let gw = gatewayInfo(home: home) {
            p.gatewayState = gw.state
            p.activeAgents = gw.activeAgents
        }

        return p
    }

    // MARK: - interrupted_turns.json (live turn marker)

    private struct LiveTurn {
        var sessionID: String
        var prompt: String?
        var startedAt: Date?
    }

    private static func liveTurn(home: URL) -> LiveTurn? {
        let url = home.appendingPathComponent("desktop/interrupted_turns.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              !json.isEmpty else { return nil }

        var best: LiveTurn?
        var bestTime: Double = 0
        for (sessionID, value) in json {
            guard let entry = value as? [String: Any] else { continue }
            let started = (entry["started_at"] as? NSNumber)?.doubleValue ?? 0
            if started > bestTime {
                bestTime = started
                best = LiveTurn(
                    sessionID: sessionID,
                    prompt: (entry["prompt"] as? String).map { String($0.prefix(120)) },
                    startedAt: started > 0 ? Date(timeIntervalSince1970: started) : nil)
            }
        }
        // Skip crash leftovers: markers are pruned at 24h, we cut at 12h.
        if let ts = best?.startedAt, Date().timeIntervalSince(ts) > 12 * 3600 { return nil }
        return best
    }

    // MARK: - state.db (sessions)

    private struct SessionRow {
        var id: String
        var title: String?
        var model: String?
        var cwd: String?
        var gitRepoRoot: String?
        var step: String?
        var messageCount: Int
        var toolCallCount: Int
        var lastActive: Date?
        var isActive: Bool
        var activeCount: Int
    }

    /// DAAT's own liveness rule: ended_at IS NULL and last activity < 300 s ago.
    private static func activeSession(home: URL) -> SessionRow? {
        let db = home.appendingPathComponent("state.db")
        guard let handle = openReadOnly(db) else { return nil }
        defer { sqlite3_close(handle) }

        let sql = """
        SELECT id, title, model, cwd, git_repo_root,
               last_activity_description,
               COALESCE(last_activity_at, started_at) AS last_active,
               message_count, tool_call_count,
               (strftime('%s','now') - COALESCE(last_activity_at, started_at)) < 300 AS is_active
        FROM sessions
        WHERE ended_at IS NULL
        ORDER BY COALESCE(last_activity_at, started_at) DESC
        LIMIT 10;
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        var rows: [SessionRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            var r = SessionRow(id: text(stmt, 0) ?? "?",
                               title: text(stmt, 1),
                               model: text(stmt, 2),
                               cwd: text(stmt, 3),
                               gitRepoRoot: text(stmt, 4),
                               step: text(stmt, 5),
                               messageCount: Int(sqlite3_column_int(stmt, 7)),
                               toolCallCount: Int(sqlite3_column_int(stmt, 8)),
                               lastActive: nil,
                               isActive: sqlite3_column_int(stmt, 9) == 1,
                               activeCount: 0)
            let epoch = sqlite3_column_double(stmt, 6)
            if epoch > 0 { r.lastActive = Date(timeIntervalSince1970: epoch) }
            rows.append(r)
        }
        guard !rows.isEmpty else { return nil }
        let activeCount = rows.filter(\.isActive).count
        var top = rows.first(where: \.isActive) ?? rows[0]
        top.activeCount = activeCount
        return top
    }

    // MARK: - projects.db (name mapping)

    private static func projectName(home: URL, forPath path: String) -> String? {
        let db = home.appendingPathComponent("projects.db")
        guard let handle = openReadOnly(db) else { return nil }
        defer { sqlite3_close(handle) }

        let sql = """
        SELECT p.name, f.path
        FROM project_folders f JOIN projects p ON p.id = f.project_id;
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        var bestName: String?
        var bestLen = 0
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let name = text(stmt, 0), let folder = text(stmt, 1) else { continue }
            if path.hasPrefix(folder), folder.count > bestLen {
                bestLen = folder.count
                bestName = name
            }
        }
        return bestName
    }

    // MARK: - gateway_state.json

    private static func gatewayInfo(home: URL) -> (state: String, activeAgents: Int?)? {
        let url = home.appendingPathComponent("gateway_state.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let state = (json["gateway_state"] as? String) ?? "unknown"
        let agents = (json["active_agents"] as? NSNumber)?.intValue
        return (state, agents)
    }

    // MARK: - sqlite helpers

    private static func openReadOnly(_ url: URL) -> OpaquePointer? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_URI | SQLITE_OPEN_FULLMUTEX
        let uri = "file:\(url.path)?mode=ro"
        guard sqlite3_open_v2(uri, &handle, flags, nil) == SQLITE_OK else {
            if handle != nil { sqlite3_close(handle) }
            return nil
        }
        sqlite3_busy_timeout(handle, 250) // WAL is hot; never block the UI long
        return handle
    }

    private static func text(_ stmt: OpaquePointer?, _ col: Int32) -> String? {
        guard let c = sqlite3_column_text(stmt, col) else { return nil }
        let s = String(cString: c)
        return s.isEmpty ? nil : s
    }
}
