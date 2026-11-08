import Foundation

/// Starts only the configured project-local development core; never kills attached cores.
@MainActor
final class CoreSupervisor: ObservableObject {
    @Published private(set) var status = ""
    private var child: Process?
    private var launches = 0
    private var nextLaunch = 0.0
    private var stopping = false

    func ensureRunningIfConfigured() {
        guard !stopping, child?.isRunning != true else { return }
        guard launches < 3 else { status = "Core restart limit reached. Check the local core/runtime paths and restart kst manually."; return }
        guard ProcessInfo.processInfo.systemUptime >= nextLaunch else { return }
        let environment = ProcessInfo.processInfo.environment
        let entry = environment["KST_CORE_ENTRY"] ?? Bundle.main.object(forInfoDictionaryKey: "KSTCoreEntry") as? String
        let node = environment["KST_NODE_PATH"] ?? Bundle.main.object(forInfoDictionaryKey: "KSTNodePath") as? String
        guard let entry, let node else { status = "No bundled development core path. Start the core manually or rebuild this app."; return }
        guard entry.hasPrefix("/"), node.hasPrefix("/"), entry.hasSuffix(".mjs"),
              FileManager.default.isReadableFile(atPath: entry),
              FileManager.default.isExecutableFile(atPath: node) else {
            status = "Configured core or Node path is unavailable. Rebuild kst after moving the project/runtime."
            return
        }
        launches += 1
        nextLaunch = ProcessInfo.processInfo.systemUptime + Double(5 << launches)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [entry]
        process.currentDirectoryURL = URL(fileURLWithPath: entry).deletingLastPathComponent()
        let allowed = ["HOME", "LANG", "TMPDIR", "PATH", "KST_DATA_DIR", "KST_TOKEN", "KST_PORT", "KST_SECRETARY_DB", "KST_SECRETARY_WRITE", "KST_PROJECTS_FILE", "KST_OPENAI_MODEL", "KST_OPENAI_API_KEY", "KST_CLAUDE_MODEL", "KST_ANTHROPIC_API_KEY", "KST_CODEX_ENABLED", "KST_CODEX_PATH", "KST_CODEX_PROJECT", "KST_UNDERSTANDING_MODE", "KST_UNDERSTANDING_ADDON_PATH"]
        process.environment = environment.filter { allowed.contains($0.key) }
        if environment["KST_UNDERSTANDING_ADDON_PATH"] == nil,
           let addon = Bundle.main.object(forInfoDictionaryKey: "KSTUnderstandingAddon") as? String,
           let resources = Bundle.main.resourceURL {
            process.environment?["KST_UNDERSTANDING_ADDON_PATH"] = resources.appendingPathComponent(addon).path
        }
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] terminated in
            let exit = terminated.terminationStatus
            Task { @MainActor in
                guard let self, !self.stopping else { return }
                self.status = "Owned core exited (status \(exit)). Restart is bounded and delayed."
            }
        }
        do {
            try process.run()
            child = process
            status = "Starting the local core (attempt \(launches)/3)â€¦"
        } catch { status = "Core process could not start. Check local execution permissions and configured runtime paths." }
    }

    func markHealthy() { status = child?.isRunning == true ? "Local core supervised by kst" : "Attached to an existing local core" }
    func shutdown() {
        stopping = true
        if let child, child.isRunning { child.terminate() }
        child = nil
    }
}
ëŽ