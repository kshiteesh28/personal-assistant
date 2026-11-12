import Foundation
import KstNativeCore

enum CheckFailure: Error { case assertion(String) }
func check(_ condition: Bool, _ name: String) throws {
    guard condition else { throw CheckFailure.assertion(name) }
}
func rejects(_ action: () throws -> Void) throws {
    var rejected = false
    do { try action() } catch { rejected = true }
    try check(rejected, "Expected rejection")
}

@main enum NativeChecks {
static func main() throws {
    try check(VoiceControl.isStop("Show my tasks stop"), "Coalesced read and Stop cancels the turn")
    try check(VoiceControl.isStop("stop listening"), "Explicit Stop remains immediate")
    try check(!VoiceControl.isStop("search web bus stop"), "Search payload containing Stop stays data")
    try check(!VoiceControl.isStop("note Please stop"), "Note payload containing Stop stays data")
    try check(VoiceControl.isTotalShutdown("total shut down"), "Exact 'total shut down' triggers wake standby")
    try check(VoiceControl.isTotalShutdown("Total Shutdown!"), "Condensed 'total shutdown' triggers wake standby")
    try check(VoiceControl.isTotalShutdown("some music lyrics total shut down now"), "Embedded 'total shut down' cuts through noise")
    try check(!VoiceControl.isTotalShutdown("note total shut down"), "Note payload with 'total shut down' stays data")
    try testRejectsEmptyWakeAndRemoteEndpoint()
    try testSettingsPersistAndCorruptionFailsExplicitly()
    try testSingletonExcludesSecondOwner()
    try testVoiceLifecycleRejectsDuplicateAndStaleResults()
    try testWakeGateAndUsageIntervals()
    try testDictationPolicies()
    try testGoogleNativePolicy()
    try testBargeInAndScheduledWordLedger()
    try testNoiseSuppressionAndSpeakerVoiceIdentification()
    print("Native invariant checks passed: endpoint restriction, settings persistence/corruption, singleton ownership, voice lifecycle/deduplication, exact wake gate, 'total shut down' standby gate, noise suppression & speaker voice ID, activity intervals, native dictation controls, and v0.7 full-duplex barge-in.")
}

static func testNoiseSuppressionAndSpeakerVoiceIdentification() throws {
    var identifier = SpeakerVoiceIdentifier()

    // 1. Enroll target speaker on wake phrase ("arise") with male fundamental frequency ~125 Hz
    let userWakeSummary = UtteranceAcousticSummary(
        frameCount: 20,
        speechFrameCount: 16,
        peakSnrDb: 14.5,
        meanSnrDb: 11.2,
        meanSpeechBandRatio: 0.84,
        meanF0Hz: 125.0,
        f0StdDevSemitones: 1.8,
        meanNearFieldRMS: 0.045
    )
    let wakeVerdict = identifier.evaluateUtterance(
        transcript: "arise",
        wakePhrase: "arise",
        summary: userWakeSummary,
        averageSegmentConfidence: 0.92
    )
    try check(wakeVerdict.accepted && identifier.isSpeakerLocked, "Wake phrase enrolls and locks target speaker F0")
    try check(abs(identifier.enrolledF0Hz - 125.0) < 1.0, "Enrolled speaker F0 matches ~125 Hz")

    // 2. Reject loud background music lyrics with heavy bass/treble (low speech-band ratio) or low SNR crest
    let musicFloorSummary = UtteranceAcousticSummary(
        frameCount: 30,
        speechFrameCount: 2,
        peakSnrDb: 3.1,
        meanSnrDb: 1.8,
        meanSpeechBandRatio: 0.42,
        meanF0Hz: 220.0,
        f0StdDevSemitones: 5.8,
        meanNearFieldRMS: 0.015
    )
    let musicVerdict = identifier.evaluateUtterance(
        transcript: "dancing in the moonlight",
        wakePhrase: "arise",
        summary: musicFloorSummary,
        averageSegmentConfidence: 0.45
    )
    try check(!musicVerdict.accepted, "Loud stationary music lyrics rejected by SNR crest and spectrum")

    // 3. Reject melodic singing vocals (high pitch variance > 4.2 semitones or mismatched speaker F0)
    let singingVocalSummary = UtteranceAcousticSummary(
        frameCount: 25,
        speechFrameCount: 18,
        peakSnrDb: 9.0,
        meanSnrDb: 7.0,
        meanSpeechBandRatio: 0.72,
        meanF0Hz: 245.0, // ~11.6 semitones above 125 Hz enrolled user
        f0StdDevSemitones: 5.1,
        meanNearFieldRMS: 0.020
    )
    let singingVerdict = identifier.evaluateUtterance(
        transcript: "never gonna give you up",
        wakePhrase: "arise",
        summary: singingVocalSummary,
        averageSegmentConfidence: 0.65
    )
    try check(!singingVerdict.accepted, "Melodic singing / non-target speaker F0 rejected")

    // 4. Accept genuine near-field utterance matching enrolled speaker (~128 Hz, conversational prosody)
    let userCommandSummary = UtteranceAcousticSummary(
        frameCount: 24,
        speechFrameCount: 20,
        peakSnrDb: 13.0,
        meanSnrDb: 10.4,
        meanSpeechBandRatio: 0.82,
        meanF0Hz: 128.0,
        f0StdDevSemitones: 2.1,
        meanNearFieldRMS: 0.042
    )
    let userVerdict = identifier.evaluateUtterance(
        transcript: "schedule my day for tomorrow",
        wakePhrase: "arise",
        summary: userCommandSummary,
        averageSegmentConfidence: 0.88
    )
    try check(userVerdict.accepted && userVerdict.reason == "verified_target_speaker", "Enrolled near-field user speech accepted")

    // 5. Priority stop phrase 'total shut down' always cuts through even during loud background music
    let emergencyStopVerdict = identifier.evaluateUtterance(
        transcript: "total shut down",
        wakePhrase: "arise",
        summary: musicFloorSummary,
        averageSegmentConfidence: 0.30
    )
    try check(emergencyStopVerdict.accepted && emergencyStopVerdict.reason == "priority_control_phrase", "'total shut down' bypasses music gate")
}

static func testBargeInAndScheduledWordLedger() throws {
    var ledger = ScheduledWordLedger()
    let clause0 = "You have two meetings tomorrow afternoon: "
    let clause1 = "The first is with Alex at two PM."
    ledger.registerClause(clauseIndex: 0, charStart: 0, text: clause0, estimatedDurationFrames: 48_000)
    ledger.registerClause(clauseIndex: 1, charStart: clause0.count, text: clause1, estimatedDurationFrames: 48_000)

    try check(ledger.spokenCharIndex(atSampleTime: 0) == 0, "Zero sample time reports zero chars")
    let midClause0 = ledger.spokenCharIndex(atSampleTime: 24_000)
    try check(midClause0 > 5 && midClause0 < clause0.count, "Mid-clause sample time maps inside Clause 0")
    let midClause1 = ledger.spokenCharIndex(atSampleTime: 72_000)
    try check(midClause1 > clause0.count && midClause1 <= clause0.count + clause1.count, "Sample time in Clause 1 maps across clause boundary")

    // Self-echo filter rejects >=80% match of playing text, but allows priority stop words
    try check(BargeInPolicy.isLikelySelfEcho(transcript: "two meetings tomorrow afternoon", currentlyPlayingText: clause0 + clause1), "Self-echo n-gram detected")
    try check(!BargeInPolicy.isLikelySelfEcho(transcript: "wait no make it Thursday", currentlyPlayingText: clause0 + clause1), "Genuine user interruption is not echo")
    try check(!BargeInPolicy.isLikelySelfEcho(transcript: "stop", currentlyPlayingText: "Please stop by the office"), "Priority stop word never suppressed by echo filter")

    // Pre-speech continuation stitching when user speaks before TTS starts
    var policy = BargeInPolicy(headphonesConnected: false)
    policy.beginThinking(turnId: "trn_pre")
    let preDecision = policy.evaluate(
        nowUptime: 10.0,
        hasVoiceEnergy: true,
        partialTranscript: "and invite Sarah",
        currentlyPlayingText: "",
        currentSampleTime: 0,
        ledger: ledger
    )
    try check(preDecision == .stitchPreSpeechContinuation(turnId: "trn_pre"), "Pre-speech continuation stitches turn")

    // Two-stage ducking -> restore on cough -> cut-through on real speech
    policy.beginSpeaking(turnId: "trn_speak")
    _ = policy.evaluate(nowUptime: 20.0, hasVoiceEnergy: true, partialTranscript: "", currentlyPlayingText: clause0, currentSampleTime: 24_000, ledger: ledger)
    let duckDecision = policy.evaluate(nowUptime: 20.15, hasVoiceEnergy: true, partialTranscript: "", currentlyPlayingText: clause0, currentSampleTime: 24_000, ledger: ledger)
    try check(duckDecision == .duckOutputVolume(0.15), "Stage 1 ducks volume at >=120ms energy")
    let restoreDecision = policy.evaluate(nowUptime: 20.20, hasVoiceEnergy: false, partialTranscript: "", currentlyPlayingText: clause0, currentSampleTime: 24_000, ledger: ledger)
    try check(restoreDecision == .restoreOutputVolume(1.0), "Cough with 0 tokens restores volume")

    let cutDecision = policy.evaluate(nowUptime: 21.0, hasVoiceEnergy: true, partialTranscript: "wait change that", currentlyPlayingText: clause0, currentSampleTime: 24_000, ledger: ledger)
    if case .cutThroughBargeIn(let tId, let charIdx, let reason) = cutDecision {
        try check(tId == "trn_speak" && charIdx == midClause0 && reason == "user_barge_in", "Stage 2 cuts through with sample-verified char index")
    } else {
        throw CheckFailure.assertion("Expected cutThroughBargeIn decision")
    }
}

static func testRejectsEmptyWakeAndRemoteEndpoint() throws {
    try rejects { _ = try WakePhrase.validated("  \n") }
    try rejects { _ = try LocalEndpoint.validated("https://example.com") }
    try rejects { _ = try LocalEndpoint.validated("http://localhost.attacker.test:4310") }
    try rejects { _ = try LocalEndpoint.validated("http://token@localhost:4310") }
    try check(try LocalEndpoint.validated("http://127.0.0.1:4310").host == "127.0.0.1", "Local endpoint accepted")
}

static func testSettingsPersistAndCorruptionFailsExplicitly() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = SettingsStore(url: directory.appendingPathComponent("settings.json"))
    try Data("{\"spokenReplies\":false}".utf8).write(to: { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); return store.url }())
    try check(try store.load().dictationEnabled == false, "Old settings migrate with dictation off")
    try store.save(NativeSettings(spokenReplies: false))
    try check(try store.load() == NativeSettings(spokenReplies: false), "Settings round trip")
    let permissions = try FileManager.default.attributesOfItem(atPath: store.url.path)[.posixPermissions] as? NSNumber
    try check(permissions?.intValue == 0o600, "Settings remain owner-only after atomic save")
    try check(try WakePhrase.validated("  computer  ") == "computer", "Wake phrase trim")
    try Data("broken".utf8).write(to: store.url)
    try rejects { _ = try store.load() }
}

static func testSingletonExcludesSecondOwner() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let owner = try InstanceLock(directory: directory)
    try withExtendedLifetime(owner) {
        try rejects { _ = try InstanceLock(directory: directory) }
    }
}

static func testVoiceLifecycleRejectsDuplicateAndStaleResults() throws {
    var voice = VoiceSession()
    let epoch = voice.begin()
    guard let first = voice.listen(generation: epoch) else { throw CheckFailure.assertion("Initial listening") }
    try check(voice.listen(generation: epoch) == nil, "Duplicate listening transition rejected")
    try check(voice.finalize(generation: epoch, turn: first), "Finalize once")
    try check(!voice.finalize(generation: epoch, turn: first), "Duplicate endpoint rejected")
    try check(voice.acceptFinal(generation: epoch, turn: first), "Accept final")
    try check(!voice.acceptFinal(generation: epoch, turn: first), "Duplicate final rejected")
    voice.speaking()
    guard let next = voice.listen(generation: epoch) else { throw CheckFailure.assertion("Follow-up listening") }
    try check(!voice.acceptFinal(generation: epoch, turn: first), "Stale previous turn rejected")
    try check(voice.accepts(generation: epoch, turn: next), "Current follow-up accepted")
    voice.close()
    try check(!voice.acceptFinal(generation: epoch, turn: next), "Final after stop rejected")
    try check(voice.listen(generation: epoch) == nil, "Permission/speech callback cannot reopen after stop")
    let newEpoch = voice.begin()
    try check(newEpoch != epoch, "New conversation generation")
    try check(!voice.accepts(generation: epoch, turn: next), "Old conversation rejected")
}
static func testDictationPolicies() throws {
    try check(try DictationPolicy.parse("Stop dictation.", terminal: false, multiline: true) == .stop, "D20/D21 whole stop control")
    try check(try DictationPolicy.parse("stop", terminal: false, multiline: true) == .text("stop"), "D20 bare stop is literal")
    try check(try DictationPolicy.parse("arise show tasks", terminal: false, multiline: true) == .text("arise show tasks"), "D20 wake stays literal")
    try check(try DictationPolicy.parse("literal phrase stop dictation", terminal: false, multiline: true) == .text("stop dictation"), "D21 escape precedes controls")
    try check(try DictationPolicy.parse("new paragraph", terminal: false, multiline: true) == .text("\n\n"), "D32 paragraph")
    try check(try DictationPolicy.parse("new line", terminal: true, multiline: false) == .text("new line"), "D18 terminal formatting literal")
    try rejects { _ = try DictationPolicy.parse("new line", terminal: false, multiline: false) }
    for text in ["ls\nrm", "ls\rrm", "ls\u{1b}", "ls\u{0}", "ls\u{2028}x", "ls\u{2029}x", "x\t", "ls\n", "ls\r", "ls\u{1b}"] {
        try rejects { _ = try DictationPolicy.parse(text, terminal: true, multiline: false) }
    }
    try rejects { _ = try DictationPolicy.parse(String(repeating: "a", count: 4097), terminal: false, multiline: true) }
    try check(DictationPolicy.payload("world", after: "hello") == " world", "D32 segmented spacing")
    try check(DictationPolicy.payload(",", after: "hello") == ",", "D32 punctuation joins")
    try check(DictationPolicy.payload("hello", after: "\n") == "hello", "D32 no leading space after newline")
    let pane = try DictationPolicy.verifiedTerminalIdentity(windowID: "10", sessionID: "session-a", atPrompt: true)
    let otherPane = try DictationPolicy.verifiedTerminalIdentity(windowID: "10", sessionID: "session-b", atPrompt: true)
    try check(pane != otherPane, "D09 changing iTerm session invalidates pane identity")
    try rejects { _ = try DictationPolicy.verifiedTerminalIdentity(windowID: "10", sessionID: "session-a", atPrompt: nil) }
    try rejects { _ = try DictationPolicy.verifiedTerminalIdentity(windowID: "10", sessionID: "session-a", atPrompt: false) }
    try rejects { _ = try DictationPolicy.verifiedTerminalIdentity(windowID: "10", sessionID: "session\na", atPrompt: true) }
    try rejects { _ = try DictationPolicy.verifiedTerminalIdentity(windowID: "", sessionID: "session-a", atPrompt: true) }
    let unicode = String(repeating: "😀e\u{301}", count: 30)
    let chunks = DictationPolicy.unicodeChunks(unicode)
    try check(chunks.joined() == unicode && chunks.allSatisfy { $0.utf16.count <= 32 }, "D10 Unicode scalars never split")
    var gate = VoiceSession()
    let generation = gate.begin(); let first = gate.listen(generation: generation)!
    try check(gate.acceptFinal(generation: generation, turn: first), "D31 first final accepted")
    try check(!gate.acceptFinal(generation: generation, turn: first), "D31 duplicate final denied")
    let second = gate.listen(generation: generation)!
    try check(gate.acceptFinal(generation: generation, turn: second), "D31 second turn with same words remains eligible")
    gate.close()
    try check(!gate.acceptFinal(generation: generation, turn: second), "D04 stop invalidates final")
}
static func testWakeGateAndUsageIntervals() throws {
    try check(WakeGate.command(in: "ARISE, show my tasks", phrase: "arise") == "show my tasks", "Inline command after configured wake preserved")
    try check(WakeGate.command(in: "hello arise", phrase: "arise") == "", "Wake only activates discussion")
    try check(WakeGate.command(in: "arises show my tasks", phrase: "arise") == nil, "Substring cannot activate")
    try check(WakeGate.command(in: "do not arise_more", phrase: "arise") == nil, "Identifier cannot activate")
    try check(WakeGate.command(in: "computer listen: add task review", phrase: "computer listen") == "add task review", "Multiword config")
    try check(WakeGate.command(in: "arise show tasks", phrase: "computer") == nil, "Old phrase not hidden trigger")
    try check(WakeGate.command(in: "anything", phrase: "  ") == nil, "Empty phrase cannot activate")
    var interval = UsageInterval()
    try check(interval.sample(now: 100, idleSeconds: 0, locked: false) == 0, "Initial activity unknown")
    try check(interval.sample(now: 130, idleSeconds: 20, locked: false) == 30, "Active interval accumulates")
    try check(interval.sample(now: 160, idleSeconds: 301, locked: false) == 0, "Real idle break resets bout")
    try check(interval.sample(now: 190, idleSeconds: 0, locked: true) == 0, "Locked time excluded")
    try check(interval.sample(now: 1000, idleSeconds: 0, locked: false) == 0, "Unknown/sleep gap excluded")
}
}
