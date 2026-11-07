import AppKit
import UserNotifications
import CoreGraphics
import KstNativeCore

private struct NativeNotice: Decodable {
    let id: String
    let kind: String
    let title: String
    let message: String
    let status: String
}
private struct NoticeFeed: Decodable { let notifications: [NativeNotice] }

/// Coarse, opt-in app/idle observations. No titles, screen pixels, keys or page text.
@MainActor
final class DesktopSignals: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published private(set) var enabled = false
    @Published private(set) var status = "Activity and native nudges off"
    private var polling: Task<Void, Never>?
    private var locked = false
    private var interval = UsageInterval()
    private var delivered = Set<String>()
    private let defaults = UserDefaults.standard
    private let endpoint: URL?
    private let token: () -> String?
    private let session: URLSession
    private var observers: [NSObjectProtocol] = []

    init(endpoint: URL?, token: @escaping () -> String?) {
        self.endpoint = endpoint
        self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 8
        session = URLSession(configuration: config, delegate: LoopbackRedirectGuard(), delegateQueue: nil)
        super.init()
        delivered = Set(defaults.stringArray(forKey: "deliveredNoticeIds") ?? [])
    }

    /// Only an explicit button requests notification permission and starts collection.
    func enable() {
        guard !enabled, endpoint != nil else { return }
        enabled = true
        interval.reset(now: ProcessInfo.processInfo.systemUptime)
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([UNNotificationCategory(identifier: "KST_NUDGE", actions: [
            UNNotificationAction(identifier: "ACK", title: "Dismiss", options: []),
            UNNotificationAction(identifier: "SNOOZE", title: "Snooze 15 minutes", options: [])
        ], intentIdentifiers: [], options: [])])
        Task { [weak self] in
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge])
                self?.status = granted ? "Coarse app activity and visual nudges enabled" : "Activity enabled; notifications denied in System Settings"
            } catch { self?.status = "Activity enabled; notification permission unavailable" }
        }
        let workspace = NSWorkspace.shared.notificationCenter
        observers.append(workspace.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.setLocked(true) } })
        observers.append(workspace.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.setLocked(false) } })
        observers.append(workspace.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.setLocked(true) } })
        observers.append(workspace.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.setLocked(false) } })
        polling = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.enabled else { return }
                await self.sampleAndDeliver()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    private func setLocked(_ value: Bool) {
        locked = value
        interval.reset(now: ProcessInfo.processInfo.systemUptime)
        Task { [weak self] in await self?.sampleAndDeliver() }
    }

    func disable() {
        enabled = false
        polling?.cancel(); polling = nil
        for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observers.removeAll()
        interval.reset(now: ProcessInfo.processInfo.systemUptime)
        status = "Activity and native nudges off"
    }

    private func authorized(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest? {
        guard let endpoint, let token = token(), !token.isEmpty else { return nil }
        var request = URLRequest(url: endpoint.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private func sampleAndDeliver() async {
        guard enabled else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null)
        let activeSeconds = interval.sample(now: now, idleSeconds: idle, locked: locked)
        let app = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
        guard let activity = authorized("api/activity", method: "POST", body: [
            "requestId": UUID().uuidString, "activeMinutes": activeSeconds / 60,
            "idleSeconds": min(86400, max(0, idle)), "locked": locked,
            "appBundleId": app
        ]) else { status = "Activity paused: pair with the local core"; return }
        do {
            let (_, response) = try await session.data(for: activity)
            guard enabled, (response as? HTTPURLResponse)?.statusCode == 200 else {
                status = "Activity sample was not accepted; retrying without storing raw activity"
                return
            }
            guard !locked, let feed = authorized("api/notifications") else { return }
            let (data, response2) = try await session.data(for: feed)
            guard enabled, !locked, (response2 as? HTTPURLResponse)?.statusCode == 200 else { return }
            let notices = try JSONDecoder().decode(NoticeFeed.self, from: data)
            delivered.formIntersection(Set(notices.notifications.filter { $0.status != "acknowledged" }.map(\.id)))
            for notice in notices.notifications where notice.status == "pending" && !delivered.contains(notice.id) {
                let content = UNMutableNotificationContent()
                content.title = String(notice.title.prefix(120))
                content.body = String(notice.message.prefix(500))
                content.categoryIdentifier = "KST_NUDGE"
                content.userInfo = ["noticeId": notice.id]
                try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: notice.id, content: content, trigger: nil))
                guard enabled else { return }
                delivered.insert(notice.id)
                defaults.set(Array(delivered), forKey: "deliveredNoticeIds")
            }
        } catch {
            guard enabled else { return }
            status = "Local activity/notification service unavailable; retrying in 30 seconds"
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let identifier = response.notification.request.identifier
        let snooze = response.actionIdentifier == "SNOOZE"
        Task { @MainActor [weak self] in
            guard let self else { return }
            var body: [String: Any] = ["requestId": UUID().uuidString, "decision": snooze ? "snooze" : "acknowledge"]
            if snooze { body["minutes"] = 15 }
            if let request = self.authorized("api/notifications/\(identifier)", method: "POST", body: body) {
                do {
                    let (_, result) = try await self.session.data(for: request)
                    if (result as? HTTPURLResponse)?.statusCode != 200 { self.status = "Notification action was not saved; check the dashboard" }
                    else if snooze {
                        self.delivered.remove(identifier)
                        self.defaults.set(Array(self.delivered), forKey: "deliveredNoticeIds")
                    }
                } catch { self.status = "Notification action was not confirmed; check the dashboard" }
            }
        }
        completionHandler()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }
}
