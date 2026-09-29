import Foundation
import IOKit.ps
import IOKit

struct BatterySample {
    var present = false
    var percent: Double = 0
    var isCharging = false
    var onACPower = false
    var maxCapacityPercent: Double = 0   // battery health
    var cycleCount: Int = 0
    var temperatureC: Double = 0
}

enum BatteryReader {
    static func sample() -> BatterySample {
        var s = BatterySample()

        // Charge % and power source via IOPowerSources (public API).
        if let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
           let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] {
            for ps in list {
                guard let desc = IOPSGetPowerSourceDescription(blob, ps)?
                    .takeUnretainedValue() as? [String: Any] else { continue }
                guard (desc[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
                s.present = true
                let cur = desc[kIOPSCurrentCapacityKey] as? Double ?? 0
                let max = desc[kIOPSMaxCapacityKey] as? Double ?? 100
                s.percent = max > 0 ? cur / max * 100 : 0
                s.isCharging = desc[kIOPSIsChargingKey] as? Bool ?? false
                s.onACPower = (desc[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
            }
        }

        // Health / cycles / temperature via AppleSmartBattery registry entry.
        let entry = IOServiceGetMatchingService(kIOMainPortDefault,
                                                IOServiceMatching("AppleSmartBattery"))
        if entry != IO_OBJECT_NULL {
            defer { IOObjectRelease(entry) }
            func prop(_ key: String) -> Any? {
                IORegistryEntryCreateCFProperty(entry, key as CFString,
                                                kCFAllocatorDefault, 0)?
                    .takeRetainedValue()
            }
            s.present = true
            if let cycles = prop("CycleCount") as? Int { s.cycleCount = cycles }
            // Temperature is reported in hundredths of °C.
            if let temp = prop("VirtualTemperature") as? Int ?? prop("Temperature") as? Int {
                s.temperatureC = Double(temp) / 100.0
            }
            // Apple Silicon reports design/raw capacity in mAh.
            if let design = prop("DesignCapacity") as? Int,
               let raw = prop("AppleRawMaxCapacity") as? Int ?? prop("NominalChargeCapacity") as? Int,
               design > 0 {
                s.maxCapacityPercent = Double(raw) / Double(design) * 100
            }
        }
        return s
    }
}
