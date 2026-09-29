import Foundation
import Combine
import Darwin

/// Electron writes one atomic settings document, including the selected profile.
final class CatPreferences: ObservableObject {
    @Published var showCpu = true
    @Published var showMemory = true
    @Published var showStorage = true
    @Published var showBattery = true
    @Published var showNetwork = true
    @Published var showProgress = true
    @Published var showUsage = false
    @Published var enabled = true
    @Published var runRequested = true
    @Published var runtimeHome = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".daat")
    @Published var profile = "default"
    @Published var mode = "local"
    @Published var applicationPath = ""
    private var lastData: Data?
    private var lockFile: Int32 = -1
    let file: URL

    init() {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--config"), args.indices.contains(index + 1) {
            file = URL(fileURLWithPath: args[index + 1])
            // Login-item launches have no arguments, so remember this location.
            if Bundle.main.bundleIdentifier != nil {
                UserDefaults.standard.set(file.path, forKey: "DaatSettingsPath")
            }
        } else if let saved = UserDefaults.standard.string(forKey: "DaatSettingsPath") {
            file = URL(fileURLWithPath: saved)
        } else {
            file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Daat/menubar-cat.json")
        }
        reload()
    }

    /// The kernel releases this lock even after a crash; no argv or PID guessing.
    func claimProcess() -> Bool {
        guard lockFile == -1 else { return true }
        let descriptor = open(file.path + ".lock", O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { return false }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { close(descriptor); return false }
        lockFile = descriptor
        return true
    }

    deinit { if lockFile >= 0 { close(lockFile) } }

    func reload() {
        guard let data = try? Data(contentsOf: file), data != lastData,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        lastData = data
        showCpu = json["showCpu"] as? Bool ?? true
        showMemory = json["showMemory"] as? Bool ?? true
        showStorage = json["showStorage"] as? Bool ?? true
        showBattery = json["showBattery"] as? Bool ?? true
        showNetwork = json["showNetwork"] as? Bool ?? true
        showProgress = json["showProgress"] as? Bool ?? true
        showUsage = json["showUsage"] as? Bool ?? false
        enabled = json["enabled"] as? Bool ?? true
        runRequested = json["runRequested"] as? Bool ?? true
        if let home = json["runtimeHome"] as? String, home.hasPrefix("/") { runtimeHome = URL(fileURLWithPath: home) }
        profile = json["profile"] as? String ?? "default"
        mode = json["mode"] as? String ?? "local"
        applicationPath = json["applicationPath"] as? String ?? ""
    }

    func removeProcessIdentity() {
        let url = URL(fileURLWithPath: file.path + ".process")
        guard let data = try? Data(contentsOf: url),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (value["pid"] as? NSNumber)?.int32Value == ProcessInfo.processInfo.processIdentifier else { return }
        try? FileManager.default.removeItem(at: url)
    }

    func writeProcessIdentity() {
        let executable = Bundle.main.executableURL?.path ?? CommandLine.arguments[0]
        if let data = try? JSONSerialization.data(withJSONObject: ["pid": ProcessInfo.processInfo.processIdentifier, "executable": executable, "updatedAt": Date().timeIntervalSince1970 * 1000]) {
            try? data.write(to: URL(fileURLWithPath: file.path + ".process"), options: .atomic)
        }
    }
}
