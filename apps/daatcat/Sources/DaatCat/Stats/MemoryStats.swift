import Foundation

struct MemorySample {
    var totalBytes: UInt64 = 0
    var usedBytes: UInt64 = 0
    var appBytes: UInt64 = 0
    var wiredBytes: UInt64 = 0
    var compressedBytes: UInt64 = 0
    var pressurePercent: Double = 0

    var usedPercent: Double {
        totalBytes > 0 ? Double(usedBytes) / Double(totalBytes) * 100 : 0
    }
}

enum MemoryReader {
    /// Matches Activity Monitor's accounting:
    /// App Memory = internal pages − purgeable, Used = App + Wired + Compressed.
    /// Pressure comes from the kernel's own memorystatus level.
    static func sample() -> MemorySample {
        var s = MemorySample()
        s.totalBytes = ProcessInfo.processInfo.physicalMemory

        var size = mach_msg_type_number_t(
            MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
        var vm = vm_statistics64()
        let result = withUnsafeMutablePointer(to: &vm) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(size)) { intPtr in
                host_statistics64(mach_host_self(), HOST_VM_INFO64, intPtr, &size)
            }
        }
        guard result == KERN_SUCCESS else { return s }

        let pageSize = UInt64(vm_kernel_page_size)
        let internalPages = UInt64(vm.internal_page_count)
        let purgeable = UInt64(vm.purgeable_count)
        let wired = UInt64(vm.wire_count)
        let compressed = UInt64(vm.compressor_page_count)

        s.appBytes = (internalPages > purgeable ? internalPages - purgeable : 0) &* pageSize
        s.wiredBytes = wired &* pageSize
        s.compressedBytes = compressed &* pageSize
        s.usedBytes = s.appBytes &+ s.wiredBytes &+ s.compressedBytes

        // kern.memorystatus_level = % of memory "available"; pressure is the inverse.
        var level: Int32 = 0
        var levelSize = MemoryLayout<Int32>.size
        if sysctlbyname("kern.memorystatus_level", &level, &levelSize, nil, 0) == 0 {
            s.pressurePercent = max(0, min(100, 100 - Double(level)))
        }
        return s
    }
}
