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

/// Types dictated text into the target app via Accessibility (`AX_SELECTED_TEXT`) when supported,
/// or universal `CGEvent` Unicode keystrokes (`CG_UNICODE`) for web apps, Notes, Electron apps, and editors.
@MainActor
final class DictationInjector {
    func insert(_ text: String, segmentID: String, target: DictationTarget, admitted: @escaping () -> Bool) async -> DictationReceipt {
        let initial = target.expectedRange
        let inserted = CFRange(location: initial.location, length: text.utf16.count)
        let useAX = target.selectedTextSettable && target.element != nil
        let method = useAX ? "AX_SELECTED_TEXT" : "CG_UNICODE"
        func receipt(_ outcome: DictationDelivery) -> DictationReceipt {
            DictationReceipt(segmentID: segmentID, method: method, outcome: outcome, text: text, range: inserted)
        }
        guard admitted(), await target.terminalValid(), admitted(), target.valid(checkRange: false) else {
            return receipt(.unknown)
        }
        if useAX, let element = target.element {
            if AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString) == .success {
                let expected = initial.location + text.utf16.count
                for _ in 0..<10 {
                    if let range = DictationTarget.range(element), range.location == expected {
                        target.expectedRange = range
                        return receipt(target.fragment(inserted) == text ? .verified : .submittedUnverified)
                    }
                    try? await Task.sleep(for: .milliseconds(10))
                }
                target.expectedRange = CFRange(location: expected, length: 0)
                return receipt(.submittedUnverified)
            }
        }

        // Universal CGEvent Unicode keyboard injection
        for chunk in DictationPolicy.unicodeChunks(text) {
            guard admitted(), await target.terminalValid(), admitted(), target.valid(checkRange: false),
                  let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                return receipt(.unknown)
            }
            let utf16 = Array(chunk.utf16)
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            try? await Task.sleep(for: .milliseconds(2))
        }
        let expected = initial.location + text.utf16.count
        if let range = DictationTarget.range(target.element) {
            target.expectedRange = range
        } else {
            target.expectedRange = CFRange(location: expected, length: 0)
        }
        return receipt(.submittedUnverified)
    }

    func deleteLast(_ receipt: DictationReceipt, target: DictationTarget) -> Bool {
        guard receipt.outcome == .verified, receipt.method == "AX_SELECTED_TEXT", !target.terminal,
              let element = target.element,
              target.valid(), target.fragment(receipt.range) == receipt.text,
              target.expectedRange.location == receipt.range.location + receipt.range.length,
              target.expectedRange.length == 0 else { return false }
        var range = receipt.range
        guard let value = AXValueCreate(.cfRange, &range),
              AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, value) == .success else { return false }
        guard target.valid(checkRange: false), AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, "" as CFString) == .success,
              let current = DictationTarget.range(element), current.location == range.location, current.length == 0 else { return false }
        target.expectedRange = current
        return true
    }
}
