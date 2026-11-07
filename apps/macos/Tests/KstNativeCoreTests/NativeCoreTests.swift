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
    try testRejectsEmptyWakeAndRemoteEndpoint()
    try testSettingsPersistAndCorruptionFailsExplicitly()
    try testSingletonExcludesSecondOwner()
    try testVoiceLifecycleRejectsDuplicateAndStaleResults()
    try testWakeGateAndUsageIntervals()
    print("Native invariant checks passed: endpoint restriction, settings persistence/corruption, singleton ownership, voice lifecycle/deduplication, exact wake gate, activity intervals.")
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
