import SwiftUI
import ServiceManagement
import AppKit

/// The panel shown when clicking the menu bar cat.
/// Layout mirrors RunCat's popup: detail list on the left, button rail on
/// the right — plus the two DAAT sections (agent credits, 진행사항).
struct PopoverView: View {
    @ObservedObject var stats: SystemStatsEngine
    @ObservedObject var codex: CodexUsageProvider
    @ObservedObject var daat: DaatProgressProvider
    @ObservedObject var preferences = CatPreferences()
    /// False in offscreen preview renders, where a scroll viewport would
    /// collapse the content to nothing.
    var scrollable = true
    var closePopover: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if scrollable {
                // The full panel is ~700pt tall — more than a MacBook screen
                // leaves under the menu bar. Scrolling inside keeps the
                // popover anchored properly instead of overflowing off-screen.
                ScrollView(.vertical, showsIndicators: false) {
                    statsColumn
                }
            } else {
                statsColumn
            }

            railSection
        }
        .padding(12)
        .frame(width: 372)
    }

    private var statsColumn: some View {
        VStack(alignment: .leading, spacing: 10) {
            if preferences.showCpu { cpuSection; Divider() }
            if preferences.showMemory { memorySection; Divider() }
            if preferences.showStorage { storageSection; Divider() }
            if preferences.showBattery { batterySection; Divider() }
            if preferences.showNetwork { networkSection; Divider() }
            if preferences.showUsage { creditsSection; Divider() }
            if preferences.showProgress { daatSection }
            Text("DAAT · " + preferences.profile).font(.caption).foregroundStyle(.secondary)

        }
        .frame(width: 268)
    }

    // MARK: - System stats (RunCat panel parity)

    private var cpuSection: some View {
        VStack(alignment: .leading, spacing: 3) {
            StatHeaderRow(icon: "cpu", title: "CPU:",
                          value: Fmt.percent(stats.cpu.totalUsage))
            SubRow(label: "System:", value: Fmt.percent(stats.cpu.system))
            SubRow(label: "User:", value: Fmt.percent(stats.cpu.user))
            SubRow(label: "Idle:", value: Fmt.percent(stats.cpu.idle))
            Sparkline(values: stats.cpuHistory)
                .frame(height: 26)
                .padding(.leading, 30)
                .padding(.top, 2)
        }
    }

    private var memorySection: some View {
        VStack(alignment: .leading, spacing: 3) {
            StatHeaderRow(icon: "memorychip", title: "Memory:",
                          value: Fmt.percent(stats.memory.usedPercent))
            SubRow(label: "Pressure:", value: Fmt.percent(stats.memory.pressurePercent))
            SubRow(label: "App Memory:", value: Fmt.gb(stats.memory.appBytes))
            SubRow(label: "Wired Memory:", value: Fmt.gb(stats.memory.wiredBytes))
            SubRow(label: "Compressed:", value: Fmt.gb(stats.memory.compressedBytes))
        }
    }

    private var storageSection: some View {
        VStack(alignment: .leading, spacing: 3) {
            StatHeaderRow(icon: "internaldrive", title: "Storage:",
                          value: "\(Fmt.percent(stats.storage.usedPercent)) used")
            SubRow(label: "\(Fmt.gb(stats.storage.usedBytes)) / \(Fmt.gb(stats.storage.totalBytes))",
                   value: "")
            MiniBar(fraction: stats.storage.usedPercent / 100)
                .padding(.leading, 30)
                .padding(.top, 2)
        }
    }

    @ViewBuilder
    private var batterySection: some View {
        VStack(alignment: .leading, spacing: 3) {
            StatHeaderRow(icon: batteryIcon, title: "Battery:",
                          value: stats.battery.present
                              ? Fmt.percent(stats.battery.percent)
                              : "–")
            if stats.battery.present {
                SubRow(label: "Power Source:",
                       value: stats.battery.onACPower ? "Power Adapter" : "Battery")
                if stats.battery.maxCapacityPercent > 0 {
                    SubRow(label: "Max Capacity:",
                           value: Fmt.percent(stats.battery.maxCapacityPercent))
                }
                if stats.battery.cycleCount > 0 {
                    SubRow(label: "Cycle Count:", value: "\(stats.battery.cycleCount)")
                }
                if stats.battery.temperatureC > 0 {
                    SubRow(label: "Temperature:",
                           value: String(format: "%.1f°C", stats.battery.temperatureC))
                }
            }
        }
    }

    private var batteryIcon: String {
        guard stats.battery.present else { return "battery.slash" }
        if stats.battery.isCharging { return "battery.100percent.bolt" }
        switch stats.battery.percent {
        case ..<15: return "battery.0percent"
        case ..<40: return "battery.25percent"
        case ..<65: return "battery.50percent"
        case ..<90: return "battery.75percent"
        default: return "battery.100percent"
        }
    }

    private var networkSection: some View {
        VStack(alignment: .leading, spacing: 3) {
            StatHeaderRow(icon: "wifi", title: "Network:", value: stats.network.interfaceName)
            SubRow(label: "Local IP:", value: stats.network.localIP)
            SubRow(label: "Upload:", value: Fmt.rate(stats.network.uploadBps))
            SubRow(label: "Download:", value: Fmt.rate(stats.network.downloadBps))
        }
    }

    // MARK: - Agent credits (OpenAI OAuth)

    @ViewBuilder
    private var creditsSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            StatHeaderRow(icon: "creditcard", title: "Agent Credits:", value: creditsHeadline)

            switch codex.state {
            case .ready(let snap):
                if let plan = snap.planType {
                    SubRow(label: "Plan:", value: plan.capitalized)
                }
                if let primary = snap.primary {
                    UsageBarRow(label: primary.label,
                                usedPercent: primary.usedPercent,
                                resetsAt: primary.resetsAt)
                }
                if let secondary = snap.secondary {
                    UsageBarRow(label: secondary.label,
                                usedPercent: secondary.usedPercent,
                                resetsAt: secondary.resetsAt)
                }
                if let balance = snap.creditsBalance {
                    SubRow(label: "Credits:", value: creditsText(balance, snap.creditsGranted))
                }
                if let vouchers = snap.resetVouchers, vouchers > 0 {
                    SubRow(label: "Limit resets available:", value: "\(vouchers)")
                }
                SubRow(label: "Updated:", value: Fmt.ago(snap.fetchedAt))
            case .noLogin:
                SubRow(label: "Run `codex login` to connect", value: "")
            case .authExpired:
                SubRow(label: "OAuth expired — `codex login`", value: "")
            case .loading, .idle:
                SubRow(label: "Loading…", value: "")
            case .error(let msg):
                SubRow(label: "Error: \(msg)", value: "")
            }
        }
    }

    private var creditsHeadline: String {
        switch codex.state {
        case .ready(let snap):
            if let p = snap.primary { return "\(Fmt.percent(p.usedPercent, decimals: 0)) used" }
            if let balance = snap.creditsBalance { return String(format: "%.0f left", balance) }
            return "OpenAI"
        case .noLogin: return "not connected"
        case .authExpired: return "re-login"
        case .loading, .idle: return "…"
        case .error: return "error"
        }
    }

    private func creditsText(_ balance: Double, _ granted: Double?) -> String {
        if let granted, granted > 0 {
            return String(format: "%.0f / %.0f", balance, granted)
        }
        return String(format: "%.0f", balance)
    }

    // MARK: - DAAT 진행사항

    @ViewBuilder
    private var daatSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .frame(width: 22)
                Text("DAAT 진행사항")
                    .font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 8)
                PhaseChip(phase: daat.progress.connected ? daat.progress.phase : "offline")
            }

            if daat.progress.connected {
                if let project = daat.progress.projectName {
                    SubRow(label: "Project:", value: project)
                }
                if let task = daat.progress.taskTitle {
                    // An idle session's prompt is history, not 진행사항 —
                    // label it so a 3-hour-old task can't pose as current.
                    if !daat.progress.isRunning {
                        Text("마지막 작업")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                            .padding(.leading, 30)
                    }
                    Text(task)
                        .font(.system(size: 11))
                        .foregroundStyle(.primary.opacity(daat.progress.isRunning ? 0.85 : 0.55))
                        .lineLimit(2)
                        .padding(.leading, 30)
                }
                if let step = daat.progress.detail {
                    SubRow(label: "Step:", value: step)
                }
                if let percent = daat.progress.percent {
                    MiniBar(fraction: percent / 100, tint: .green)
                        .padding(.leading, 30)
                        .padding(.top, 2)
                } else if daat.progress.isRunning {
                    IndeterminateBar()
                        .padding(.leading, 30)
                        .padding(.top, 2)
                }
                HStack {
                    if let model = daat.progress.model {
                        Text(model).font(.system(size: 10)).foregroundStyle(.tertiary)
                    }
                    if daat.progress.activeSessions > 1 {
                        Text("+\(daat.progress.activeSessions - 1) more active")
                            .font(.system(size: 10)).foregroundStyle(.tertiary)
                    }
                    Spacer()
                    Text(Fmt.ago(daat.progress.updatedAt))
                        .font(.system(size: 10)).foregroundStyle(.tertiary)
                }
                .padding(.leading, 30)
            } else {
                SubRow(label: "DAAT not running", value: "")
            }
        }
    }

    // MARK: - Right rail (RunCat-style)

    private var railSection: some View {
        VStack(spacing: 8) {
            RailButton(icon: "pawprint", label: "DAAT") {
                let url = URL(fileURLWithPath: preferences.applicationPath.isEmpty ? "/Applications/Daat.app" : preferences.applicationPath)
                NSWorkspace.shared.openApplication(at: url,
                                                   configuration: .init(),
                                                   completionHandler: nil)
                closePopover()
            }
            RailButton(icon: "waveform.path.ecg", label: "Activity") {
                let url = URL(fileURLWithPath:
                    "/System/Applications/Utilities/Activity Monitor.app")
                NSWorkspace.shared.openApplication(at: url,
                                                   configuration: .init(),
                                                   completionHandler: nil)
                closePopover()
            }
            RailButton(icon: "arrow.clockwise", label: "Refresh") {
                codex.refreshSoon(force: true)
                daat.refreshNow()
            }
            LoginRailButton()
            RailButton(icon: "power", label: "Quit") {
                NSApp.terminate(nil)
            }
            Spacer()
        }
    }
}

/// Launch-at-login toggle backed by SMAppService.
struct LoginRailButton: View {
    @State private var enabled = (SMAppService.mainApp.status == .enabled)

    var body: some View {
        RailButton(icon: enabled ? "checkmark.circle.fill" : "circle",
                   label: "Login") {
            do {
                if enabled {
                    try SMAppService.mainApp.unregister()
                } else {
                    try SMAppService.mainApp.register()
                }
                enabled = (SMAppService.mainApp.status == .enabled)
            } catch {
                enabled = (SMAppService.mainApp.status == .enabled)
            }
        }
        .help("Start DAAT Cat at login")
    }
}

/// Simple animated activity bar for running-without-percent states.
struct IndeterminateBar: View {
    @State private var phase: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.12))
                Capsule()
                    .fill(Color.green.opacity(0.9))
                    .frame(width: geo.size.width * 0.3)
                    .offset(x: phase * geo.size.width * 0.7)
            }
        }
        .frame(height: 5)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                phase = 1
            }
        }
    }
}
