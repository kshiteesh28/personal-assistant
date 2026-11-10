import AppKit
import ApplicationServices
import Carbon.HIToolbox

struct DictationTargetError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// A short-lived RAM-only lease. No document/screen contents are retained.
@MainActor
final class DictationTarget {
    let pid: pid_t
    let bundleID: String
    let appName: String
    let element: AXUIElement
    let window: AXUIElement
    let role: String
    let subrole: String
    let document: String?
    let windowTitle: String?
    let elementIdentifier: String?
    let terminal: Bool
    let multiline: Bool
    let selectedTextSettable: Bool
    var expectedRange: CFRange
    var terminalPaneIdentity: TerminalPaneIdentity?

    static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
    }
    static func text(_ element: AXUIElement, _ name: String) -> String? {
        guard let result = attribute(element, name) as? String else { return nil }
        return String(result.prefix(1024))
    }
    static func ax(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        guard let result = attribute(element, name), CFGetTypeID(result) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(result, to: AXUIElement.self)
    }
    static func range(_ element: AXUIElement) -> CFRange? {
        guard let result = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(result) == AXValueGetTypeID() else { return nil }
        let value = unsafeDowncast(result, to: AXValue.self)
        var range = CFRange()
        guard AXValueGetType(value) == .cfRange, AXValueGetValue(value, .cfRange, &range), range.location >= 0, range.length >= 0 else { return nil }
        return range
    }
    static func capture() throws -> DictationTarget {
        guard AXIsProcessTrusted() else { throw DictationTargetError(message: "Enable Accessibility for kst in System Settings, refocus your field, then start again.") }
        guard !IsSecureEventInputEnabled() else { throw DictationTargetError(message: "Secure keyboard input is active. Dictation is unavailable in protected fields.") }
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              let bundleID = app.bundleIdentifier,
              !["com.apple.loginwindow", "com.apple.SecurityAgent"].contains(bundleID) else {
            throw DictationTargetError(message: "Focus an editable field in another app and press the dictation hotkey.")
        }
        let application = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.15)
        guard let window = ax(application, kAXFocusedWindowAttribute), let element = ax(application, kAXFocusedUIElementAttribute) else {
            throw DictationTargetError(message: "This app does not expose a focused editable field to Accessibility. Use manual input.")
        }
        AXUIElementSetMessagingTimeout(element, 0.15)
        return try DictationTarget(app: app, bundleID: bundleID, window: window, element: element)
    }
    private init(app: NSRunningApplication, bundleID: String, window: AXUIElement, element: AXUIElement) throws {
        self.pid = app.processIdentifier; self.bundleID = bundleID; appName = app.localizedName ?? bundleID
        self.element = element; self.window = window
        role = Self.text(element, kAXRoleAttribute) ?? ""
        subrole = Self.text(element, kAXSubroleAttribute) ?? ""
        guard !subrole.lowercased().contains("secure"), !subrole.lowercased().contains("password"),
              [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role),
              let range = Self.range(element) else {
            throw DictationTargetError(message: "This field is protected or does not expose reliable editing/caret information. Use manual input.")
        }
        guard (Self.attribute(element, kAXEnabledAttribute) as? Bool) != false else { throw DictationTargetError(message: "The focused field is disabled.") }
        document = Self.text(window, kAXDocumentAttribute)
        windowTitle = Self.text(window, kAXTitleAttribute)
        elementIdentifier = Self.text(element, kAXIdentifierAttribute)
        terminal = ["com.googlecode.iterm2", "com.apple.Terminal"].contains(bundleID)
        multiline = role == kAXTextAreaRole && !terminal
        expectedRange = range
        var settable = DarwinBoolean(false)
        selectedTextSettable = AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success && settable.boolValue
        // Terminal identities are bound asynchronously through read-only scripting.
        // AXIdentifier alone may be reused between panes, so it is not authority.
    }
    func valid(checkRange: Bool = true, requireTerminalIdentity: Bool = true) -> Bool {
        if terminal && requireTerminalIdentity && terminalPaneIdentity == nil { return false }
        guard AXIsProcessTrusted(), !IsSecureEventInputEnabled(),
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return false }
        let application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, 0.15)
        guard let focusedWindow = Self.ax(application, kAXFocusedWindowAttribute), CFEqual(focusedWindow, window),
              let focused = Self.ax(application, kAXFocusedUIElementAttribute), CFEqual(focused, element),
              Self.text(window, kAXDocumentAttribute) == document,
              Self.text(window, kAXTitleAttribute) == windowTitle,
              Self.text(element, kAXIdentifierAttribute) == elementIdentifier,
              Self.text(element, kAXSubroleAttribute) == subrole else { return false }
        guard !checkRange || Self.range(element).map({ $0.location == expectedRange.location && $0.length == expectedRange.length }) == true else { return false }
        return true
    }
    func terminalValid() async -> Bool {
        guard terminal else { return true }
        guard let terminalPaneIdentity else { return false }
        return (try? await TerminalPaneProbe.read(bundleID: bundleID)) == terminalPaneIdentity
    }
    func fragment(_ range: CFRange) -> String? {
        guard range.length <= 4096, range.length >= 0 else { return nil }
        var copy = range
        guard let value = AXValueCreate(.cfRange, &copy) else { return nil }
        var result: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(element, kAXStringForRangeParameterizedAttribute as CFString, value, &result) == .success else { return nil }
        return result as? String
    }
}
