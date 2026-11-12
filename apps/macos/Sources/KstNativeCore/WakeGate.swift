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
        let commands = [
            "start typing for me",
            "start dictation",
            "begin dictation",
            "begin typing",
            "start typing"
        ]
        let source = transcript
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^(?:hey\\s+kst[, ]+|arise[, ]+|please[, ]+|can you[, ]+|could you[, ]+)+", with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        for command in commands {
            guard let range = source.range(of: command, options: [.anchored, .caseInsensitive]) else { continue }
            guard range.upperBound == source.endIndex || source[range.upperBound].isWhitespace || source[range.upperBound].isPunctuation else { continue }
            let rest = String(source[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            if ["now", "please", "for me"].contains(rest.lowercased()) { return DictationStart(initialText: nil) }
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

    /// Detects the ‘total shut down’ / ‘total shutdown’ stop phrase that puts the assistant
    /// into wake-word standby until the wake phrase is spoken again.
    /// Literal payload prefixes (note, search, write, literal phrase) remain data.
    public static func isTotalShutdown(_ transcript: String) -> Bool {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let lowered = trimmed.lowercased()
        let literalPrefixes = ["note ", "search ", "browse ", "write ", "literal phrase ", "add task "]
        if literalPrefixes.contains(where: { lowered.hasPrefix($0) }) {
            return false
        }
        let pattern = "(?<![\\p{L}\\p{N}_])total\\s+shut\\s*-?\\s*down(?![\\p{L}\\p{N}_])"
        return lowered.range(of: pattern, options: .regularExpression) != nil
    }

    /// Fast-path complete commands that can finalize with minimal silence delay (~0.50s).
    public static func isFastCompleteCommand(_ transcript: String) -> Bool {
        let cleaned = transcript
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        guard !cleaned.isEmpty else { return false }
        if isStop(cleaned) || isTotalShutdown(cleaned) || dictationStart(in: cleaned) != nil {
            return true
        }
        let fastSet: Set<String> = [
            "plan my day", "schedule my day", "plan my schedule", "create a schedule plan",
            "make a schedule plan", "organize my day", "confirm plan", "apply plan",
            "show my calendar", "show calendar", "list calendar", "what is on my calendar", "what's on my calendar",
            "show my reminders", "show reminders", "list reminders", "what are my reminders",
            "show my tasks", "show tasks", "list tasks",
            "show my notes", "show notes", "list notes",
            "check unread mail", "check my unread mail", "read unread mail",
            "summarize this tab", "summarize this safari tab",
            "play music", "pause music", "resume music",
            "send it", "yes send it", "confirm send", "cancel send", "end conversation", "we're done"
        ]
        return fastSet.contains(cleaned)
    }

    /// Returns `true` when a spoken transcript looks like an unfinished mid-sentence clause
    /// so endpointing holds the turn open instead of cutting the user off mid-sentence.
    public static func isIncompleteUtterance(_ transcript: String) -> Bool {
        let cleaned = transcript
            .lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        guard !cleaned.isEmpty else { return false }
        if isFastCompleteCommand(cleaned) { return false }

        let incompleteOpeners: Set<String> = [
            "schedule", "schedule a", "schedule an", "schedule an event", "schedule a meeting",
            "schedule event", "schedule meeting", "schedule an event in my calendar",
            "schedule an event on my calendar", "schedule a meeting in my calendar",
            "schedule a meeting on my calendar", "add an event", "add an event to my calendar",
            "add event to my calendar", "create an event", "create an event in my calendar",
            "put on my calendar", "book a meeting", "remind me", "remind me to",
            "set a reminder", "set a reminder to", "add a reminder", "add a reminder to",
            "take a note", "write a note", "create a note", "note",
            "draft an email", "write an email", "send an email", "email",
            "send a message", "send a text", "text", "imessage",
            "can you", "could you", "would you", "please", "i want to", "i need to"
        ]
        if incompleteOpeners.contains(cleaned) { return true }

        let words = cleaned.split(separator: " ").map(String.init)
        guard let lastWord = words.last else { return false }

        let danglingTailWords: Set<String> = [
            "to", "for", "at", "on", "in", "into", "with", "about", "from", "by", "of",
            "and", "or", "but", "that", "saying", "called", "named", "titled", "regarding",
            "around", "between", "until", "after", "before",
            "a", "an", "the", "my", "our", "your", "his", "her", "their", "this", "these",
            "is", "are", "was", "were", "be", "can", "could", "would", "should", "will"
        ]
        return danglingTailWords.contains(lastWord)
    }
}
