import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

interface Msg { role: 'user' | 'assistant'; content: string; ts: number; }

const COMMANDS = [
  { cmd: '/task',     desc: 'Add a task (e.g. /task Buy milk tomorrow)' },
  { cmd: '/note',     desc: 'Capture a quick note' },
  { cmd: '/event',    desc: 'Schedule a meeting or event' },
  { cmd: '/brief',    desc: 'Show today\'s daily brief' },
  { cmd: '/tasks',    desc: 'List your active tasks' },
  { cmd: '/schedule', desc: 'Generate today\'s schedule' },
  { cmd: '/copilot',  desc: 'Ask AI anything' },
  { cmd: '/motivate', desc: 'Get a motivation boost' },
  { cmd: '/remind',   desc: 'Set a reminder' },
  { cmd: '/research', desc: 'Deep-dive research on a topic' },
  { cmd: '/pipeline', desc: 'Add to downtime pipeline' },
];

const TASK_CATEGORIES = [
  { label: '🎯 Priority', options: [{ label: 'High Intensity', v: 'priority:1' }, { label: 'Standard', v: 'priority:2' }, { label: 'Low Priority', v: 'priority:3' }] },
  { label: '⚡ Energy', options: [{ label: 'High Velocity', v: 'energy:high' }, { label: 'Sustained', v: 'energy:medium' }, { label: 'Low Energy', v: 'energy:low' }] },
  { label: '⚙️ Type', options: [{ label: 'Deep Work', v: 'type:deep_work' }, { label: 'Admin', v: 'type:admin' }, { label: 'Comm', v: 'type:communication' }, { label: 'Creative', v: 'type:creative' }] },
  { label: '🌅 Time', options: [{ label: 'Morning', v: 'time:morning' }, { label: 'Afternoon', v: 'time:afternoon' }, { label: 'End of Day', v: 'time:evening' }] },
  { label: '⏳ Est', options: [{ label: '15m', v: 'estimate:15' }, { label: '30m', v: 'estimate:30' }, { label: '1h', v: 'estimate:60' }, { label: '2h', v: 'estimate:120' }, { label: '4h', v: 'estimate:240' }] },
  { label: '📌 Pinned', options: [{ label: '9 AM', v: 'at:09:00' }, { label: '12 PM', v: 'at:12:00' }, { label: '3 PM', v: 'at:15:00' }, { label: '6 PM', v: 'at:18:00' }] },
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: '👋 Hi! I\'m your Personal Secretary. Type a message or / for slash commands.', ts: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = input.startsWith('/') ? COMMANDS.filter(c => c.cmd.startsWith(input.split(' ')[0].toLowerCase())) : [];
  const showCommands = filtered.length > 0 && !input.includes(' ');
  const showTypeSuggestions = !loading && input === '';
  const showTaskSuggestions = !loading && input.startsWith('/task');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Listen for chat-command events from NotificationToast action buttons
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const cmd = e.detail as string;
      if (cmd) { setInput(cmd + ' '); inputRef.current?.focus(); }
    };
    window.addEventListener('chat-command', handler as EventListener);
    return () => window.removeEventListener('chat-command', handler as EventListener);
  }, []);

  const send = async (msgText?: string) => {
    const text = (msgText ?? input).trim();
    if (!text) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const res = await api.post<{ reply: string }>('/api/chat', { message: text });
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply, ts: Date.now() }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${err.message ?? 'Server error'}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: '420px',
      background: 'var(--color-surface)',
      borderLeft: '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-xl)',
      display: 'flex', flexDirection: 'column',
      zIndex: 400,
      animation: 'slideInRight 0.25s ease-out',
    }}>
      {/* Header */}
      <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--color-surface)' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>🤖</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Personal Secretary</div>
          <div style={{ fontSize: '0.72rem', color: loading ? 'var(--color-orange)' : 'var(--color-green)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {loading ? 'Thinking…' : 'Online'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setMessages([{ role: 'assistant', content: '🧹 Chat cleared. How can I help?', ts: Date.now() }])}
            title="Clear chat" style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '0.35rem 0.5rem', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            ✕ Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'var(--chat-direction, column)' as any, gap: '0.75rem' }}>
        {(['forge', 'abyss'].includes(document.documentElement.getAttribute('data-theme') || '') ? [...messages].reverse() : messages).map((m, i) => {
          /* If reversed, role alignments might need tweaking, but we'll stick to flex-end for user */
          return (
            <div key={i} className="msg-bubble" style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              animation: 'var(--bg-physics-animation, none)',
              animationDelay: `${Math.random()}s`,
            }}>
              <div style={{
                maxWidth: '84%', padding: '0.7rem 0.9rem', 
                borderRadius: m.role === 'user' ? 'var(--chat-bubble-shape, var(--radius-lg))' : 'var(--chat-bubble-shape, var(--radius-lg))',
                background: m.role === 'user' ? 'var(--color-accent)' : 'var(--color-bg)',
                color: m.role === 'user' ? (document.documentElement.getAttribute('data-theme')==='sage'?'white':'var(--color-bg)') : 'var(--color-text-primary)',
                border: m.role === 'assistant' ? '1px solid var(--color-border)' : 'none',
                fontSize: '0.9rem', lineHeight: 1.5, boxShadow: 'var(--shadow-sm)',
                whiteSpace: 'pre-wrap',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{ position: 'relative', zIndex: 2 }}>{m.content}</div>
                {m.role === 'user' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)', zIndex: 1 }} />}
              </div>
              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: '0.2rem', padding: '0 0.2rem' }}>{fmtTime(m.ts)}</span>
            </div>
          );
        })}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ padding: '0.7rem 1rem', borderRadius: 'var(--chat-bubble-shape, var(--radius-lg))', background: 'var(--color-bg)', border: '1px solid var(--color-border)', display: 'flex', gap: '4px', alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-text-tertiary)', display: 'inline-block', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Command suggestions */}
      {showCommands && (
        <div style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)', maxHeight: '220px', overflowY: 'auto' }}>
          {filtered.map(c => (
            <button key={c.cmd} type="button" onClick={() => setInput(c.cmd + ' ')}
              style={{ width: '100%', padding: '0.65rem 1.1rem', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-accent)', minWidth: '90px' }}>{c.cmd}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{c.desc}</span>
            </button>
          ))}
        </div>
      )}

        {/* Quick Suggestions */}
        {showTypeSuggestions && (
          <div style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            {[
              { label: '📝 Task', val: '/task ' },
              { label: '📓 Note', val: '/note ' },
              { label: '🔔 Reminder', val: '/remind ' },
              { label: '⚡ Pipeline', val: '/pipeline ' }
            ].map(s => (
              <button key={s.val} onClick={() => setInput(s.val)}
                style={{ padding: '0.35rem 0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape)', fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer', color: 'var(--color-text-primary)', transition: 'all 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {showTaskSuggestions && (
          <div style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }} onMouseLeave={() => setHoveredCat(null)}>
            {/* Category Labels */}
            <div style={{ display: 'flex', gap: '4px', padding: '0.4rem 0.6rem', borderBottom: hoveredCat ? '1px solid var(--color-border)' : 'none' }}>
              {TASK_CATEGORIES.map(cat => (
                <button key={cat.label} 
                  onMouseEnter={() => setHoveredCat(cat.label)}
                  style={{ 
                    padding: '0.25rem 0.6rem', background: hoveredCat === cat.label ? 'var(--color-bg)' : 'transparent', 
                    border: '1px solid transparent', borderColor: hoveredCat === cat.label ? 'var(--color-border)' : 'transparent',
                    borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-primary)'
                  }}>
                  {cat.label}
                </button>
              ))}
            </div>
            
            {/* Sub-options for hovered category */}
            {hoveredCat && (
              <div className="fade-in" style={{ padding: '0.5rem 0.6rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', background: 'var(--color-bg)' }}>
                {TASK_CATEGORIES.find(c => c.label === hoveredCat)?.options.map(opt => (
                  <button key={opt.v} onClick={() => setInput(prev => prev.trimEnd() + ' ' + opt.v + ' ')}
                    style={{ 
                      padding: '0.25rem 0.6rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', 
                      borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--color-text-secondary)',
                      transition: 'all 0.1s'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <form onSubmit={e => { e.preventDefault(); send(); }} style={{ padding: '0.85rem 1rem', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '0.5rem', background: 'var(--color-surface)' }}>
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          placeholder="Ask me anything or type / for commands…"
          disabled={loading}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setInput(''); } }}
          style={{ flex: 1, padding: '0.65rem 0.9rem', borderRadius: 'var(--chat-bubble-shape)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', fontSize: '0.9rem' }}
        />
        <button type="submit" disabled={!input.trim() || loading} style={{ padding: '0 1.1rem', background: 'var(--color-accent)', color: 'white', border: 'none', borderRadius: 'var(--chat-bubble-shape)', cursor: 'pointer', fontWeight: 600, opacity: (!input.trim() || loading) ? 0.5 : 1, transition: 'opacity 0.15s' }}>
          ↑
        </button>
      </form>
    </div>
  );
}
