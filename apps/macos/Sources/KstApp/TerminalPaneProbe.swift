import Foundation
import Carbon
import Darwin
import KstNativeCore

struct TerminalPaneIdentity: Equatable, Sendable {
    let windowID: String
    let sessionID: String
}
struct TerminalPaneFailure: LocalizedError, Sendable {
    let message: String
    var permissionNeeded = false
    var errorDescription: String? { message }
}

/// Fixed read-only scripting dictionary calls. No scrollback, shell text or commands.
enum TerminalPaneProbe {
    static let iTermBundleID = "com.googlecode.iterm2"
    static func automationAllowed(prompt: Bool) -> Bool {
        let bytes = Array(iTermBundleID.utf8)
        var descriptor = AEAddressDesc()
        let status = bytes.withUnsafeBytes { AECreateDesc(DescType(typeApplicationBundleID), $0.baseAddress, $0.count, &descriptor) }
        guard status == noErr else { return false }
        defer { AEDisposeDesc(&descriptor) }
        return AEDeterminePermissionToAutomateTarget(&descriptor, AEEventClass(typeWildCard), AEEventID(typeWildCard), prompt) == noErr
    }
    static func requestPermission() async -> Bool {
        await Task.detached(priority: .userInitiated) { automationAllowed(prompt: true) }.value
    }
    static func read(bundleID: String) async throws -> TerminalPaneIdentity {
        guard bundleID == iTermBundleID else {
            throw TerminalPaneFailure(message: "Terminal.app does not expose a verified shell-prompt signal. Use iTerm with shell integration, or type manually.")
        }
        return try await Task.detached(priority: .userInitiated) {
            guard automationAllowed(prompt: false) else {
                throw TerminalPaneFailure(message: "Allow read-only Automation access to iTerm, then refocus the intended pane and start again.", permissionNeeded: true)
            }
            let script = """
            (() => {
              const app = Application('com.googlecode.iterm2');
              if (!app.running() || app.windows().length === 0) return JSON.stringify({error:'unavailable'});
              const w = app.currentWindow();
              const s = w.currentSession();
              let prompt = null;
              try { prompt = s.isAtShellPrompt(); } catch {}
              return JSON.stringify({windowID:String(w.id()),sessionID:s.id(),prompt});
            })();
            """
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-l", "JavaScript", "-e", script]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            process.standardInput = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem {
                guard process.isRunning else { return }
                process.terminate()
                DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.2) {
                    if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
                }
            }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 2, execute: timeout)
            process.waitUntilExit(); timeout.cancel()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            guard process.terminationStatus == 0, data.count <= 4096,
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let windowID = result["windowID"] as? String, let sessionID = result["sessionID"] as? String,
                  !windowID.isEmpty, !sessionID.isEmpty, sessionID.utf8.count <= 1024 else {
                throw TerminalPaneFailure(message: "iTerm pane identity could not be verified. No terminal input was sent.")
            }
            do { _ = try DictationPolicy.verifiedTerminalIdentity(windowID: windowID, sessionID: sessionID, atPrompt: result["prompt"] as? Bool) }
            catch { throw TerminalPaneFailure(message: "iTerm does not confirm a stable pane at a shell prompt. Enable iTerm shell integration and re-arm at a normal prompt.") }
            return TerminalPaneIdentity(windowID: windowID, sessionID: sessionID)
        }.value
    }
}
