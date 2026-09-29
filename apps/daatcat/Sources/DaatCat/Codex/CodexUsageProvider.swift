import Foundation
import Combine

/// Agent credit usage for the OpenAI OAuth (Codex CLI) account.
///
/// Reads ~/.codex/auth.json (written by `codex login`) and queries the same
/// endpoints CodexBar documents:
///   GET https://chatgpt.com/backend-api/wham/usage
///   GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
/// Tokens are only held in memory; auth.json is never modified.
final class CodexUsageProvider: ObservableObject {

    struct Window {
        var label: String
        var usedPercent: Double
        var resetsAt: Date?
    }

    struct Snapshot {
        var planType: String?
        var email: String?
        var primary: Window?      // e.g. session (5h) / monthly, per plan
        var secondary: Window?    // e.g. weekly, when the plan has one
        var creditsBalance: Double?
        var creditsGranted: Double?
        var resetVouchers: Int?   // "rate limit reset" credits available
        var fetchedAt = Date()
    }

    enum State {
        case idle
        case loading
        case ready(Snapshot)
        case noLogin          // no auth.json
        case authExpired      // the owning app must renew its login
        case error(String)
    }

    @Published private(set) var state: State = .idle

    private var accessToken: String?
    private var accountID: String?
    private var timer: Timer?
    private var lastFetch: Date?
    private var enabled = false
    private var inFlight: Task<Void, Never>?

    private let authURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".codex/auth.json")

    func setEnabled(_ value: Bool) {
        guard enabled != value else { return }
        enabled = value
        if value { start() }
        else { timer?.invalidate(); timer = nil; inFlight?.cancel(); inFlight = nil; state = .idle }
    }

    func start() {
        guard enabled, timer == nil else { return }
        refreshSoon()
        timer = Timer(timeInterval: 300, repeats: true) { [weak self] _ in
            self?.refreshSoon(force: true)
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    /// Refresh if data is stale (>60 s old). Called when the popover opens.
    func refreshSoon(force: Bool = false) {
        guard enabled, inFlight == nil else { return }
        if !force, let last = lastFetch, Date().timeIntervalSince(last) < 60 { return }
        inFlight = Task { await fetch(); self.inFlight = nil }
    }

    @MainActor
    private func setState(_ s: State) { if enabled && !Task.isCancelled { state = s } }

    private func fetch() async {
        guard loadAuthFile() else {
            await setState(.noLogin)
            return
        }
        await setState(.loading)

        var snapshot = Snapshot()
        decodeIdentity(into: &snapshot)

        do {
            let (data, status) = try await get("https://chatgpt.com/backend-api/wham/usage")
            guard status != 401 else {
                await setState(.authExpired)
                return
            }
            guard (200..<300).contains(status) else {
                await setState(.error("usage HTTP \(status)"))
                return
            }
            parseUsage(data, into: &snapshot)

            // Credits endpoint is optional — ignore failures.
            if let (creditsData, creditsStatus) =
                try? await get("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"),
               (200..<300).contains(creditsStatus) {
                parseCredits(creditsData, into: &snapshot)
            }

            lastFetch = Date()
            await setState(.ready(snapshot))
        } catch {
            await setState(.error(error.localizedDescription))
        }
    }

    // MARK: - auth.json

    private func loadAuthFile() -> Bool {
        guard let data = try? Data(contentsOf: authURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tokens = json["tokens"] as? [String: Any],
              let access = tokens["access_token"] as? String else { return false }
        accessToken = access
        accountID = tokens["account_id"] as? String
        return true
    }

    /// Plan + email live in the id_token JWT claims (no network call needed).
    private func decodeIdentity(into snapshot: inout Snapshot) {
        guard let data = try? Data(contentsOf: authURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tokens = json["tokens"] as? [String: Any],
              let idToken = tokens["id_token"] as? String else { return }
        let parts = idToken.split(separator: ".")
        guard parts.count >= 2, let payload = decodeBase64URL(String(parts[1])),
              let claims = try? JSONSerialization.jsonObject(with: payload) as? [String: Any]
        else { return }
        snapshot.email = claims["email"] as? String
        if let auth = claims["https://api.openai.com/auth"] as? [String: Any] {
            snapshot.planType = auth["chatgpt_plan_type"] as? String
        }
    }

    private func decodeBase64URL(_ s: String) -> Data? {
        var str = s.replacingOccurrences(of: "-", with: "+")
                   .replacingOccurrences(of: "_", with: "/")
        while str.count % 4 != 0 { str += "=" }
        return Data(base64Encoded: str)
    }

    // MARK: - HTTP

    private func get(_ urlString: String) async throws -> (Data, Int) {
        guard let url = URL(string: urlString), let token = accessToken else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accountID {
            req.setValue(accountID, forHTTPHeaderField: "chatgpt-account-id")
        }
        req.setValue("DaatCat/1.0 (macOS)", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        return (data, (resp as? HTTPURLResponse)?.statusCode ?? 0)
    }

    // This monitor never owns or rotates another application's refresh token.
    // A 401 asks the user to sign in through Codex, which owns that session.

    // MARK: - Parsing (schema-tolerant)

    /// The wham/usage payload nests windows under rate_limit / rate_limits.
    /// Field names have shifted across releases, so this walks the JSON
    /// defensively instead of using Codable.
    private func parseUsage(_ data: Data, into snapshot: inout Snapshot) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        // Identity ships at the root of wham/usage (JWT decode is the fallback).
        if let plan = root["plan_type"] as? String { snapshot.planType = plan }
        if let email = root["email"] as? String { snapshot.email = email }

        let rateLimit = (root["rate_limit"] ?? root["rate_limits"]) as? [String: Any] ?? root

        if let p = rateLimit["primary_window"] as? [String: Any] {
            snapshot.primary = window(from: p, fallbackLabel: "Usage")
        }
        if let s = rateLimit["secondary_window"] as? [String: Any] {
            snapshot.secondary = window(from: s, fallbackLabel: "Secondary")
        }
        // Some payload versions also expose credit balance inline.
        if let credits = root["credits"] as? [String: Any] {
            snapshot.creditsBalance = doubleValue(credits["balance"] ?? credits["remaining"])
            snapshot.creditsGranted = doubleValue(credits["granted"] ?? credits["total"])
        }
        if let vouchers = root["rate_limit_reset_credits"] as? [String: Any] {
            snapshot.resetVouchers = doubleValue(vouchers["available_count"]).map(Int.init)
        }
    }

    private func parseCredits(_ data: Data, into snapshot: inout Snapshot) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        let credits = (root["credits"] as? [String: Any]) ?? root
        if snapshot.creditsBalance == nil {
            snapshot.creditsBalance = doubleValue(
                credits["balance"] ?? credits["remaining"] ?? credits["available"])
        }
        if snapshot.creditsGranted == nil {
            snapshot.creditsGranted = doubleValue(credits["granted"] ?? credits["total"])
        }
    }

    private func window(from dict: [String: Any], fallbackLabel: String) -> Window {
        var w = Window(label: fallbackLabel, usedPercent: 0, resetsAt: nil)
        w.usedPercent = doubleValue(dict["used_percent"] ?? dict["usage_percent"] ?? dict["percent"]) ?? 0
        if let seconds = doubleValue(dict["resets_in_seconds"] ?? dict["reset_after_seconds"]) {
            w.resetsAt = Date().addingTimeInterval(seconds)
        } else if let ts = doubleValue(dict["resets_at"] ?? dict["reset_at"]) {
            w.resetsAt = Date(timeIntervalSince1970: ts)
        }
        // Label by window length: plans differ (5h session / weekly / monthly).
        if let span = doubleValue(dict["limit_window_seconds"]) {
            w.label = Self.windowLabel(seconds: span)
        } else if let minutes = doubleValue(dict["window_minutes"]) {
            w.label = Self.windowLabel(seconds: minutes * 60)
        }
        return w
    }

    private static func windowLabel(seconds: Double) -> String {
        let hours = seconds / 3600
        switch hours {
        case ..<24: return String(format: "Session (%.0fh)", hours.rounded())
        case ..<48: return "Daily"
        case ..<(8 * 24): return "Weekly"
        case ..<(45 * 24): return "Monthly"
        default: return String(format: "%.0f days", hours / 24)
        }
    }

    private func doubleValue(_ any: Any?) -> Double? {
        switch any {
        case let d as Double: return d
        case let i as Int: return Double(i)
        case let s as String: return Double(s)
        case let n as NSNumber: return n.doubleValue
        default: return nil
        }
    }
}
