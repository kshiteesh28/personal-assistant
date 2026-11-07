import { useState, useRef, useEffect } from 'react';
import { useEventStream } from '../services/sse';
import { playNudgeSound } from '../services/nudge-sound';

interface Toast {
  id: string;
  kind: 'reminder' | 'nudge';
  title: string;
  message: string;
  category?: string;
  actions?: { label: string; chatCommand: string }[];
}

const CATEGORY_ICON: Record<string, string> = {
  wellness: '🌿', break: '☕', checkin: '✅', motivation: '⚡', summary: '📊',
};

export default function NotificationToast({ position = 'bottom-right', soundEnabled = false, customSoundUrl }: {
  position?: string; soundEnabled?: boolean; customSoundUrl?: string;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSilenced, setIsSilenced] = useState(false);
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Listen for silence toggle (Flow State Shield)
  useEffect(() => {
    const handler = (e: any) => setIsSilenced(!!e.detail);
    window.addEventListener('toggle-silence', handler as any);
    return () => window.removeEventListener('toggle-silence', handler as any);
  }, []);

  const addToast = (toast: Toast) => {
    if (isSilenced) return;
    setToasts(prev => [...prev.slice(-4), toast]); // max 5 toasts
    if (soundEnabled) playNudgeSound(customSoundUrl);
    // Auto-dismiss wellness/break after 8s
    if (toast.category === 'wellness' || toast.category === 'break') {
      const t = setTimeout(() => dismiss(toast.id), 8000);
      timerRef.current.set(toast.id, t);
    }
  };

  const dismiss = (id: string) => {
    clearTimeout(timerRef.current.get(id));
    timerRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEventStream((type, payload: any) => {
    if (type === 'reminder.due') {
      addToast({ id: `r-${payload.reminderId}-${Date.now()}`, kind: 'reminder', title: '⏰ Reminder', message: payload.title });
    }
    if (type === 'flowstate.nudge' || type === 'secretary.nudge') {
      addToast({
        id: payload.nudgeId ?? `n-${Date.now()}`,
        kind: 'nudge',
        title: `${CATEGORY_ICON[payload.category] ?? '💬'} ${payload.category ? payload.category.charAt(0).toUpperCase() + payload.category.slice(1) : 'Nudge'}`,
        message: payload.message,
        category: payload.category,
        actions: payload.actions,
      });
    }
    if (type === 'flowstate.success' || type === 'secretary.success') {
      addToast({ id: `s-${Date.now()}`, kind: 'nudge', title: '✅ Success', message: payload.message });
    }
  });

  if (toasts.length === 0) return null;

  const posStyle: React.CSSProperties = {
    position: 'fixed', zIndex: 9000,
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
    padding: '1rem',
    ...(position.includes('bottom') ? { bottom: 0 } : { top: 'calc(var(--nav-height, 64px) + 8px)' }),
    ...(position.includes('right') ? { right: 0 } : { left: 0 }),
    ...(position.includes('right') ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }),
  };

  return (
    <div style={posStyle}>
      {toasts.map(toast => (
        <div key={toast.id} className="scale-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape)', padding: '0.9rem 1.1rem', boxShadow: 'var(--shadow-lg)', maxWidth: '320px', minWidth: '240px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{toast.title}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{toast.message}</div>
              {toast.actions && toast.actions.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                  {toast.actions.map(a => (
                    <button key={a.label} onClick={() => { dismiss(toast.id); window.dispatchEvent(new CustomEvent('chat-command', { detail: a.chatCommand })); }}
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-accent)', background: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => dismiss(toast.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: '1rem', lineHeight: 1, flexShrink: 0, padding: '0.1rem' }}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
