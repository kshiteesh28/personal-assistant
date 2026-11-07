import Foundation

/// Pure lifecycle gate. Permission/hardware callbacks must match session and turn.
public struct VoiceSession: Sendable {
    public enum State: String, Sendable { case closed, permission, listening, finalizing, waiting, speaking }
    public private(set) var generation = 0
    public private(set) var turn = 0
    public private(set) var state: State = .closed
    public init() {}
    @discardableResult public mutating func begin() -> Int {
        generation += 1; turn = 0; state = .permission; return generation
    }
    public mutating func listen(generation expected: Int) -> Int? {
        guard expected == generation, [.permission, .waiting, .speaking].contains(state) else { return nil }
        turn += 1; state = .listening; return turn
    }
    public func accepts(generation expected: Int, turn expectedTurn: Int) -> Bool {
        expected == generation && expectedTurn == turn && [.listening, .finalizing].contains(state)
    }
    public mutating func finalize(generation expected: Int, turn expectedTurn: Int) -> Bool {
        guard accepts(generation: expected, turn: expectedTurn), state == .listening else { return false }
        state = .finalizing; return true
    }
    public mutating func acceptFinal(generation expected: Int, turn expectedTurn: Int) -> Bool {
        guard accepts(generation: expected, turn: expectedTurn) else { return false }
        state = .waiting; return true
    }
    public mutating func speaking() { if state == .waiting { state = .speaking } }
    public mutating func close() { generation += 1; state = .closed }
}
