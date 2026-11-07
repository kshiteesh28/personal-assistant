import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, CheckSquare, Bell,
  StickyNote, Coffee, Settings, MessageCircle, X, Zap
} from 'lucide-react';

import { bootstrap, getAuthToken, api } from './services/api';
import { useEventStream } from './services/sse';
import { useTheme } from './services/theme';
import { requestNotificationPermission, showProactiveNotification, bringToFront } from './services/popups';
import { initCapacitor, updateStatusBarTheme } from './services/capacitor';

import BriefPage from './pages/BriefPage';
import TasksPage from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { RemindersPage } from './pages/RemindersPage';
import { NotesPage } from './pages/NotesPage';
import DowntimePage from './pages/DowntimePage';
import { SettingsPage } from './pages/SettingsPage';

import ChatPanel from './components/ChatPanel';
import NotificationToast from './components/NotificationToast';
import BackgroundVoiceIndicator from './components/BackgroundVoiceIndicator';
import { NetworkStatus } from './components/NetworkStatus';

const NAV_ITEMS = [
  { to: '/',          label: 'Brief',     Icon: LayoutDashboard },
  { to: '/calendar',  label: 'Calendar',  Icon: Calendar        },
  { to: '/tasks',     label: 'Tasks',     Icon: CheckSquare     },
  { to: '/reminders', label: 'Reminders', Icon: Bell            },
  { to: '/notes',     label: 'Notes',     Icon: StickyNote      },
  { to: '/downtime',  label: 'Downtime',  Icon: Coffee          },
  { to: '/settings',  label: 'Settings',  Icon: Settings        },
];

// Primary tabs shown in mobile bottom bar (the rest go to "more")
const PRIMARY_TAB_ITEMS = NAV_ITEMS.slice(0, 5);

function Sidebar() {
  const loc = useLocation();
  const isActive = (to: string) => loc.pathname === to;

  return (
    <aside className="sidebar" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <Zap size={28} color="var(--color-accent)" strokeWidth={2.5} />
      </div>

      {/* Nav links */}
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          className={`sidebar-link${isActive(to) ? ' active' : ''}`}
          title={label}
          aria-current={isActive(to) ? 'page' : undefined}
        >
          <Icon size={20} className="sidebar-link-icon" strokeWidth={isActive(to) ? 2.5 : 2} />
          <span className="sidebar-link-label">{label}</span>
        </Link>
      ))}
    </aside>
  );
}

function BottomTabs() {
  const loc = useLocation();
  const isActive = (to: string) => loc.pathname === to;

  return (
    <nav className="bottom-tabs" aria-label="Main navigation">
      {PRIMARY_TAB_ITEMS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          className={`bottom-tab-link${isActive(to) ? ' active' : ''}`}
          aria-current={isActive(to) ? 'page' : undefined}
        >
          <Icon size={22} strokeWidth={isActive(to) ? 2.5 : 2} />
          {label}
        </Link>
      ))}
      {/* More button for Settings + Downtime */}
      <Link
        to="/settings"
        className={`bottom-tab-link${(isActive('/settings') || isActive('/downtime')) ? ' active' : ''}`}
        aria-label="More"
      >
        <Settings size={22} strokeWidth={isActive('/settings') ? 2.5 : 2} />
        More
      </Link>
    </nav>
  );
}

function AppContent() {
  const { theme, setTheme } = useTheme(); // Note: App currently uses a custom hook, we should sync with Context
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  const [nudgeBadge, setNudgeBadge] = useState(0);
  const [nudgeConfig, setNudgeConfig] = useState<any>({});
  const [bgVoiceListening] = useState(false);
  const [ripples, setRipples] = useState<{ id: number, x: number, y: number }[]>([]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (document.documentElement.getAttribute('data-theme') !== 'abyss') return;
      const id = Date.now();
      setRipples(r => [...r, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setRipples(r => r.filter(rip => rip.id !== id)), 1500);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    api.get<any>('/api/config').then(cfg => {
      if (cfg?.nudgeAppearance) setNudgeConfig(cfg.nudgeAppearance);
      if (cfg?.theme) {
        setTheme(cfg.theme);
        document.documentElement.setAttribute('data-theme', cfg.theme);
        initCapacitor(cfg.theme);
      } else {
        initCapacitor('apple');
      }
    }).catch(() => { initCapacitor('apple'); });
  }, []);

  useEventStream((type, payload: any) => {
    if (type === 'config.changed') {
      api.get<any>('/api/config').then(cfg => {
        if (cfg?.theme) {
          setTheme(cfg.theme);
          document.documentElement.setAttribute('data-theme', cfg.theme);
          updateStatusBarTheme(cfg.theme);
        }
        if (cfg?.nudgeAppearance) setNudgeConfig(cfg.nudgeAppearance);
      }).catch(() => {});
    }
    if ((type === 'flowstate.nudge' || type === 'secretary.nudge') && !chatOpen) {
      setNudgeBadge(n => n + 1);
    }
    if (type === 'brief.ready') {
      requestNotificationPermission().then(perm => {
        if (perm === 'granted') { showProactiveNotification('Daily Brief Ready', `Your brief for ${payload.date} is ready!`); bringToFront(); }
      });
    }
    if (type === 'meeting.approaching') {
      requestNotificationPermission().then(perm => {
        const mins = Math.round(payload.startsInMs / 60000);
        if (perm === 'granted') showProactiveNotification(payload.title, `Starts in ${mins} minute${mins !== 1 ? 's' : ''}`);
      });
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'k') { e.preventDefault(); setChatOpen(v => !v); }
      if (mod && e.key === 'n') { e.preventDefault(); navigate('/tasks', { state: { openCreate: true } }); }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); setChatOpen(true);
      }
      if (e.key === 'Escape') setChatOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [navigate]);

  useEffect(() => {
    const handler = (_e: CustomEvent) => { setChatOpen(true); };
    window.addEventListener('chat-command', handler as EventListener);
    return () => window.removeEventListener('chat-command', handler as EventListener);
  }, []);

  const loc = useLocation();

  return (
    <div className="app-layout">
      {/* Global Morphing UI SVGs */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id="heat-haze">
            <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="2" result="noise">
              <animate attributeName="baseFrequency" values="0.015;0.02;0.015" dur="4s" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* Global Ripples */}
      {ripples.map(r => (
        <div key={r.id} className="abyss-ripple" style={{ left: r.x, top: r.y }} />
      ))}

      {/* Collapsible sidebar — desktop & tablet */}
      <Sidebar />

      {/* Main content area */}
      <main id="main-content" className="app-main" tabIndex={-1}>
        {/* Page transitions wrapper — re-mounts on route change */}
        <div key={loc.pathname} className="page-transition">
          <Routes>
            <Route path="/" element={<BriefPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/downtime" element={<DowntimePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <BottomTabs />

      {/* Chat FAB */}
      <button
        className="chat-fab"
        onClick={() => { setChatOpen(v => !v); setNudgeBadge(0); }}
        aria-label={chatOpen ? 'Close chat' : 'Open chat'}
        style={{ bottom: 'calc(var(--bottom-tab-height, 0px) + 1.25rem)' }}
      >
        {chatOpen
          ? <X size={20} strokeWidth={2.5} />
          : <MessageCircle size={20} strokeWidth={2} />
        }
        {nudgeBadge > 0 && !chatOpen && (
          <span className="chat-fab-badge">{nudgeBadge > 9 ? '9+' : nudgeBadge}</span>
        )}
      </button>

      {/* Chat Panel */}
      {chatOpen && <ChatPanel />}

      {/* Background voice indicator */}
      <BackgroundVoiceIndicator isListening={bgVoiceListening} />

      {/* Notification toasts */}
      <NotificationToast
        position={nudgeConfig.position ?? 'bottom-right'}
        soundEnabled={nudgeConfig.soundEnabled ?? false}
        customSoundUrl={nudgeConfig.customSoundDataUrl}
      />

      {/* Network offline banner (Phase 6) */}
      <NetworkStatus />
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    bootstrap().then(() => {
      if (getAuthToken()) setAuth(true);
      else setError('Could not get auth token. Is the server running on port 3000?');
    }).catch(err => setError(err.message));
  }, []);

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1.25rem', padding: '2rem', textAlign: 'center' }}>
      <Zap size={48} color="var(--color-red)" />
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Connection Error</h1>
      <p style={{ color: 'var(--color-text-secondary)', maxWidth: '360px', fontSize: '0.9rem', lineHeight: 1.6 }}>{error}</p>
      <button className="btn-secondary" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );

  if (!auth) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: '1rem' }}>
      <Zap size={40} color="var(--color-accent)" strokeWidth={2} style={{ animation: 'pulse 1.5s infinite' }} />
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>Connecting to Flow-State…</p>
    </div>
  );

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
