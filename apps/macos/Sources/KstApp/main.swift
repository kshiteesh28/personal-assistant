import AppKit
import SwiftUI
import AVFoundation
import CoreGraphics
import Combine
import KstNativeCore

struct Message: Identifiable {
    let id = UUID()
    let role: String
    let text: String
}

private struct CoreReply: Decodable {
    let reply: String
    let conversationId: String
    let understanding: UnderstandingReply?
}
private struct UnderstandingReply: Decodable { let contextRevision: Int }
private struct CoreSettings: Decodable {
    let wakePhrase: String
    let revision: Int
}
private struct ExternalFeed: Decodable { let jobs: [ExternalResult] }
private struct ExternalResult: Decodable {
    let id: String
    let service: String?
    let status: String
    let text: String?
    let createdAt: String?
}
private struct PendingRequest {
    let id: String
    let text: String
    let conversationId: String?
    let contextRevision: Int?
    let source: String
}

@MainActor
final class AppModel: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var messages = [Message(role: "kst", text: "Ready for typed or local voice requests. Arm the configured wake phrase to activate a discussion by voice. Armed mode uses continuous on-device Apple speech; it is not a dedicated low-power keyword model.")]
    let voice = VoiceInput()
    let supervisor = CoreSupervisor()
    lazy var desktop = DesktopSignals(endpoint: endpoint, token: { [weak self] in self?.pairingToken() })
    @Published var draft = ""
    @Published var connection = "Checking local core…"
    @Published var issue: String?
    @Published var settings = NativeSettings()
    @Published var wakePhrase = ""
    @Published var busy = false
    @Published var savedNotice = ""
    private var activitySubscription: AnyCancellable?
    private var contextRevision: Int?
    private let clientInstanceId = UUID().uuidString
    private var runtimeSequence = 0
    private var conversationId: String?
    private var pendingRequest: PendingRequest?
    private var settingsRevision: Int?
    private let launchedAt = Date()
    private var shownExternalResults = Set<String>()
    private var requestTask: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    private let speech = AVSpeechSynthesizer()
    private var speakingID: ObjectIdentifier?
    private var speechTimeout: Task<Void, Never>?
    private var generation = 0
    private let store: SettingsStore
    private let session: URLSession
    private let endpoint: URL?
    private let tokenURL: URL
    let nativeDirectory: URL

    override init() {
        let env = ProcessInfo.processInfo.environment
        nativeDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/kst-dev/native")
        store = SettingsStore(url: nativeDirectory.appendingPathComponent("settings.json"))
        endpoint = try? LocalEndpoint.validated(env["KST_CORE_URL"] ?? "http://127.0.0.1:4310")
        let coreDirectory = env["KST_DATA_DIR"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/kst-dev/core")
        tokenURL = coreDirectory.appendingPathComponent("token")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 4
        configuration.timeoutIntervalForResource = 8
        configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: LoopbackRedirectGuard(), delegateQueue: nil)
        super.init()
        speech.delegate = self
        activitySubscription = voice.$status.removeDuplicates().sink { [weak self] _ in Task { @MainActor in await self?.reportRuntimeState() } }
        voice.onFinal = { [weak self] text in
            guard let self, self.voice.active else { return }
            let normalized = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            if VoiceControl.isStop(text) {
                self.stop()
                return
            }
            if ["end conversation", "we're done", "we are done", "that's all"].contains(normalized) {
                self.endDiscussion()
                return
            }
            self.draft = text
            self.submit(fromVoice: true)
        }
        voice.onFailure = { [weak self] message in self?.issue = message }
        voice.onWake = { [weak self] in self?.speak("I'm listening."); Task { await self?.reportRuntimeState() } }
        voice.onDiscussionEnded = { [weak self] in self?.conversationId = nil; self?.contextRevision = nil }
        do { settings = try store.load() } catch { issue = "Settings could not be read. Existing settings were preserved; save to replace them." }
        if endpoint == nil { issue = NativeFailure.invalidLocalURL.localizedDescription }
    }

    func beginHealthChecks() {
        healthTask?.cancel()
        healthTask = Task { [weak self] in
            var failures = 0
            while !Task.isCancelled {
                guard let self else { return }
                let available = await self.checkHealth()
                if available { self.supervisor.markHealthy() }
                else if self.connection != "Core update required" { self.supervisor.ensureRunningIfConfigured() }
                failures = available ? 0 : min(failures + 1, 4)
                try? await Task.sleep(for: .seconds(available ? 10 : min(30, 2 << failures)))
            }
        }
    }

    func retry() { settingsRevision = nil; beginHealthChecks() }
    func openDashboard() {
        if let endpoint { NSWorkspace.shared.open(endpoint) }
    }

    private func pairingToken() -> String? {
        ProcessInfo.processInfo.environment["KST_TOKEN"] ?? (try? String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func refreshSharedSettings() async {
        guard let endpoint, let token = pairingToken(), !token.isEmpty else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/settings"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            let config = try JSONDecoder().decode(CoreSettings.self, from: data)
            if settingsRevision != config.revision {
                wakePhrase = config.wakePhrase
                settingsRevision = config.revision
                voice.applyWakePhrase(config.wakePhrase)
            }
        } catch { /* Health remains independent of settings access. */ }
    }

    private func checkHealth() async -> Bool {
        guard let endpoint else { connection = "Invalid local core URL"; return false }
        do {
            let (data, response) = try await session.data(from: endpoint.appendingPathComponent("health"))
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  body["status"] as? String == "ok", body["app"] as? String == "kst" else {
                connection = "Unexpected core response — retrying"; return false
            }
            guard body["version"] as? String == "0.5.0" else {
                connection = "Core update required"
                issue = "The local core is older than this app and does not support the adaptive conversation protocol. Restart the core that owns port 4310, then retry. If kst started it, quit and reopen kst; if you started it in Terminal, stop it there and run “node scripts/kst.mjs start” again."
                return false
            }
            connection = "Local core connected"
            if issue?.contains("older than this app") == true { issue = nil }
            await reportRuntimeState()
            await refreshSharedSettings()
            await refreshExternalResults()
            return true
        } catch {
            connection = "Core unavailable — automatic retry enabled"
            return false
        }
    }

    private func reportRuntimeState() async {
        guard let endpoint, let token = pairingToken() else { return }
        runtimeSequence += 1
        let thermal: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermal = "nominal"
        case .fair: thermal = "fair"
        case .serious: thermal = "serious"
        case .critical: thermal = "critical"
        @unknown default: thermal = "critical"
        }
        let voiceState = speech.isSpeaking ? "speaking" : !voice.active ? "off" : voice.waitingForWake ? "armed" : "discussion"
        var request = URLRequest(url: endpoint.appendingPathComponent("api/understanding/runtime-state"))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["clientInstanceId": clientInstanceId, "sequence": runtimeSequence, "voiceState": voiceState, "ttsActive": speech.isSpeaking, "idleSeconds": min(86400, max(0, CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null))), "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled, "thermalState": thermal])
        _ = try? await session.data(for: request)
    }

    private func refreshExternalResults() async {
        guard let endpoint, let token = pairingToken(), !token.isEmpty else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/external/status"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            let feed = try JSONDecoder().decode(ExternalFeed.self, from: data)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            shownExternalResults.formIntersection(Set(feed.jobs.map(\.id)))
            for job in feed.jobs.reversed() {
                guard !shownExternalResults.contains(job.id), let text = job.text,
                      let created = job.createdAt.flatMap({ formatter.date(from: $0) }), created >= launchedAt else { continue }
                shownExternalResults.insert(job.id)
                appendMessage(role: "kst", text: "\(job.service ?? "External service") · \(job.status)\n\(text)")
                // Background results are visual only. Speech requires a direct user request.
            }
        } catch { /* Results stay in durable core receipts; they are never reissued here. */ }
    }

    private func endDiscussion() {
        let endedConversation = conversationId
        generation += 1
        let endedGeneration = generation
        conversationId = nil
        contextRevision = nil
        voice.endDiscussion()
        guard let endedConversation, let endpoint, let token = pairingToken() else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/conversation"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["requestId": UUID().uuidString, "text": "end conversation", "conversationId": endedConversation])
        Task { [weak self] in
            guard let self else { return }
            do {
                let (_, response) = try await self.session.data(for: request)
                guard self.generation == endedGeneration else { return }
                if (response as? HTTPURLResponse)?.statusCode != 200 { self.issue = "Discussion closed locally; core closure was not confirmed. Pending requests expire or can be cleared with Stop." }
            } catch { if self.generation == endedGeneration { self.issue = "Discussion closed locally; the core could not confirm closure. Use Stop to revoke outstanding approvals." } }
        }
    }

    func submit(fromVoice: Bool = false) {
        if !fromVoice { voice.close() }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        guard text.count <= 4000 else { issue = "Please keep each request under 4,000 characters."; return }
        guard let endpoint else { voice.close(); issue = NativeFailure.invalidLocalURL.localizedDescription; return }
        let token = pairingToken()
        guard let token, !token.isEmpty else {
            voice.close()
            issue = "Core pairing token is missing. Start the kst core, then retry your request."
            return
        }
        if let pendingRequest, pendingRequest.text != text {
            voice.close()
            issue = "The previous request has an uncertain result. Retry its original text with the same request ID, or Stop and check receipts before starting a different request."
            return
        }
        let pending = pendingRequest ?? PendingRequest(id: UUID().uuidString, text: text, conversationId: conversationId, contextRevision: contextRevision, source: fromVoice ? "voice" : "typed")
        if pendingRequest == nil { appendMessage(role: "You", text: text) }
        pendingRequest = pending
        draft = ""
        generation += 1
        let acceptedGeneration = generation
        busy = true
        Task { await reportRuntimeState() }
        issue = nil
        speech.stopSpeaking(at: .immediate)
        var request = URLRequest(url: endpoint.appendingPathComponent("api/conversation"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["requestId": pending.id, "text": pending.text, "source": pending.source]
        if let revision = pending.contextRevision { body["contextRevision"] = revision }
        if let conversationId = pending.conversationId { body["conversationId"] = conversationId }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        requestTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == acceptedGeneration { self.busy = false } }
            do {
                var (data, response) = try await self.session.data(for: request)
                for _ in 0..<30 where (response as? HTTPURLResponse)?.statusCode == 202 {
                    try Task.checkCancellation()
                    try await Task.sleep(for: .seconds(1))
                    guard self.generation == acceptedGeneration else { return }
                    var poll = URLRequest(url: endpoint.appendingPathComponent("api/understanding/requests/\(pending.id)"))
                    poll.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    (data, response) = try await self.session.data(for: poll)
                    if let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        if let final = receipt["response"] as? [String: Any], final["reply"] != nil { data = try JSONSerialization.data(withJSONObject: final); break }
                        if ["PREPARED", "DISPATCHING"].contains(receipt["state"] as? String ?? "") { response = HTTPURLResponse(url: poll.url!, statusCode: 202, httpVersion: nil, headerFields: nil)! }
                    }
                }
                guard self.generation == acceptedGeneration else { return }
                let httpResponse = response as? HTTPURLResponse
                guard let httpResponse, httpResponse.statusCode == 200 else {
                    self.draft = text
                    let details = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                    let error = details?["error"] as? [String: Any]
                    self.issue = error?["message"] as? String ?? "The result is pending or unverified. Review its receipt before repeating it."
                    if httpResponse?.statusCode == 409 || httpResponse?.statusCode == 400 {
                        self.pendingRequest = nil
                        self.contextRevision = nil
                        self.voice.resume()
                    } else { self.voice.close() }
                    return
                }
                if let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], payload["executionState"] as? String == "UNKNOWN" {
                    self.voice.close()
                    self.draft = text
                    self.issue = "Execution is uncertain. Review request \(pending.id) before sending another action."
                    return
                }
                let reply = try JSONDecoder().decode(CoreReply.self, from: data)
                self.pendingRequest = nil
                self.conversationId = reply.conversationId
                self.contextRevision = reply.understanding?.contextRevision
                self.appendMessage(role: "kst", text: reply.reply)
                self.speak(reply.reply)
            } catch {
                guard self.generation == acceptedGeneration, !Task.isCancelled else { return }
                self.draft = text
                self.voice.close()
                self.issue = "No verified response was received. Check the core before retrying; the request was not automatically repeated."
            }
        }
    }

    private func appendMessage(role: String, text: String) {
        messages.append(Message(role: role, text: text))
        if messages.count > 80 { messages.removeFirst(messages.count - 80) }
    }

    func speak(_ text: String) {
        guard settings.spokenReplies else { voice.resume(); return }
        speechTimeout?.cancel()
        speakingID = nil
        speech.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: String(text.prefix(1200)))
        // Resolve from Apple's live catalog first: identifiers differ between
        // compact/enhanced installations, and gender may initially be unspecified.
        let preferredNames = ["Daniel", "Rishi", "Aman", "Fred"]
        let available = AVSpeechSynthesisVoice.speechVoices()
        let maleVoice = available.filter { candidate in
            candidate.language.hasPrefix("en") &&
            candidate.gender != .female &&
            (candidate.gender == .male || preferredNames.contains(candidate.name))
        }.sorted { left, right in
            let leftRank = preferredNames.firstIndex(of: left.name) ?? preferredNames.count
            let rightRank = preferredNames.firstIndex(of: right.name) ?? preferredNames.count
            if leftRank != rightRank { return leftRank < rightRank }
            if left.quality != right.quality { return left.quality.rawValue > right.quality.rawValue }
            // Prefer compact Daniel when both catalog variants are registered.
            return left.identifier < right.identifier
        }.first ?? AVSpeechSynthesisVoice(identifier: "com.apple.speech.synthesis.voice.Fred")
        guard let maleVoice else {
            issue = "Apple could not provide an installed male voice. The reply remains visible."
            voice.resume()
            return
        }
        utterance.voice = maleVoice
        utterance.rate = 0.52
        utterance.pitchMultiplier = 1.0
        speakingID = ObjectIdentifier(utterance)
        voice.speaking()
        speech.speak(utterance)
        let identifier = ObjectIdentifier(utterance)
        speechTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            guard let self, !Task.isCancelled, self.speakingID == identifier else { return }
            self.speakingID = nil
            self.speech.stopSpeaking(at: .immediate)
            self.voice.close()
            self.issue = "Speech playback did not complete within its deadline. Listening is off; the verified response remains visible."
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.speakingID == identifier else { return }
            self.speakingID = nil
            self.speechTimeout?.cancel()
            self.voice.resume()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.speakingID == identifier else { return }
            self.speakingID = nil
            self.speechTimeout?.cancel()
            // Cancellation does not silently reopen a microphone.
            self.voice.close()
        }
    }

    func startListening(armed: Bool = false) {
        guard !busy, pendingRequest == nil else {
            issue = "Finish or reconcile the pending request before starting voice capture."
            return
        }
        speakingID = nil
        speech.stopSpeaking(at: .immediate)
        issue = nil
        voice.startConversation(armedPhrase: armed ? wakePhrase : nil)
    }

    func stop() {
        voice.close()
        speechTimeout?.cancel()
        speakingID = nil
        generation += 1
        requestTask?.cancel()
        requestTask = nil
        busy = false
        speech.stopSpeaking(at: .immediate)
        conversationId = nil
        contextRevision = nil
        pendingRequest = nil
        issue = "Discussion stopped. A request already accepted by the core may have completed; check its receipt before retrying."
        guard let endpoint, let token = pairingToken() else { return }
        let stopGeneration = generation
        var request = URLRequest(url: endpoint.appendingPathComponent("api/stop"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["requestId": UUID().uuidString])
        Task { [weak self] in
            guard let self else { return }
            do {
                let (_, response) = try await self.session.data(for: request)
                guard self.generation == stopGeneration else { return }
                if (response as? HTTPURLResponse)?.statusCode != 200 {
                    self.issue = "Speech and local waiting stopped. Core cancellation was not verified; inspect pending work in the dashboard."
                }
            } catch {
                guard self.generation == stopGeneration else { return }
                self.issue = "Speech and local waiting stopped. The core could not acknowledge cancellation; inspect pending work before retrying."
            }
        }
    }

    func saveSettings() {
        do {
            settings = try settings.validated()
            try store.save(settings)
            let phrase = try WakePhrase.validated(wakePhrase)
            guard let settingsRevision, let endpoint, let token = pairingToken() else {
                issue = "Speech preference saved. Connect to the core and Retry before changing the shared wake phrase."
                return
            }
            var request = URLRequest(url: endpoint.appendingPathComponent("api/settings"))
            request.httpMethod = "PATCH"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["expectedRevision": settingsRevision, "wakePhrase": phrase])
            issue = nil
            Task { [weak self] in
                guard let self else { return }
                do {
                    let (data, response) = try await self.session.data(for: request)
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                        self.issue = "Wake settings were not saved. Press Retry to refresh the current shared revision."
                        return
                    }
                    let config = try JSONDecoder().decode(CoreSettings.self, from: data)
                    self.wakePhrase = config.wakePhrase
                    self.settingsRevision = config.revision
                    self.voice.close()
                    self.savedNotice = "Shared wake phrase saved. Arm listening again to use the updated phrase."
                } catch { self.issue = "Wake-setting result is unverified. Press Retry to read the current settings before saving again." }
            }
        } catch { issue = error.localizedDescription; savedNotice = "" }
    }

    func shutdown() { stop(); desktop.disable(); healthTask?.cancel(); session.invalidateAndCancel(); supervisor.shutdown() }
}

/// A local response can never redirect pairing credentials to an external service.
final class LoopbackRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var voice: VoiceInput
    @ObservedObject var desktop: DesktopSignals
    @ObservedObject var supervisor: CoreSupervisor
    init(model: AppModel) { self.model = model; self.voice = model.voice; self.desktop = model.desktop; self.supervisor = model.supervisor }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                if let logo = Bundle.main.url(forResource: "kst-logo", withExtension: "png"), let image = NSImage(contentsOf: logo) {
                    Image(nsImage: image).resizable().scaledToFit().frame(width: 100, height: 40)
                }
                VStack(alignment: .leading) {
                    Text("kst").font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("Your personal assistant · first development build").foregroundStyle(.secondary)
                }
                Spacer()
                Button("Stop", role: .destructive) { model.stop() }.keyboardShortcut(".", modifiers: .command)
            }
            HStack {
                Circle().fill(model.connection == "Local core connected" ? .green : .orange).frame(width: 8, height: 8)
                Text(model.connection).font(.callout)
                Spacer()
                Button("Dashboard") { model.openDashboard() }
                Button("Retry") { model.retry() }
            }
            if !supervisor.status.isEmpty { Text(supervisor.status).font(.caption2).foregroundStyle(.secondary) }
            HStack {
                Text(voice.status).font(.caption).foregroundStyle(voice.active ? Color.orange : Color.secondary)
                Spacer()
                if voice.active {
                    Button("Finish turn") { voice.finishTurn() }
                } else {
                    Button("Start listening") { model.startListening() }.disabled(model.busy)
                    Button("Arm wake phrase") { model.startListening(armed: true) }.disabled(model.busy || model.wakePhrase.isEmpty)
                }
            }
            if !voice.partialTranscript.isEmpty {
                Text(voice.partialTranscript).font(.callout).foregroundStyle(.secondary).lineLimit(3)
            }
            Text("On-device English speech · microphone pauses during replies · armed audio stays in RAM").font(.caption2).foregroundStyle(.secondary)
            HStack {
                Text(desktop.status).font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Button(desktop.enabled ? "Pause nudges" : "Enable activity & nudges") {
                    if desktop.enabled { desktop.disable() } else { desktop.enable() }
                }
            }
            if let issue = model.issue {
                Text(issue).font(.callout).foregroundStyle(.orange).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(model.messages) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(message.role).font(.caption.weight(.semibold)).foregroundStyle(message.role == "You" ? Color.secondary : Color.orange)
                                Text(message.text).textSelection(.enabled)
                            }.frame(maxWidth: .infinity, alignment: .leading).id(message.id)
                        }
                    }.padding(.vertical, 8)
                }.onChange(of: model.messages.count) { _, _ in
                    if let last = model.messages.last { scroll.scrollTo(last.id, anchor: .bottom) }
                }
            }.frame(minHeight: 220)
            HStack {
                TextField("Ask kst…", text: $model.draft).textFieldStyle(.roundedBorder).onSubmit { model.submit() }
                Button(model.busy ? "Waiting…" : "Send") { model.submit() }.disabled(model.busy || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            DisclosureGroup("Settings") {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Shared wake phrase", text: $model.wakePhrase).textFieldStyle(.roundedBorder)
                    Text("Armed mode recognizes this phrase through local Apple speech. It consumes more power than a trained keyword detector; accuracy and battery use require hardware testing.").font(.caption).foregroundStyle(.secondary)
                    Toggle("Speak replies using an Apple male voice · medium pace", isOn: $model.settings.spokenReplies)
                    Button("Save preferences") { model.saveSettings() }
                    if !model.savedNotice.isEmpty { Text(model.savedNotice).font(.caption).foregroundStyle(.secondary) }
                }.padding(.top, 8)
            }
        }.padding(24).frame(minWidth: 620, minHeight: 590)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var item: NSStatusItem?
    private var model: AppModel?
    private var instanceLock: InstanceLock?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let model = AppModel()
        do { instanceLock = try InstanceLock(directory: model.nativeDirectory) } catch {
            let alert = NSAlert()
            alert.messageText = "kst could not start"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        self.model = model
        if let iconURL = Bundle.main.url(forResource: "kst-icon", withExtension: "png"), let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
        }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 740), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "kst"
        window.contentView = NSHostingView(rootView: ContentView(model: model))
        window.isReleasedWhenClosed = false
        window.center()
        self.window = window
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item?.button?.title = "kst"
        let menu = NSMenu()
        menu.addItem(withTitle: "Open kst", action: #selector(showWindow), keyEquivalent: "")
        menu.addItem(withTitle: "Stop discussion and speech", action: #selector(stop), keyEquivalent: ".")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit kst", action: #selector(quit), keyEquivalent: "q")
        for entry in menu.items { entry.target = self }
        item?.menu = menu
        model.beginHealthChecks()
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(sessionLocked), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        showWindow()
    }

    @objc func showWindow() { NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil) }
    @objc func stop() { model?.stop() }
    @objc func sessionLocked() { model?.stop() }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { model?.shutdown() }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
