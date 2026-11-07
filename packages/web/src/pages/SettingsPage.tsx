import { useState, useEffect } from 'react';
import { 
  Palette, Bell, Bot, Calendar, Mic, MessageSquare, 
  FlaskConical, Database, Monitor, Save, Download, 
  Upload, CheckCircle2, Shield, Clock, Zap, 
  Sun, Moon, Flame, Leaf, Droplet, Command, Trash2, RefreshCw
} from 'lucide-react';

import { api } from '../services/api';
import { useTheme } from '../services/theme';
import { BentoCard } from '../components/BentoCard';
import { hapticFeedback } from '../services/capacitor';
interface Config {
  theme?: string;
  notifications?: { 
    triggers?: { dailyBrief?: boolean; preMeeting?: boolean; breakReminder?: boolean; reminderDue?: boolean }; 
    dailyBriefTime?: string; 
    preMeetingMinutes?: number; 
  };
  proactive?: { 
    enabled?: boolean; wellnessEnabled?: boolean; breakEnabled?: boolean; checkinEnabled?: boolean; 
    motivationEnabled?: boolean; summaryEnabled?: boolean; workHoursStart?: string; workHoursEnd?: string; 
    morningKickoffTime?: string; wellnessIntervalMin?: number; breakReminderCooldownMin?: number;
    taskCheckinCooldownMin?: number; motivationIntervalMin?: number;
    scheduleDayStart?: string;
    scheduleDayEnd?: string;
    scheduleLunchStartTime?: string;
    scheduleDinnerStartTime?: string;
    scheduleBufferBeforeMeetingMin?: number;
    scheduleBufferAfterMeetingMin?: number;
  };
  tracking?: { enabled?: boolean; focusBlockMaxMinutes?: number; };
  nudgeAppearance?: { position?: string; soundEnabled?: boolean; };
  voice?: { enabled?: boolean; alwaysOn?: boolean; wakeWord?: string; ttsEnabled?: boolean; };
  server?: { authToken?: string; };
}

export const SettingsPage = () => {
  const { setTheme } = useTheme();
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<any>(null);
  const [nudgeTest, setNudgeTest] = useState({ category: 'wellness', message: '' });
  const [nudgeSending, setNudgeSending] = useState(false);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadConfig();
    loadVoiceStatus();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await api.get<Config>('/api/config');
      setConfig(data ?? {});
      if (data?.theme) setTheme(data.theme);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadVoiceStatus = async () => {
    try { setVoiceStatus(await api.get('/api/voice/status')); }
    catch { setVoiceStatus({ ready: false }); }
  };

  const patch = (path: string[], value: any) => {
    setConfig(prev => {
      const next: any = { ...prev };
      let cur = next;
      for (let i = 0; i < path.length - 1; i++) {
        cur[path[i]] = { ...(cur[path[i]] ?? {}) };
        cur = cur[path[i]];
      }
      cur[path[path.length - 1]] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/api/config', config);
      setSaved(true);
      hapticFeedback('medium');
      setTimeout(() => setSaved(false), 3000);
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: 'Settings saved successfully' } }));
    } catch (e) { 
      alert('Failed to save settings'); 
      hapticFeedback('heavy');
    }
    finally { setSaving(false); }
  };

  const handleTestNudge = async () => {
    setNudgeSending(true);
    try {
      await api.post('/api/test-nudge', { category: nudgeTest.category, ...(nudgeTest.message ? { message: nudgeTest.message } : {}) });
    } catch (e) { alert('Failed to send test nudge'); }
    finally { setNudgeSending(false); }
  };

  const handleExport = async () => {
    try {
      const data = await api.get('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `secretary-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
    } catch { alert('Export failed'); }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const payload = JSON.parse(ev.target?.result as string);
        const result: any = await api.post('/api/import', { payload, mode: importMode });
        if (result?.success === false && result?.conflicts?.length) {
          alert(`Import has ${result.conflicts.length} conflicts. Choose conflict_resolution in the request.`);
        } else { alert('Import successful! Reload the page to see changes.'); }
      } catch { alert('Import failed — invalid file format'); }
    };
    reader.readAsText(file);
  };

  if (loading) return (
    <div className="bento-grid fade-in">
      <BentoCard colSpan={2} loading />
      <BentoCard colSpan={2} loading />
      <BentoCard loading />
      <BentoCard loading />
    </div>
  );

  /* ─── UI Helper Components ─────────────────────────────── */

  const SectionHeader = ({ icon: Icon, label, color = 'var(--color-accent)' }: { icon: any; label: string; color?: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
      <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: `color-mix(in srgb, ${color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
        <Icon size={18} />
      </div>
      <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-primary)' }}>
        {label}
      </span>
    </div>
  );

  const ToggleRow = ({ label, sublabel, checked, onChange }: { label: string; sublabel?: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', cursor: 'pointer' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</div>
        {sublabel && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{sublabel}</div>}
      </div>
      <div className="toggle-switch">
        <input type="checkbox" checked={!!checked} onChange={e => { onChange(e.target.checked); hapticFeedback('light'); }} />
        <span className="toggle-slider"></span>
      </div>
    </label>
  );

  const InputGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="form-group" style={{ marginBottom: '1rem' }}>
      <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)', marginBottom: '0.4rem', display: 'block' }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.8rem, 5vw, 2.5rem)', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>Settings</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem', marginTop: '0.4rem' }}>Configure your premium assistant experience</p>
        </div>
        <button 
          className="btn-primary" 
          onClick={handleSave} 
          disabled={saving}
          style={{ padding: '0.75rem 1.5rem', borderRadius: 'var(--chat-bubble-shape)', minWidth: '140px', boxShadow: 'var(--shadow-lg)' }}
        >
          {saving ? <><RefreshCw size={16} className="animate-spin" style={{ marginRight: '8px' }} /> Saving...</> : saved ? <><CheckCircle2 size={16} style={{ marginRight: '8px' }} /> Saved</> : <><Save size={16} style={{ marginRight: '8px' }} /> Save Changes</>}
        </button>
      </div>

      <div className="bento-grid">
        
        {/* 1. Appearance ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.5rem">
          <SectionHeader icon={Palette} label="Appearance" color="var(--color-purple)" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {(['apple', 'forge', 'archive', 'abyss'] as const).map(t => {
              const active = (config.theme === t) || (!config.theme && t === 'apple');
              return (
                <label key={t} style={{ cursor: 'pointer', position: 'relative' }}>
                  <input 
                    type="radio" 
                    name="theme" 
                    value={t} 
                    checked={active}
                    onChange={() => { patch(['theme'], t); setTheme(t); hapticFeedback('light'); }} 
                    style={{ position: 'absolute', opacity: 0 }} 
                  />
                  <div style={{ 
                    border: `2px solid ${active ? 'var(--color-accent)' : 'var(--glass-border)'}`, 
                    background: active ? 'color-mix(in srgb, var(--color-accent) 4%, var(--color-bg))' : 'var(--color-surface)',
                    borderRadius: 'var(--chat-bubble-shape)', 
                    padding: '1.25rem 1rem', 
                    textAlign: 'center', 
                    transition: 'var(--transition)',
                    boxShadow: active ? 'var(--shadow-md)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '130px'
                  }}>
                    <div style={{ 
                      width: '100%', 
                      height: '48px', 
                      borderRadius: '8px', 
                      marginBottom: '0.75rem', 
                      background: t === 'apple' ? 'linear-gradient(135deg, #f5f5f7 0%, #d1d1d6 100%)' : t === 'forge' ? 'linear-gradient(135deg, #ef4444 0%, #450a0a 100%)' : t === 'archive' ? 'linear-gradient(135deg, #22c55e 0%, #14532d 100%)' : 'linear-gradient(135deg, #0ea5e9 0%, #030712 100%)',
                      border: '1px solid var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {t === 'apple' ? <Sun size={20} color="#1d1d1f" /> : t === 'forge' ? <Flame size={20} color="#fca5a5" /> : t === 'archive' ? <Leaf size={20} color="#ecfccb" /> : <Droplet size={20} color="#e0f2fe" />}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: active ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {t === 'apple' ? 'Light Breeze' : t === 'forge' ? 'Eternal Forge' : t === 'archive' ? 'Overgrown Archive' : 'Abyssal Focus'}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        </BentoCard>

        {/* 2. Notifications ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.5rem">
          <SectionHeader icon={Bell} label="Smart Notifications" color="var(--color-orange)" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem 2rem' }}>
            <ToggleRow label="Daily Briefing" sublabel="Morning overview of your day" checked={!!config.notifications?.triggers?.dailyBrief} onChange={v => patch(['notifications', 'triggers', 'dailyBrief'], v)} />
            <ToggleRow label="Pre-Meeting Alerts" sublabel="Notification before events" checked={!!config.notifications?.triggers?.preMeeting} onChange={v => patch(['notifications', 'triggers', 'preMeeting'], v)} />
            <ToggleRow label="Break Reminders" sublabel="Automatic flow breaks" checked={!!config.notifications?.triggers?.breakReminder} onChange={v => patch(['notifications', 'triggers', 'breakReminder'], v)} />
            <ToggleRow label="Reminders History" sublabel="Due task notifications" checked={!!config.notifications?.triggers?.reminderDue} onChange={v => patch(['notifications', 'triggers', 'reminderDue'], v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
            <InputGroup label="Briefing Time">
              <div style={{ position: 'relative' }}>
                <Clock size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                <input type="time" value={config.notifications?.dailyBriefTime ?? '08:00'} onChange={e => patch(['notifications', 'dailyBriefTime'], e.target.value)} style={{ paddingLeft: '2.25rem' }} />
              </div>
            </InputGroup>
            <InputGroup label="Pre-Meeting Buffer">
              <div style={{ position: 'relative' }}>
                <Clock size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                <input type="number" min={1} max={60} value={config.notifications?.preMeetingMinutes ?? 10} onChange={e => patch(['notifications', 'preMeetingMinutes'], +e.target.value)} style={{ paddingLeft: '2.25rem' }} />
                <span style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>min</span>
              </div>
            </InputGroup>
          </div>
        </BentoCard>

        {/* 3. Proactive ──── col-span-2 row-span-2 */}
        <BentoCard colSpan={2} rowSpan={2} padding="1.5rem">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <SectionHeader icon={Bot} label="Proactive AI Intelligence" color="var(--color-accent)" />
            <div className="toggle-switch">
              <input type="checkbox" checked={!!config.proactive?.enabled} onChange={e => { patch(['proactive', 'enabled'], e.target.checked); hapticFeedback('medium'); }} />
              <span className="toggle-slider"></span>
            </div>
          </div>
          
          <div style={{ opacity: config.proactive?.enabled ? 1 : 0.4, transition: 'var(--transition)', pointerEvents: config.proactive?.enabled ? 'auto' : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <ToggleRow label="Wellness Nudges" sublabel="Mental health & posture check-ins" checked={!!config.proactive?.wellnessEnabled} onChange={v => patch(['proactive', 'wellnessEnabled'], v)} />
              {config.proactive?.wellnessEnabled && (
                <div style={{ marginLeft: '1.5rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--color-surface)', padding: '0.75rem', borderRadius: 'var(--chat-bubble-shape)' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Interval (min)</span>
                  <input type="number" min={15} max={480} value={config.proactive?.wellnessIntervalMin ?? 90} onChange={e => patch(['proactive', 'wellnessIntervalMin'], +e.target.value)} style={{ width: '80px', height: '32px', textAlign: 'center' }} />
                </div>
              )}
              
              <ToggleRow label="Smart Break Logic" sublabel="AI suggests breaks based on activity" checked={!!config.proactive?.breakEnabled} onChange={v => patch(['proactive', 'breakEnabled'], v)} />
              <ToggleRow label="Focus Check-ins" sublabel="Subtle nudges to keep you on track" checked={!!config.proactive?.checkinEnabled} onChange={v => patch(['proactive', 'checkinEnabled'], v)} />
              <ToggleRow label="Motivation Boosts" sublabel="Custom quotes and energy pushes" checked={!!config.proactive?.motivationEnabled} onChange={v => patch(['proactive', 'motivationEnabled'], v)} />
              <ToggleRow label="End-of-day Summaries" sublabel="Complete overview of accomplishments" checked={!!config.proactive?.summaryEnabled} onChange={v => patch(['proactive', 'summaryEnabled'], v)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
              <InputGroup label="Work Flow Starts">
                <input type="time" value={config.proactive?.workHoursStart ?? '09:00'} onChange={e => {
                  patch(['proactive', 'workHoursStart'], e.target.value);
                  patch(['proactive', 'scheduleDayStart'], e.target.value);
                }} />
              </InputGroup>
              <InputGroup label="Work Flow Ends">
                <input type="time" value={config.proactive?.workHoursEnd ?? '18:00'} onChange={e => {
                  patch(['proactive', 'workHoursEnd'], e.target.value);
                  patch(['proactive', 'scheduleDayEnd'], e.target.value);
                }} />
              </InputGroup>
              <div style={{ gridColumn: 'span 2' }}>
                <InputGroup label="Morning Kickoff Session">
                  <input type="time" value={config.proactive?.morningKickoffTime ?? '08:30'} onChange={e => patch(['proactive', 'morningKickoffTime'], e.target.value)} />
                </InputGroup>
              </div>
            </div>
          </div>
        </BentoCard>

        {/* 4. Voice ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.5rem">
          <SectionHeader icon={Mic} label="Voice & Language" color="var(--color-blue)" />
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <div style={{ flex: 1, minWidth: '200px' }}><ToggleRow label="Voice Engine" sublabel="Enable speech recognition" checked={!!config.voice?.enabled} onChange={v => patch(['voice', 'enabled'], v)} /></div>
            <div style={{ flex: 1, minWidth: '200px' }}><ToggleRow label="Always Listening" sublabel="Wake word activation" checked={!!config.voice?.alwaysOn} onChange={v => patch(['voice', 'alwaysOn'], v)} /></div>
            <div style={{ flex: 1, minWidth: '200px' }}><ToggleRow label="Speech Synthesis (TTS)" sublabel="Assistant can speak to you" checked={!!config.voice?.ttsEnabled} onChange={v => patch(['voice', 'ttsEnabled'], v)} /></div>
          </div>
          
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <InputGroup label="AI Designation (Wake Word)">
                <div style={{ position: 'relative' }}>
                  <Command size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                  <input type="text" value={config.voice?.wakeWord ?? 'Secretary'} onChange={e => patch(['voice', 'wakeWord'], e.target.value)} placeholder="e.g. Secretary" style={{ paddingLeft: '2.25rem' }} />
                </div>
              </InputGroup>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <button className="btn-secondary" onClick={() => { loadVoiceStatus(); hapticFeedback('light'); }} style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RefreshCw size={14} /> Status
              </button>
            </div>
          </div>

          {voiceStatus && (
            <div style={{ 
              padding: '1rem', 
              background: 'var(--color-bg)', 
              borderRadius: 'var(--chat-bubble-shape)', 
              border: `1px solid ${voiceStatus.ready ? 'var(--color-green)' : 'var(--color-red)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              animation: 'slideInUp 0.3s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: voiceStatus.ready ? 'var(--color-green)' : 'var(--color-red)', boxShadow: `0 0 10px ${voiceStatus.ready ? 'var(--color-green)' : 'var(--color-red)'}` }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{voiceStatus.ready ? 'ENGINE RESPONSIVE' : 'ENGINE DISCONNECTED'}</span>
              </div>
              {voiceStatus.binaryPath && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{voiceStatus.binaryPath}</span>}
            </div>
          )}
        </BentoCard>

        {/* 5. Scheduling ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.5rem">
          <SectionHeader icon={Calendar} label="Intelligent Scheduling" color="var(--color-green)" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
            <InputGroup label="Daily Start"><input type="time" value={config.proactive?.scheduleDayStart ?? '08:00'} onChange={e => patch(['proactive', 'scheduleDayStart'], e.target.value)} /></InputGroup>
            <InputGroup label="Daily End"><input type="time" value={config.proactive?.scheduleDayEnd ?? '20:00'} onChange={e => patch(['proactive', 'scheduleDayEnd'], e.target.value)} /></InputGroup>
            <InputGroup label="Lunch Time"><input type="time" value={config.proactive?.scheduleLunchStartTime ?? '12:30'} onChange={e => patch(['proactive', 'scheduleLunchStartTime'], e.target.value)} /></InputGroup>
            <InputGroup label="Dinner Time"><input type="time" value={config.proactive?.scheduleDinnerStartTime ?? '19:30'} onChange={e => patch(['proactive', 'scheduleDinnerStartTime'], e.target.value)} /></InputGroup>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
            <InputGroup label="Pre-Event Buffer (min)">
              <input type="number" min={0} max={60} value={config.proactive?.scheduleBufferBeforeMeetingMin ?? 5} onChange={e => patch(['proactive', 'scheduleBufferBeforeMeetingMin'], +e.target.value)} />
            </InputGroup>
            <InputGroup label="Post-Event Buffer (min)">
              <input type="number" min={0} max={60} value={config.proactive?.scheduleBufferAfterMeetingMin ?? 5} onChange={e => patch(['proactive', 'scheduleBufferAfterMeetingMin'], +e.target.value)} />
            </InputGroup>
          </div>
        </BentoCard>

        {/* 6. Tracking ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.5rem">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <SectionHeader icon={Monitor} label="Activity & Focus" color="var(--color-purple)" />
            <div className="toggle-switch">
              <input type="checkbox" checked={!!config.tracking?.enabled} onChange={e => patch(['tracking', 'enabled'], e.target.checked)} />
              <span className="toggle-slider"></span>
            </div>
          </div>
          <div style={{ opacity: config.tracking?.enabled ? 1 : 0.4, transition: 'var(--transition)', pointerEvents: config.tracking?.enabled ? 'auto' : 'none' }}>
            <InputGroup label="Maximum Continuous Focus (minutes)">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input type="range" min={15} max={180} step={5} value={config.tracking?.focusBlockMaxMinutes ?? 90} onChange={e => patch(['tracking', 'focusBlockMaxMinutes'], +e.target.value)} style={{ flex: 1, accentColor: 'var(--color-accent)' }} />
                <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-accent)', minWidth: '40px' }}>{config.tracking?.focusBlockMaxMinutes ?? 90}m</span>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem' }}>Triggers a break suggestion after this duration of continuous focus activity detected.</p>
            </InputGroup>
          </div>
        </BentoCard>

        {/* 7. Nudge Look ──── col-span-1 */}
        <BentoCard colSpan={1} padding="1.5rem">
          <SectionHeader icon={MessageSquare} label="UI Mechanics" />
          <InputGroup label="Toast Position">
            <select value={config.nudgeAppearance?.position ?? 'bottom-right'} onChange={e => patch(['nudgeAppearance', 'position'], e.target.value)}>
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
            </select>
          </InputGroup>
          <ToggleRow label="Audible Feedback" sublabel="Play sounds for nudges" checked={!!config.nudgeAppearance?.soundEnabled} onChange={v => patch(['nudgeAppearance', 'soundEnabled'], v)} />
        </BentoCard>

        {/* 8. Debug/Test ──── col-span-1 */}
        <BentoCard colSpan={1} padding="1.5rem" style={{ display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon={FlaskConical} label="Live Diagnostic" color="var(--color-red)" />
          <div style={{ flex: 1 }}>
            <InputGroup label="Signal Pulse">
              <select value={nudgeTest.category} onChange={e => setNudgeTest(p => ({ ...p, category: e.target.value }))} style={{ marginBottom: '0.75rem' }}>
                <option value="wellness">🌿 Wellness</option>
                <option value="break">☕ Break</option>
                <option value="checkin">✅ Check-in</option>
                <option value="motivation">⚡ Motivation</option>
                <option value="summary">📊 Summary</option>
              </select>
              <button 
                className="btn-secondary w-full" 
                onClick={handleTestNudge} 
                disabled={nudgeSending}
                style={{ height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--color-red)', borderColor: 'color-mix(in srgb, var(--color-red) 30%, var(--glass-border))' }}
              >
                {nudgeSending ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />} 
                {nudgeSending ? 'Firing...' : 'Trigger Simulation'}
              </button>
            </InputGroup>
          </div>
        </BentoCard>

        {/* 9. Data Vault ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.5rem">
          <SectionHeader icon={Database} label="System Data & Privacy" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                Securely backup your configuration, tasks, and notes to a local JSON file. 
              </p>
              <button className="btn-secondary w-full" onClick={() => { handleExport(); hapticFeedback('medium'); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Download size={16} /> Export Vault
              </button>
            </div>
            
            <div style={{ borderLeft: '1px solid var(--glass-border)', paddingLeft: '2rem' }}>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                {(['merge', 'replace'] as const).map(m => (
                  <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                    <input type="radio" name="importMode" checked={importMode === m} onChange={() => setImportMode(m)} style={{ accentColor: 'var(--color-accent)' }} />
                    {m.toUpperCase()}
                  </label>
                ))}
              </div>
              <label className="btn-secondary w-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', height: '42px' }}>
                <Upload size={16} /> Restoration
                <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
        </BentoCard>

        {/* 10. Admin/Danger Zone ──── col-span-2 */}
        <BentoCard colSpan={2} padding="1.25rem" style={{ border: '1px solid color-mix(in srgb, var(--color-red) 20%, var(--glass-border))' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Shield size={18} color="var(--color-red)" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-red)' }}>Security & Auth</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>Token: {config.server?.authToken?.slice(0, 8)}...</div>
              </div>
            </div>
            <button 
              className="btn-secondary" 
              onClick={() => { if(confirm('Factory reset app?')) alert('Feature pending'); }}
              style={{ color: 'var(--color-red)', borderColor: 'transparent', fontSize: '0.75rem', fontWeight: 700 }}
            >
              <Trash2 size={14} style={{ marginRight: '6px' }} /> Wipe Identity
            </button>
          </div>
        </BentoCard>

      </div>

      <div style={{ height: '40px' }} /> {/* Spacing for bottom nav */}
    </div>
  );
};

export default SettingsPage;
