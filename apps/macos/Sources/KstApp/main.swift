import AppKit
import SwiftUI
import AVFoundation
import CoreGraphics
import Carbon.HIToolbox
import Combine
import KstNativeCore

struct Message: Identifiable {
    let id = UUID()
    let role: String
    var text: String
}

private struct CoreReply: Decodable {
    let reply: String
    let conversationId: String
    let understanding: UnderstandingReply?
    let contextRevision: Int?
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
    let turnId: String
    let text: String
    let conversationId: String?
    let contextRevision: Int?
    let source: String
}

@MainActor
final class AppModel: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var messages = [Message(role: "kst", text: "Ready for full-duplex 2-way voice or typed requests (KST v0.8 · Raphael). Say “arise” to wake, or say “total shut down” at any time to pause listening until you call the wake phrase again.")]
    let voice = VoiceInput()
    let supervisor = CoreSupervisor()
    lazy var dictation = AudioModeCoordinator(voice: voice, directory: nativeDirectory)
    private let nativeCoordinator = NativeSystemCoordinator()
    @Published var appleStatus = "Apple-Native Suite ready · Calendar, Reminders, Contacts, Mail, Messages, Notes, Safari, Spotlight & Music"
    @Published var intelligenceStatus = "Tier 1A: Apple Foundation Models (On-Device 3B) · Full-Duplex Barge-In Active"
    @Published var applePreviewText = ""
    @Published var pendingConfirmationId: String?
    @Published var dictationShortcutCode = UserDefaults.standard.object(forKey: "dictation.hotkey.code") as? Int ?? 2
    @Published var raphaelWorkMode = "DEEP_ARCHITECTURE"
    @Published var raphaelInterruptibility = "High (82%)"
    @Published var raphaelTopSkill = "Swift Strict Concurrency & Sendable Actors"
    @Published var raphaelFlowMusic = "Ambient Architecture"
    @Published var preferredMusicStyle = "Auto (Thompson Sampling)"
    @Published var customMusicPlaylist = ""
    @Published var musicAutoDuck = true
    private var appleSettingsRevision = 1
    private var appleSettingsLoaded = false
    private var brokerBootstrap: NativeBrokerBootstrap?
    private var brokerStarted = false
    private var brokerTask: Task<Void, Never>?
    private var runtimeV2Available = false
    private var speechCompletion: (() -> Void)?
    private var stopAcknowledgment: Task<Bool, Never>?
    lazy var desktop = DesktopSignals(endpoint: endpoint, token: { [weak self] in self?.pairingToken() })
    @Published var draft = ""
    @Published var connection = "Checking local core…"
    @Published var issue: String?
    @Published var settings = NativeSettings()
    @Published var wakePhrase = "arise"
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
    private var utteranceCharOffsets: [ObjectIdentifier: Int] = [:]
    private var speechTimeout: Task<Void, Never>?
    private var generation = 0
    private var stitchedContinuationPrefix = ""
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
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: LoopbackRedirectGuard(), delegateQueue: nil)
        super.init()
        speech.delegate = self
        voice.applyWakePhrase(wakePhrase)
        dictation.onWillStart = { [weak self] in self?.stop(stopDictation: false); self?.issue = nil }
        dictation.onStateChanged = { [weak self] in Task { @MainActor in await self?.reportRuntimeState() } }
        dictation.acknowledgeTarget = { [weak self] text, completion in
            guard let self else { return }
            let modeGeneration = self.dictation.modeGeneration
            Task { @MainActor in
                let stopped = await self.stopAcknowledgment?.value ?? true
                guard self.dictation.modeGeneration == modeGeneration else { return }
                guard stopped else { self.dictation.stop(); self.issue = "Assistant cancellation was not acknowledged. Reconnect the core before starting dictation."; return }
                self.speak(text, completion: completion, dictationAcknowledgment: true)
            }
        }
        activitySubscription = voice.$status.removeDuplicates().sink { [weak self] _ in Task { @MainActor in await self?.reportRuntimeState() } }
        voice.onBargeIn = { [weak self] turnId, spokenCharIndex, reason in
            guard let self else { return }
            self.handleUserBargeIn(turnId: turnId, spokenCharIndex: spokenCharIndex, reason: reason)
        }
        voice.onTotalShutdown = { [weak self] in
            guard let self else { return }
            self.sleepToWakeStandby()
        }
        voice.onFinal = { [weak self] text in
            guard let self, self.voice.active else { return }
            if VoiceControl.isTotalShutdown(text) {
                self.sleepToWakeStandby()
                return
            }
            if let command = VoiceControl.dictationStart(in: text) { self.dictation.start(initialText: command.initialText); return }
            if VoiceControl.isStop(text) {
                self.stop()
                return
            }
            let normalized = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            if ["end conversation", "we're done", "we are done", "that's all"].contains(normalized) {
                self.endDiscussion()
                return
            }
            let combined = self.stitchedContinuationPrefix.isEmpty ? text : (self.stitchedContinuationPrefix + " " + text)
            self.stitchedContinuationPrefix = ""
            self.draft = combined
            self.submit(fromVoice: true)
        }
        voice.onFailure = { [weak self] message in self?.issue = message }
        voice.onWake = { [weak self] in self?.speak("I'm listening."); Task { await self?.reportRuntimeState() } }
        voice.onDiscussionEnded = { [weak self] in self?.conversationId = nil; self?.contextRevision = nil }
        do { settings = try store.load() } catch { issue = "Settings could not be read. Existing settings were preserved; save to replace them." }
        if endpoint == nil { issue = NativeFailure.invalidLocalURL.localizedDescription }
        // Respect the persisted opt-in. Dictation injects keyboard events into
        // whichever app owns the captured text field, so it must never be armed
        // implicitly at startup.
        dictation.enabled = settings.dictationEnabled
        dictation.registerHotkey()
    }

    func beginHealthChecks() {
        if !brokerStarted && brokerTask == nil {
            brokerTask = Task { [weak self] in
                guard let self else { return }
                do {
                    let bootstrap = try await self.nativeCoordinator.startBroker()
                    self.brokerBootstrap = bootstrap
                    self.supervisor.brokerBootstrap = try JSONEncoder().encode(bootstrap)
                    self.brokerStarted = true
                } catch {
                    self.appleStatus = "Native system broker unavailable: " + error.localizedDescription
                }
                self.brokerTask = nil
            }
        }
        healthTask?.cancel()
        healthTask = Task { [weak self] in
            var failures = 0
            while !Task.isCancelled {
                guard let self else { return }
                let available = await self.checkHealth()
                if available { self.supervisor.markHealthy() }
                else if self.connection != "Core update required" && self.brokerTask == nil { self.supervisor.ensureRunningIfConfigured() }
                failures = available ? 0 : min(failures + 1, 4)
                try? await Task.sleep(for: .seconds(available ? 5 : min(30, 2 << failures)))
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

    private func registerLiveBrokerIfNeeded() async {
        guard let endpoint, let token = pairingToken(), !token.isEmpty, let bootstrap = brokerBootstrap else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/system/register-broker"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "socketPath": bootstrap.socketPath,
            "capability": bootstrap.capability
        ])
        _ = try? await session.data(for: request)
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
        } catch {}
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
            let version = body["version"] as? String ?? ""
            guard ["0.8.0-preview.1", "0.7.0-preview.1", "0.6.0-preview.1"].contains(version) else {
                connection = "Core update required"
                runtimeV2Available = false
                dictation.runtimeV2Available = false
                issue = "The local core version (\(version)) does not match this app. Restart the core on port 4310."
                return false
            }
            connection = "Local core connected (\(version))"
            runtimeV2Available = (body["capabilities"] as? [String: Any])?["runtimeStateV2"] as? Bool == true
            dictation.runtimeV2Available = runtimeV2Available
            if issue?.contains("does not match") == true { issue = nil }
            await registerLiveBrokerIfNeeded()
            await reportRuntimeState()
            await refreshSharedSettings()
            await refreshExternalResults()
            await refreshAppleAndIntelligenceStatus()
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
        let isSpeaking = speech.isSpeaking || voice.isSpeakingTTS
        let voiceState = dictation.active ? dictation.heartbeatVoiceState : isSpeaking ? "speaking" : !voice.active ? "off" : voice.waitingForWake ? "armed" : "discussion"
        var request = URLRequest(url: endpoint.appendingPathComponent(runtimeV2Available ? "api/runtime-state/v2" : "api/understanding/runtime-state"))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var heartbeat: [String: Any] = [
            "clientInstanceId": clientInstanceId,
            "sequence": runtimeSequence,
            "voiceState": voiceState,
            "ttsActive": isSpeaking,
            "idleSeconds": min(86400, max(0, CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null))),
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
            "thermalState": thermal
        ]
        if runtimeV2Available { heartbeat["schemaVersion"] = 2; heartbeat["modeGeneration"] = dictation.modeGeneration }
        request.httpBody = try? JSONSerialization.data(withJSONObject: heartbeat)
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
            }
        } catch {}
    }

    func refreshAppleAndIntelligenceStatus() async {
        guard let endpoint, let token = pairingToken(), !token.isEmpty else { return }
        var appleReq = URLRequest(url: endpoint.appendingPathComponent("api/apple/status"))
        appleReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let (data, response) = try? await session.data(for: appleReq),
           (response as? HTTPURLResponse)?.statusCode == 200,
           let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let brokerOk = value["brokerAvailable"] as? Bool == true
            let perms = value["permissions"] as? [String: Any] ?? [:]
            let cal = perms["calendar"] as? String ?? "notDetermined"
            let rem = perms["reminders"] as? String ?? "notDetermined"
            let con = perms["contacts"] as? String ?? "notDetermined"
            appleStatus = "Apple Suite (\(brokerOk ? "paired" : "offline")) · Calendar: \(cal) · Reminders: \(rem) · Contacts: \(con)"
            if let raph = value["raphael"] as? [String: Any] {
                if let mode = raph["workMode"] as? String {
                    raphaelWorkMode = mode
                }
                if let i = raph["interruptibility"] as? Double {
                    let pct = Int(round(i * 100))
                    let label = i >= 0.7 ? "High" : i >= 0.4 ? "Medium" : "Focus Lock"
                    raphaelInterruptibility = "\(label) (\(pct)%)"
                }
                if let curr = raph["curriculumRecommendation"] as? [String: Any],
                   let top = curr["topRecommendation"] as? [String: Any],
                   let name = top["topicName"] as? String {
                    raphaelTopSkill = name
                }
                if let mus = raph["musicRecommendation"] as? [String: Any],
                   let pl = mus["recommendedPlaylist"] as? String {
                    let custom = customMusicPlaylist.trimmingCharacters(in: .whitespacesAndNewlines)
                    if preferredMusicStyle == "Custom Playlist…" && !custom.isEmpty {
                        raphaelFlowMusic = custom
                    } else if preferredMusicStyle != "Auto (Thompson Sampling)" && preferredMusicStyle != "Custom Playlist…" {
                        raphaelFlowMusic = preferredMusicStyle
                    } else {
                        raphaelFlowMusic = pl
                    }
                }
            }
            if let rev = value["settingsRevision"] as? Int {
                appleSettingsRevision = rev
            }
            if !appleSettingsLoaded, let appleCfg = value["settings"] as? [String: Any] {
                appleSettingsLoaded = true
                if let duck = appleCfg["musicAutoDuck"] as? Bool {
                    musicAutoDuck = duck
                }
                if let pref = appleCfg["preferredMusicPlaylist"] as? String, !pref.isEmpty {
                    let presets = [
                        "Ambient Architecture", "Binaural 40Hz Gamma Flow", "Baroque String Focus",
                        "Deep Focus Synthwave", "Lo-Fi Coding Beats", "Modern Piano Minimalism",
                        "Acoustic Morning Briefing", "Restorative Alpha Waves"
                    ]
                    if presets.contains(pref) {
                        preferredMusicStyle = pref
                    } else {
                        preferredMusicStyle = "Custom Playlist…"
                        customMusicPlaylist = pref
                    }
                } else {
                    preferredMusicStyle = "Auto (Thompson Sampling)"
                }
            }
            if let pending = (value["pendingConfirmations"] as? [[String: Any]])?.first {
                pendingConfirmationId = pending["confirmationId"] as? String
                if let preview = pending["preview"] as? [String: Any] {
                    applePreviewText = describeApplePreview(preview)
                }
            } else {
                pendingConfirmationId = nil
                applePreviewText = ""
            }
        }

        var intelReq = URLRequest(url: endpoint.appendingPathComponent("api/intelligence/status"))
        intelReq.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let (data, response) = try? await session.data(for: intelReq),
           (response as? HTTPURLResponse)?.statusCode == 200,
           let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let tier1A = value["tier1A"] as? [String: Any] {
            let avail = tier1A["available"] as? Bool == true
            let turns = value["activeConversationTurns"] as? Int ?? 0
            intelligenceStatus = "Tier 1A: Apple Foundation Models (\(avail ? "Active" : "Deterministic Fallback")) · Rolling context: \(turns) turns"
        }
    }

    func confirmStagedAppleAction(confirm: Bool) {
        guard let id = pendingConfirmationId, let endpoint, let token = pairingToken() else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/apple/confirm/\(id)"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "requestId": UUID().uuidString,
            "decision": confirm ? "confirm" : "cancel"
        ])
        Task { [weak self] in
            guard let self else { return }
            if let (data, _) = try? await self.session.data(for: request),
               let res = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let reply = res["reply"] as? String {
                self.appendMessage(role: "kst", text: reply)
                self.speak(reply)
            }
            await self.refreshAppleAndIntelligenceStatus()
        }
    }

    /// Invoked immediately (`<15ms`) when `VoiceInput` detects a user barge-in or pre-speech continuation.
    private func handleUserBargeIn(turnId: String, spokenCharIndex: Int, reason: String) {
        speech.stopSpeaking(at: .immediate)
        speakingID = nil
        utteranceCharOffsets.removeAll()
        requestTask?.cancel()
        requestTask = nil
        busy = false
        if reason == "user_continuation", let pending = pendingRequest, spokenCharIndex == 0 {
            stitchedContinuationPrefix = pending.text
            if messages.last?.role == "You" {
                messages.removeLast()
            }
        } else if spokenCharIndex > 0, let lastIdx = messages.indices.last, messages[lastIdx].role == "kst" {
            let full = messages[lastIdx].text
            let prefix = String(full.prefix(max(0, min(full.count, spokenCharIndex))))
            messages[lastIdx].text = prefix + " [interrupted by user]"
        }
        pendingRequest = nil
        guard let endpoint, let token = pairingToken() else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/conversation/interrupt"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "requestId": "int-" + UUID().uuidString,
            "turnId": turnId,
            "spokenCharIndex": spokenCharIndex,
            "reason": reason
        ])
        Task {
            _ = try? await session.data(for: request)
        }
    }

    /// Triggered when the user says `'total shut down'`. Cancels active speech and streaming,
    /// clears conversation context, and puts the microphone into armed wake-word standby until
    /// the wake phrase (`arise`) is spoken again.
    func sleepToWakeStandby() {
        dictation.stop()
        speechCompletion = nil
        speechTimeout?.cancel()
        speakingID = nil
        utteranceCharOffsets.removeAll()
        speech.stopSpeaking(at: .immediate)
        voice.stopPlaybackImmediately()
        generation += 1
        requestTask?.cancel()
        requestTask = nil
        busy = false
        stitchedContinuationPrefix = ""
        conversationId = nil
        contextRevision = nil
        pendingRequest = nil
        applePreviewText = ""
        pendingConfirmationId = nil
        issue = nil
        voice.enterWakeStandby(phrase: wakePhrase)
        appendMessage(role: "kst", text: "Total shut down complete. Standing by—I will not listen to conversation until you call the wake phrase “\(wakePhrase)” again.")
        Task { await reportRuntimeState() }

        guard let endpoint, let token = pairingToken() else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/stop"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["requestId": UUID().uuidString])
        Task {
            _ = try? await session.data(for: request)
        }
    }

    private func endDiscussion() {
        let endedConversation = conversationId
        generation += 1
        conversationId = nil
        contextRevision = nil
        voice.endDiscussion()
        guard let endedConversation, let endpoint, let token = pairingToken() else { return }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/conversation"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["requestId": UUID().uuidString, "text": "end conversation", "conversationId": endedConversation])
        Task {
            _ = try? await session.data(for: request)
        }
    }

    func submit(fromVoice: Bool = false) {
        if !fromVoice { dictation.stop() }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard text.count <= 4000 else { issue = "Please keep each request under 4,000 characters."; return }
        if VoiceControl.isTotalShutdown(text) {
            draft = ""
            appendMessage(role: "You", text: text)
            sleepToWakeStandby()
            return
        }
        if let command = VoiceControl.dictationStart(in: text) {
            draft = ""
            appendMessage(role: "You", text: text)
            dictation.start(initialText: command.initialText)
            return
        }
        guard let endpoint else { voice.close(); issue = NativeFailure.invalidLocalURL.localizedDescription; return }
        let token = pairingToken()
        guard let token, !token.isEmpty else {
            voice.close()
            issue = "Core pairing token is missing. Start the kst core, then retry your request."
            return
        }

        // If user submits while a previous turn is still speaking, interrupt the previous turn first
        if voice.isSpeakingTTS || speech.isSpeaking {
            voice.stopPlaybackImmediately()
            speech.stopSpeaking(at: .immediate)
            speakingID = nil
            utteranceCharOffsets.removeAll()
        }
        requestTask?.cancel()

        let turnId = "trn_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)
        let pending = PendingRequest(
            id: UUID().uuidString,
            turnId: String(turnId),
            text: text,
            conversationId: conversationId,
            contextRevision: contextRevision,
            source: fromVoice ? "voice" : "typed"
        )
        appendMessage(role: "You", text: text)
        pendingRequest = pending
        draft = ""
        generation += 1
        let acceptedGeneration = generation
        busy = true
        issue = nil
        if fromVoice {
            voice.markThinkingPreSpeech(turnId: pending.turnId)
        }
        Task { await reportRuntimeState() }

        var request = URLRequest(url: endpoint.appendingPathComponent("api/conversation/stream"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "requestId": pending.id,
            "turnId": pending.turnId,
            "text": pending.text,
            "source": pending.source
        ]
        if let revision = pending.contextRevision { body["contextRevision"] = revision }
        if let conversationId = pending.conversationId { body["conversationId"] = conversationId }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        requestTask = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == acceptedGeneration { self.busy = false } }
            do {
                let (bytes, response) = try await self.session.bytes(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    self.pendingRequest = nil
                    self.issue = "The local core rejected the streaming request."
                    return
                }
                var currentEvent = ""
                var assembledText = ""
                var messageInserted = false
                let resolvedVoice = self.resolveMaleVoice()

                for try await line in bytes.lines {
                    try Task.checkCancellation()
                    guard self.generation == acceptedGeneration else { return }
                    if line.hasPrefix("event:") {
                        currentEvent = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                    } else if line.hasPrefix("data:") {
                        let rawJSON = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard let data = rawJSON.data(using: .utf8),
                              let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
                        switch currentEvent {
                        case "clause":
                            let clauseText = payload["text"] as? String ?? ""
                            let charStart = payload["charStart"] as? Int ?? assembledText.count
                            assembledText += clauseText
                            if !messageInserted {
                                self.appendMessage(role: "kst", text: assembledText)
                                messageInserted = true
                            } else if let idx = self.messages.indices.last {
                                self.messages[idx].text = assembledText
                            }
                            if self.settings.spokenReplies, let resolvedVoice, !clauseText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                self.voice.markSpeakingClause(
                                    turnId: pending.turnId,
                                    fullAccumulatedText: assembledText
                                )
                                let utterance = AVSpeechUtterance(string: clauseText)
                                utterance.voice = resolvedVoice
                                utterance.rate = 0.55
                                utterance.pitchMultiplier = 1.0
                                let id = ObjectIdentifier(utterance)
                                self.utteranceCharOffsets[id] = charStart
                                self.speakingID = id
                                self.speech.speak(utterance)
                            }
                        case "confirmation_staged":
                            self.pendingConfirmationId = payload["confirmationId"] as? String
                            if let preview = payload["preview"] as? [String: Any] {
                                self.applePreviewText = self.describeApplePreview(preview)
                            }
                        case "done":
                            if let full = payload["fullText"] as? String, !full.isEmpty {
                                if !messageInserted {
                                    self.appendMessage(role: "kst", text: full)
                                } else if let idx = self.messages.indices.last {
                                    self.messages[idx].text = full
                                }
                            }
                            self.conversationId = payload["conversationId"] as? String ?? self.conversationId
                            self.pendingRequest = nil
                            await self.refreshAppleAndIntelligenceStatus()
                        case "error":
                            self.issue = payload["message"] as? String ?? "Turn failed."
                            self.pendingRequest = nil
                        default:
                            break
                        }
                    }
                }
            } catch {
                guard self.generation == acceptedGeneration, !Task.isCancelled else { return }
                self.pendingRequest = nil
                self.issue = "Connection interrupted or core unavailable."
            }
        }
    }

    private func appendMessage(role: String, text: String) {
        messages.append(Message(role: role, text: text))
        if messages.count > 80 { messages.removeFirst(messages.count - 80) }
    }

    private func resolveMaleVoice() -> AVSpeechSynthesisVoice? {
        let preferredNames = ["Daniel", "Rishi", "Aman", "Fred"]
        let available = AVSpeechSynthesisVoice.speechVoices()
        return available.filter { candidate in
            candidate.language.hasPrefix("en") &&
            candidate.gender != .female &&
            (candidate.gender == .male || preferredNames.contains(candidate.name))
        }.sorted { left, right in
            let leftRank = preferredNames.firstIndex(of: left.name) ?? preferredNames.count
            let rightRank = preferredNames.firstIndex(of: right.name) ?? preferredNames.count
            if leftRank != rightRank { return leftRank < rightRank }
            if left.quality != right.quality { return left.quality.rawValue > right.quality.rawValue }
            return left.identifier < right.identifier
        }.first ?? AVSpeechSynthesisVoice(identifier: "com.apple.speech.synthesis.voice.Fred")
    }

    func speak(_ text: String, completion: (() -> Void)? = nil, dictationAcknowledgment: Bool = false) {
        guard !dictation.active || dictationAcknowledgment else { return }
        guard settings.spokenReplies else {
            if let completion { completion() } else if !dictation.active { voice.markSpeechFinished() }
            return
        }
        guard let maleVoice = resolveMaleVoice() else {
            issue = "Apple could not provide an installed male voice. The reply remains visible."
            if dictation.active { dictation.stop() } else { voice.markSpeechFinished() }
            return
        }
        speechCompletion = completion
        speechTimeout?.cancel()
        speakingID = nil
        utteranceCharOffsets.removeAll()
        speech.stopSpeaking(at: .immediate)
        let clipped = String(text.prefix(1200))
        let utterance = AVSpeechUtterance(string: clipped)
        utterance.voice = maleVoice
        utterance.rate = 0.57
        utterance.pitchMultiplier = 1.0
        let id = ObjectIdentifier(utterance)
        speakingID = id
        utteranceCharOffsets[id] = 0
        if !dictationAcknowledgment && voice.active && voice.mode == .assistant {
            let turnId = "trn_" + UUID().uuidString.prefix(8)
            voice.markSpeakingClause(turnId: String(turnId), fullAccumulatedText: clipped)
        } else {
            voice.speaking()
        }
        speech.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        let rangeEnd = characterRange.location + characterRange.length
        Task { @MainActor [weak self] in
            guard let self else { return }
            let baseOffset = self.utteranceCharOffsets[identifier] ?? 0
            self.voice.updateLiveSpokenCharIndex(baseOffset + rangeEnd)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.utteranceCharOffsets.removeValue(forKey: identifier)
            guard self.speakingID == identifier else { return }
            self.speakingID = nil
            self.speechTimeout?.cancel()
            let completion = self.speechCompletion
            self.speechCompletion = nil
            if let completion {
                completion()
            } else if !self.dictation.active {
                self.voice.markSpeechFinished()
            }
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.utteranceCharOffsets.removeValue(forKey: identifier)
            guard self.speakingID == identifier else { return }
            self.speakingID = nil
            self.speechTimeout?.cancel()
            self.speechCompletion = nil
        }
    }

    func startListening(armed: Bool = false) {
        dictation.stop()
        speechCompletion = nil
        speakingID = nil
        utteranceCharOffsets.removeAll()
        speech.stopSpeaking(at: .immediate)
        voice.stopPlaybackImmediately()
        issue = nil
        voice.startConversation(armedPhrase: armed ? wakePhrase : nil)
    }

    func stop(stopDictation: Bool = true) {
        stopAcknowledgment = Task { false }
        applePreviewText = ""
        pendingConfirmationId = nil
        stitchedContinuationPrefix = ""
        if stopDictation { dictation.stop() }
        speechCompletion = nil
        voice.close()
        speechTimeout?.cancel()
        speakingID = nil
        utteranceCharOffsets.removeAll()
        generation += 1
        requestTask?.cancel()
        requestTask = nil
        busy = false
        speech.stopSpeaking(at: .immediate)
        conversationId = nil
        contextRevision = nil
        pendingRequest = nil
        issue = "Discussion stopped. Pending uncommitted turns were cancelled."
        guard let endpoint, let token = pairingToken() else { return }
        let stopGeneration = generation
        var request = URLRequest(url: endpoint.appendingPathComponent("api/stop"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["requestId": UUID().uuidString])
        stopAcknowledgment = Task { [weak self] in
            guard let self else { return false }
            do {
                let (_, response) = try await self.session.data(for: request)
                guard self.generation == stopGeneration else { return false }
                return (response as? HTTPURLResponse)?.statusCode == 200
            } catch {
                return false
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
                    self.dictation.stop()
                    self.voice.close()
                    self.savedNotice = "Shared wake phrase saved. Arm listening again to use the updated phrase."
                } catch { self.issue = "Wake-setting result is unverified. Press Retry to read the current settings before saving again." }
            }
        } catch { issue = error.localizedDescription; savedNotice = "" }
    }

    private func describeApplePreview(_ preview: [String: Any]) -> String {
        let fields = [("app", "App"), ("to", "To"), ("subject", "Subject"), ("body", "Message"), ("mode", "Action")]
        var lines: [String] = []
        for (key, label) in fields {
            if let value = preview[key] {
                lines.append("\(label): \(value)")
            }
        }
        return lines.joined(separator: "\n")
    }

    func configureDictationShortcut() {
        dictation.registerHotkey(keyCode: UInt32(dictationShortcutCode), modifiers: UInt32(controlKey | optionKey))
    }

    func configureDictation() {
        dictation.enabled = settings.dictationEnabled
        do { try store.save(settings) } catch { issue = "Dictation preference could not be saved." }
    }

    func executeCommand(_ command: String) {
        draft = command
        submit(fromVoice: false)
    }

    func openCoreLog() {
        let logURL = CoreSupervisor.coreLogURL
        let fm = FileManager.default
        let logsDir = logURL.deletingLastPathComponent()
        try? fm.createDirectory(at: logsDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if !fm.fileExists(atPath: logURL.path) {
            fm.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        NSWorkspace.shared.open(logURL)
    }

    func restartCore() {
        supervisor.restartCore()
        retry()
        savedNotice = "Core restart requested. Logs are saved to ~/Library/Logs/kst-core.log."
    }

    func saveMusicPreferences() {
        guard let endpoint, let token = pairingToken() else {
            issue = "Connect to the core and Retry before saving music preferences."
            return
        }
        let resolvedPlaylist: String
        if preferredMusicStyle == "Auto (Thompson Sampling)" {
            resolvedPlaylist = ""
        } else if preferredMusicStyle == "Custom Playlist…" {
            resolvedPlaylist = customMusicPlaylist.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            resolvedPlaylist = preferredMusicStyle
        }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/apple/settings"))
        request.httpMethod = "PATCH"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "expectedRevision": appleSettingsRevision,
            "preferredMusicPlaylist": resolvedPlaylist,
            "musicAutoDuck": musicAutoDuck
        ])
        issue = nil
        Task { [weak self] in
            guard let self else { return }
            do {
                let (data, response) = try await self.session.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    self.issue = "Music preference was not saved. Press Retry to refresh the settings revision."
                    return
                }
                if let rev = obj["settingsRevision"] as? Int {
                    self.appleSettingsRevision = rev
                }
                if !resolvedPlaylist.isEmpty {
                    self.raphaelFlowMusic = resolvedPlaylist
                }
                self.savedNotice = resolvedPlaylist.isEmpty
                    ? "Music preference saved (Auto via Thompson Sampling)."
                    : "Music preference saved (“\(resolvedPlaylist)”)."
            } catch {
                self.issue = "Could not save music preference. Press Retry and try again."
            }
        }
    }

    func shutdown() {
        stop()
        dictation.shutdown()
        brokerTask?.cancel()
        Task { await nativeCoordinator.shutdown() }
        desktop.disable()
        healthTask?.cancel()
        session.invalidateAndCancel()
        supervisor.shutdown()
    }
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
    @ObservedObject var dictation: AudioModeCoordinator
    init(model: AppModel) {
        self.model = model
        self.voice = model.voice
        self.desktop = model.desktop
        self.supervisor = model.supervisor
        self.dictation = model.dictation
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                if let logo = Bundle.main.url(forResource: "kst-logo", withExtension: "png"), let image = NSImage(contentsOf: logo) {
                    Image(nsImage: image).resizable().scaledToFit().frame(width: 100, height: 40)
                }
                VStack(alignment: .leading) {
                    Text("kst").font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("KST v0.8 · Raphael (Great Sage) Personal Work Operator").foregroundStyle(.secondary)
                }
                Spacer()
                Button("Stop", role: .destructive) { model.stop() }.keyboardShortcut(".", modifiers: .command)
            }
            HStack {
                Circle().fill(model.connection.hasPrefix("Local core connected") ? .green : .orange).frame(width: 8, height: 8)
                Text(model.connection).font(.callout)
                Spacer()
                Button("Dashboard") { model.openDashboard() }
                Button("Retry") { model.retry() }
            }
            Text(model.intelligenceStatus).font(.caption).foregroundStyle(.secondary)
            Text(model.appleStatus).font(.caption2).foregroundStyle(.secondary)
            if !supervisor.status.isEmpty { Text(supervisor.status).font(.caption2).foregroundStyle(.secondary) }
            HStack {
                Text(voice.status).font(.caption).foregroundStyle(voice.active ? Color.orange : Color.secondary)
                Spacer()
                if voice.active {
                    if !voice.waitingForWake {
                        Button("Total shut down") { model.sleepToWakeStandby() }
                    }
                    Button("Finish turn") { voice.finishTurn() }
                } else {
                    Button("Start 2-way voice") { model.startListening() }
                    Button("Arm wake phrase") { model.startListening(armed: true) }.disabled(model.wakePhrase.isEmpty)
                }
            }
            Text(voice.voiceFilterStatus).font(.caption2).foregroundStyle(.secondary)
            if !voice.partialTranscript.isEmpty {
                Text(voice.partialTranscript).font(.callout).foregroundStyle(.secondary).lineLimit(3)
            }
            Text(dictation.status).font(.caption).foregroundStyle(dictation.active ? Color.orange : Color.secondary)
            Text("Say “total shut down” to sleep until “\(model.wakePhrase)” · Voice-band noise suppression & speaker F0 lock reject background music lyrics.").font(.caption2).foregroundStyle(.secondary)
            HStack {
                Text(desktop.status).font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Button(desktop.enabled ? "Pause nudges" : "Enable activity & nudges") {
                    if desktop.enabled { desktop.disable() } else { desktop.enable() }
                }
            }
            GroupBox("Raphael Personal Work Operator (Local ML)") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(model.raphaelWorkMode)
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.blue.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                        Text("Interruptibility: \(model.raphaelInterruptibility)")
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(Color.green.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                        Spacer()
                        Text("🎧 \(model.raphaelFlowMusic)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if !model.raphaelTopSkill.isEmpty {
                        Text("🎯 FSRS-4.5 Skill: \(model.raphaelTopSkill)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 6)], alignment: .leading, spacing: 6) {
                        Button("Briefing") { model.executeCommand("Raphael status report") }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("What to Learn") { model.executeCommand("What should I learn next?") }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Focus DJ") { model.executeCommand("Play music for deep architecture") }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Brief Gemini") { model.executeCommand("Brief Gemini on my active task") }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Capture Tasks") { model.executeCommand("Capture action items from Gemini") }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Terminal Sentinel") { model.executeCommand("Explain my last terminal error") }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.vertical, 2)
            }
            if !model.applePreviewText.isEmpty {
                GroupBox("Confirm Outbound Apple Action (Two-Stage Gate)") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(model.applePreviewText).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        HStack {
                            Button("Confirm & Send") { model.confirmStagedAppleAction(confirm: true) }.buttonStyle(.borderedProminent)
                            Button("Cancel") { model.confirmStagedAppleAction(confirm: false) }
                        }
                    }
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
                TextField("Ask Raphael (Calendar, Schedule Plan, Skill Coach, Music DJ, Gemini Companion)…", text: $model.draft).textFieldStyle(.roundedBorder).onSubmit { model.submit() }
                Button(model.busy ? "Streaming…" : "Send") { model.submit() }.disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            DisclosureGroup("Settings") {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Shared wake phrase", text: $model.wakePhrase).textFieldStyle(.roundedBorder)
                    Toggle("Speak replies using an Apple male voice · full-duplex barge-in enabled", isOn: $model.settings.spokenReplies)
                    Toggle("Enable dictation (“start typing”)", isOn: $model.settings.dictationEnabled).onChange(of: model.settings.dictationEnabled) { _, _ in model.configureDictation() }
                    Picker("Dictation shortcut", selection: $model.dictationShortcutCode) {
                        Text("Control+Option+D").tag(2)
                        Text("Control+Option+J").tag(38)
                        Text("Control+Option+K").tag(40)
                    }.onChange(of: model.dictationShortcutCode) { _, _ in model.configureDictationShortcut() }
                    Button("Save preferences") { model.saveSettings() }
                    Divider()
                    Picker("Focus music preference", selection: $model.preferredMusicStyle) {
                        Text("Auto (Thompson Sampling)").tag("Auto (Thompson Sampling)")
                        Text("Ambient Architecture").tag("Ambient Architecture")
                        Text("Binaural 40Hz Gamma Flow").tag("Binaural 40Hz Gamma Flow")
                        Text("Baroque String Focus").tag("Baroque String Focus")
                        Text("Deep Focus Synthwave").tag("Deep Focus Synthwave")
                        Text("Lo-Fi Coding Beats").tag("Lo-Fi Coding Beats")
                        Text("Modern Piano Minimalism").tag("Modern Piano Minimalism")
                        Text("Acoustic Morning Briefing").tag("Acoustic Morning Briefing")
                        Text("Restorative Alpha Waves").tag("Restorative Alpha Waves")
                        Text("Custom Playlist…").tag("Custom Playlist…")
                    }
                    if model.preferredMusicStyle == "Custom Playlist…" {
                        TextField("Apple Music playlist name", text: $model.customMusicPlaylist).textFieldStyle(.roundedBorder)
                    }
                    Toggle("Auto-duck Apple Music during voice replies", isOn: $model.musicAutoDuck)
                    Button("Save music preference") { model.saveMusicPreferences() }
                    Divider()
                    HStack(spacing: 8) {
                        Button("Open Core Log") { model.openCoreLog() }
                        Button("Restart Core") { model.restartCore() }
                    }
                    Text("Core logs: ~/Library/Logs/kst-core.log (5 MB rotation)").font(.caption2).foregroundStyle(.secondary)
                    if !model.savedNotice.isEmpty { Text(model.savedNotice).font(.caption).foregroundStyle(.secondary) }
                }.padding(.top, 8)
            }
        }.padding(24).frame(minWidth: 640, minHeight: 600)
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
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 740, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "kst"
        window.contentView = NSHostingView(rootView: ContentView(model: model))
        window.isReleasedWhenClosed = false
        window.center()
        self.window = window
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item?.button?.title = "kst"
        let menu = NSMenu()
        menu.addItem(withTitle: "Open kst", action: #selector(showWindow), keyEquivalent: "")
        menu.addItem(withTitle: "Start / stop dictation", action: #selector(toggleDictation), keyEquivalent: "")
        menu.addItem(withTitle: "Total shut down (sleep until wake phrase)", action: #selector(sleepToWake), keyEquivalent: "")
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
    @objc func toggleDictation() { model?.dictation.toggle() }
    @objc func sleepToWake() { model?.sleepToWakeStandby() }
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
