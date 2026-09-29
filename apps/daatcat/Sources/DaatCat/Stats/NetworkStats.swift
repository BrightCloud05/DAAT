import Foundation

struct NetworkSample {
    var interfaceName = "Wi-Fi"
    var localIP = "–"
    var uploadBps: Double = 0
    var downloadBps: Double = 0
}

/// Sums per-interface byte counters from getifaddrs (AF_LINK if_data) and
/// converts consecutive samples into byte/s rates, like nettop does.
final class NetworkReader {
    private var lastIn: UInt64 = 0
    private var lastOut: UInt64 = 0
    private var lastTime: Date?

    func sample() -> NetworkSample {
        var s = NetworkSample()
        var totalIn: UInt64 = 0
        var totalOut: UInt64 = 0

        var addrList: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&addrList) == 0, let first = addrList else { return s }
        defer { freeifaddrs(addrList) }

        var primaryIPv4: String?
        var en0IPv4: String?

        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let ifa = cursor {
            let name = String(cString: ifa.pointee.ifa_name)
            let flags = Int32(ifa.pointee.ifa_flags)
            let isUp = (flags & IFF_UP) != 0
            let isLoopback = (flags & IFF_LOOPBACK) != 0

            if let addr = ifa.pointee.ifa_addr, isUp, !isLoopback {
                if addr.pointee.sa_family == UInt8(AF_LINK), name.hasPrefix("en"),
                   let data = ifa.pointee.ifa_data?.assumingMemoryBound(to: if_data.self) {
                    totalIn &+= UInt64(data.pointee.ifi_ibytes)
                    totalOut &+= UInt64(data.pointee.ifi_obytes)
                }
                if addr.pointee.sa_family == UInt8(AF_INET) {
                    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(addr, socklen_t(addr.pointee.sa_len),
                                   &host, socklen_t(host.count),
                                   nil, 0, NI_NUMERICHOST) == 0 {
                        let ip = String(cString: host)
                        if name == "en0" { en0IPv4 = ip }
                        if primaryIPv4 == nil, name.hasPrefix("en") { primaryIPv4 = ip }
                    }
                }
            }
            cursor = ifa.pointee.ifa_next
        }

        s.localIP = en0IPv4 ?? primaryIPv4 ?? "–"

        let now = Date()
        if let last = lastTime {
            let dt = now.timeIntervalSince(last)
            if dt > 0, totalIn >= lastIn, totalOut >= lastOut {
                s.downloadBps = Double(totalIn - lastIn) / dt
                s.uploadBps = Double(totalOut - lastOut) / dt
            }
        }
        lastIn = totalIn
        lastOut = totalOut
        lastTime = now
        return s
    }
}
