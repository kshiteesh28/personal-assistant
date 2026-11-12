import Foundation
import KstNativeCore
#if canImport(FoundationModels)
import FoundationModels
#endif

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private func extractString(_ content: GeneratedContent, _ key: String) -> String? {
    if let direct = try? content.value(String.self, forProperty: key) {
        let trimmed = direct.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
    if let optionalVal = (try? content.value(String?.self, forProperty: key)) ?? nil {
        let trimmed = optionalVal.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
    return nil
}

@available(macOS 26.0, *)
private func extractInt(_ content: GeneratedContent, _ key: String) -> Int? {
    if let direct = try? content.value(Int.self, forProperty: key) {
        return direct
    }
    if let optionalVal = (try? content.value(Int?.self, forProperty: key)) ?? nil {
        return optionalVal
    }
    if let str = extractString(content, key), let parsed = Int(str) {
        return parsed
    }
    return nil
}

@available(macOS 26.0, *)
struct KstScheduleArgs: Generable, Codable, Sendable {
    let operation: String
    let title: String?
    let startAt: String?
    let durationMinutes: Int?
    let fireAt: String?

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for Apple Calendar events, Apple Reminders, and focus plans.",
            properties: [
                GenerationSchema.Property(name: "operation", description: "Operation: calendarList, calendarAvailability, meetingCreate, meetingReschedule, meetingCancel, remindersList, reminderCreate, reminderComplete, reminderModify, or planPropose", type: String.self),
                GenerationSchema.Property(name: "title", description: "Meeting or reminder title, or existing target title", type: String?.self),
                GenerationSchema.Property(name: "startAt", description: "Start date/time for meetings (ISO-8601 or natural phrase like 'tomorrow at 3pm')", type: String?.self),
                GenerationSchema.Property(name: "durationMinutes", description: "Duration in minutes for meetings (default 30)", type: Int?.self),
                GenerationSchema.Property(name: "fireAt", description: "Reminder trigger date/time (ISO-8601 or natural phrase like 'in 15 minutes')", type: String?.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.operation = extractString(content, "operation") ?? "calendarList"
        self.title = extractString(content, "title")
        self.startAt = extractString(content, "startAt")
        self.durationMinutes = extractInt(content, "durationMinutes")
        self.fireAt = extractString(content, "fireAt")
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "operation": operation,
            "title": title ?? "",
            "startAt": startAt ?? "",
            "durationMinutes": durationMinutes ?? 30,
            "fireAt": fireAt ?? ""
        ])
    }
}

@available(macOS 26.0, *)
struct KstScheduleTool: Tool {
    let name = "kst_schedule"
    let description = "List or manage Apple Calendar events, Apple Reminders, and daily focus plans."
    typealias Arguments = KstScheduleArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstScheduleArgs) async throws -> String {
        var payload: [String: String] = ["operation": arguments.operation]
        if let title = arguments.title, !title.isEmpty {
            payload["title"] = title
            payload["target"] = title
        }
        if let startAt = arguments.startAt, !startAt.isEmpty {
            payload["startAt"] = startAt
            if payload["fireAt"] == nil { payload["fireAt"] = startAt }
        }
        if let durationMinutes = arguments.durationMinutes {
            payload["durationMinutes"] = String(durationMinutes)
        }
        if let fireAt = arguments.fireAt, !fireAt.isEmpty {
            payload["fireAt"] = fireAt
            if payload["startAt"] == nil { payload["startAt"] = fireAt }
        }
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "apple.schedule.\(arguments.operation)",
            arguments: payload
        )
    }
}

@available(macOS 26.0, *)
struct KstCommunicationArgs: Generable, Codable, Sendable {
    let operation: String
    let recipientOrQuery: String?
    let subject: String?
    let bodyText: String?

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for Apple Contacts resolution, Apple Mail, and Apple Messages.",
            properties: [
                GenerationSchema.Property(name: "operation", description: "Operation: contactResolve, mailSearchUnread, mailReadThread, mailDraftPreview, or imessagePreviewSend", type: String.self),
                GenerationSchema.Property(name: "recipientOrQuery", description: "Recipient name, email address, phone number, or search query", type: String?.self),
                GenerationSchema.Property(name: "subject", description: "Email subject line when drafting in Apple Mail", type: String?.self),
                GenerationSchema.Property(name: "bodyText", description: "Message body text for Apple Mail draft or Apple Messages iMessage preview", type: String?.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.operation = extractString(content, "operation") ?? "mailDraftPreview"
        self.recipientOrQuery = extractString(content, "recipientOrQuery")
        self.subject = extractString(content, "subject")
        self.bodyText = extractString(content, "bodyText")
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "operation": operation,
            "recipientOrQuery": recipientOrQuery ?? "",
            "subject": subject ?? "",
            "bodyText": bodyText ?? ""
        ])
    }
}

@available(macOS 26.0, *)
struct KstCommunicationTool: Tool {
    let name = "kst_communication"
    let description = "Resolve contacts in Apple Contacts, check/draft emails in Apple Mail, or stage an iMessage in Apple Messages."
    typealias Arguments = KstCommunicationArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstCommunicationArgs) async throws -> String {
        var payload: [String: String] = ["operation": arguments.operation]
        if let recipientOrQuery = arguments.recipientOrQuery, !recipientOrQuery.isEmpty {
            payload["recipientOrQuery"] = recipientOrQuery
            payload["to"] = recipientOrQuery
        }
        if let subject = arguments.subject, !subject.isEmpty {
            payload["subject"] = subject
        }
        if let bodyText = arguments.bodyText, !bodyText.isEmpty {
            payload["bodyText"] = bodyText
            payload["body"] = bodyText
        }
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "apple.comm.\(arguments.operation)",
            arguments: payload
        )
    }
}

@available(macOS 26.0, *)
struct KstKnowledgeArgs: Generable, Codable, Sendable {
    let operation: String
    let title: String?
    let body: String?
    let dueIso: String?

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for Apple Notes and KST tasks.",
            properties: [
                GenerationSchema.Property(name: "operation", description: "Operation: noteCreate, noteAppend, noteSearch, noteList, taskCreate, taskComplete, or taskList", type: String.self),
                GenerationSchema.Property(name: "title", description: "Note or task title, or search query", type: String?.self),
                GenerationSchema.Property(name: "body", description: "Note body content", type: String?.self),
                GenerationSchema.Property(name: "dueIso", description: "Optional due date/time for tasks", type: String?.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.operation = extractString(content, "operation") ?? "noteCreate"
        self.title = extractString(content, "title")
        self.body = extractString(content, "body")
        self.dueIso = extractString(content, "dueIso")
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "operation": operation,
            "title": title ?? "",
            "body": body ?? "",
            "dueIso": dueIso ?? ""
        ])
    }
}

@available(macOS 26.0, *)
struct KstKnowledgeTool: Tool {
    let name = "kst_knowledge"
    let description = "Create, append, list, or search notes in Apple Notes and manage secretary tasks."
    typealias Arguments = KstKnowledgeArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstKnowledgeArgs) async throws -> String {
        var payload: [String: String] = ["operation": arguments.operation]
        if let title = arguments.title, !title.isEmpty {
            payload["title"] = title
            payload["query"] = title
        }
        if let body = arguments.body, !body.isEmpty {
            payload["body"] = body
            if payload["title"] == nil { payload["title"] = String(body.prefix(60)) }
        }
        if let dueIso = arguments.dueIso, !dueIso.isEmpty {
            payload["dueIso"] = dueIso
        }
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "apple.knowledge.\(arguments.operation)",
            arguments: payload
        )
    }
}

@available(macOS 26.0, *)
struct KstDesktopContextArgs: Generable, Codable, Sendable {
    let operation: String
    let query: String?

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for Safari active tab context, Spotlight file search, and Finder.",
            properties: [
                GenerationSchema.Property(name: "operation", description: "Operation: safariActiveTabContext, safariOpenUrl, spotlightFileSearch, finderRevealFile, or appLaunchOrFocus", type: String.self),
                GenerationSchema.Property(name: "query", description: "File name, URL, search query, or macOS application name", type: String?.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.operation = extractString(content, "operation") ?? "safariActiveTabContext"
        self.query = extractString(content, "query")
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "operation": operation,
            "query": query ?? ""
        ])
    }
}

@available(macOS 26.0, *)
struct KstDesktopContextTool: Tool {
    let name = "kst_desktop_context"
    let description = "Read active Safari tab context, open URLs, find files via Spotlight, reveal files in Finder, or launch macOS apps."
    typealias Arguments = KstDesktopContextArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstDesktopContextArgs) async throws -> String {
        var payload: [String: String] = ["operation": arguments.operation]
        if let query = arguments.query, !query.isEmpty {
            payload["query"] = query
            payload["urlOrQuery"] = query
            payload["appName"] = query
        }
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "apple.desktop.\(arguments.operation)",
            arguments: payload
        )
    }
}

@available(macOS 26.0, *)
struct KstEnvironmentArgs: Generable, Codable, Sendable {
    let operation: String
    let commandOrShortcut: String?
    let confirmationId: String?

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for confirming staged actions, controlling Apple Music, or running allowlisted Shortcuts.",
            properties: [
                GenerationSchema.Property(name: "operation", description: "Operation: confirmPendingAction, cancelPendingAction, musicPlaybackControl, or focusShortcutRun", type: String.self),
                GenerationSchema.Property(name: "commandOrShortcut", description: "Music command (play, pause, resume, next, playPlaylist) or allowlisted Shortcut name", type: String?.self),
                GenerationSchema.Property(name: "confirmationId", description: "Confirmation ID if confirming a specific pending action", type: String?.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.operation = extractString(content, "operation") ?? "confirmPendingAction"
        self.commandOrShortcut = extractString(content, "commandOrShortcut")
        self.confirmationId = extractString(content, "confirmationId")
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "operation": operation,
            "commandOrShortcut": commandOrShortcut ?? "",
            "confirmationId": confirmationId ?? ""
        ])
    }
}

@available(macOS 26.0, *)
struct KstEnvironmentTool: Tool {
    let name = "kst_environment"
    let description = "Confirm or cancel staged outbound Mail/iMessage actions, control Apple Music, or run allowlisted macOS Focus Shortcuts."
    typealias Arguments = KstEnvironmentArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstEnvironmentArgs) async throws -> String {
        var payload: [String: String] = ["operation": arguments.operation]
        if let cmd = arguments.commandOrShortcut, !cmd.isEmpty {
            payload["command"] = cmd
            payload["shortcutName"] = cmd
            payload["playlist"] = cmd
        }
        if let confirmationId = arguments.confirmationId, !confirmationId.isEmpty {
            payload["confirmationId"] = confirmationId
        }
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "apple.env.\(arguments.operation)",
            arguments: payload
        )
    }
}

@available(macOS 26.0, *)
struct KstRaphaelOperatorArgs: Generable, Codable, Sendable {
    let operation: String
    let targetOrTopic: String?

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for KST Raphael Personal Work Operator: FSRS skill learning coach, Contextual Thompson Sampling Music DJ, Side-by-Side Co-Pilot Bridge (Gemini/ChatGPT/Claude/iTerm2), and Raphael status briefing.",
            properties: [
                GenerationSchema.Property(name: "operation", description: "Operation: briefing, whatToLearn, recordSkillPractice, musicFlowRecommend, briefCompanionAI, captureCompanionTasks, or explainTerminalError", type: String.self),
                GenerationSchema.Property(name: "targetOrTopic", description: "Optional work mode (DEEP_ARCHITECTURE, FAST_EXECUTION, READING_RESEARCH), companion app (Gemini, ChatGPT, Claude), or skill topic", type: String?.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.operation = extractString(content, "operation") ?? "briefing"
        self.targetOrTopic = extractString(content, "targetOrTopic")
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "operation": operation,
            "targetOrTopic": targetOrTopic ?? ""
        ])
    }
}

@available(macOS 26.0, *)
struct KstRaphaelOperatorTool: Tool {
    let name = "kst_raphael_operator"
    let description = "Invoke KST Raphael (Great Sage) skills: recommend what to learn next (FSRS-4.5), select focus music via Thompson Sampling, brief Gemini/ChatGPT/Claude with current work context, capture tasks from AI chats, or explain the last iTerm2 error."
    typealias Arguments = KstRaphaelOperatorArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstRaphaelOperatorArgs) async throws -> String {
        var payload: [String: String] = ["operation": arguments.operation]
        if let targetOrTopic = arguments.targetOrTopic, !targetOrTopic.isEmpty {
            payload["target"] = targetOrTopic
            payload["topic"] = targetOrTopic
            payload["mode"] = targetOrTopic
        }
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "apple.raphael.\(arguments.operation)",
            arguments: payload
        )
    }
}

@available(macOS 26.0, *)
struct KstExternalEscalationArgs: Generable, Codable, Sendable {
    let service: String
    let prompt: String

    static var generationSchema: GenerationSchema {
        GenerationSchema(
            type: Self.self,
            description: "Arguments for staging a Tier 2 approval-gated request to Claude, Gemini, ChatGPT, or Codex CLI.",
            properties: [
                GenerationSchema.Property(name: "service", description: "External Tier 2 service: claude, gemini, chatgpt, or codex", type: String.self),
                GenerationSchema.Property(name: "prompt", description: "Exact prompt or codebase task to stage for user approval", type: String.self)
            ]
        )
    }

    init(_ content: GeneratedContent) throws {
        self.service = extractString(content, "service") ?? "claude"
        self.prompt = extractString(content, "prompt") ?? ""
    }

    var generatedContent: GeneratedContent {
        GeneratedContent(properties: [
            "service": service,
            "prompt": prompt
        ])
    }
}

@available(macOS 26.0, *)
struct KstExternalEscalationTool: Tool {
    let name = "kst_external_escalation"
    let description = "Stage an approval-gated request for Claude, Google Gemini, ChatGPT, or OpenAI Codex CLI when deep cloud reasoning or repo analysis is requested."
    typealias Arguments = KstExternalEscalationArgs

    let turnId: String
    let streamContext: NativeSocketStreamContext

    func call(arguments: KstExternalEscalationArgs) async throws -> String {
        return try await streamContext.executeCoreTool(
            turnId: turnId,
            kind: "external.stageApproval",
            arguments: [
                "service": arguments.service,
                "prompt": arguments.prompt
            ]
        )
    }
}
#endif

/// Coordinates both `AppleEcosystemBroker` and `LocalIntelligenceBroker` (Apple Foundation Models 3B)
/// over the single owner-only `NativeSystemBrokerSocket` (`b.sock`).
/// Notice `appleBroker` is `nonisolated` so concurrent `apple.execute` calls invoked during
/// an active `llm.infer.start` turn never deadlock on actor re-entrancy.
actor NativeSystemCoordinator {
    nonisolated let appleBroker = AppleEcosystemBroker()
    private var socket: NativeSystemBrokerSocket?

    func startBroker() throws -> NativeBrokerBootstrap {
        if let socket { return socket.bootstrap }
        let created = try NativeSystemBrokerSocket { [weak self] method, paramsData, streamContext in
            guard let self else {
                throw NativeBrokerFault(code: "BROKER_SHUTDOWN", message: "Native coordinator shut down.")
            }
            return try await self.handleSocketRequest(method: method, paramsData: paramsData, streamContext: streamContext)
        }
        socket = created
        return created.bootstrap
    }

    func shutdown() {
        socket?.stop()
        socket = nil
    }

    nonisolated private func handleSocketRequest(
        method: String,
        paramsData: Data,
        streamContext: NativeSocketStreamContext
    ) async throws -> Data {
        let params = ((try? JSONSerialization.jsonObject(with: paramsData)) as? [String: Any]) ?? [:]
        switch method {
        case "apple.status":
            let permissions = appleBroker.permissionsStatus()
            let dict: [String: Any] = [
                "permissions": permissions,
                "foundationModelsAvailable": isFoundationModelsAvailable()
            ]
            return try JSONSerialization.data(withJSONObject: dict)

        case "apple.execute":
            let domain = params["domain"] as? String ?? ""
            let action = params["action"] as? String ?? ""
            let payloadDict = params["payload"] as? [String: Any] ?? [:]
            let payloadData = (try? JSONSerialization.data(withJSONObject: payloadDict)) ?? Data("{}".utf8)
            return try await appleBroker.executeJSON(domain: domain, action: action, payloadData: payloadData)

        case "llm.infer.start":
            let res = try await runLocalInference(params: params, streamContext: streamContext)
            return try JSONSerialization.data(withJSONObject: res)

        default:
            throw NativeBrokerFault(code: "UNKNOWN_METHOD", message: "Unsupported native broker method: \(method)")
        }
    }

    nonisolated private func isFoundationModelsAvailable() -> Bool {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            if case .available = SystemLanguageModel.default.availability {
                return true
            }
        }
        #endif
        return false
    }

    nonisolated private func runLocalInference(
        params: [String: Any],
        streamContext: NativeSocketStreamContext
    ) async throws -> [String: Any] {
        let turnId = params["turnId"] as? String ?? UUID().uuidString
        let userText = params["text"] as? String ?? ""
        let activeContext = params["activeContext"] as? [String: Any] ?? [:]
        let history = params["history"] as? [[String: Any]] ?? []

        #if canImport(FoundationModels)
        if #available(macOS 26.0, *), case .available = SystemLanguageModel.default.availability {
            do {
                return try await runFoundationModelsSession(
                    turnId: turnId,
                    userText: userText,
                    activeContext: activeContext,
                    history: history,
                    streamContext: streamContext,
                    compactedRetry: false
                )
            } catch {
                return try await runFoundationModelsSession(
                    turnId: turnId,
                    userText: userText,
                    activeContext: activeContext,
                    history: [],
                    streamContext: streamContext,
                    compactedRetry: true
                )
            }
        }
        #endif

        throw NativeBrokerFault(
            code: "AFM_UNAVAILABLE",
            message: "Apple Foundation Models is unavailable on this Mac or disabled in System Settings."
        )
    }

    #if canImport(FoundationModels)
    @available(macOS 26.0, *)
    nonisolated private func runFoundationModelsSession(
        turnId: String,
        userText: String,
        activeContext: [String: Any],
        history: [[String: Any]],
        streamContext: NativeSocketStreamContext,
        compactedRetry: Bool
    ) async throws -> [String: Any] {
        let contextData = (try? JSONSerialization.data(withJSONObject: activeContext)) ?? Data()
        let contextJSON = String(data: contextData, encoding: .utf8) ?? "{}"
        let localTime = activeContext["currentLocalTime"] as? String ?? ""
        let localDate = activeContext["currentLocalDate"] as? String ?? ""
        let tz = activeContext["timezone"] as? String ?? TimeZone.current.identifier
        let historySummary = history.suffix(6).compactMap { item -> String? in
            guard let role = item["role"] as? String, let text = item["text"] as? String else { return nil }
            return "\(role.uppercased()): \(text.prefix(240))"
        }.joined(separator: "\n")

        let timeInstruction = localTime.isEmpty ? "" : "The user's current local time is \(localTime) on \(localDate) in timezone \(tz). When asked for the current time or date, state this local time. All event and reminder times are in timezone \(tz)."

        let instructions = """
        You are kst (Raphael / Great Sage), a concise, capable personal work operator running natively on the user's MacBook Pro.
        Keep spoken replies natural, warm, and direct (1 to 3 short sentences).
        \(timeInstruction)
        Always call the matching tool for Calendar, Reminders, Notes, Mail, Messages, Safari, Spotlight, Music, or Raphael Co-Pilot requests:
        - Calendar & Reminders: use kst_schedule (operations: calendarList, meetingCreate, meetingReschedule, meetingCancel, remindersList, reminderCreate, reminderComplete, reminderModify, planPropose).
        - Mail, Contacts & iMessage: use kst_communication (operations: mailDraftPreview, mailSearchUnread, imessagePreviewSend, contactResolve).
        - Notes & Tasks: use kst_knowledge (operations: noteCreate, noteAppend, noteSearch, noteList, taskCreate, taskComplete, taskList).
        - Raphael Operator (What to Learn, Music Flow DJ, Brief Gemini/ChatGPT, Capture Tasks from Chat, Terminal Error Analysis): use kst_raphael_operator (operations: briefing, whatToLearn, recordSkillPractice, musicFlowRecommend, briefCompanionAI, captureCompanionTasks, explainTerminalError).
        Never invent completion of an action without calling the matching tool.
        <active_context>
        \(contextJSON.prefix(1200))
        </active_context>
        \(historySummary.isEmpty ? "" : "<recent_turns>\n\(historySummary)\n</recent_turns>")
        """

        let tools: [any Tool] = [
            KstScheduleTool(turnId: turnId, streamContext: streamContext),
            KstCommunicationTool(turnId: turnId, streamContext: streamContext),
            KstKnowledgeTool(turnId: turnId, streamContext: streamContext),
            KstDesktopContextTool(turnId: turnId, streamContext: streamContext),
            KstEnvironmentTool(turnId: turnId, streamContext: streamContext),
            KstRaphaelOperatorTool(turnId: turnId, streamContext: streamContext),
            KstExternalEscalationTool(turnId: turnId, streamContext: streamContext)
        ]

        let session = LanguageModelSession(
            model: SystemLanguageModel.default,
            tools: tools,
            instructions: instructions
        )

        let response = try await session.respond(to: userText)
        let fullText = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        streamContext.emitDelta(fullText)
        return [
            "reply": fullText,
            "streamed": true,
            "tierUsed": compactedRetry ? "tier1a_foundation_models_compacted" : "tier1a_foundation_models"
        ]
    }
    #endif
}
