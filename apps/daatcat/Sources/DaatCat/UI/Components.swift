import SwiftUI

// MARK: - Formatting helpers

enum Fmt {
    static func gb(_ bytes: UInt64) -> String { gb(Int64(bytes)) }

    static func gb(_ bytes: Int64) -> String {
        let value = Double(bytes) / 1_000_000_000
        return String(format: "%.1f GB", value)
    }

    static func percent(_ v: Double, decimals: Int = 1) -> String {
        String(format: "%.\(decimals)f%%", v)
    }

    static func rate(_ bps: Double) -> String {
        if bps >= 1_000_000 { return String(format: "%.1f MB/s", bps / 1_000_000) }
        if bps >= 1_000 { return String(format: "%.1f kB/s", bps / 1_000) }
        return String(format: "%.0f B/s", bps)
    }

    static func ago(_ date: Date?) -> String {
        guard let date else { return "–" }
        let s = Int(Date().timeIntervalSince(date))
        if s < 5 { return "just now" }
        if s < 60 { return "\(s)s ago" }
        if s < 3600 { return "\(s / 60)m ago" }
        return "\(s / 3600)h \(s % 3600 / 60)m ago"
    }

    static func countdown(to date: Date?) -> String {
        guard let date else { return "–" }
        let s = max(0, Int(date.timeIntervalSince(Date())))
        if s >= 86_400 { return "\(s / 86_400)d \(s % 86_400 / 3600)h" }
        if s >= 3600 { return "\(s / 3600)h \(s % 3600 / 60)m" }
        return "\(s / 60)m"
    }
}

// MARK: - Rows (RunCat-style)

/// Section header row: icon + title, big value right-aligned.
struct StatHeaderRow: View {
    let icon: String
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(.secondary)
                .frame(width: 22)
            Text(title)
                .font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
        }
    }
}

/// Indented secondary line: "System  8.3%".
struct SubRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
            Spacer(minLength: 8)
            Text(value).monospacedDigit()
        }
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .padding(.leading, 30)
    }
}

/// Thin capacity bar (storage row).
struct MiniBar: View {
    let fraction: Double
    var tint: Color = .accentColor

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.12))
                Capsule().fill(tint)
                    .frame(width: max(3, geo.size.width * min(1, max(0, fraction))))
            }
        }
        .frame(height: 5)
    }
}

/// 60-sample CPU sparkline.
struct Sparkline: View {
    let values: [Double]   // 0–100

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let points = normalized()
            ZStack {
                if points.count > 1 {
                    Path { path in
                        for (i, v) in points.enumerated() {
                            let x = w * CGFloat(i) / CGFloat(points.count - 1)
                            let y = h - h * CGFloat(v)
                            if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
                            else { path.addLine(to: CGPoint(x: x, y: y)) }
                        }
                    }
                    .stroke(Color.accentColor, lineWidth: 1.2)

                    Path { path in
                        for (i, v) in points.enumerated() {
                            let x = w * CGFloat(i) / CGFloat(points.count - 1)
                            let y = h - h * CGFloat(v)
                            if i == 0 { path.move(to: CGPoint(x: x, y: h)); path.addLine(to: CGPoint(x: x, y: y)) }
                            else { path.addLine(to: CGPoint(x: x, y: y)) }
                        }
                        if !points.isEmpty { path.addLine(to: CGPoint(x: w, y: h)) }
                        path.closeSubpath()
                    }
                    .fill(Color.accentColor.opacity(0.15))
                }
            }
        }
    }

    private func normalized() -> [Double] {
        let recent = values.suffix(60)
        return recent.map { min(1, max(0, $0 / 100)) }
    }
}

/// Labeled usage bar for credit windows: "Session (5h)  42%  · resets 3h 12m".
struct UsageBarRow: View {
    let label: String
    let usedPercent: Double
    let resetsAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                if let resetsAt {
                    Text("resets \(Fmt.countdown(to: resetsAt))")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
                Text(Fmt.percent(usedPercent, decimals: 0))
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
            }
            MiniBar(fraction: usedPercent / 100, tint: barColor)
        }
        .padding(.leading, 30)
    }

    private var barColor: Color {
        switch usedPercent {
        case ..<60: return .green
        case ..<85: return .orange
        default: return .red
        }
    }
}

/// Colored status dot + text ("running", "idle", "stopped").
struct PhaseChip: View {
    let phase: String?

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(phase ?? "unknown")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    private var color: Color {
        switch phase {
        case "running": return .green
        case "idle": return .yellow
        case "stopped", "error": return .red
        default: return .gray
        }
    }
}

/// Right-rail button, like RunCat's Runners/Store column.
struct RailButton: View {
    let icon: String
    let label: String
    var action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .regular))
                    .frame(height: 18)
                Text(label)
                    .font(.system(size: 9.5))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(.primary)
            .frame(width: 64, height: 52)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(hovering ? Color.primary.opacity(0.12) : Color.primary.opacity(0.06))
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
