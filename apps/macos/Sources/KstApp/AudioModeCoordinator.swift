import AppKit
import AVFoundation
@preconcurrency import ApplicationServices
import Carbon.HIToolbox
import Combine
import KstNativeCore

private let dictationFocusHandler: AXObserverCallback = { _, _, notification, context in
    guard let context else { return }
    let owner = Unmanaged<AudioModeCoordinator>.fromOpaque(context).takeUnretainedValue()
    let name = notification as String
    MainActor.assumeIsolated {
        if [kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification, kAXTitleChangedNotification].contains(name) { owner.focusEvent() }
        else { owner.recheckTarget() }
    }
}

private let dictationHotkeyHandler: EventHandlerUPP = { _, event, context in
    guard let event else { return OSStatus(eventNotHandledErr) }
    var hotkeyID = EventHotKeyID()
    guard GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hotkeyID) == noErr,
          hotkeyID.signature == 0x4b535444, hotkeyID.id == 1 else { return OSStatus(eventNotHandledErr) }
    guard let context else { return OSStatus(eventNotHandledErr) }
    let owner = Unmanaged<AudioModeCoordinator>.fromOpaque(context).takeUnretainedValue()
    MainActor.assumeIsolated { owner.toggle() }
    return noErr
}

/// Owns dictation admission around the same VoiceInput used by the secretary.
/// It never sends text through the local core, command parser or learning system.
@MainActor
final class AudioModeCoordinator: ObservableObject {
    enum State: String {
        case off, targeting, dictating, finalizing, inserting
        case pausedUser, pausedFocus, pausedPermission, targetUnsupported, deliveryUnknown
    }
    @Published private(set) var state: State = .off
    @Published private(set) var status = "Dictation off · say “start typing” during assistant listening"
    @Published private(set) var partial = ""
    @Published private(set) var targetName = ""
    @Published private(set) var modeGeneration = 0
    @Published private(set) var terminalAcknowledgmentNeeded = false
    @Published private(set) var replacementAcknowledgmentNeeded = false
    @Published private(set) var terminalPermissionNeeded = false
    @Published private(set) var hotkeyRegistered = false
    @Published private(set) var hotkeyDescription = "Control+Option+D"
    var enabled = false { didSet { if !enabled { stop() } } }
    var runtimeV2Available = false { didSet { if !runtimeV2Available && active { stop() } } }
    var onWillStart: (() -> Void)?
    var onStateChanged: (() -> Void)?
    /// Parent uses its existing installed male voice. Complete only after TTS ends.
    var acknowledgeTarget: ((String, @escaping () -> Void) -> Void)?
    var active: Bool { state != .off }
    var heartbeatVoiceState: String {
        switch state {
        case .off: return "off"
        case .dictating: return "dictating"
        case .finalizing: return "finalizing"
        case .inserting: return "inserting"
        default: return "dictation-paused"
        }
    }
    private let voice: VoiceInput
    private let injector = DictationInjector()
    private let lockDirectory: URL
    private var ownership: InstanceLock?
    private var target: DictationTarget?
    private var overlay: DictationOverlay?
    private var monitor: Task<Void, Never>?
    private var insertion: Task<Void, Never>?
    private var expiry: Task<Void, Never>?
    private var receiptExpiry: Task<Void, Never>?
    private var focusObserver: AXObserver?
    private var observerReliable = false
    private var acknowledgmentTimeout: Task<Void, Never>?
    private var partialSubscription: AnyCancellable?
    private var sessionID = UUID().uuidString
    private var turn = 0
    private var receipts: [DictationReceipt] = []
    private var lastText: String?
    private var pendingInitialText: String?
    private var resumeAfterInitialInsert = false
    private var hotkey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var observations: [NSObjectProtocol] = []

    init(voice: VoiceInput, directory: URL? = nil) {
        self.voice = voice
        lockDirectory = (directory ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/kst-dev/native")).appendingPathComponent("dictation")
        voice.onDictationFinal = { [weak self] text in self?.acceptFinal(text) }
        voice.onDictationFailure = { [weak self] message in
            guard let self else { return }
            if message.contains("configuration changed") {
                self.stop(); self.status = message; self.onStateChanged?()
            } else {
                if !self.voice.partialTranscript.isEmpty { self.partial = self.voice.partialTranscript }
                self.pause(VoiceInput.dictationPermissionsReady ? .pausedUser : .pausedPermission, message: message)
            }
        }
        voice.onDictationPhase = { [weak self] phase in
            guard let self, self.active else { return }
            if phase == "dictating" { self.change(.dictating, "Listening · \(self.targetName)") }
            else if phase == "finalizing" { self.change(.finalizing, "Finishing speech · microphone paused") }
            else { self.change(.inserting, "Typing final text · microphone paused") }
        }
        partialSubscription = voice.$partialTranscript.sink { [weak self] text in
            guard let self, self.active, self.voice.mode == .dictation else { return }
            self.partial = text; self.updateOverlay()
        }
        observations.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.recheckTarget() }
        })
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            observations.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.stop() }
            })
        }
        observations.append(DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        })
    }

    /// Registration does not capture microphone audio or prompt for permissions.
    func registerHotkey(keyCode requestedCode: UInt32? = nil, modifiers requestedModifiers: UInt32? = nil) {
        let preferences = UserDefaults.standard
        let keyCode = requestedCode ?? (preferences.object(forKey: "dictation.hotkey.code") as? NSNumber)?.uint32Value ?? UInt32(kVK_ANSI_D)
        let modifiers = requestedModifiers ?? (preferences.object(forKey: "dictation.hotkey.modifiers") as? NSNumber)?.uint32Value ?? UInt32(controlKey | optionKey)
        let allowed = UInt32(controlKey | optionKey | cmdKey | shiftKey)
        guard keyCode <= 127, modifiers & ~allowed == 0, modifiers & UInt32(controlKey | optionKey | cmdKey) != 0 else {
            status = "Choose a valid shortcut with Control, Option or Command."; return
        }
        if let hotkey { UnregisterEventHotKey(hotkey); self.hotkey = nil }
        if handler == nil {
            var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let result = InstallEventHandler(GetApplicationEventTarget(), dictationHotkeyHandler, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &handler)
            guard result == noErr else { status = "Could not install dictation shortcut. Use Start dictation."; return }
        }
        let result = RegisterEventHotKey(keyCode, modifiers, EventHotKeyID(signature: 0x4b535444, id: 1), GetApplicationEventTarget(), 0, &hotkey)
        hotkeyRegistered = result == noErr
        if hotkeyRegistered {
            hotkeyDescription = keyCode == UInt32(kVK_ANSI_D) && modifiers == UInt32(controlKey | optionKey) ? "Control+Option+D" : "Custom shortcut (key code \(keyCode))"
            preferences.set(keyCode, forKey: "dictation.hotkey.code")
            preferences.set(modifiers, forKey: "dictation.hotkey.modifiers")
        }
        if !hotkeyRegistered { status = "Dictation shortcut is in use. Choose another shortcut or use the status menu." }
    }
    func shutdown() {
        stop()
        if let hotkey { UnregisterEventHotKey(hotkey); self.hotkey = nil }
        if let handler { RemoveEventHandler(handler); self.handler = nil }
        for token in observations {
            NSWorkspace.shared.notificationCenter.removeObserver(token)
            DistributedNotificationCenter.default().removeObserver(token)
        }
        observations.removeAll(); ownership = nil
    }
    func toggle() {
        switch state {
        case .dictating, .finalizing, .inserting, .targeting: stop()
        default: start()
        }
    }
    func start(initialText: String? = nil) {
        guard enabled else { status = "Enable dictation in kst first."; onStateChanged?(); return }
        guard runtimeV2Available else { status = "The connected core needs runtime-state v2 before dictation can start."; onStateChanged?(); return }
        stop()
        pendingInitialText = initialText
        onWillStart?()
        modeGeneration += 1
        let generation = modeGeneration
        change(.targeting, "Checking focused field…")
        guard AXIsProcessTrusted() else {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
            _ = AXIsProcessTrustedWithOptions(options as CFDictionary)
            pause(.pausedPermission, message: "Enable Accessibility for kst in System Settings. Refocus your field and press the hotkey again.")
            return
        }
        guard VoiceInput.dictationPermissionsReady else {
            pause(.pausedPermission, message: "Microphone and Speech permission needed. After granting access, refocus your field and start again.")
            Task { @MainActor in await VoiceInput.requestDictationPermissions() }
            return
        }
        do {
            if ownership == nil { ownership = try InstanceLock(directory: lockDirectory) }
            target = try DictationTarget.capture()
            guard let target else { return }
            targetName = target.appName
            if target.terminal {
                change(.targeting, "Verifying the focused terminal pane and shell prompt…")
                Task { [weak self] in
                    do {
                        let identity = try await TerminalPaneProbe.read(bundleID: target.bundleID)
                        guard let self, self.modeGeneration == generation else { return }
                        guard target.valid(requireTerminalIdentity: false) else { self.pause(.pausedFocus, message: "Terminal focus changed during verification. Re-arm at the intended prompt."); return }
                        target.terminalPaneIdentity = identity
                        self.terminalAcknowledgmentNeeded = true
                        self.replacementAcknowledgmentNeeded = target.expectedRange.length != 0
                        self.change(.targeting, "Confirm this iTerm pane is the intended text prompt. Enter is never emitted.")
                    } catch {
                        guard let self, self.modeGeneration == generation else { return }
                        self.pause(.targetUnsupported, message: error.localizedDescription)
                        self.terminalPermissionNeeded = (error as? TerminalPaneFailure)?.permissionNeeded == true
                        self.updateOverlay()
                    }
                }
                return
            }
            terminalAcknowledgmentNeeded = target.terminal
            replacementAcknowledgmentNeeded = target.expectedRange.length != 0
            if terminalAcknowledgmentNeeded || replacementAcknowledgmentNeeded {
                change(.targeting, terminalAcknowledgmentNeeded ? "Confirm this terminal is at the intended text prompt. Enter is never emitted." : "Selected text will be replaced. Confirm this target.")
                return
            }
            begin(generation: generation)
        } catch { pause(.targetUnsupported, message: error.localizedDescription) }
    }
    func acknowledgeTargetAndStart() {
        guard state == .targeting, let target, target.valid(), terminalAcknowledgmentNeeded || replacementAcknowledgmentNeeded else {
            pause(.pausedFocus, message: "Target changed. Refocus your field and start again."); return
        }
        terminalAcknowledgmentNeeded = false; replacementAcknowledgmentNeeded = false
        begin(generation: modeGeneration)
    }
    private func begin(generation: Int) {
        guard modeGeneration == generation, let target, target.valid() else {
            pause(.pausedFocus, message: "Target changed. Refocus your field and start again."); return
        }
        sessionID = UUID().uuidString; turn = 0; lastText = nil; receipts.removeAll(); partial = ""
        change(.targeting, "Dictation target: \(target.appName)")
        let completion: () -> Void = { [weak self] in
            guard let self, self.modeGeneration == generation else { return }
            self.acknowledgmentTimeout?.cancel(); self.acknowledgmentTimeout = nil
            guard let target = self.target, target.valid() else { self.pause(.pausedFocus, message: "Target changed during acknowledgment. Refocus and start again."); return }
            Task { @MainActor [weak self] in
                let paneValid = await target.terminalValid()
                guard let self, self.modeGeneration == generation else { return }
                guard paneValid, target.valid() else { self.pause(.pausedFocus, message: "Target or terminal prompt changed during acknowledgment. Re-arm at the intended field."); return }
                if let initialText = self.pendingInitialText {
                    self.pendingInitialText = nil
                    self.resumeAfterInitialInsert = true
                    self.acceptFinal(initialText)
                    return
                }
                self.voice.startDictation(terminal: target.terminal)
                if self.voice.mode == .dictation { self.startMonitor() }
            }
        }
        guard let acknowledgeTarget else {
            pause(.pausedUser, message: "Dictation target acknowledgment is unavailable. Restart kst and try again."); return
        }
        acknowledgmentTimeout?.cancel()
        acknowledgmentTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled, let self, self.modeGeneration == generation else { return }
            self.pause(.pausedUser, message: "Target acknowledgment did not complete. Microphone remains off; start again.")
        }
        acknowledgeTarget("Dictating into \(target.appName).", completion)
    }
    func stop() {
        modeGeneration += 1
        if voice.mode == .dictation { voice.close() }
        monitor?.cancel(); monitor = nil
        insertion?.cancel(); insertion = nil
        expiry?.cancel(); expiry = nil
        receiptExpiry?.cancel(); receiptExpiry = nil
        acknowledgmentTimeout?.cancel(); acknowledgmentTimeout = nil
        clearFocusObserver()
        target = nil; partial = ""; lastText = nil; receipts.removeAll()
        pendingInitialText = nil; resumeAfterInitialInsert = false
        terminalAcknowledgmentNeeded = false; replacementAcknowledgmentNeeded = false; terminalPermissionNeeded = false
        state = .off; status = "Dictation off · say “start typing” during assistant listening · optional \(hotkeyDescription)"; targetName = ""
        overlay?.close(); overlay = nil
        onStateChanged?()
    }
    private func change(_ state: State, _ status: String) {
        self.state = state; self.status = status; updateOverlay(); onStateChanged?()
    }
    private func updateOverlay() {
        if state == .targeting && target == nil { return }
        if active && overlay == nil {
            let panel = DictationOverlay()
            panel.onStop = { [weak self] in self?.stop() }
            panel.onCopy = { [weak self] in self?.copyPending() }
            panel.onAcknowledge = { [weak self] in self?.acknowledgeTargetAndStart() }
            panel.onTerminalPermission = { [weak self] in self?.requestTerminalPermission() }
            overlay = panel
        }
        overlay?.update(status: status, partial: partial, acknowledge: terminalAcknowledgmentNeeded || replacementAcknowledgmentNeeded, terminalPermission: terminalPermissionNeeded)
    }
    func requestTerminalPermission() {
        guard terminalPermissionNeeded else { return }
        terminalPermissionNeeded = false
        stop()
        Task { [weak self] in
            let allowed = await TerminalPaneProbe.requestPermission()
            guard let self else { return }
            self.status = allowed ? "iTerm permission granted. Refocus your pane and press the dictation shortcut again." : "iTerm Automation was not granted. Enable it in System Settings, then re-arm."
            self.onStateChanged?()
        }
    }
    private func clearFocusObserver() {
        if let focusObserver { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(focusObserver), .commonModes) }
        focusObserver = nil; observerReliable = false
    }
    fileprivate func focusEvent() {
        guard [.dictating, .finalizing, .inserting].contains(state) else { return }
        pause(state == .inserting ? .deliveryUnknown : .pausedFocus, message: "Focused app/window/field changed. Dictation paused; no remaining text will be replayed.")
    }
    fileprivate func recheckTarget() {
        guard [.dictating, .finalizing, .inserting].contains(state), let target else { return }
        guard VoiceInput.dictationPermissionsReady, AXIsProcessTrusted() else { pause(.pausedPermission, message: "Permission lost. Dictation paused; re-arm after enabling access."); return }
        guard target.valid(checkRange: state != .inserting) else {
            pause(state == .inserting ? .deliveryUnknown : .pausedFocus, message: state == .inserting ? "Delivery uncertain. Remaining text cancelled; nothing will be replayed." : "Focus or caret changed. Dictation paused. Refocus and press the hotkey to re-arm.")
            return
        }
    }
    private func startMonitor() {
        clearFocusObserver()
        if let target {
            var observer: AXObserver?
            if AXObserverCreate(target.pid, dictationFocusHandler, &observer) == .success, let observer {
                let app = AXUIElementCreateApplication(target.pid)
                var reliable = true
                for notification in [kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification] {
                    if AXObserverAddNotification(observer, app, notification as CFString, Unmanaged.passUnretained(self).toOpaque()) != .success { reliable = false }
                }
                for notification in [kAXSelectedTextChangedNotification, kAXValueChangedNotification] {
                    if AXObserverAddNotification(observer, target.element, notification as CFString, Unmanaged.passUnretained(self).toOpaque()) != .success { reliable = false }
                }
                if AXObserverAddNotification(observer, target.window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque()) != .success { reliable = false }
                observerReliable = reliable
                CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
                focusObserver = observer
            }
        }
        monitor?.cancel()
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard let self, !Task.isCancelled, self.active, let target = self.target else { return }
                guard VoiceInput.dictationPermissionsReady, AXIsProcessTrusted() else { self.pause(.pausedPermission, message: "Permission lost. Dictation paused; re-arm after enabling access."); return }
                if target.terminal {
                    let generation = self.modeGeneration
                    let paneValid = await target.terminalValid()
                    guard self.modeGeneration == generation, !Task.isCancelled else { return }
                    guard paneValid else { self.pause(self.state == .inserting ? .deliveryUnknown : .pausedFocus, message: "Terminal pane or prompt changed. Dictation paused; no remaining text is replayed."); return }
                }
                guard self.observerReliable || target.valid(checkRange: self.state != .inserting) else {
                    self.pause(self.state == .inserting ? .deliveryUnknown : .pausedFocus, message: self.state == .inserting ? "Delivery uncertain. Remaining text cancelled; nothing will be replayed." : "Focus or caret changed. Dictation paused. Refocus and press the hotkey to re-arm.")
                    return
                }
            }
        }
    }
    private func pause(_ next: State, message: String) {
        modeGeneration += 1
        if voice.mode == .dictation { voice.close() }
        pendingInitialText = nil; resumeAfterInitialInsert = false
        monitor?.cancel(); monitor = nil; insertion?.cancel(); insertion = nil
        clearFocusObserver(); receiptExpiry?.cancel(); receiptExpiry = nil
        acknowledgmentTimeout?.cancel(); acknowledgmentTimeout = nil
        receipts.removeAll(); lastText = nil
        terminalAcknowledgmentNeeded = false; replacementAcknowledgmentNeeded = false
        change(next, message)
        expiry?.cancel()
        expiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, let self else { return }
            self.partial = ""; self.updateOverlay()
        }
    }
    func copyPending() {
        guard !partial.isEmpty else { return }
        // Explicit Copy replaces clipboard contents. There is no paste/restore path.
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(partial, forType: .string)
    }
    private func acceptFinal(_ text: String) {
        guard active, let target else { return }
        partial = String(text.prefix(4096))
        do {
            switch try DictationPolicy.parse(text, terminal: target.terminal, multiline: target.multiline) {
            case .stop: stop()
            case .pause: pause(.pausedUser, message: "Dictation paused. Refocus and press the hotkey to start a new session.")
            case .undoQuestion: pause(.pausedUser, message: "Use “delete last dictation” only while its exact insertion is still verified; otherwise edit manually.")
            case .deleteLast:
                guard let last = receipts.last, injector.deleteLast(last, target: target) else { pause(.pausedUser, message: "Last insertion is no longer verifiable. Edit manually."); return }
                receipts.removeLast(); lastText = nil; partial = ""; voice.resume()
            case .text(let recognized):
                guard !recognized.isEmpty, target.valid() else { pause(.pausedFocus, message: "Focus or caret changed. Text was not inserted."); return }
                let payload = DictationPolicy.payload(recognized, after: lastText)
                let generation = modeGeneration
                turn += 1; let segmentID = "\(sessionID):\(turn):1"
                change(.inserting, "Typing final text · microphone paused")
                insertion = Task { [weak self] in
                    guard let self else { return }
                    let receipt = await self.injector.insert(payload, segmentID: segmentID, target: target, admitted: { [weak self] in self?.modeGeneration == generation && !Task.isCancelled })
                    guard self.modeGeneration == generation else { return }
                    if receipt.outcome == .unknown { self.pause(.deliveryUnknown, message: "Delivery uncertain. Text will not be replayed. Check the target field."); return }
                    self.receipts.append(receipt)
                    if self.receipts.count > 10 { self.receipts.removeFirst() }
                    if self.receipts.reduce(0, { $0 + $1.text.utf8.count }) > 131072 { self.receipts.removeAll() }
                    self.lastText = String(payload.suffix(1)); self.partial = ""
                    self.receiptExpiry?.cancel()
                    self.receiptExpiry = Task { [weak self] in
                        try? await Task.sleep(for: .seconds(30))
                        guard !Task.isCancelled else { return }
                        self?.receipts.removeAll()
                    }
                    if self.resumeAfterInitialInsert {
                        self.resumeAfterInitialInsert = false
                        self.voice.startDictation(terminal: target.terminal)
                        if self.voice.mode == .dictation { self.startMonitor() }
                    } else {
                        self.voice.resume()
                    }
                }
            }
        } catch {
            pause(.pausedUser, message: "This segment exceeds the size limit or contains unsupported formatting/control characters. Nothing was inserted; use Copy or split the phrase.")
        }
    }
}

@MainActor
private final class DictationOverlay: NSObject {
    private final class Panel: NSPanel {
        override var canBecomeKey: Bool { false }
        override var canBecomeMain: Bool { false }
    }
    var onStop: (() -> Void)?
    var onCopy: (() -> Void)?
    var onAcknowledge: (() -> Void)?
    var onTerminalPermission: (() -> Void)?
    private let panel: NSPanel
    private let label = NSTextField(wrappingLabelWithString: "")
    private let transcript = NSTextField(wrappingLabelWithString: "")
    private let acknowledge = NSButton(title: "Confirm target", target: nil, action: nil)
    private let terminalPermission = NSButton(title: "Allow iTerm Automation", target: nil, action: nil)
    override init() {
        panel = Panel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 170), styleMask: [.nonactivatingPanel, .titled], backing: .buffered, defer: false)
        super.init()
        panel.title = "kst dictation"; panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.backgroundColor = NSColor(calibratedRed: 0.97, green: 0.95, blue: 0.89, alpha: 1)
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        transcript.font = .systemFont(ofSize: 12); transcript.maximumNumberOfLines = 3
        let stop = NSButton(title: "Stop", target: self, action: #selector(stopPressed))
        let copy = NSButton(title: "Copy (replaces clipboard)", target: self, action: #selector(copyPressed))
        acknowledge.target = self; acknowledge.action = #selector(acknowledgePressed)
        terminalPermission.target = self; terminalPermission.action = #selector(permissionPressed)
        let buttons = NSStackView(views: [stop, copy, acknowledge]); buttons.orientation = .horizontal
        let stack = NSStackView(views: [label, transcript, buttons, terminalPermission]); stack.orientation = .vertical; stack.alignment = .leading
        stack.spacing = 8; stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView?.addSubview(stack)
        if let content = panel.contentView {
            NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12), stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12), stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 12), stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -12)])
        }
        if let screen = NSScreen.main { panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.midX - 220, y: screen.visibleFrame.minY + 30)) }
    }
    func update(status: String, partial: String, acknowledge needed: Bool, terminalPermission permissionNeeded: Bool) {
        label.stringValue = status; transcript.stringValue = partial
        acknowledge.isHidden = !needed
        terminalPermission.isHidden = !permissionNeeded
        panel.orderFrontRegardless()
    }
    func close() { panel.orderOut(nil); panel.close() }
    @objc private func stopPressed() { onStop?() }
    @objc private func copyPressed() { onCopy?() }
    @objc private func acknowledgePressed() { onAcknowledge?() }
    @objc private func permissionPressed() { onTerminalPermission?() }
}
