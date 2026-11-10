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

public enum VoiceControl {
    public struct DictationStart: Equatable, Sendable {
        public let initialText: String?
        public init(initialText: String?) { self.initialText = initialText }
    }

    /// Explicit local handoff from assistant speech to foreground dictation.
    /// Text spoken after the control prefix is kept as the first dictation turn.
    /// This never routes the phrase or payload to a cloud model.
    public static func dictationStart(in transcript: String) -> DictationStart? {
        let commands = ["start typing for me", "start dictation", "begin dictation", "begin typing", "start typing"]
        let source = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        for command in commands {
            guard let range = source.range(of: command, options: [.anchored, .caseInsensitive]) else { continue }
            guard range.upperBound == source.endIndex || source[range.upperBound].isWhitespace || source[range.upperBound].isPunctuation else { continue }
            let rest = String(source[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            if ["now", "please"].contains(rest.lowercased()) { return DictationStart(initialText: nil) }
            return DictationStart(initialText: rest.isEmpty ? nil : rest)
        }
        return nil
    }

    /// A Stop coalesced with a bounded read cancels the turn; data payloads stay data.
    public static func isStop(_ transcript: String) -> Bool {
        let text = transcript.lowercased().trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        if ["stop", "stop listening", "disarm", "mute microphone"].contains(text) { return true }
        return text.range(of: "^(?:show|list) (?:my )?(?:tasks|notes|reminders|calendar|timeline)[,;.!? ]+stop(?: listening)?$", options: .regularExpression) != nil
    }
}
