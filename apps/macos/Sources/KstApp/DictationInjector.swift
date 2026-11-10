import AppKit
import ApplicationServices
import KstNativeCore

enum DictationDelivery: String { case verified = "VERIFIED", submittedUnverified = "SUBMITTED_UNVERIFIED", unknown = "UNKNOWN" }
struct DictationReceipt {
    let segmentID: String
    let method: String
    let outcome: DictationDelivery
    let text: String
    let range: CFRange
}

/// Never falls through to a different method after any side effect has been issued.
@MainActor
final class DictationInjector {
    func insert(_ text: String, segmentID: String, target: DictationTarget, admitted: @escaping () -> Bool) async -> DictationReceipt {
        let initial = target.expectedRange
        let inserted = CFRange(location: initial.location, length: text.utf16.count)
        let method = target.selectedTextSettable ? "AX_SELECTED_TEXT" : "CG_UNICODE"
        func receipt(_ outcome: DictationDelivery) -> DictationReceipt { DictationReceipt(segmentID: segmentID, method: method, outcome: outcome, text: text, range: inserted) }
        guard admitted(), await target.terminalValid(), admitted(), target.valid() else { return receipt(.unknown) }
        if target.selectedTextSettable {
            guard AXUIElementSetAttributeValue(target.element, kAXSelectedTextAttribute as CFString, text as CFString) == .success else { return receipt(.unknown) }
        } else {
            for chunk in DictationPolicy.unicodeChunks(text) {
                guard admitted(), await target.terminalValid(), admitted(), target.valid(checkRange: false), let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true), let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { return receipt(.unknown) }
                let utf16 = Array(chunk.utf16)
                down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
                up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
                down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                // Return to the main run loop so physical Stop/focus events can be admitted.
                try? await Task.sleep(for: .milliseconds(1))
            }
        }
        guard admitted(), target.valid(checkRange: false) else { return receipt(.unknown) }
        let expected = initial.location + text.utf16.count
        // Event delivery is asynchronous; a successful post is not an insertion acknowledgment.
        for _ in 0..<10 {
            guard admitted(), target.valid(checkRange: false) else { return receipt(.unknown) }
            if let range = DictationTarget.range(target.element), range.location == expected, range.length == 0 {
                target.expectedRange = range
                return receipt(target.fragment(inserted) == text ? .verified : .submittedUnverified)
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return receipt(.unknown)
    }
    func deleteLast(_ receipt: DictationReceipt, target: DictationTarget) -> Bool {
        guard receipt.outcome == .verified, receipt.method == "AX_SELECTED_TEXT", !target.terminal,
              target.valid(), target.fragment(receipt.range) == receipt.text,
              target.expectedRange.location == receipt.range.location + receipt.range.length,
              target.expectedRange.length == 0 else { return false }
        var range = receipt.range
        guard let value = AXValueCreate(.cfRange, &range),
              AXUIElementSetAttributeValue(target.element, kAXSelectedTextRangeAttribute as CFString, value) == .success else { return false }
        guard target.valid(checkRange: false), AXUIElementSetAttributeValue(target.element, kAXSelectedTextAttribute as CFString, "" as CFString) == .success,
              let current = DictationTarget.range(target.element), current.location == range.location, current.length == 0 else { return false }
        target.expectedRange = current
        return true
    }
}
