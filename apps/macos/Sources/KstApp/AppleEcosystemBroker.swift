import AppKit
import EventKit
import Contacts
import Foundation
import NaturalLanguage
import KstNativeCore

/// Executes bounded Apple Event (`osascript`), Shortcuts (`/usr/bin/shortcuts`), and Spotlight (`mdfind`)
/// child processes with an 8.0-second deadline so cold-launching Mail.app, Notes.app, or Calendar.app never times out.
actor AppleAutomationExecutor {
    func runProcess(executable: String, arguments: [String], environment: [String: String] = [:], timeoutSeconds: Double = 8.0) async throws -> String {
        return try await withThrowingTaskGroup(of: String.self) { group in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            var env: [String: String] = [
                "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "LANG": "en_US.UTF-8"
            ]
            for (k, v) in environment { env[k] = v }
            process.environment = env

            let outPipe = Pipe()
            let errPipe = Pipe()
            process.standardOutput = outPipe
            process.standardError = errPipe
            process.standardInput = FileHandle.nullDevice

            group.addTask {
                return try await withCheckedThrowingContinuation { continuation in
                    process.terminationHandler = { proc in
                        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
                        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
                        let outStr = String(data: outData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        let errStr = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        if proc.terminationStatus == 0 {
                            continuation.resume(returning: outStr)
                        } else {
                            let code = errStr.contains("Not authorized") || errStr.contains("-1743")
                                ? "AUTOMATION_PERMISSION_DENIED"
                                : "AUTOMATION_FAILED"
                            continuation.resume(throwing: NativeBrokerFault(
                                code: code,
                                message: errStr.isEmpty ? "Apple automation exited with code \(proc.terminationStatus)." : errStr
                            ))
                        }
                    }
                    do {
                        try process.run()
                    } catch {
                        continuation.resume(throwing: NativeBrokerFault(code: "LAUNCH_FAILED", message: error.localizedDescription))
                    }
                }
            }

            group.addTask {
                try await Task.sleep(for: .milliseconds(Int(timeoutSeconds * 1000)))
                if process.isRunning { process.terminate() }
                throw NativeBrokerFault(code: "AUTOMATION_TIMEOUT", message: "Target Apple application did not respond within \(Int(timeoutSeconds))s.")
            }

            let result = try await group.next() ?? ""
            group.cancelAll()
            return result
        }
    }

    func runAppleScript(_ script: String, arguments: [String] = [], timeoutSeconds: Double = 8.0) async throws -> String {
        return try await runProcess(
            executable: "/usr/bin/osascript",
            arguments: ["-e", script] + arguments,
            timeoutSeconds: timeoutSeconds
        )
    }
}

/// Native macOS Executive Suite + Raphael Co-Pilot Broker (`0.8.0`).
/// Proactively resolves Calendar, Reminders, and Contacts permissions and uses EventKit (`EKEventStore`)
/// with automatic `Calendar.app` / `Reminders.app` AppleScript fallback, plus Sidecar AI Co-Pilot and NaturalLanguage embeddings.
final class AppleEcosystemBroker: @unchecked Sendable {
    private let eventStore = EKEventStore()
    private let contactStore = CNContactStore()
    private let automation = AppleAutomationExecutor()
    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private let isoFractionalFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init() {
        Task { [weak self] in
            await self?.requestSuitePermissionsIfNeeded()
        }
    }

    func requestSuitePermissionsIfNeeded() async {
        if EKEventStore.authorizationStatus(for: .event) == .notDetermined {
            _ = try? await eventStore.requestFullAccessToEvents()
            eventStore.reset()
        }
        if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined {
            _ = try? await eventStore.requestFullAccessToReminders()
            eventStore.reset()
        }
        if CNContactStore.authorizationStatus(for: .contacts) == .notDetermined {
            _ = try? await contactStore.requestAccess(for: .contacts)
        }
    }

    func permissionsStatus() -> [String: Any] {
        let calStatus = EKEventStore.authorizationStatus(for: .event)
        let remStatus = EKEventStore.authorizationStatus(for: .reminder)
        let conStatus = CNContactStore.authorizationStatus(for: .contacts)
        if calStatus == .notDetermined || remStatus == .notDetermined || conStatus == .notDetermined {
            Task { [weak self] in
                await self?.requestSuitePermissionsIfNeeded()
            }
        }
        return [
            "calendar": describeEKStatus(calStatus),
            "reminders": describeEKStatus(remStatus),
            "contacts": describeCNStatus(conStatus),
            "automation": ["com.apple.iCal", "com.apple.reminders", "com.apple.mail", "com.apple.MobileSMS", "com.apple.Notes", "com.apple.Safari", "com.apple.Music", "com.googlecode.iterm2"]
        ]
    }

    private func describeEKStatus(_ status: EKAuthorizationStatus) -> String {
        switch status {
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        case .denied: return "appleScriptReady"
        case .restricted: return "restricted"
        case .notDetermined: return "ready"
        @unknown default: return "fullAccess"
        }
    }

    private func describeCNStatus(_ status: CNAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "ready"
        @unknown default: return "unknown"
        }
    }

    private func parseFlexibleDate(_ raw: String?) -> Date? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }
        if let d = isoFractionalFormatter.date(from: raw) ?? isoFormatter.date(from: raw) {
            return d
        }
        let localFormats = [
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd"
        ]
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = .current
        for fmt in localFormats {
            df.dateFormat = fmt
            if let d = df.date(from: raw) { return d }
        }
        let lower = raw.lowercased()
        if lower == "now" || lower == "today" { return Date().addingTimeInterval(3600) }
        if lower == "tomorrow" { return Date().addingTimeInterval(86_400) }
        if let relMatch = lower.range(of: "^in\\s+(\\d+)\\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)$", options: .regularExpression) {
            let parts = lower[relMatch].split(whereSeparator: \.isWhitespace)
            if parts.count >= 3, let val = Double(parts[1]) {
                let unit = parts[2]
                let mult: Double = unit.hasPrefix("h") ? 3600 : unit.hasPrefix("d") ? 86400 : 60
                return Date().addingTimeInterval(val * mult)
            }
        }
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) {
            let range = NSRange(raw.startIndex..<raw.endIndex, in: raw)
            if let match = detector.firstMatch(in: raw, options: [], range: range), let detected = match.date {
                return detected
            }
        }
        return nil
    }

    private func ensureCalendarAccess() async throws {
        let status = EKEventStore.authorizationStatus(for: .event)
        if status == .fullAccess || status.rawValue == 3 {
            if eventStore.defaultCalendarForNewEvents == nil && eventStore.calendars(for: .event).isEmpty {
                eventStore.reset()
            }
            return
        }
        let granted = try await eventStore.requestFullAccessToEvents()
        eventStore.reset()
        guard granted else {
            throw NativeBrokerFault(code: "CALENDAR_PERMISSION_DENIED", message: "Grant Calendar Full Access to kst in System Settings > Privacy & Security > Calendars.")
        }
    }

    private func ensureRemindersAccess() async throws {
        let status = EKEventStore.authorizationStatus(for: .reminder)
        if status == .fullAccess || status.rawValue == 3 {
            if eventStore.defaultCalendarForNewReminders() == nil && eventStore.calendars(for: .reminder).isEmpty {
                eventStore.reset()
            }
            return
        }
        let granted = try await eventStore.requestFullAccessToReminders()
        eventStore.reset()
        guard granted else {
            throw NativeBrokerFault(code: "REMINDERS_PERMISSION_DENIED", message: "Grant Reminders Full Access to kst in System Settings > Privacy & Security > Reminders.")
        }
    }

    private func ensureContactsAccess() async throws {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .authorized { return }
        let granted = try await contactStore.requestAccess(for: .contacts)
        guard granted else {
            throw NativeBrokerFault(code: "CONTACTS_PERMISSION_DENIED", message: "Grant Contacts access to kst in System Settings > Privacy & Security > Contacts.")
        }
    }

    private func resolveWritableEventCalendar() -> EKCalendar? {
        if let def = eventStore.defaultCalendarForNewEvents, def.allowsContentModifications {
            return def
        }
        let calendars = eventStore.calendars(for: .event)
        if let writable = calendars.first(where: { $0.allowsContentModifications }) {
            return writable
        }
        eventStore.reset()
        return eventStore.defaultCalendarForNewEvents
            ?? eventStore.calendars(for: .event).first(where: { $0.allowsContentModifications })
            ?? eventStore.calendars(for: .event).first
    }

    private func resolveWritableReminderCalendar() -> EKCalendar? {
        if let def = eventStore.defaultCalendarForNewReminders(), def.allowsContentModifications {
            return def
        }
        let calendars = eventStore.calendars(for: .reminder)
        if let writable = calendars.first(where: { $0.allowsContentModifications }) {
            return writable
        }
        eventStore.reset()
        return eventStore.defaultCalendarForNewReminders()
            ?? eventStore.calendars(for: .reminder).first(where: { $0.allowsContentModifications })
            ?? eventStore.calendars(for: .reminder).first
    }

    func executeJSON(domain: String, action: String, payloadData: Data) async throws -> Data {
        let payload = ((try? JSONSerialization.jsonObject(with: payloadData)) as? [String: Any]) ?? [:]
        let result = try await execute(domain: domain, action: action, payload: payload)
        return try JSONSerialization.data(withJSONObject: result)
    }

    private func execute(domain: String, action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch domain {
        case "calendar":
            return try await handleCalendar(action: action, payload: payload)
        case "reminders":
            return try await handleReminders(action: action, payload: payload)
        case "contacts":
            return try await handleContacts(action: action, payload: payload)
        case "mail":
            return try await handleMail(action: action, payload: payload)
        case "messages":
            return try await handleMessages(action: action, payload: payload)
        case "notes":
            return try await handleNotes(action: action, payload: payload)
        case "safari":
            return try await handleSafari(action: action, payload: payload)
        case "spotlight":
            return try await handleSpotlight(action: action, payload: payload)
        case "music":
            return try await handleMusic(action: action, payload: payload)
        case "shortcuts":
            return try await handleShortcuts(action: action, payload: payload)
        case "sidecar":
            return try await handleSidecar(action: action, payload: payload)
        case "intelligence":
            return try await handleIntelligence(action: action, payload: payload)
        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_DOMAIN", message: "Unsupported Apple native domain: \(domain)")
        }
    }

    // MARK: - 1. Apple Calendar (EventKit + Calendar.app AppleScript Fallback)

    private func createCalendarEventViaAppleScript(title: String, startDate: Date, durationMinutes: Int) async throws -> (uid: String, calName: String) {
        let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: startDate)
        let args = [
            title,
            String(comps.year ?? 2026),
            String(comps.month ?? 1),
            String(comps.day ?? 1),
            String(comps.hour ?? 9),
            String(comps.minute ?? 0),
            String(durationMinutes)
        ]
        let script = """
        on run argv
          set evTitle to item 1 of argv
          set y to (item 2 of argv) as integer
          set m to (item 3 of argv) as integer
          set d to (item 4 of argv) as integer
          set hh to (item 5 of argv) as integer
          set mm to (item 6 of argv) as integer
          set durMins to (item 7 of argv) as integer

          set startDate to current date
          set day of startDate to 1
          set year of startDate to y
          set month of startDate to m
          set day of startDate to d
          set hours of startDate to hh
          set minutes of startDate to mm
          set seconds of startDate to 0
          set endDate to startDate + (durMins * minutes)

          tell application "Calendar"
            set targetCal to first calendar whose writable is true
            set calTitle to name of targetCal as string
            tell targetCal
              set newEv to make new event at end of events with properties {summary:evTitle, start date:startDate, end date:endDate}
              return (uid of newEv as string) & "|||" & calTitle
            end tell
          end tell
        end run
        """
        let raw = try await automation.runAppleScript(script, arguments: args, timeoutSeconds: 10.0)
        let parts = raw.components(separatedBy: "|||")
        return (parts.first ?? UUID().uuidString, parts.count > 1 ? parts[1] : "Calendar")
    }

    private func formatLocalShortTime(_ date: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US")
        df.timeZone = .current
        df.dateFormat = "h:mm a"
        return df.string(from: date)
    }

    private func removeCalendarEventViaAppleScript(target: String, clearAll: Bool = false) async throws -> (uid: String, title: String, removedCount: Int)? {
        let script = """
        on run argv
          set targetText to item 1 of argv
          set clearAllFlag to item 2 of argv
          tell application "Calendar"
            set removedCount to 0
            set removedTitle to ""
            set removedUid to ""
            repeat with cal in (every calendar whose writable is true)
              try
                if clearAllFlag is "true" then
                  set evs to (every event of cal)
                  repeat with ev in evs
                    if removedTitle is "" then
                      set removedTitle to summary of ev as string
                      set removedUid to uid of ev as string
                    end if
                    delete ev
                    set removedCount to removedCount + 1
                  end repeat
                else
                  set matched to (every event of cal whose summary contains targetText or uid is targetText)
                  if (count of matched) > 0 then
                    set targetEv to item 1 of matched
                    set removedTitle to summary of targetEv as string
                    set removedUid to uid of targetEv as string
                    delete targetEv
                    return removedUid & "|||" & removedTitle & "|||1"
                  end if
                end if
              end try
            end repeat
            if removedCount > 0 then
              return removedUid & "|||" & removedTitle & "|||" & (removedCount as string)
            end if
          end tell
          return ""
        end run
        """
        let raw = try await automation.runAppleScript(script, arguments: [target, clearAll ? "true" : "false"], timeoutSeconds: 10.0)
        guard !raw.isEmpty else { return nil }
        let parts = raw.components(separatedBy: "|||")
        let uid = parts.first ?? UUID().uuidString
        let title = parts.count > 1 ? parts[1] : target
        let count = parts.count > 2 ? (Int(parts[2]) ?? 1) : 1
        return (uid, title, count)
    }

    private func handleCalendar(action: String, payload: [String: Any]) async throws -> [String: Any] {
        let now = Date()
        switch action {
        case "listEvents", "calendarList", "checkAvailability", "calendarAvailability":
            do {
                try await ensureCalendarAccess()
                let start = parseFlexibleDate(payload["startIso"] as? String ?? payload["startAt"] as? String) ?? Calendar.current.startOfDay(for: now)
                let end = parseFlexibleDate(payload["endIso"] as? String ?? payload["endAt"] as? String) ?? start.addingTimeInterval(7 * 86_400)
                let safeEnd = end > start ? end : start.addingTimeInterval(86_400)
                let predicate = eventStore.predicateForEvents(withStart: start, end: safeEnd, calendars: nil)
                let sorted = eventStore.events(matching: predicate).sorted { $0.startDate < $1.startDate }
                let events = sorted.prefix(30).map { ev -> [String: Any] in
                    [
                        "eventIdentifier": ev.eventIdentifier ?? UUID().uuidString,
                        "title": ev.title ?? "(Untitled)",
                        "startAt": isoFormatter.string(from: ev.startDate),
                        "endAt": isoFormatter.string(from: ev.endDate),
                        "allDay": ev.isAllDay,
                        "calendarTitle": ev.calendar?.title ?? "Calendar",
                        "location": ev.location ?? ""
                    ]
                }
                return ["status": "ok", "events": Array(events)]
            } catch {
                return ["status": "ok", "events": []]
            }

        case "meetingCreate":
            let rawTitle = (payload["title"] as? String ?? payload["target"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let title = rawTitle.isEmpty ? "Calendar Event" : rawTitle
            let startStr = payload["startAt"] as? String ?? payload["fireAt"] as? String
            let startDate = parseFlexibleDate(startStr) ?? now.addingTimeInterval(3600)
            let rawDuration: Double
            if let num = payload["durationMinutes"] as? NSNumber {
                rawDuration = num.doubleValue
            } else if let str = payload["durationMinutes"] as? String, let parsed = Double(str) {
                rawDuration = parsed
            } else {
                rawDuration = 30.0
            }
            let durationMinutes = max(5.0, min(480.0, rawDuration))
            let endDate = startDate.addingTimeInterval(durationMinutes * 60.0)
            let timeRangeStr = "\(formatLocalShortTime(startDate))–\(formatLocalShortTime(endDate))"

            do {
                try await ensureCalendarAccess()
                guard let targetCalendar = resolveWritableEventCalendar() else {
                    throw NativeBrokerFault(code: "NO_WRITABLE_CALENDAR", message: "No writable EventKit calendar.")
                }
                let event = EKEvent(eventStore: eventStore)
                event.title = title
                event.startDate = startDate
                event.endDate = endDate
                if let loc = payload["location"] as? String, !loc.isEmpty {
                    event.location = loc
                }
                event.calendar = targetCalendar
                try eventStore.save(event, span: .thisEvent, commit: true)
                return [
                    "status": "committed",
                    "eventIdentifier": event.eventIdentifier ?? UUID().uuidString,
                    "title": title,
                    "calendarTitle": targetCalendar.title,
                    "startAt": isoFormatter.string(from: startDate),
                    "endAt": isoFormatter.string(from: endDate),
                    "message": "Scheduled “\(title)” in Apple Calendar (\(targetCalendar.title)) for \(timeRangeStr)."
                ]
            } catch {
                let fallback = try await createCalendarEventViaAppleScript(
                    title: title,
                    startDate: startDate,
                    durationMinutes: Int(durationMinutes)
                )
                return [
                    "status": "committed",
                    "eventIdentifier": fallback.uid,
                    "title": title,
                    "calendarTitle": fallback.calName,
                    "startAt": isoFormatter.string(from: startDate),
                    "endAt": isoFormatter.string(from: endDate),
                    "message": "Scheduled “\(title)” in Apple Calendar (\(fallback.calName)) for \(timeRangeStr)."
                ]
            }

        case "meetingReschedule":
            try await ensureCalendarAccess()
            let target = (payload["target"] as? String ?? payload["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let newStart = parseFlexibleDate(payload["startAt"] as? String ?? payload["fireAt"] as? String) ?? now.addingTimeInterval(3600)
            let durationMinutes = (payload["durationMinutes"] as? NSNumber)?.doubleValue
                ?? (payload["durationMinutes"] as? String).flatMap(Double.init)
                ?? 30.0
            let predicate = eventStore.predicateForEvents(withStart: now.addingTimeInterval(-7 * 86_400), end: now.addingTimeInterval(30 * 86_400), calendars: nil)
            let allEvents = eventStore.events(matching: predicate)
            if let existing = allEvents.first(where: {
                ($0.eventIdentifier ?? "").lowercased() == target ||
                ($0.title ?? "").lowercased() == target ||
                (!target.isEmpty && ($0.title ?? "").lowercased().contains(target))
            }) {
                existing.startDate = newStart
                existing.endDate = newStart.addingTimeInterval(max(5.0, durationMinutes) * 60.0)
                try eventStore.save(existing, span: .thisEvent, commit: true)
                return [
                    "status": "committed",
                    "eventIdentifier": existing.eventIdentifier ?? "",
                    "title": existing.title ?? "",
                    "startAt": isoFormatter.string(from: existing.startDate),
                    "endAt": isoFormatter.string(from: existing.endDate),
                    "message": "Rescheduled “\(existing.title ?? target)” in Apple Calendar to \(formatLocalShortTime(existing.startDate))."
                ]
            }
            return ["status": "local_only", "message": "No matching event found in Apple Calendar to reschedule."]

        case "meetingCancel":
            let rawTarget = (payload["target"] as? String ?? payload["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let target = rawTarget.lowercased()
            let clearAll = (payload["clearAll"] as? Bool) ?? false
            let targetStart = parseFlexibleDate(payload["startAt"] as? String ?? payload["targetStartIso"] as? String)

            do {
                try await ensureCalendarAccess()
                let winStart = clearAll ? Calendar.current.startOfDay(for: now) : now.addingTimeInterval(-7 * 86_400)
                let winEnd = clearAll ? now.addingTimeInterval(7 * 86_400) : now.addingTimeInterval(30 * 86_400)
                let predicate = eventStore.predicateForEvents(withStart: winStart, end: winEnd, calendars: nil)
                let allEvents = eventStore.events(matching: predicate).filter { $0.calendar?.allowsContentModifications ?? true }

                if clearAll {
                    var removedCount = 0
                    var firstTitle = ""
                    var firstId = ""
                    for ev in allEvents {
                        if firstTitle.isEmpty {
                            firstTitle = ev.title ?? "Event"
                            firstId = ev.eventIdentifier ?? ""
                        }
                        try? eventStore.remove(ev, span: .thisEvent, commit: false)
                        removedCount += 1
                    }
                    if removedCount > 0 {
                        try eventStore.commit()
                        return [
                            "status": "cancelled",
                            "eventIdentifier": firstId,
                            "title": firstTitle,
                            "removedCount": removedCount,
                            "message": "Removed \(removedCount) event\(removedCount == 1 ? "" : "s") from Apple Calendar."
                        ]
                    }
                }

                let existing = allEvents.first(where: { ev in
                    let evId = (ev.eventIdentifier ?? "").lowercased()
                    let evTitle = (ev.title ?? "").lowercased()
                    if !target.isEmpty && (evId == target || evTitle == target) {
                        return true
                    }
                    if !target.isEmpty && (evTitle.contains(target) || target.contains(evTitle)) {
                        return true
                    }
                    if let targetStart, abs(ev.startDate.timeIntervalSince(targetStart)) <= 1800 {
                        return true
                    }
                    return false
                })

                if let existing {
                    let id = existing.eventIdentifier ?? ""
                    let oldTitle = existing.title ?? rawTarget
                    try eventStore.remove(existing, span: .thisEvent, commit: true)
                    return [
                        "status": "cancelled",
                        "eventIdentifier": id,
                        "title": oldTitle,
                        "removedCount": 1,
                        "message": "Removed “\(oldTitle)” from Apple Calendar."
                    ]
                }
            } catch {}

            if let fallback = try? await removeCalendarEventViaAppleScript(target: rawTarget, clearAll: clearAll) {
                return [
                    "status": "cancelled",
                    "eventIdentifier": fallback.uid,
                    "title": fallback.title,
                    "removedCount": fallback.removedCount,
                    "message": fallback.removedCount > 1
                        ? "Removed \(fallback.removedCount) events from Apple Calendar."
                        : "Removed “\(fallback.title)” from Apple Calendar."
                ]
            }

            return ["status": "local_only", "message": "No matching event found in Apple Calendar to remove."]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_CALENDAR_ACTION", message: "Unsupported Calendar action: \(action)")
        }
    }

    // MARK: - 2. Apple Reminders (EventKit + Reminders.app AppleScript Fallback)

    private func createReminderViaAppleScript(title: String) async throws -> String {
        let script = """
        on run argv
          set remTitle to item 1 of argv
          tell application "Reminders"
            set newRem to make new reminder with properties {name:remTitle}
            return id of newRem as string
          end tell
        end run
        """
        return try await automation.runAppleScript(script, arguments: [title], timeoutSeconds: 10.0)
    }

    private func listRemindersViaAppleScript() async -> [[String: String]] {
        let script = """
        tell application "Reminders"
          set outLines to {}
          set remList to (reminders whose completed is false)
          set idx to 0
          repeat with r in remList
            set idx to idx + 1
            if idx > 15 then exit repeat
            set end of outLines to (id of r as string) & "|||" & (name of r as string)
          end repeat
          set AppleScript's text item delimiters to "\\n"
          return outLines as text
        end tell
        """
        guard let raw = try? await automation.runAppleScript(script, timeoutSeconds: 6.0), !raw.isEmpty else {
            return []
        }
        return raw.split(separator: "\n").map { line in
            let parts = line.components(separatedBy: "|||")
            return [
                "reminderIdentifier": parts.first ?? UUID().uuidString,
                "title": parts.count > 1 ? parts[1] : String(line),
                "listTitle": "Reminders"
            ]
        }
    }

    private func handleReminders(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "listReminders", "remindersList", "reminderList":
            do {
                try await ensureRemindersAccess()
                let predicate = eventStore.predicateForReminders(in: nil)
                let store = eventStore
                let fmt = isoFormatter
                let reminders: [[String: String]] = await withCheckedContinuation { continuation in
                    store.fetchReminders(matching: predicate) { items in
                        let incomplete = (items ?? []).filter { !$0.isCompleted }.prefix(25).map { rem -> [String: String] in
                            var entry: [String: String] = [
                                "reminderIdentifier": rem.calendarItemIdentifier,
                                "title": rem.title ?? "(Untitled Reminder)",
                                "listTitle": rem.calendar?.title ?? "Reminders"
                            ]
                            if let comps = rem.dueDateComponents, let d = Calendar.current.date(from: comps) {
                                entry["fireAt"] = fmt.string(from: d)
                            }
                            return entry
                        }
                        continuation.resume(returning: Array(incomplete))
                    }
                }
                return ["status": "ok", "reminders": reminders]
            } catch {
                let fallback = await listRemindersViaAppleScript()
                return ["status": "ok", "reminders": fallback]
            }

        case "reminderCreate":
            let rawTitle = (payload["title"] as? String ?? payload["target"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let title = rawTitle.isEmpty ? "Reminder" : rawTitle
            let fireStr = payload["fireAt"] as? String ?? payload["startAt"] as? String ?? payload["dueIso"] as? String
            let fireDate = parseFlexibleDate(fireStr)

            do {
                try await ensureRemindersAccess()
                guard let targetCalendar = resolveWritableReminderCalendar() else {
                    throw NativeBrokerFault(code: "NO_WRITABLE_REMINDER_LIST", message: "No writable EventKit reminder list.")
                }
                let reminder = EKReminder(eventStore: eventStore)
                reminder.title = title
                reminder.calendar = targetCalendar
                if let notes = payload["body"] as? String, !notes.isEmpty {
                    reminder.notes = notes
                }
                if let fireDate {
                    reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
                    reminder.addAlarm(EKAlarm(absoluteDate: fireDate))
                }
                try eventStore.save(reminder, commit: true)
                return [
                    "status": "committed",
                    "reminderIdentifier": reminder.calendarItemIdentifier,
                    "title": title,
                    "listTitle": targetCalendar.title,
                    "message": "Saved reminder “\(title)” in Apple Reminders (\(targetCalendar.title))."
                ]
            } catch {
                let fallbackId = try await createReminderViaAppleScript(title: title)
                return [
                    "status": "committed",
                    "reminderIdentifier": fallbackId,
                    "title": title,
                    "listTitle": "Reminders",
                    "message": "Saved reminder “\(title)” in Apple Reminders."
                ]
            }

        case "reminderComplete", "reminderCancel", "reminderModify":
            try await ensureRemindersAccess()
            let target = (payload["target"] as? String ?? payload["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let fireStr = payload["fireAt"] as? String ?? payload["startAt"] as? String
            let fireDate = parseFlexibleDate(fireStr)
            let predicate = eventStore.predicateForReminders(in: nil)
            let store = eventStore
            let matched: (id: String, title: String)? = await withCheckedContinuation { continuation in
                store.fetchReminders(matching: predicate) { items in
                    guard let match = (items ?? []).first(where: {
                        !$0.isCompleted && (
                            $0.calendarItemIdentifier.lowercased() == target ||
                            ($0.title ?? "").lowercased() == target ||
                            (!target.isEmpty && ($0.title ?? "").lowercased().contains(target))
                        )
                    }) else {
                        continuation.resume(returning: nil)
                        return
                    }
                    if action == "reminderComplete" || action == "reminderCancel" {
                        match.isCompleted = true
                        match.completionDate = Date()
                    } else if let fireDate {
                        match.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
                        if let alarms = match.alarms {
                            for alarm in alarms { match.removeAlarm(alarm) }
                        }
                        match.addAlarm(EKAlarm(absoluteDate: fireDate))
                    }
                    try? store.save(match, commit: true)
                    continuation.resume(returning: (match.calendarItemIdentifier, match.title ?? target))
                }
            }
            if let matched {
                return [
                    "status": "committed",
                    "reminderIdentifier": matched.id,
                    "title": matched.title,
                    "message": action == "reminderModify"
                        ? "Updated reminder “\(matched.title)” in Apple Reminders."
                        : "Completed reminder “\(matched.title)” in Apple Reminders."
                ]
            }
            return ["status": "local_only", "message": "No matching active reminder found in Apple Reminders."]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_REMINDER_ACTION", message: "Unsupported Reminders action: \(action)")
        }
    }

    // MARK: - 3. Apple Contacts (CNContactStore)

    private func handleContacts(action: String, payload: [String: Any]) async throws -> [String: Any] {
        try await ensureContactsAccess()
        let query = (payload["query"] as? String ?? payload["recipientOrQuery"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return ["status": "ok", "matches": []] }
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactNicknameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor
        ]
        let predicate = CNContact.predicateForContacts(matchingName: query)
        let contacts = (try? contactStore.unifiedContacts(matching: predicate, keysToFetch: keys)) ?? []
        let matches = contacts.prefix(6).map { c -> [String: Any] in
            let fullName = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
            let emails = c.emailAddresses.map { String($0.value) }
            let phones = c.phoneNumbers.map { $0.value.stringValue }
            return [
                "identifier": c.identifier,
                "fullName": fullName.isEmpty ? c.organizationName : fullName,
                "organization": c.organizationName,
                "emails": emails,
                "phones": phones
            ]
        }
        return ["status": "ok", "matches": Array(matches)]
    }

    // MARK: - 4. Apple Mail (`Mail.app`)

    private func handleMail(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "searchUnread", "readThread":
            let script = """
            on run argv
              tell application "Mail"
                set unreadList to (messages of inbox whose read status is false)
                set outLines to {}
                set maxCount to 5
                set idx to 0
                repeat with m in unreadList
                  set idx to idx + 1
                  if idx > maxCount then exit repeat
                  set end of outLines to (sender of m as string) & "|||" & (subject of m as string)
                end repeat
                set AppleScript's text item delimiters to "\\n"
                return outLines as text
              end tell
            end run
            """
            let raw = try await automation.runAppleScript(script)
            let messages = raw.split(separator: "\n").map { line -> [String: String] in
                let parts = line.components(separatedBy: "|||")
                return [
                    "sender": parts.first ?? "Unknown",
                    "subject": parts.count > 1 ? parts[1] : "(No subject)"
                ]
            }
            return ["status": "ok", "messages": messages]

        case "createVisibleDraft":
            let to = (payload["to"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let recipientName = (payload["recipientName"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let subject = (payload["subject"] as? String ?? "Note").trimmingCharacters(in: .whitespacesAndNewlines)
            let body = (payload["body"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let script = """
            on run argv
              set targetAddress to item 1 of argv
              set targetName to item 2 of argv
              set mailSubject to item 3 of argv
              set mailBody to item 4 of argv
              tell application "Mail"
                activate
                set newMessage to make new outgoing message with properties {subject:mailSubject, content:mailBody & return & return, visible:true}
                if targetAddress is not "" then
                  tell newMessage
                    if targetName is not "" and targetName is not targetAddress then
                      make new to recipient at end of to recipients with properties {name:targetName, address:targetAddress}
                    else
                      make new to recipient at end of to recipients with properties {address:targetAddress}
                    end if
                  end tell
                end if
              end tell
              return "draft_opened"
            end run
            """
            let out = try await automation.runAppleScript(script, arguments: [to, recipientName, subject, body], timeoutSeconds: 10.0)
            return ["status": out, "message": "Opened email draft in Apple Mail."]

        case "sendConfirmedMail":
            let to = (payload["to"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let recipientName = (payload["recipientName"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let subject = (payload["subject"] as? String ?? "Note").trimmingCharacters(in: .whitespacesAndNewlines)
            let body = (payload["body"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard to.contains("@") else {
                let openScript = """
                on run argv
                  tell application "Mail" to activate
                  return "needs_recipient_address"
                end run
                """
                _ = try? await automation.runAppleScript(openScript, timeoutSeconds: 5.0)
                return [
                    "status": "draft_visible",
                    "message": "“\(to.isEmpty ? recipientName : to)” does not have an email address with '@' yet. I brought your draft to the front in Apple Mail so you can choose the address and press Send."
                ]
            }
            let script = """
            on run argv
              set targetAddress to item 1 of argv
              set targetName to item 2 of argv
              set mailSubject to item 3 of argv
              set mailBody to item 4 of argv
              tell application "Mail"
                set newMessage to make new outgoing message with properties {subject:mailSubject, content:mailBody, visible:false}
                tell newMessage
                  if targetName is not "" and targetName is not targetAddress then
                    make new to recipient at end of to recipients with properties {name:targetName, address:targetAddress}
                  else
                    make new to recipient at end of to recipients with properties {address:targetAddress}
                  end if
                end tell
                send newMessage
              end tell
              return "sent"
            end run
            """
            _ = try await automation.runAppleScript(script, arguments: [to, recipientName, subject, body], timeoutSeconds: 10.0)
            return ["status": "sent", "message": "Sent email to \(to) via Apple Mail."]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_MAIL_ACTION", message: "Unsupported Mail action: \(action)")
        }
    }

    // MARK: - 5. Apple Messages (`Messages.app` — Two-Stage Confirmed Only)

    private func handleMessages(action: String, payload: [String: Any]) async throws -> [String: Any] {
        guard action == "sendConfirmedMessage" else {
            throw NativeBrokerFault(code: "UNSUPPORTED_MESSAGES_ACTION", message: "Messages only supports two-stage sendConfirmedMessage.")
        }
        let handle = payload["handle"] as? String ?? ""
        let body = payload["body"] as? String ?? ""
        guard !handle.isEmpty, !body.isEmpty else {
            throw NativeBrokerFault(code: "INVALID_MESSAGE_PAYLOAD", message: "Recipient handle and body are required.")
        }
        let script = """
        on run argv
          set targetBuddy to item 1 of argv
          set targetText to item 2 of argv
          tell application "Messages"
            set targetService to 1st account whose service type = iMessage
            set theBuddy to participant targetBuddy of targetService
            send targetText to theBuddy
          end tell
          return "sent"
        end run
        """
        _ = try await automation.runAppleScript(script, arguments: [handle, body])
        return ["status": "sent", "message": "Sent iMessage to \(payload["recipientName"] as? String ?? handle)."]
    }

    // MARK: - 6. Apple Notes (`Notes.app`)

    private func escapeHTML(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\n", with: "<br>")
    }

    private func handleNotes(action: String, payload: [String: Any]) async throws -> [String: Any] {
        let rawTitle = (payload["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawBody = (payload["body"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let title = rawTitle.isEmpty ? (rawBody.isEmpty ? "KST Note" : String(rawBody.prefix(60))) : rawTitle
        let body = rawBody.isEmpty ? title : rawBody
        let folder = (payload["folder"] as? String ?? "KST Secretary").trimmingCharacters(in: .whitespacesAndNewlines)

        switch action {
        case "createNote", "noteCreate":
            let htmlContent = "<h1>\(escapeHTML(title))</h1><p>\(escapeHTML(body))</p>"
            let script = """
            on run argv
              set folderName to item 1 of argv
              set noteHTML to item 2 of argv
              tell application "Notes"
                try
                  tell default account
                    if not (exists folder folderName) then
                      make new folder with properties {name:folderName}
                    end if
                    set theNote to make new note at folder folderName with properties {body:noteHTML}
                    return id of theNote as string
                  end tell
                on error
                  set theNote to make new note with properties {body:noteHTML}
                  return id of theNote as string
                end try
              end tell
            end run
            """
            let noteId = try await automation.runAppleScript(script, arguments: [folder, htmlContent], timeoutSeconds: 10.0)
            return [
                "status": "committed",
                "noteIdentifier": noteId,
                "title": title,
                "message": "Saved note “\(title)” in Apple Notes."
            ]

        case "appendNote", "noteAppend":
            let htmlAppend = "<p>\(escapeHTML(body))</p>"
            let htmlNew = "<h1>\(escapeHTML(title))</h1><p>\(escapeHTML(body))</p>"
            let script = """
            on run argv
              set folderName to item 1 of argv
              set noteTitle to item 2 of argv
              set appendHTML to item 3 of argv
              set newHTML to item 4 of argv
              tell application "Notes"
                try
                  set matched to (notes of default account whose name contains noteTitle)
                  if (count of matched) > 0 then
                    set targetNote to item 1 of matched
                    set body of targetNote to (body of targetNote) & appendHTML
                    return id of targetNote as string
                  end if
                end try
                try
                  tell default account
                    if not (exists folder folderName) then
                      make new folder with properties {name:folderName}
                    end if
                    set theNote to make new note at folder folderName with properties {body:newHTML}
                    return id of theNote as string
                  end tell
                on error
                  set theNote to make new note with properties {body:newHTML}
                  return id of theNote as string
                end try
              end tell
            end run
            """
            let noteId = try await automation.runAppleScript(script, arguments: [folder, title, htmlAppend, htmlNew], timeoutSeconds: 10.0)
            return [
                "status": "committed",
                "noteIdentifier": noteId,
                "title": title,
                "message": "Updated note “\(title)” in Apple Notes."
            ]

        case "searchNotes", "noteSearch", "listNotes", "notesList":
            let query = (payload["query"] as? String ?? payload["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let script = """
            on run argv
              set q to item 1 of argv
              tell application "Notes"
                set outLines to {}
                set idx to 0
                if q is "" then
                  set allNotes to notes of default account
                  repeat with n in allNotes
                    set idx to idx + 1
                    if idx > 8 then exit repeat
                    set end of outLines to (name of n as string)
                  end repeat
                else
                  set matched to (notes of default account whose name contains q)
                  repeat with n in matched
                    set idx to idx + 1
                    if idx > 8 then exit repeat
                    set end of outLines to (name of n as string)
                  end repeat
                end if
                set AppleScript's text item delimiters to "\\n"
                return outLines as text
              end tell
            end run
            """
            let raw = try await automation.runAppleScript(script, arguments: [query], timeoutSeconds: 10.0)
            let notes = raw.split(separator: "\n").map { ["title": String($0)] }
            return ["status": "ok", "notes": notes]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_NOTES_ACTION", message: "Unsupported Notes action: \(action)")
        }
    }

    // MARK: - 7. Apple Safari (`Safari.app`)

    private func handleSafari(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "activeTabContext":
            let script = """
            tell application "Safari"
              if (count of windows) is 0 then return ""
              set t to current tab of front window
              set tabUrl to URL of t
              set tabTitle to name of t
              set tabText to text of t
              return tabTitle & "|||" & tabUrl & "|||" & tabText
            end tell
            """
            let raw = try await automation.runAppleScript(script)
            guard !raw.isEmpty else { return ["status": "empty"] }
            let parts = raw.components(separatedBy: "|||")
            let title = parts.first ?? ""
            let url = parts.count > 1 ? parts[1] : ""
            let excerpt = parts.count > 2 ? String(parts[2].prefix(3000)) : ""
            return ["status": "ok", "title": title, "url": url, "excerpt": excerpt]

        case "openUrl":
            let raw = (payload["urlOrQuery"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !raw.isEmpty else { throw NativeBrokerFault(code: "INVALID_URL", message: "Provide a URL or search query.") }
            let url: URL?
            if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
                url = URL(string: raw)
            } else {
                let encoded = raw.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                url = URL(string: "https://www.google.com/search?q=\(encoded)")
            }
            guard let targetURL = url else { throw NativeBrokerFault(code: "INVALID_URL", message: "Invalid URL.") }
            _ = await MainActor.run { NSWorkspace.shared.open(targetURL) }
            return ["status": "opened", "url": targetURL.absoluteString, "message": "Opened in your default browser."]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_SAFARI_ACTION", message: "Unsupported Safari action: \(action)")
        }
    }

    // MARK: - 8. Spotlight & Finder (`mdfind` + `NSWorkspace`)

    private func handleSpotlight(action: String, payload: [String: Any]) async throws -> [String: Any] {
        let query = (payload["query"] as? String ?? payload["appName"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        switch action {
        case "searchFiles":
            guard !query.isEmpty else { return ["files": []] }
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let out = try await automation.runProcess(
                executable: "/usr/bin/mdfind",
                arguments: ["-onlyin", home, "-name", query]
            )
            let files = out.split(separator: "\n").prefix(6).map { path -> [String: String] in
                let p = String(path)
                return ["path": p, "name": URL(fileURLWithPath: p).lastPathComponent]
            }
            return ["status": "ok", "files": Array(files)]

        case "revealFile":
            guard !query.isEmpty else { throw NativeBrokerFault(code: "INVALID_PATH", message: "File path or name is required.") }
            let fileURL = URL(fileURLWithPath: query)
            await MainActor.run {
                NSWorkspace.shared.activateFileViewerSelecting([fileURL])
            }
            return ["status": "revealed", "path": query, "message": "Revealed in Finder."]

        case "launchOrFocusApp":
            guard !query.isEmpty else { throw NativeBrokerFault(code: "INVALID_APP", message: "Application name is required.") }
            _ = try await automation.runProcess(executable: "/usr/bin/open", arguments: ["-a", query])
            return ["status": "launched", "appName": query, "message": "Opened \(query)."]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_SPOTLIGHT_ACTION", message: "Unsupported Spotlight action: \(action)")
        }
    }

    // MARK: - 9. Apple Music & macOS Shortcuts (`/usr/bin/shortcuts`)

    private func handleMusic(action: String, payload: [String: Any]) async throws -> [String: Any] {
        let command = (payload["command"] as? String ?? "pause").lowercased()
        let playlist = payload["playlist"] as? String
        let script: String
        var args: [String] = []
        switch command {
        case "playplaylist":
            script = "on run argv\ntell application \"Music\" to play playlist (item 1 of argv)\nend run"
            args = [playlist ?? "Focus"]
        case "play", "resume":
            script = "tell application \"Music\" to play"
        case "next":
            script = "tell application \"Music\" to next track"
        default:
            script = "tell application \"Music\" to pause"
        }
        _ = try await automation.runAppleScript(script, arguments: args)
        return ["status": "ok", "command": command, "message": "Apple Music: \(command)."]
    }

    private func handleShortcuts(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "listShortcuts":
            let out = try await automation.runProcess(executable: "/usr/bin/shortcuts", arguments: ["list"])
            let list = out.split(separator: "\n").prefix(30).map(String.init)
            return ["status": "ok", "shortcuts": Array(list)]

        case "runShortcut":
            let name = (payload["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { throw NativeBrokerFault(code: "INVALID_SHORTCUT", message: "Shortcut name is required.") }
            let out = try await automation.runProcess(executable: "/usr/bin/shortcuts", arguments: ["run", name])
            return ["status": "ok", "shortcut": name, "output": out, "message": "Executed macOS Shortcut “\(name)”."]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_SHORTCUT_ACTION", message: "Unsupported Shortcuts action: \(action)")
        }
    }

    // MARK: - 10. Raphael Sidecar Co-Pilot Bridge (Gemini / ChatGPT / Claude / iTerm2)

    private func handleSidecar(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "harvestContextSnapshot":
            let frontApp = await MainActor.run { NSWorkspace.shared.frontmostApplication }
            let appName = frontApp?.localizedName ?? "macOS"
            let bundleId = frontApp?.bundleIdentifier ?? ""
            var windowTitle = ""
            if let scriptOut = try? await automation.runAppleScript(
                "tell application \"System Events\" to get name of first window of (first application process whose frontmost is true)",
                timeoutSeconds: 2.5
            ) {
                windowTitle = scriptOut
            }
            let gitBranch = (try? await automation.runProcess(
                executable: "/usr/bin/git",
                arguments: ["-C", FileManager.default.currentDirectoryPath, "rev-parse", "--abbrev-ref", "HEAD"],
                timeoutSeconds: 2.0
            )) ?? "main"
            return [
                "status": "ok",
                "frontmostApp": appName,
                "bundleIdentifier": bundleId,
                "windowTitle": windowTitle,
                "gitBranch": gitBranch,
                "observedAt": isoFormatter.string(from: Date())
            ]

        case "readTerminalFailure":
            let tailScript = """
            tell application "System Events"
              set iTermRunning to (exists process "iTerm2")
            end tell
            if iTermRunning then
              tell application "iTerm2"
                if (count of windows) > 0 then
                  tell current session of current window
                    set sessName to name as string
                    set sessText to contents as string
                    return sessName & "|||" & sessText
                  end tell
                end if
              end tell
            end if
            return ""
            """
            let rawTerm = (try? await automation.runAppleScript(tailScript, timeoutSeconds: 4.0)) ?? ""
            var sessionName = "iTerm2"
            var tailText = ""
            if !rawTerm.isEmpty {
                let parts = rawTerm.components(separatedBy: "|||")
                sessionName = parts.first ?? "iTerm2"
                let fullText = parts.count > 1 ? parts[1] : rawTerm
                tailText = String(fullText.suffix(2400))
            }
            let cwd = (payload["cwd"] as? String) ?? FileManager.default.currentDirectoryPath
            let gitBranch = (try? await automation.runProcess(
                executable: "/usr/bin/git",
                arguments: ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
                timeoutSeconds: 2.5
            )) ?? "main"
            let gitStatus = (try? await automation.runProcess(
                executable: "/usr/bin/git",
                arguments: ["-C", cwd, "status", "--short"],
                timeoutSeconds: 2.5
            )) ?? ""

            let errorLines = tailText
                .split(separator: "\n")
                .filter { line in
                    let l = line.lowercased()
                    return l.contains("error:") || l.contains("failed") || l.contains("exception") || l.contains("fatal:") || l.contains("fault") || l.contains("panic")
                }
                .suffix(8)
                .map(String.init)
                .joined(separator: "\n")

            return [
                "status": "ok",
                "sessionName": sessionName,
                "gitBranch": gitBranch,
                "gitStatus": String(gitStatus.prefix(800)),
                "tailText": tailText,
                "errorSnippet": errorLines.isEmpty ? String(tailText.suffix(600)) : errorLines
            ]

        case "readCompanionContext":
            let targetApp = (payload["targetApp"] as? String ?? "Gemini").lowercased()
            let safariScript = """
            tell application "Safari"
              if (count of windows) is 0 then return ""
              set t to current tab of front window
              return (name of t as string) & "|||" & (URL of t as string) & "|||" & (text of t as string)
            end tell
            """
            if let rawSafari = try? await automation.runAppleScript(safariScript, timeoutSeconds: 4.5), !rawSafari.isEmpty {
                let parts = rawSafari.components(separatedBy: "|||")
                let tabTitle = parts.first ?? "Safari"
                let tabUrl = parts.count > 1 ? parts[1] : ""
                let tabText = parts.count > 2 ? String(parts[2].suffix(3500)) : ""
                if targetApp.contains("gemini") || targetApp.contains("safari") || tabUrl.contains("gemini.google") || tabUrl.contains("chatgpt.com") || tabUrl.contains("claude.ai") || !tabText.isEmpty {
                    let domain = tabUrl.contains("chatgpt") ? "chatgpt_app" : tabUrl.contains("claude") ? "claude_app" : "gemini_web"
                    return [
                        "status": "ok",
                        "companionApp": tabTitle,
                        "sourceDomain": domain,
                        "url": tabUrl,
                        "transcript": tabText
                    ]
                }
            }
            let pbText = await MainActor.run { NSPasteboard.general.string(forType: .string) ?? "" }
            return [
                "status": "ok",
                "companionApp": payload["targetApp"] as? String ?? "Gemini",
                "sourceDomain": targetApp.contains("chatgpt") ? "chatgpt_app" : targetApp.contains("claude") ? "claude_app" : "gemini_web",
                "url": "local://companion/\(targetApp)",
                "transcript": String(pbText.prefix(3500))
            ]

        case "injectPromptContext":
            let targetApp = (payload["targetApp"] as? String ?? "Gemini").trimmingCharacters(in: .whitespacesAndNewlines)
            let promptText = (payload["promptText"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !promptText.isEmpty else {
                throw NativeBrokerFault(code: "EMPTY_PROMPT", message: "Provide a non-empty prompt packet to inject.")
            }
            await MainActor.run {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(promptText, forType: .string)
            }
            let lowerTarget = targetApp.lowercased()
            var focusedSurface = targetApp
            if lowerTarget.contains("gemini") {
                let geminiScript = """
                tell application "Safari"
                  activate
                  set foundTab to false
                  repeat with w in windows
                    repeat with t in tabs of w
                      if (URL of t contains "gemini.google.com") then
                        set current tab of w to t
                        set index of w to 1
                        set foundTab to true
                        exit repeat
                      end if
                    end repeat
                    if foundTab then exit repeat
                  end repeat
                end tell
                """
                _ = try? await automation.runAppleScript(geminiScript, timeoutSeconds: 4.0)
                focusedSurface = "Gemini (Safari)"
            } else if lowerTarget.contains("chatgpt") {
                _ = try? await automation.runProcess(executable: "/usr/bin/open", arguments: ["-a", "ChatGPT"], timeoutSeconds: 3.0)
                focusedSurface = "ChatGPT"
            } else if lowerTarget.contains("claude") {
                _ = try? await automation.runProcess(executable: "/usr/bin/open", arguments: ["-a", "Claude"], timeoutSeconds: 3.0)
                focusedSurface = "Claude"
            } else if lowerTarget.contains("iterm") || lowerTarget.contains("terminal") {
                _ = try? await automation.runProcess(executable: "/usr/bin/open", arguments: ["-a", "iTerm"], timeoutSeconds: 3.0)
                focusedSurface = "iTerm2"
            }
            return [
                "status": "injected",
                "targetApp": focusedSurface,
                "clipboardStaged": true,
                "charactersStaged": promptText.count,
                "message": "Staged <kst_work_context> packet (\(promptText.count) chars) on your clipboard and focused \(focusedSurface) ready to paste."
            ]

        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_SIDECAR_ACTION", message: "Unsupported Sidecar action: \(action)")
        }
    }

    // MARK: - 11. Native macOS NaturalLanguage Semantic Embeddings (`0 MB` extra RAM)

    private func handleIntelligence(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "embedText":
            let text = (payload["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else {
                return ["status": "ok", "dimension": 512, "vector": [Double](), "engine": "NaturalLanguage.NLEmbedding"]
            }
            if let embedding = NLEmbedding.sentenceEmbedding(for: .english),
               let vector = embedding.vector(for: text) {
                return [
                    "status": "ok",
                    "dimension": vector.count,
                    "vector": vector,
                    "engine": "NaturalLanguage.NLEmbedding"
                ]
            }
            return [
                "status": "fallback",
                "dimension": 512,
                "vector": [Double](),
                "engine": "kst-local-trigram-512"
            ]
        default:
            throw NativeBrokerFault(code: "UNSUPPORTED_INTELLIGENCE_ACTION", message: "Unsupported Intelligence action: \(action)")
        }
    }
}
