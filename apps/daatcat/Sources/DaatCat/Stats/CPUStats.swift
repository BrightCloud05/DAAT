import Foundation

struct CPUSample {
    var totalUsage: Double = 0   // %
    var system: Double = 0       // %
    var user: Double = 0         // %
    var idle: Double = 100       // %
}

/// Reads host-wide CPU load ticks and converts consecutive samples into
/// percentage deltas (the same host_statistics API Activity Monitor uses).
final class CPUReader {
    private var previous: host_cpu_load_info?

    func sample() -> CPUSample {
        guard let load = Self.hostCPULoad() else { return CPUSample() }
        defer { previous = load }
        guard let prev = previous else { return CPUSample() }

        let userDiff = Double(load.cpu_ticks.0 &- prev.cpu_ticks.0)
        let sysDiff  = Double(load.cpu_ticks.1 &- prev.cpu_ticks.1)
        let idleDiff = Double(load.cpu_ticks.2 &- prev.cpu_ticks.2)
        let niceDiff = Double(load.cpu_ticks.3 &- prev.cpu_ticks.3)

        let total = userDiff + sysDiff + idleDiff + niceDiff
        guard total > 0 else { return CPUSample() }

        var s = CPUSample()
        s.user = (userDiff + niceDiff) / total * 100
        s.system = sysDiff / total * 100
        s.idle = idleDiff / total * 100
        s.totalUsage = min(100, max(0, s.user + s.system))
        return s
    }

    private static func hostCPULoad() -> host_cpu_load_info? {
        var size = mach_msg_type_number_t(
            MemoryLayout<host_cpu_load_info_data_t>.size / MemoryLayout<integer_t>.size)
        var info = host_cpu_load_info()
        let result = withUnsafeMutablePointer(to: &info) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(size)) { intPtr in
                host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, intPtr, &size)
            }
        }
        return result == KERN_SUCCESS ? info : nil
    }
}
