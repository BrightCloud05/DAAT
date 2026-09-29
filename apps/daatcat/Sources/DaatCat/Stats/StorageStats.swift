import Foundation

struct StorageSample {
    var totalBytes: Int64 = 0
    var availableBytes: Int64 = 0

    var usedBytes: Int64 { max(0, totalBytes - availableBytes) }
    var usedPercent: Double {
        totalBytes > 0 ? Double(usedBytes) / Double(totalBytes) * 100 : 0
    }
}

enum StorageReader {
    /// Uses "available for important usage" so the number matches what
    /// Finder / RunCat report (purgeable space counts as available).
    static func sample() -> StorageSample {
        var s = StorageSample()
        let root = URL(fileURLWithPath: "/")
        let keys: Set<URLResourceKey> = [
            .volumeTotalCapacityKey,
            .volumeAvailableCapacityForImportantUsageKey,
        ]
        guard let values = try? root.resourceValues(forKeys: keys) else { return s }
        s.totalBytes = Int64(values.volumeTotalCapacity ?? 0)
        s.availableBytes = values.volumeAvailableCapacityForImportantUsage ?? 0
        return s
    }
}
