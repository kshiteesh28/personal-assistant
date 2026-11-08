import AppKit
import AVFoundation
import Speech
import KstNativeCore

// The Speech framework accepts appended microphone buffers from the audio callback.
// This box owns the one request until its tap is removed; no audio is written to disk.
private final class AudioRequestFeed: @unchecked Sendable {
    let request: SFSpeechAudioBufferRecognitionRequest
    init(_ request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }
    func append(_ buffer: AVAudioPCMBuffer) { request.append(buffer) }
}

@MainActor
final class VoiceInput: ObservableObject {
    @Published private(set) var status = "Microphone off"
    @Published private(set) var partialTranscript = ""
    @Published private(set) var active = false
    @Published private(set) var waitingForWake = false
    var onFinal: ((String) -> Void)?
    var onWake: (() -> Void)?
    var onDiscussionEnded: (() -> Void)?
    var onFailure: ((String) -> Void)?
    private var lifecycle = VoiceSession()
    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var timer: Task<Void, Never>?
    private var permissionTask: Task<Void, Never>?
    private var tapInstalled = false
    private var startedAt = 0.0
    private var updatedAt = 0.0
    private var finalizeAt: Double?
    private var routeObserver: NSObjectProtocol?
    private var wakeEnabled = false
    private var wakePhrase = ""
    private var recognizedText = ""

    init() {
        routeObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.active else { return }
                self.fail("Audio configuration changed. Listening stopped; check the microphone and start again.")
            }
        }
    }

    /// Called only by the explicit Start listening action. Never from init or a test.
    func startConversation(armedPhrase: String? = nil) {
        close()
        if let armedPhrase {
            do { wakePhrase = try WakePhrase.validated(armedPhrase) }
            catch { fail(error.localizedDescription); return }
            wakeEnabled = true
            waitingForWake = true
        }
        active = true
        let epoch = lifecycle.begin()
        status = "Requesting microphone and speech permission…"
        permissionTask = Task { [weak self] in
            guard let self else { return }
            let mic = await AVCaptureDevice.requestAccess(for: .audio)
            guard self.active, self.lifecycle.generation == epoch else { return }
            guard mic else { self.fail("Microphone permission was denied. Enable it in System Settings, then start again."); return }
            let speechStatus = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
            guard self.active, self.lifecycle.generation == epoch else { return }
            guard speechStatus == .authorized else { self.fail("Speech recognition permission is unavailable. Typed requests still work."); return }
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.supportsOnDeviceRecognition else {
                self.fail("On-device English speech recognition is unavailable on this Mac. No online fallback was used; typed requests remain available.")
                return
            }
            self.recognizer = recognizer
            self.resume()
        }
    }

    func resume() {
        guard active, [.permission, .waiting, .speaking].contains(lifecycle.state) else { return }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
              SFSpeechRecognizer.authorizationStatus() == .authorized,
              let recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            fail("Local speech recognition or microphone permission is unavailable. Listening stopped.")
            return
        }
        cleanupCapture()
        let epoch = lifecycle.generation
        guard let turn = lifecycle.listen(generation: epoch) else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .confirmation
        request.contextualStrings = Array(([wakePhrase, "reminder", "calendar", "timeline", "schedule meeting", "plan my day", "search web", "stop", "end conversation"].filter { !$0.isEmpty && $0.utf8.count <= 80 }).prefix(100))
        self.request = request
        partialTranscript = ""
        recognizedText = ""
        startedAt = ProcessInfo.processInfo.systemUptime
        updatedAt = startedAt
        finalizeAt = nil
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { fail("The selected microphone has no usable audio format."); return }
        let feed = AudioRequestFeed(request)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in feed.append(buffer) }
        tapInstalled = true
        recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal ?? false
            let failed = error != nil
            Task { @MainActor in
                guard let self, self.lifecycle.accepts(generation: epoch, turn: turn) else { return }
                if let text, text != self.recognizedText {
                    self.recognizedText = String(text.prefix(4001))
                    self.partialTranscript = self.waitingForWake ? "" : self.recognizedText
                    self.updatedAt = ProcessInfo.processInfo.systemUptime
                }
                if final, let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    guard self.lifecycle.acceptFinal(generation: epoch, turn: turn) else { return }
                    self.cleanupCapture()
                    if self.waitingForWake {
                        guard let command = WakeGate.command(in: text, phrase: self.wakePhrase) else {
                            self.recognizedText = ""
                            self.resume()
                            return
                        }
                        self.waitingForWake = false
                        self.recognizedText = ""
                        self.status = "Wake phrase detected · discussion open"
                        if command.isEmpty { self.onWake?() } else { self.onFinal?(command) }
                        return
                    }
                    self.status = "Waiting for the local core…"
                    self.onFinal?(text)
                } else if failed {
                    self.fail("On-device recognition ended without a verified final transcript. Nothing was sent; try again or type your request.")
                }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            status = waitingForWake ? "Armed for ‘\(wakePhrase)’ · continuous on-device speech gate" : "Listening locally · turn-taking mode"
        } catch { fail("The microphone could not start. Listening is off; check the selected audio device."); return }
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard let self, self.lifecycle.accepts(generation: epoch, turn: turn), !Task.isCancelled else { return }
                guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
                      SFSpeechRecognizer.authorizationStatus() == .authorized else {
                    self.fail("Microphone or speech permission was revoked. Listening stopped immediately.")
                    return
                }
                let now = ProcessInfo.processInfo.systemUptime
                if let finalizing = self.finalizeAt {
                    if now - finalizing > 5 { self.fail("Recognition did not finalize in time. No partial transcript was submitted."); return }
                } else if self.recognizedText.isEmpty {
                    if now - self.startedAt > 45 {
                        if self.waitingForWake { self.recycleArmedTurn() }
                        else { self.endDiscussion(); self.onDiscussionEnded?() }
                        return
                    }
                } else if now - self.startedAt > 45 {
                    if self.waitingForWake { self.recycleArmedTurn(); return }
                    self.fail("This turn reached its 45-second limit. Nothing was sent; split the request or type it.")
                    return
                } else if now - self.updatedAt > 1.5 { self.finishTurn() }
            }
        }
    }

    /// A finalized recognition result is still required; partial text is never dispatched.
    func finishTurn() {
        guard lifecycle.finalize(generation: lifecycle.generation, turn: lifecycle.turn) else { return }
        status = waitingForWake ? "Armed · checking local phrase" : "Finalizing speech…"
        finalizeAt = ProcessInfo.processInfo.systemUptime
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
    }

    func speaking() { lifecycle.speaking(); status = "Speaking · microphone paused" }
    func applyWakePhrase(_ phrase: String) {
        guard let validated = try? WakePhrase.validated(phrase), validated != wakePhrase else { return }
        wakePhrase = validated
        if active && waitingForWake { recycleArmedTurn() }
    }
    func endDiscussion() {
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
        resume()
    }
    func close() {
        lifecycle.close()
        active = false
        waitingForWake = false
        wakeEnabled = false
        permissionTask?.cancel()
        cleanupCapture()
        partialTranscript = ""
        status = "Microphone off"
    }
    private func fail(_ message: String) { close(); status = message; onFailure?(message) }
    private func cleanupCapture() {
        timer?.cancel(); timer = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio()
        recognition?.cancel(); recognition = nil
        request = nil
    }
}
