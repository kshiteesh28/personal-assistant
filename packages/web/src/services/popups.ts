// Browser notification helpers (OS-level toasts / permission request)

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return Promise.resolve('denied');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  return Notification.requestPermission();
}

export function showProactiveNotification(title: string, body: string, icon?: string) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: icon ?? '/favicon.ico', silent: false });
  }
}

export function bringToFront() {
  // Focus window — only works if user interaction has occurred
  try { window.focus(); } catch {}
}
