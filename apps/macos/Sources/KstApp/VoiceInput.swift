import AppKit
import AVFoundation
import Speech
import KstNativeCore

// The Speech framework accepts appended microphone buffers from the audio callback.
// This box filters out sub-bass/treble music (<95 Hz & >3600 Hz) without chopping speech
// syllables and tracks real-time vocal activity uptime so pauses while thinking never cut the user off.
private final class AudioRequestFeed: @unchecked Sendable {
    let request: SFSpeechAudioBufferRecognitionRequest
    private let lock = NSLock()
    private var processor = VoiceAudioProcessor()

    init(_ request: SFSpeechAudioBufferRecognitionRequest) {
        self.request = request
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        let frameLength = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        let sampleRate = buffer.format.sampleRate
        if frameLength > 0, channels > 0, sampleRate > 0, let floatData = buffer.floatChannelData {
            lock.lock()
            let samples = UnsafeMutableBufferPointer(start: floatData[0], count: frameLength)
            _ = processor.processMonoFrame(samples, sampleRate: sampleRate)
            if channels > 1 {
                for ch in 1..<channels {
                    let dst = UnsafeMutableBufferPointer(start: floatData[ch], count: frameLength)
                    for i in 0..<frameLength {
                        dst[i] = samples[i]
                    }
                }
            }
            lock.unlock()
        }
        request.append(buffer)
    }

    func currentAcousticSummary() -> UtteranceAcousticSummary {
        lock.lock()
        defer { lock.unlock() }
        return processor.currentSummary()
    }

    func lastVocalActivityUptime() -> Double {
        lock.lock()
        defer { lock.unlock() }
        return processor.lastVocalActivityUptime
    }

    func resetTurnMetrics() {
        lock.lock()
        defer { lock.unlock() }
        processor.resetTurnMetrics()
    }
}

@MainActor
final class VoiceInput: ObservableObject {
    enum Mode { case off, assistant, dictation }
    @Published private(set) var mode: Mode = .off
    var onDictationFinal: ((String) -> Void)?
    var onDictationFailure: ((String) -> Void)?
    var onDictationPhase: ((String) -> Void)?
    private var terminalDictation = false

    @Published private(set) var status = "Microphone off"
    @Published private(set) var voiceFilterStatus = "Noise & music suppression active · Speaker voice ID ready"
    @Published private(set) var partialTranscript = ""
    @Published private(set) var active = false
    @Published private(set) var waitingForWake = false
    @Published private(set) var isSpeakingTTS = false
    var onFinal: ((String) -> Void)?
    var onWake: (() -> Void)?
    var onTotalShutdown: (() -> Void)?
    var onDiscussionEnded: (() -> Void)?
    var onFailure: ((String) -> Void)?
    var onBargeIn: ((String, Int, String) -> Void)?

    private var lifecycle = VoiceSession()
    private var engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var activeFeed: AudioRequestFeed?
    private var recognition: SFSpeechRecognitionTask?
    private var timer: Task<Void, Never>?
    private var postSpeechRecycleTask: Task<Void, Never>?
    private var permissionTask: Task<Void, Never>?
    private var tapInstalled = false
    private var startedAt = 0.0
    private var updatedAt = 0.0
    private var finalizeAt: Double?
    private var routeObserver: NSObjectProtocol?
    private var wakeEnabled = true
    private var wakePhrase = "arise"
    private var recognizedText = ""
    private var pendingIncompletePrefix = ""
    private var pendingIncompleteAt: Double = 0

    // Speaker Voice Identification & Anti-Echo State (`0.7.0`)
    private(set) var bargeInPolicy = BargeInPolicy()
    private(set) var wordLedger = ScheduledWordLedger()
    private(set) var speakerIdentifier = SpeakerVoiceIdentifier()
    private(set) var activeSpeechTurnId: String?
    private(set) var currentlyPlayingText = ""
    private var lastSpokenAssistantText = ""
    private var lastTTSFinishedUptime: Double = 0
    private(set) var liveSpokenCharIndex = 0

    init() {
        registerRouteObserver()
    }

    private func registerRouteObserver() {
        if let routeObserver {
            NotificationCenter.default.removeObserver(routeObserver)
        }
        routeObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.active else { return }
                if self.mode == .assistant {
                    if !self.isSpeakingTTS {
                        self.resume()
                    }
                } else {
                    self.fail("Audio configuration changed. Listening stopped; check the microphone and start again.")
                }
            }
        }
    }

    func startConversation(armedPhrase: String? = nil) {
        close()
        mode = .assistant
        wakeEnabled = true
        if let armedPhrase {
            let candidate = armedPhrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "arise" : armedPhrase
            do { wakePhrase = try WakePhrase.validated(candidate) }
            catch { fail(error.localizedDescription); return }
            waitingForWake = true
        } else {
            waitingForWake = false
        }
        active = true
        let epoch = lifecycle.begin()
        status = "Requesting microphone and speech permission…"
        permissionTask = Task { [weak self] in
            guard let self else { return }
            let mic = await AVCaptureDevice.requestAccess(for: .audio)
            guard self.active, self.lifecycle.generation == epoch else { return }
            guard mic else {
                self.fail("Microphone permission was denied. Enable it in System Settings > Privacy & Security > Microphone, then start again.")
                return
            }
            let speechStatus = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
            guard self.active, self.lifecycle.generation == epoch else { return }
            guard speechStatus == .authorized else {
                self.fail("Speech recognition permission is unavailable. Enable it in System Settings > Privacy & Security > Speech Recognition.")
                return
            }
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer(),
                  recognizer.isAvailable else {
                self.fail("Apple speech recognition is unavailable on this Mac. Check System Settings > Keyboard > Dictation.")
                return
            }
            self.recognizer = recognizer
            self.resume()
        }
    }

    static var dictationPermissionsReady: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized && SFSpeechRecognizer.authorizationStatus() == .authorized
    }
    static func requestDictationPermissions() async {
        _ = await AVCaptureDevice.requestAccess(for: .audio)
        _ = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
    }

    func startDictation(terminal: Bool) {
        close()
        guard Self.dictationPermissionsReady else {
            onDictationFailure?("Microphone and Speech permissions are required. Enable them, refocus your field, and start again.")
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer(),
              recognizer.isAvailable else {
            onDictationFailure?("Apple speech recognition is unavailable.")
            return
        }
        mode = .dictation
        terminalDictation = terminal
        active = true
        _ = lifecycle.begin()
        self.recognizer = recognizer
        resume()
    }

    private func isAssistantSelfEcho(_ text: String) -> Bool {
        if !currentlyPlayingText.isEmpty {
            if BargeInPolicy.isLikelySelfEcho(transcript: text, currentlyPlayingText: currentlyPlayingText) {
                return true
            }
        }
        let elapsedSinceTTS = ProcessInfo.processInfo.systemUptime - lastTTSFinishedUptime
        if elapsedSinceTTS <= 4.0 && !lastSpokenAssistantText.isEmpty {
            if BargeInPolicy.isLikelySelfEcho(transcript: text, currentlyPlayingText: lastSpokenAssistantText) {
                return true
            }
        }
        return false
    }

    private func stitchWithPendingPrefix(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !pendingIncompletePrefix.isEmpty else { return trimmed }
        if trimmed.isEmpty { return pendingIncompletePrefix }
        if trimmed.lowercased().hasPrefix(pendingIncompletePrefix.lowercased()) {
            return trimmed
        }
        return pendingIncompletePrefix + " " + trimmed
    }

    func resume() {
        // Never open microphone capture while TTS is actively speaking; markSpeechFinished()
        // automatically resumes listening once the assistant finishes its sentence.
        guard active, !isSpeakingTTS, [.permission, .waiting, .speaking, .listening, .finalizing].contains(lifecycle.state) else { return }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
              SFSpeechRecognizer.authorizationStatus() == .authorized,
              let recognizer, recognizer.isAvailable else {
            fail("Local speech recognition or microphone permission is unavailable. Listening stopped.")
            return
        }
        cleanupCapture()
        let epoch = lifecycle.generation
        if [.listening, .finalizing].contains(lifecycle.state) {
            _ = lifecycle.acceptFinal(generation: epoch, turn: lifecycle.turn)
        }
        guard let turn = lifecycle.listen(generation: epoch) else { return }
        bargeInPolicy.beginListening()

        let request = SFSpeechAudioBufferRecognitionRequest()
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        if mode == .dictation { request.addsPunctuation = !terminalDictation }
        request.contextualStrings = mode == .dictation
            ? ["stop dictation", "pause dictation", "literal phrase", "new paragraph"]
            : Array(([wakePhrase, "arise", "total shut down", "total shutdown", "start typing", "start dictation", "plan my day", "schedule my day", "confirm plan", "apply plan", "schedule an event in my calendar", "schedule meeting", "add to my calendar", "remind me to", "calendar", "timeline", "imessage", "apple mail", "safari", "music", "stop", "end conversation"].filter { !$0.isEmpty && $0.utf8.count <= 80 }).prefix(100))
        self.request = request
        partialTranscript = pendingIncompletePrefix.isEmpty ? "" : "\(pendingIncompletePrefix) …"
        recognizedText = ""
        startedAt = ProcessInfo.processInfo.systemUptime
        updatedAt = startedAt
        finalizeAt = nil

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("The selected microphone has no usable audio format.")
            return
        }
        let feed = AudioRequestFeed(request)
        self.activeFeed = feed
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            feed.append(buffer)
        }
        tapInstalled = true

        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal ?? false
            let failed = error != nil
            let avgConfidence = Self.averageConfidence(of: result)
            Task { @MainActor in
                guard let self, !self.isSpeakingTTS, self.lifecycle.accepts(generation: epoch, turn: turn) else { return }
                let acousticSummary = feed.currentAcousticSummary()

                if let text, text != self.recognizedText {
                    // 1. Immediate 'total shut down' stop-word detection on live partial or final frame
                    if self.mode == .assistant && VoiceControl.isTotalShutdown(text) {
                        guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                        self.pendingIncompletePrefix = ""
                        self.enterWakeStandby(phrase: self.wakePhrase)
                        self.onTotalShutdown?()
                        return
                    }

                    // 2. Reject any post-TTS speaker reverberation echo
                    if self.isAssistantSelfEcho(text) {
                        return
                    }

                    // 3. Immediate wake-word detection on partial transcript if user says the wake phrase cleanly
                    if self.waitingForWake, let command = WakeGate.command(in: text, phrase: self.wakePhrase) {
                        self.speakerIdentifier.enrollOrUpdate(summary: acousticSummary)
                        self.updateVoiceFilterStatus(reason: "wake_phrase_enrolled")
                        if command.isEmpty {
                            guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                            self.cleanupCapture()
                            self.waitingForWake = false
                            self.recognizedText = ""
                            self.partialTranscript = ""
                            self.status = "Wake phrase detected · listening"
                            self.onWake?()
                            return
                        }
                    }

                    // 4. Reject partial background music / stationary room noise that lacks near-field voice presence
                    if self.mode == .assistant && !self.waitingForWake {
                        if acousticSummary.frameCount >= 6 && (acousticSummary.speechFrameCount == 0 || acousticSummary.peakSnrDb < 4.2) {
                            self.updateVoiceFilterStatus(reason: "background_noise_or_music_floor")
                            return
                        }
                        if acousticSummary.f0StdDevSemitones > 4.5 {
                            self.updateVoiceFilterStatus(reason: "melodic_singing_pitch_variance")
                            return
                        }
                    }

                    self.recognizedText = String(text.prefix(4001))
                    let display = self.stitchWithPendingPrefix(self.recognizedText)
                    self.partialTranscript = self.waitingForWake ? " Heard: \(display)" : display
                    self.updatedAt = ProcessInfo.processInfo.systemUptime
                }

                if final, let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    if self.mode == .assistant && VoiceControl.isTotalShutdown(text) {
                        guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                        self.pendingIncompletePrefix = ""
                        self.enterWakeStandby(phrase: self.wakePhrase)
                        self.onTotalShutdown?()
                        return
                    }
                    if self.isSpeakingTTS || self.isAssistantSelfEcho(text) {
                        self.recognizedText = ""
                        self.partialTranscript = ""
                        self.recycleArmedTurn()
                        return
                    }
                    guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                    self.cleanupCapture()
                    if self.mode == .dictation {
                        self.status = "Typing final dictation…"
                        self.onDictationPhase?("inserting")
                        self.onDictationFinal?(text)
                        return
                    }
                    if self.waitingForWake {
                        guard let command = WakeGate.command(in: text, phrase: self.wakePhrase) else {
                            self.recognizedText = ""
                            self.partialTranscript = ""
                            self.resume()
                            return
                        }
                        self.speakerIdentifier.enrollOrUpdate(summary: acousticSummary)
                        self.updateVoiceFilterStatus(reason: "wake_phrase_enrolled")
                        self.waitingForWake = false
                        self.recognizedText = ""
                        self.partialTranscript = ""
                        self.status = "Wake phrase detected · listening"
                        if command.isEmpty { self.onWake?() } else { self.onFinal?(command) }
                        return
                    }

                    let combinedText = self.stitchWithPendingPrefix(text)

                    // Evaluate target speaker voice identification & background music lyric rejection
                    let verdict = self.speakerIdentifier.evaluateUtterance(
                        transcript: combinedText,
                        wakePhrase: self.wakePhrase,
                        summary: acousticSummary,
                        averageSegmentConfidence: avgConfidence
                    )
                    self.updateVoiceFilterStatus(reason: verdict.reason)
                    guard verdict.accepted else {
                        self.recognizedText = ""
                        self.partialTranscript = self.pendingIncompletePrefix
                        self.recycleArmedTurn()
                        return
                    }

                    // If SFSpeechRecognizer finalized early on a mid-sentence pause ("Schedule an event in my calendar"),
                    // hold the prefix open for up to 2.5s so the user can finish stating the time/title!
                    let nowUptime = ProcessInfo.processInfo.systemUptime
                    if VoiceControl.isIncompleteUtterance(combinedText) && (self.pendingIncompletePrefix.isEmpty || nowUptime - self.pendingIncompleteAt < 2.5) {
                        if self.pendingIncompletePrefix.isEmpty {
                            self.pendingIncompleteAt = nowUptime
                        }
                        self.pendingIncompletePrefix = combinedText
                        self.partialTranscript = "\(combinedText) …"
                        self.status = "Listening for the rest of your sentence…"
                        self.recycleArmedTurn()
                        return
                    }

                    self.pendingIncompletePrefix = ""
                    self.status = "Processing your request…"
                    self.onFinal?(combinedText)
                } else if final, self.mode == .dictation {
                    guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                    self.cleanupCapture()
                    self.resume()
                } else if failed {
                    if self.waitingForWake || self.isSpeakingTTS {
                        if !self.isSpeakingTTS { self.recycleArmedTurn() }
                    } else if !self.recognizedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        let fallbackText = self.stitchWithPendingPrefix(self.recognizedText)
                        if VoiceControl.isTotalShutdown(fallbackText) {
                            guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                            self.pendingIncompletePrefix = ""
                            self.enterWakeStandby(phrase: self.wakePhrase)
                            self.onTotalShutdown?()
                            return
                        }
                        if self.isAssistantSelfEcho(fallbackText) {
                            self.recycleArmedTurn()
                            return
                        }
                        let verdict = self.speakerIdentifier.evaluateUtterance(
                            transcript: fallbackText,
                            wakePhrase: self.wakePhrase,
                            summary: acousticSummary,
                            averageSegmentConfidence: avgConfidence
                        )
                        self.updateVoiceFilterStatus(reason: verdict.reason)
                        guard verdict.accepted, self.lifecycle.acceptFinal(generation: epoch, turn: turn) else {
                            self.recycleArmedTurn()
                            return
                        }
                        self.cleanupCapture()
                        let nowUptime = ProcessInfo.processInfo.systemUptime
                        if VoiceControl.isIncompleteUtterance(fallbackText) && (self.pendingIncompletePrefix.isEmpty || nowUptime - self.pendingIncompleteAt < 2.5) {
                            if self.pendingIncompletePrefix.isEmpty {
                                self.pendingIncompleteAt = nowUptime
                            }
                            self.pendingIncompletePrefix = fallbackText
                            self.partialTranscript = "\(fallbackText) …"
                            self.status = "Listening for the rest of your sentence…"
                            self.recycleArmedTurn()
                            return
                        }
                        self.pendingIncompletePrefix = ""
                        self.onFinal?(fallbackText)
                    } else {
                        self.recycleArmedTurn()
                    }
                }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            if mode == .dictation { onDictationPhase?("dictating") }
            status = mode == .dictation
                ? "Listening · dictation"
                : waitingForWake
                ? "Armed for ‘\(wakePhrase)’ · speak ‘\(wakePhrase)’ to start"
                : !pendingIncompletePrefix.isEmpty
                ? "Listening for the rest of your sentence…"
                : "Listening locally · 2-way voice active"
        } catch {
            engine = AVAudioEngine()
            registerRouteObserver()
            do {
                let freshInput = engine.inputNode
                let freshFormat = freshInput.outputFormat(forBus: 0)
                freshInput.installTap(onBus: 0, bufferSize: 1024, format: freshFormat) { buffer, _ in
                    feed.append(buffer)
                }
                tapInstalled = true
                engine.prepare()
                try engine.start()
                status = waitingForWake
                    ? "Armed for ‘\(wakePhrase)’ · speak ‘\(wakePhrase)’ to start"
                    : "Listening locally · 2-way voice active"
            } catch {
                fail("The microphone could not start (\(error.localizedDescription)). Check System Settings > Sound > Input.")
                return
            }
        }
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, self.lifecycle.accepts(generation: epoch, turn: turn), !Task.isCancelled else { return }
                guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
                      SFSpeechRecognizer.authorizationStatus() == .authorized else {
                    self.fail("Microphone or speech permission was revoked. Listening stopped immediately.")
                    return
                }
                if self.isSpeakingTTS {
                    continue
                }
                let now = ProcessInfo.processInfo.systemUptime
                let lastVocal = self.activeFeed?.lastVocalActivityUptime() ?? 0
                let effectiveLastActivity = max(self.updatedAt, lastVocal)
                let combinedCurrent = self.stitchWithPendingPrefix(self.recognizedText)

                // Snappy adaptive endpointing:
                // - 0.50s for fast standalone commands ("plan my day", "start typing", "show my calendar", "send it")
                // - 1.10s for complete sentences
                // - 2.10s for incomplete mid-sentence clauses
                let dynamicSilenceThreshold: Double = self.mode == .dictation
                    ? 1.25
                    : VoiceControl.isFastCompleteCommand(combinedCurrent)
                    ? 0.50
                    : VoiceControl.isIncompleteUtterance(combinedCurrent)
                    ? 2.10
                    : 1.10

                // If we held an incomplete prefix and the user stayed silent for 2.6s, dispatch it
                if !self.pendingIncompletePrefix.isEmpty && self.recognizedText.isEmpty && (now - max(self.pendingIncompleteAt, lastVocal) > 2.6) {
                    let flushed = self.pendingIncompletePrefix
                    self.pendingIncompletePrefix = ""
                    if self.lifecycle.acceptFinal(generation: epoch, turn: turn) {
                        self.cleanupCapture()
                        self.onFinal?(flushed)
                    }
                    return
                }

                if let finalizing = self.finalizeAt {
                    if now - finalizing > 0.9 {
                        let pendingText = self.stitchWithPendingPrefix(self.recognizedText).trimmingCharacters(in: .whitespacesAndNewlines)
                        let acousticSummary = self.activeFeed?.currentAcousticSummary() ?? UtteranceAcousticSummary()
                        self.pendingIncompletePrefix = ""
                        if !pendingText.isEmpty, !self.isAssistantSelfEcho(pendingText), self.lifecycle.acceptFinal(generation: epoch, turn: turn) {
                            self.cleanupCapture()
                            if self.mode == .assistant && VoiceControl.isTotalShutdown(pendingText) {
                                self.enterWakeStandby(phrase: self.wakePhrase)
                                self.onTotalShutdown?()
                                return
                            }
                            if self.waitingForWake {
                                if let command = WakeGate.command(in: pendingText, phrase: self.wakePhrase) {
                                    self.speakerIdentifier.enrollOrUpdate(summary: acousticSummary)
                                    self.updateVoiceFilterStatus(reason: "wake_phrase_enrolled")
                                    self.waitingForWake = false
                                    self.recognizedText = ""
                                    self.partialTranscript = ""
                                    if command.isEmpty { self.onWake?() } else { self.onFinal?(command) }
                                } else {
                                    self.recycleArmedTurn()
                                }
                            } else {
                                let verdict = self.speakerIdentifier.evaluateUtterance(
                                    transcript: pendingText,
                                    wakePhrase: self.wakePhrase,
                                    summary: acousticSummary
                                )
                                self.updateVoiceFilterStatus(reason: verdict.reason)
                                if verdict.accepted {
                                    self.onFinal?(pendingText)
                                } else {
                                    self.recycleArmedTurn()
                                }
                            }
                        } else {
                            self.recycleArmedTurn()
                        }
                        return
                    }
                } else if self.recognizedText.isEmpty {
                    if now - self.startedAt > 45 && !self.isSpeakingTTS {
                        if self.waitingForWake || self.mode == .dictation { self.recycleArmedTurn() }
                        else { self.endDiscussion(); self.onDiscussionEnded?() }
                        return
                    }
                } else if now - self.startedAt > 45 {
                    if self.mode == .dictation { self.finishTurn(); return }
                    if self.waitingForWake { self.recycleArmedTurn(); return }
                    self.finishTurn()
                    return
                } else if now - effectiveLastActivity > dynamicSilenceThreshold {
                    self.finishTurn()
                }
            }
        }
    }

    private nonisolated static func averageConfidence(of result: SFSpeechRecognitionResult?) -> Float? {
        guard let segments = result?.bestTranscription.segments, !segments.isEmpty else { return nil }
        let nonZero = segments.map(\.confidence).filter { $0 > 0 }
        guard !nonZero.isEmpty else { return nil }
        return nonZero.reduce(0, +) / Float(nonZero.count)
    }

    private func updateVoiceFilterStatus(reason: String) {
        let f0Badge = speakerIdentifier.isSpeakerLocked
            ? String(format: "Voice ID locked (~%.0f Hz)", speakerIdentifier.enrolledF0Hz)
            : "Speaker Voice ID calibrating"
        switch reason {
        case "wake_phrase_enrolled", "wake_command_enrolled", "verified_target_speaker":
            voiceFilterStatus = "\(f0Badge) · Near-field speech verified · Music & echo suppression active"
        case "background_noise_or_music_floor", "music_bass_treble_spectrum", "melodic_singing_pitch_variance", "speaker_voice_mismatch", "low_confidence_lyric_hallucination":
            voiceFilterStatus = "\(f0Badge) · Ignored background music/lyrics (\(reason.replacingOccurrences(of: "_", with: " ")))"
        default:
            voiceFilterStatus = "\(f0Badge) · Noise, music & echo suppression active"
        }
    }

    func markThinkingPreSpeech(turnId: String) {
        postSpeechRecycleTask?.cancel()
        activeSpeechTurnId = turnId
        currentlyPlayingText = ""
        liveSpokenCharIndex = 0
        // Pause microphone capture while waiting for and speaking the assistant's reply
        // so room noise or speaker audio can never trigger a false '[interrupted by user]' cutoff.
        cleanupCapture()
        lifecycle.speaking()
        status = "Thinking…"
    }

    func markSpeakingClause(turnId: String, fullAccumulatedText: String) {
        postSpeechRecycleTask?.cancel()
        activeSpeechTurnId = turnId
        currentlyPlayingText = fullAccumulatedText
        lastSpokenAssistantText = fullAccumulatedText
        isSpeakingTTS = true
        recognizedText = ""
        partialTranscript = ""
        pendingIncompletePrefix = ""
        // Pause microphone capture during TTS playback on MacBook speakers so the assistant
        // never hears its own voice or interrupts itself mid-reply.
        cleanupCapture()
        lifecycle.speaking()
        status = "Speaking reply… (press Stop or Cmd+. to interrupt)"
    }

    func updateLiveSpokenCharIndex(_ charIndex: Int) {
        liveSpokenCharIndex = max(liveSpokenCharIndex, charIndex)
    }

    func markSpeechFinished() {
        if !currentlyPlayingText.isEmpty {
            lastSpokenAssistantText = currentlyPlayingText
        }
        lastTTSFinishedUptime = ProcessInfo.processInfo.systemUptime
        isSpeakingTTS = false
        activeSpeechTurnId = nil
        currentlyPlayingText = ""
        recognizedText = ""
        partialTranscript = ""
        bargeInPolicy.finishSpeaking()

        guard active && mode == .assistant else { return }
        cleanupCapture()
        lifecycle.close()
        _ = lifecycle.begin()
        status = waitingForWake
            ? "Armed for ‘\(wakePhrase)’ · speak ‘\(wakePhrase)’ to start"
            : "Listening locally · 2-way voice active"

        postSpeechRecycleTask?.cancel()
        postSpeechRecycleTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(240))
            guard let self, !Task.isCancelled, self.active, !self.isSpeakingTTS else { return }
            self.recognizedText = ""
            self.partialTranscript = ""
            self.resume()
        }
    }

    func stopPlaybackImmediately() {
        postSpeechRecycleTask?.cancel()
        if !currentlyPlayingText.isEmpty {
            lastSpokenAssistantText = currentlyPlayingText
            lastTTSFinishedUptime = ProcessInfo.processInfo.systemUptime
        }
        isSpeakingTTS = false
        activeSpeechTurnId = nil
        currentlyPlayingText = ""
        bargeInPolicy.finishSpeaking()
    }

    func finishTurn() {
        guard !isSpeakingTTS else { return }
        guard lifecycle.finalize(generation: lifecycle.generation, turn: lifecycle.turn) else { return }
        if mode == .dictation { onDictationPhase?("finalizing") }
        status = waitingForWake ? "Armed · checking local phrase" : "Finalizing speech…"
        finalizeAt = ProcessInfo.processInfo.systemUptime
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
    }

    func speaking() {
        postSpeechRecycleTask?.cancel()
        isSpeakingTTS = true
        recognizedText = ""
        partialTranscript = ""
        cleanupCapture()
        lifecycle.speaking()
        status = "Speaking · microphone paused"
    }

    func applyWakePhrase(_ phrase: String) {
        guard let validated = try? WakePhrase.validated(phrase), validated != wakePhrase else { return }
        wakePhrase = validated
        if active && waitingForWake { recycleArmedTurn() }
    }

    func enterWakeStandby(phrase: String? = nil) {
        postSpeechRecycleTask?.cancel()
        stopPlaybackImmediately()
        if let phrase, let validated = try? WakePhrase.validated(phrase) {
            wakePhrase = validated
        }
        mode = .assistant
        wakeEnabled = true
        waitingForWake = true
        recognizedText = ""
        partialTranscript = ""
        pendingIncompletePrefix = ""
        if active {
            cleanupCapture()
            lifecycle.close()
            _ = lifecycle.begin()
            resume()
            status = "Total shut down · armed for ‘\(wakePhrase)’ (say ‘\(wakePhrase)’ to wake)"
        } else {
            startConversation(armedPhrase: wakePhrase)
        }
    }

    func endDiscussion() {
        postSpeechRecycleTask?.cancel()
        stopPlaybackImmediately()
        pendingIncompletePrefix = ""
        guard wakeEnabled, active else { close(); return }
        cleanupCapture()
        lifecycle.close()
        _ = lifecycle.begin()
        waitingForWake = true
        recognizedText = ""
        partialTranscript = ""
        resume()
    }

    private func recycleArmedTurn() {
        cleanupCapture()
        lifecycle.close()
        _ = lifecycle.begin()
        recognizedText = ""
        partialTranscript = pendingIncompletePrefix.isEmpty ? "" : "\(pendingIncompletePrefix) …"
        resume()
    }

    func close() {
        postSpeechRecycleTask?.cancel()
        stopPlaybackImmediately()
        mode = .off
        lifecycle.close()
        active = false
        waitingForWake = false
        wakeEnabled = false
        pendingIncompletePrefix = ""
        permissionTask?.cancel()
        cleanupCapture()
        partialTranscript = ""
        status = "Microphone off"
    }

    private func fail(_ message: String) {
        let wasDictation = mode == .dictation
        let pendingPartial = partialTranscript
        close()
        status = message
        if wasDictation { partialTranscript = pendingPartial; onDictationFailure?(message) } else { onFailure?(message) }
    }

    private func cleanupCapture() {
        timer?.cancel()
        timer = nil
        engine.stop()
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        request?.endAudio()
        recognition?.cancel()
        recognition = nil
        request = nil
        activeFeed = nil
    }
}
