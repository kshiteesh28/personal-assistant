import Foundation

/// Native-only deterministic formatting. Dictation text never enters the command model.
public enum DictationControl: Equatable, Sendable {
    case stop, pause, deleteLast, undoQuestion, text(String)
}
public enum DictationPolicyError: Error, Equatable { case tooLarge, forbiddenControl, notMultiline, terminalIdentityUnavailable, terminalPromptUnknown }
public enum DictationPolicy {
    public static func verifiedTerminalIdentity(windowID: String, sessionID: String, atPrompt: Bool?) throws -> String {
        guard !windowID.isEmpty, windowID.utf8.count <= 64, windowID.allSatisfy({ $0.isASCII && $0.isNumber }),
              !sessionID.isEmpty, sessionID.utf8.count <= 1024,
              !sessionID.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw DictationPolicyError.terminalIdentityUnavailable
        }
        guard atPrompt == true else { throw DictationPolicyError.terminalPromptUnknown }
        return windowID + "\n" + sessionID
    }
    public static func parse(_ recognized: String, terminal: Bool, multiline: Bool) throws -> DictationControl {
        try validate(recognized, terminal: terminal, multiline: multiline)
        let text = recognized.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.utf16.count <= 4096, text.utf8.count <= 16384 else { throw DictationPolicyError.tooLarge }
        var comparison = text.lowercased()
        if let last = comparison.last, ".!?".contains(last) { comparison.removeLast() }
        if comparison.hasPrefix("literal phrase ") {
            let payload = String(text.dropFirst("literal phrase ".count))
            try validate(payload, terminal: terminal, multiline: multiline)
            return .text(payload)
        }
        switch comparison {
        case "stop dictation": return .stop
        case "pause dictation": return .pause
        case "delete last dictation": if !terminal { return .deleteLast }
        case "undo that": if !terminal { return .undoQuestion }
        case "new line", "new paragraph":
            if !terminal {
                guard multiline else { throw DictationPolicyError.notMultiline }
                return .text(comparison == "new line" ? "\n" : "\n\n")
            }
        case "comma": if !terminal { return .text(",") }
        case "period": if !terminal { return .text(".") }
        case "question mark": if !terminal { return .text("?") }
        default: break
        }
        try validate(text, terminal: terminal, multiline: multiline)
        return .text(text)
    }
    public static func validate(_ text: String, terminal: Bool, multiline: Bool) throws {
        for scalar in text.unicodeScalars {
            let value = scalar.value
            if value < 32 || (127...159).contains(value) || value == 0x2028 || value == 0x2029 {
                if value == 10 && multiline && !terminal { continue }
                throw DictationPolicyError.forbiddenControl
            }
        }
    }
    public static func payload(_ text: String, after previous: String?) -> String {
        guard let a = previous?.unicodeScalars.last, let b = text.unicodeScalars.first else { return text }
        let end = CharacterSet.alphanumerics.contains(a) || ".,!?;:)]}’\"".unicodeScalars.contains(a)
        return end && CharacterSet.alphanumerics.contains(b) ? " " + text : text
    }
    public static func unicodeChunks(_ text: String, limit: Int = 32) -> [String] {
        precondition(limit >= 2)
        var chunks: [String] = [], current = "", units = 0
        for scalar in text.unicodeScalars {
            let length = scalar.value > 0xffff ? 2 : 1
            if units + length > limit { chunks.append(current); current = ""; units = 0 }
            current.unicodeScalars.append(scalar); units += length
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }
}
