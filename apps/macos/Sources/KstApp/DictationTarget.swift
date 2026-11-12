import AppKit
import ApplicationServices
import Carbon.HIToolbox

struct DictationTargetError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// A short-lived RAM-only lease. Supports both full Accessibility text elements (`AX_SELECTED_TEXT`)
/// and universal `CGEvent` Unicode keyboard injection (`CG_UNICODE`) into any focused macOS app
/// (including Safari web inputs, Notes, Mail, VS Code, Cursor, Slack, and TextEdit).
@MainActor
final class DictationTarget {
    let pid: pid_t
    let bundleID: String
    let appName: String
    let element: AXUIElement?
    let window: AXUIElement?
    let role: String
    let subrole: String
    let document: String?
    let windowTitle: String?
    let elementIdentifier: String?
    let terminal: Bool
    let multiline: Bool
    let selectedTextSettable: Bool
    let rangeTrackable: Bool
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
    static func range(_ element: AXUIElement?) -> CFRange? {
        guard let element, let result = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(result) == AXValueGetTypeID() else { return nil }
        let value = unsafeDowncast(result, to: AXValue.self)
        var range = CFRange()
        guard AXValueGetType(value) == .cfRange, AXValueGetValue(value, .cfRange, &range), range.location >= 0, range.length >= 0 else { return nil }
        return range
    }

    static func capture(preferredApp: NSRunningApplication? = nil) throws -> DictationTarget {
        guard AXIsProcessTrusted() else {
            throw DictationTargetError(message: "Enable Accessibility for kst in System Settings > Privacy & Security > Accessibility, then say “start typing” again.")
        }
        guard !IsSecureEventInputEnabled() else {
            throw DictationTargetError(message: "Secure keyboard input is active. Dictation is unavailable in password fields.")
        }

        var candidateApp = NSWorkspace.shared.frontmostApplication
        if candidateApp?.processIdentifier == ProcessInfo.processInfo.processIdentifier, let fallback = preferredApp, !fallback.isTerminated {
            fallback.activate()
            candidateApp = fallback
        }
        guard let app = candidateApp,
              let bundleID = app.bundleIdentifier,
              !["com.apple.loginwindow", "com.apple.SecurityAgent"].contains(bundleID) else {
            throw DictationTargetError(message: "Focus a window or text field and say “start typing”.")
        }

        let application = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.20)
        let window = ax(application, kAXFocusedWindowAttribute)
        let element = ax(application, kAXFocusedUIElementAttribute)
        if let element {
            AXUIElementSetMessagingTimeout(element, 0.20)
        }
        return try DictationTarget(app: app, bundleID: bundleID, window: window, element: element)
    }

    private init(app: NSRunningApplication, bundleID: String, window: AXUIElement?, element: AXUIElement?) throws {
        self.pid = app.processIdentifier
        self.bundleID = bundleID
        self.appName = app.localizedName ?? bundleID
        self.element = element
        self.window = window
        self.role = element.flatMap { Self.text($0, kAXRoleAttribute) } ?? "AXWindow"
        self.subrole = element.flatMap { Self.text($0, kAXSubroleAttribute) } ?? ""
        guard !subrole.lowercased().contains("secure"), !subrole.lowercased().contains("password") else {
            throw DictationTargetError(message: "Password and secure fields are blocked for dictation.")
        }
        if let element, let enabledAttr = Self.attribute(element, kAXEnabledAttribute) as? Bool, enabledAttr == false {
            throw DictationTargetError(message: "The focused field is disabled.")
        }
        self.document = window.flatMap { Self.text($0, kAXDocumentAttribute) }
        self.windowTitle = window.flatMap { Self.text($0, kAXTitleAttribute) }
        self.elementIdentifier = element.flatMap { Self.text($0, kAXIdentifierAttribute) }
        self.terminal = ["com.googlecode.iterm2", "com.apple.Terminal"].contains(bundleID)
        self.multiline = !terminal && (role == kAXTextAreaRole || role == "AXWebArea" || role == "AXGroup" || role == "AXWindow")
        if let detectedRange = Self.range(element) {
            self.expectedRange = detectedRange
            self.rangeTrackable = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role)
        } else {
            self.expectedRange = CFRange(location: 0, length: 0)
            self.rangeTrackable = false
        }
        var settable = DarwinBoolean(false)
        if let element, rangeTrackable {
            self.selectedTextSettable = AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success && settable.boolValue
        } else {
            self.selectedTextSettable = false
        }
    }

    func valid(checkRange: Bool = true, requireTerminalIdentity: Bool = true) -> Bool {
        if terminal && requireTerminalIdentity && terminalPaneIdentity == nil { return false }
        guard AXIsProcessTrusted(), !IsSecureEventInputEnabled() else { return false }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return false }
        if let element {
            let currentSubrole = Self.text(element, kAXSubroleAttribute) ?? ""
            if currentSubrole.lowercased().contains("secure") || currentSubrole.lowercased().contains("password") {
                return false
            }
        }
        if checkRange && rangeTrackable && selectedTextSettable {
            if let currentRange = Self.range(element) {
                return currentRange.location == expectedRange.location && currentRange.length == expectedRange.length
            }
        }
        return true
    }

    func terminalValid() async -> Bool {
        guard terminal else { return true }
        guard let terminalPaneIdentity else { return false }
        return (try? await TerminalPaneProbe.read(bundleID: bundleID)) == terminalPaneIdentity
    }

    func fragment(_ range: CFRange) -> String? {
        guard let element, range.length <= 4096, range.length >= 0 else { return nil }
        var copy = range
        guard let value = AXValueCreate(.cfRange, &copy) else { return nil }
        var result: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(element, kAXStringForRangeParameterizedAttribute as CFString, value, &result) == .success else { return nil }
        return result as? String
    }
}
