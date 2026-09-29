import Foundation
import Combine

/// Aggregates all system metrics on a 2-second cadence and publishes them
/// for the popover UI. Mirrors the panel RunCat shows: CPU, Memory,
/// Storage, Battery, Network.
final class SystemStatsEngine: ObservableObject {

    @Published var cpu = CPUSample()
    @Published var cpuHistory: [Double] = []
    @Published var memory = MemorySample()
    @Published var storage = StorageSample()
    @Published var battery = BatterySample()
    @Published var network = NetworkSample()

    private let cpuReader = CPUReader()
    private let netReader = NetworkReader()
    private var timer: Timer?
    private var slowTick = 0

    func start() {
        sampleFast()
        sampleSlow()
        timer = Timer(timeInterval: 2.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.sampleFast()
            self.slowTick += 1
            if self.slowTick % 5 == 0 { self.sampleSlow() } // every 10 s
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func stop() { timer?.invalidate() }

    /// Cheap metrics, every 2 s.
    private func sampleFast() {
        cpu = cpuReader.sample()
        cpuHistory.append(cpu.totalUsage)
        if cpuHistory.count > 60 { cpuHistory.removeFirst(cpuHistory.count - 60) }
        memory = MemoryReader.sample()
        network = netReader.sample()
    }

    /// Metrics that barely change, every 10 s.
    private func sampleSlow() {
        storage = StorageReader.sample()
        battery = BatteryReader.sample()
    }
}
