import AppIntents
import Foundation
import KstNativeCore

/// Inbound Siri, Spotlight & Apple Watch bridge (`0.8.0-raphael`) allowing macOS Siri, Spotlight,
/// and Apple Shortcuts to invoke KST and Raphael (Great Sage) directly over the authenticated local core API.
struct AskKstIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask KST Secretary"
    static let description = IntentDescription("Send a natural-language command or question to your local KST personal secretary.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Request", requestValueDialog: IntentDialog("What would you like KST to do?"))
    var query: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: query)
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

struct CreateKstTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Create KST Task"
    static let description = IntentDescription("Add a task to your KST personal secretary workspace.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Task Title")
    var taskTitle: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: "add task \(taskTitle)")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

struct CreateKstReminderIntent: AppIntent {
    static let title: LocalizedStringResource = "Create KST Reminder"
    static let description = IntentDescription("Create a reminder in Apple Reminders and KST.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Reminder Title")
    var reminderTitle: String

    @Parameter(title: "When (for example, in 15 minutes or tomorrow at 3 pm)")
    var whenText: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: "remind me to \(reminderTitle) \(whenText)")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

/// 1. Siri & Apple Watch Intent: Full Raphael Status & Work Graph Briefing
struct KstRaphaelBriefingIntent: AppIntent {
    static let title: LocalizedStringResource = "Get KST Raphael Briefing"
    static let description = IntentDescription("Synthesizes your active work mode, top priority task, FSRS skill recommendation, and acoustic flow state.")
    static let openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: "raphael status report")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

/// 2. Siri & Spotlight Intent: FSRS-4.5 + Deadline Urgency Learning Coach
struct KstWhatToLearnIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask KST What to Learn Next"
    static let description = IntentDescription("Uses FSRS-4.5 memory decay and your recent terminal errors to recommend the highest-leverage topic to study next.")
    static let openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: "what should I learn next")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

/// 3. Siri & Apple Watch Intent: Start Flow Session + Contextual Thompson Sampling Music DJ
struct KstStartFlowSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Start KST Deep Work Flow Session"
    static let description = IntentDescription("Selects the optimal Apple Music playlist via Contextual Thompson Sampling and configures your nudge bandit for deep focus.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Work Mode", default: "deep work")
    var workMode: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: "play music for \(workMode)")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

/// 4. Siri & Spotlight Intent: Side-by-Side AI Co-Pilot Context Injection
struct KstBriefCompanionAIIntent: AppIntent {
    static let title: LocalizedStringResource = "Brief Companion AI with KST Context"
    static let description = IntentDescription("Harvests your active git branch, terminal error tail, and KST Work Graph to brief Gemini, ChatGPT, or Claude.")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "Companion App", default: "Gemini")
    var companionApp: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstIntentLoopbackClient.sendConversation(text: "brief \(companionApp) on my current task")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

struct KstShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskKstIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Tell \(.applicationName) to help me"
            ],
            shortTitle: "Ask KST",
            systemImageName: "waveform.circle"
        )
        AppShortcut(
            intent: CreateKstTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)"
            ],
            shortTitle: "New KST Task",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: KstRaphaelBriefingIntent(),
            phrases: [
                "Ask \(.applicationName) for my Raphael briefing",
                "Show my \(.applicationName) work status"
            ],
            shortTitle: "Raphael Briefing",
            systemImageName: "brain.head.profile"
        )
        AppShortcut(
            intent: KstWhatToLearnIntent(),
            phrases: [
                "Ask \(.applicationName) what I should learn",
                "What should I study in \(.applicationName)"
            ],
            shortTitle: "What to Learn",
            systemImageName: "graduationcap.fill"
        )
        AppShortcut(
            intent: KstStartFlowSessionIntent(),
            phrases: [
                "Start deep work flow in \(.applicationName)",
                "Play focus music with \(.applicationName)"
            ],
            shortTitle: "Start Flow Mode",
            systemImageName: "waveform.path.ecg"
        )
        AppShortcut(
            intent: KstBriefCompanionAIIntent(),
            phrases: [
                "Brief Gemini with \(.applicationName)",
                "Send my work context with \(.applicationName)"
            ],
            shortTitle: "Brief Co-Pilot AI",
            systemImageName: "sparkles.rectangle.stack"
        )
    }
}

enum KstIntentLoopbackClient {
    static func sendConversation(text: String) async throws -> String {
        let env = ProcessInfo.processInfo.environment
        let endpoint = try LocalEndpoint.validated(env["KST_CORE_URL"] ?? "http://127.0.0.1:4310")
        let coreDirectory = env["KST_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/kst-dev/core")
        let tokenURL = coreDirectory.appendingPathComponent("token")
        let token = env["KST_TOKEN"] ?? (try? String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))
        guard let token, !token.isEmpty else {
            return "KST local pairing token is unavailable. Open kst first."
        }
        var request = URLRequest(url: endpoint.appendingPathComponent("api/conversation"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "requestId": "siri-" + UUID().uuidString,
            "text": text,
            "source": "siri"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reply = json["reply"] as? String else {
            return "KST could not complete that request right now."
        }
        return reply
    }
}
