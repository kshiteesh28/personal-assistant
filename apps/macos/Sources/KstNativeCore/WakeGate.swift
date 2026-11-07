import Foundation

public enum WakeGate {
    /// Returns text after an exact configured word/phrase, or nil if absent.
    /// This is a local transcript gate, not a trained low-power keyword detector.
    public static func command(in transcript: String, phrase: String) -> String? {
        let words = phrase.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return nil }
        let escaped = words.map { NSRegularExpression.escapedPattern(for: String($0)) }.joined(separator: "\\s+")
        let pattern = "(?<![\\p{L}\\p{N}_])" + escaped + "(?![\\p{L}\\p{N}_])"
        guard let match = transcript.range(of: pattern, options: [.regularExpression, .caseInsensitive]) else { return nil }
        return String(transcript[match.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
    }
}
