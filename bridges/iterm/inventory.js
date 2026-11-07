// Read-only JXA inventory. Invoked only after an explicit authenticated user request.
// Names/properties verified against the installed iTerm2.sdef scripting dictionary.
(() => {
  const app = Application('com.googlecode.iterm2');
  if (!app.running()) return JSON.stringify({ status: 'not-running', sessions: [], message: 'iTerm is not running. It was not launched.' });
  const sessions = [];
  for (const window of app.windows()) {
    for (const tab of window.tabs()) {
      for (const session of tab.sessions()) {
        if (sessions.length >= 100) break;
        let atShellPrompt = null;
        try { atShellPrompt = session.isAtShellPrompt(); } catch {}
        sessions.push({ windowId: window.id(), sessionId: session.id(), name: session.name(), atShellPrompt });
      }
    }
  }
  return JSON.stringify({ status: 'connected', sessions, message: 'Read-only inventory. Prompt information alone does not authorize command entry.' });
})();
