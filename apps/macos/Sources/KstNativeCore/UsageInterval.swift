import Foundation

public struct UsageInterval: Sendable {
    public private(set) var activeSeconds = 0.0
    private var previous: Double?
    public init() {}
    public mutating func reset(now: Double) { previous = now; activeSeconds = 0 }
    public mutating func sample(now: Double, idleSeconds: Double, locked: Bool) -> Double {
        defer { previous = now }
        guard now.isFinite, idleSeconds.isFinite else { activeSeconds = 0; return 0 }
        guard !locked, idleSeconds < 300 else { activeSeconds = 0; return 0 }
        guard let previous else { return activeSeconds }
        let elapsed = now - previous
        guard elapsed >= 0, elapsed <= 60 else { activeSeconds = 0; return 0 }
        activeSeconds = min(86400, activeSeconds + elapsed)
        return activeSeconds
    }
}
