import { useEffect, useState } from 'react';
import {
  RefreshCw, Zap, AlertTriangle, Clock, Calendar, Bell,
  Play, CheckCircle2, Timer
} from 'lucide-react';

import { api } from '../services/api';
import type { Brief } from '@secretary/shared';
import { useEventStream } from '../services/sse';
import { OrganicContainer } from '../components/OrganicContainer';
import { ProgressRing } from '../components/ProgressRing';

/* ── Energy badge ──────────────────────────────────────────── */
function EnergyBadge({ level }: { level?: string }) {
  if (!level) return null;
  const map: Record<string, { cls: string; label: string }> = {
    high:   { cls: 'badge-energy badge-energy-high',   label: '⚡ High' },
    medium: { cls: 'badge-energy badge-energy-medium', label: '◎ Med'  },
    low:    { cls: 'badge-energy badge-energy-low',    label: '❄ Low'  },
  };
  const e = map[level] || map['medium'];
  return <span className={e.cls}>{e.label}</span>;
}

/* ── Greeting helper ────────────────────────────────────────── */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ── Time formatter ─────────────────────────────────────────── */
const fmt    = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ts: number) => new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

/* ── Block type color map ───────────────────────────────────── */
const BLOCK_COLORS: Record<string, string> = {
  meeting: 'var(--color-blue)',
  task:    'var(--color-accent)',
  buffer:  'var(--color-border-strong)',
  lunch:   'var(--color-orange)',
  dinner:  'var(--color-orange)',
  break:   'var(--color-green)',
  flex:    'var(--color-text-tertiary)',
};

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function BriefPage() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [showTriage, setShowTriage] = useState(false);
  const [triageData, setTriageData] = useState({ goalAchieved: false, carryOver: true, blockDeepWork: true });

  const today = new Date().toISOString().split('T')[0];
  const now   = Date.now();

  const [conflictTask, setConflictTask] = useState<any>(null);
  const [customTrim, setCustomTrim] = useState<number>(30);

  const fetchBrief = async () => {
    setLoading(true); setError('');
    try { 
      const data = await api.get<Brief>(`/api/brief/${today}`);
      setBrief(data); 

      // Check for overflow conflicts that need user input
      const trimConflict = data.schedule?.overflow?.find(o => o.action === 'trim');
      if (trimConflict) {
        const task = (data.tasks ?? []).find(t => t.id === trimConflict.task_id);
        if (task) {
          setConflictTask({ ...task, suggestion: trimConflict.suggested_estimate });
          setCustomTrim(trimConflict.suggested_estimate || 30);
        }
      }
    }
    catch (e: any) { setError('Failed to load brief. Is the server running?'); }
    finally { setLoading(false); }
  };

  const generateSchedule = async () => {
    setGenerating(true);
    try { await api.post('/api/schedule/generate', { date: today }); await fetchBrief(); }
    catch { alert('Schedule generation failed.'); }
    finally { setGenerating(false); }
  };

  useEffect(() => { fetchBrief(); }, []);

  useEventStream((type: string, payload: any) => {
    if (type === 'brief.ready' && payload?.date === today) fetchBrief();
    if (type === 'data.changed') fetchBrief();
  });

  const updateExternalStatus = (status: string | null) => {
    document.title = status ? `⚡ ${status} – Flow-State` : 'Flow-State';
    window.dispatchEvent(new CustomEvent('toggle-silence', { detail: !!status }));
  };

  const handleTaskAction = async (id: string, action: 'start' | 'complete' | 'progress', value?: number) => {
    try {
      if (action === 'complete') {
        await api.put(`/api/tasks/${id}`, { status: 'done', progress: 100 });
        updateExternalStatus(null);
        const remaining = (brief?.tasks ?? []).filter(t => t.id !== id && (t.status === 'todo' || t.status === 'in_progress'));
        if (remaining.length === 0) setShowTriage(true);
      } else if (action === 'start') {
        await api.patch(`/api/tasks/${id}/progress`, { progress: 5 });
        const task = (brief?.tasks ?? []).find(t => t.id === id);
        if (task) updateExternalStatus(task.title);
      } else if (action === 'progress' && value !== undefined) {
        await api.patch(`/api/tasks/${id}/progress`, { progress: value });
      }
      fetchBrief();
    } catch (e) { console.error('Task action failed', e); }
  };

  const handleMeetingFinished = async (id: string) => {
    try {
      await api.put(`/api/events/${id}`, { end_ts: now });
      fetchBrief();
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: 'Meeting finished early! Checking for downtime suggestions…' } }));
    } catch (e) { console.error('Meeting finish failed', e); }
  };

  const handleConflictResolve = async (action: 'trim' | 'defer') => {
    if (!conflictTask) return;
    try {
      if (action === 'trim') {
        await api.put(`/api/tasks/${conflictTask.id}`, { time_estimate: customTrim });
      } else {
        // Move to tomorrow (set due_ts to tomorrow morning)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        await api.put(`/api/tasks/${conflictTask.id}`, { due_ts: tomorrow.getTime(), pinned_time: null });
      }
      setConflictTask(null);
      generateSchedule(); // re-gen with new values
    } catch (e) {
      console.error('Resolve failed', e);
    }
  };

  /* ── Derived data ─────────────────────────────────────────── */
  const activeTasks = (brief?.tasks ?? []).filter(t => t.status === 'todo' || t.status === 'in_progress');
  const doneTasks   = (brief?.tasks ?? []).filter(t => t.status === 'done' && t.progress !== undefined);
  const totalTasks  = activeTasks.length + doneTasks.length;
  const completedPct = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0;

  const overdue   = brief?.overdue_tasks ?? [];
  const events    = (brief?.events ?? []).filter(e => e.all_day || e.end_ts > now || e.start_ts >= now);
  const reminders = (brief?.reminders ?? []).filter(r => r.status === 'active');
  const blocks = (brief?.schedule?.blocks ?? []).filter(b => {
    if (b.end_ts > now || b.start_ts >= now) return true;
    // If it's a task that isn't done yet, keep it so it's visible in the schedule list
    if (b.type === 'task' && b.task_id) {
      const t = (brief?.tasks ?? []).find(x => x.id === b.task_id);
      return t && t.status !== 'done';
    }
    return false;
  });

  /* ── Loading state ────────────────────────────────────────── */
  if (loading && !brief) return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', justifyContent: 'center' }} className="fade-in">
      <OrganicContainer priority={1} style={{ width: '600px', height: '180px' }} className="skeleton"><div/></OrganicContainer>
      <OrganicContainer priority={3} style={{ width: '300px', height: '150px' }} className="skeleton"><div/></OrganicContainer>
      <OrganicContainer priority={3} style={{ width: '300px', height: '150px' }} className="skeleton"><div/></OrganicContainer>
      <OrganicContainer priority={2} style={{ width: '500px', height: '200px' }} className="skeleton"><div/></OrganicContainer>
      <OrganicContainer priority={2} style={{ width: '500px', height: '200px' }} className="skeleton"><div/></OrganicContainer>
    </div>
  );

  /* ── Error state ──────────────────────────────────────────── */
  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem', textAlign: 'center' }}>
      <AlertTriangle size={48} color="var(--color-red)" />
      <p style={{ color: 'var(--color-text-secondary)' }}>{error}</p>
      <button className="btn-secondary" onClick={fetchBrief}>Retry</button>
    </div>
  );

  if (!brief) return null;

  /* ════════════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════════ */
  return (
    <div className="fade-in">

      {/* ── Page header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {getGreeting()} 👋
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            {new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={fetchBrief} style={{ gap: '0.4rem', fontSize: '0.85rem', padding: '0.5rem 0.9rem' }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn-primary" onClick={generateSchedule} disabled={generating} style={{ gap: '0.4rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
            <Zap size={14} />
            {generating ? 'Generating…' : 'Generate Schedule'}
          </button>
        </div>
      </div>

      {/* ── Core Layout ──────────────────────── */}
      <div className="bento-grid" style={{ display: 'grid', gap: '1.5rem', padding: '1rem 0' }}>

        {/* 1. Progress Metric */}
        <div className="glass-card squircle-block" style={{ width: '100%', padding: '2.5rem 2rem', gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: '0.5rem' }}>
                Daily Progress
              </div>
              <div style={{ fontSize: 'clamp(1.8rem, 5vw, 2.5rem)', fontWeight: 900, letterSpacing: '-0.04em', color: 'var(--color-text-primary)', lineHeight: 1 }}>
                {doneTasks.length}
                <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--color-text-tertiary)', marginLeft: '4px' }}>/ {totalTasks} done</span>
              </div>
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <StatChip icon={<CheckCircle2 size={13} />} label={`${activeTasks.length} active`} color="var(--color-accent)" />
                {events.length > 0 && <StatChip icon={<Calendar size={13} />} label={`${events.length} events`} color="var(--color-blue)" />}
                {reminders.length > 0 && <StatChip icon={<Bell size={13} />} label={`${reminders.length} reminders`} color="var(--color-orange)" />}
              </div>
            </div>
            <ProgressRing
              value={completedPct}
              completed={doneTasks.length}
              total={totalTasks}
              size={110}
              strokeWidth={9}
            />
          </div>
        </div>

        {/* 2. Today's Schedule */}
        <div className="glass-card squircle-block" style={{ width: '100%', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <SectionHeader icon={<Clock size={15} />} label="Today's Schedule" />
          {blocks.length === 0 ? (
            <EmptyState message="No upcoming blocks. Generate a schedule!" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
              {blocks.map((b, i) => {
                const task = b.task_id ? (brief.tasks ?? []).find(x => x.id === b.task_id) : null;
                const isDone = task?.status === 'done';
                const isInProgress = !isDone && (task?.progress || 0) > 0;

                return (
                  <div
                    key={i}
                    className={isInProgress ? 'schedule-block-active' : ''}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      background: 'var(--color-surface)',
                      borderRadius: 'var(--chat-bubble-shape, 12px)',
                      borderLeft: `3px solid ${BLOCK_COLORS[b.type] ?? 'var(--color-border)'}`,
                      opacity: isDone ? 0.5 : 1,
                      transition: 'all 0.25s ease',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', minWidth: '88px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {fmt(b.start_ts)}–{fmt(b.end_ts)}
                    </span>
                    <span style={{ flex: 1, fontWeight: 600, textDecoration: isDone ? 'line-through' : 'none' }}>{b.title}</span>
                    {b.energy_band && <EnergyBadge level={b.energy_band} />}
                    {b.type === 'task' && b.task_id && !isDone && (
                      <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                        {isInProgress ? (
                          <>
                            <span style={{ color: 'var(--color-accent)', fontSize: '0.7rem', fontWeight: 700 }}>⚡ Active</span>
                            <ActionBtn onClick={() => handleTaskAction(b.task_id!, 'complete')} color="var(--color-green)" label="Done">
                              <CheckCircle2 size={12} />
                            </ActionBtn>
                          </>
                        ) : (
                          <>
                            <ActionBtn onClick={() => handleTaskAction(b.task_id!, 'start')} label="Start">
                              <Play size={12} />
                            </ActionBtn>
                            <ActionBtn onClick={() => handleTaskAction(b.task_id!, 'complete')} color="var(--color-green)" label="Done">
                              <CheckCircle2 size={12} />
                            </ActionBtn>
                          </>
                        )}
                      </div>
                    )}
                    {b.type === 'meeting' && b.event_id && (
                      <ActionBtn onClick={() => handleMeetingFinished(b.event_id!)} color="var(--color-orange)" label="Done early">
                        <Timer size={12} />
                      </ActionBtn>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {(brief.schedule?.overflow ?? []).length > 0 && (
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {brief.schedule!.overflow.map((o: any, idx: number) => {
                const task = (brief.tasks ?? []).find(t => t.id === o.task_id);
                if (!task) return null;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setConflictTask({ ...task, suggestion: o.suggested_estimate });
                      setCustomTrim(o.suggested_estimate || 30);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      background: 'color-mix(in srgb, var(--color-orange) 10%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--color-orange) 30%, transparent)',
                      borderRadius: 'var(--task-radius-low, 12px)',
                      fontSize: '0.8rem',
                      color: 'var(--color-orange)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Zap size={13} fill="var(--color-orange)" />
                    <span style={{ flex: 1 }}>{task.title} Conflict – Fix now</span>
                    <span style={{ fontSize: '0.7rem', opacity: 0.8, background: 'var(--color-orange)', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>TRIM available</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3 & 4. Sidebar Flow (Events & Reminders) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Events */}
          <div className="glass-card squircle-block" style={{ width: '100%', padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: events.length > 3 ? '1' : 'auto' }}>
            <SectionHeader icon={<Calendar size={15} color="var(--color-blue)" />} label={`Events (${events.length})`} />
            {events.length === 0 ? (
              <EmptyState message="No upcoming meetings." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                {events.slice(0, 5).map(e => (
                  <div key={e.id} style={{ padding: '0.6rem 0.75rem', background: 'var(--color-surface)', borderRadius: 'var(--chat-bubble-shape, 12px)', borderLeft: '3px solid var(--color-blue)', fontSize: '0.82rem' }}>
                    <div style={{ fontWeight: 600 }}>{e.title}</div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.72rem', marginTop: '2px', fontWeight: 600 }}>
                      {e.all_day ? 'All day' : `${fmt(e.start_ts)} – ${fmt(e.end_ts)}`}
                      {e.location && ` · ${e.location}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reminders - Sit below events if they both fit, else the grid handles overflow */}
          {reminders.length > 0 && (
            <div className="glass-card squircle-block" style={{ width: '100%', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader icon={<Bell size={15} color="var(--color-orange)" />} label={`Reminders (${reminders.length})`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                {reminders.slice(0, 4).map(r => (
                  <div key={r.id} style={{ padding: '0.6rem 0.75rem', background: 'var(--color-surface)', borderRadius: 'var(--chat-bubble-shape, 12px)', borderLeft: '3px solid var(--color-orange)', fontSize: '0.82rem' }}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.72rem', marginTop: '2px', fontWeight: 600 }}>
                      {new Date(r.trigger_ts).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 5. Tasks */}
        <div className="glass-card squircle-block" style={{ width: '100%', padding: '1.5rem', display: 'flex', flexDirection: 'column', gridColumn: '1 / -1' }}>
          <SectionHeader icon={<CheckCircle2 size={15} />} label={`Tasks (${activeTasks.length})`} />
          {activeTasks.length === 0 ? (
            <EmptyState message="🎉 All tasks complete for today!" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
              {activeTasks.slice(0, 8).map(t => {
                const isInProgress = t.status === 'in_progress' || (t.progress || 0) > 0;
                return (
                  <div
                    key={t.id}
                    className={isInProgress ? 'glass-card task-in-progress' : ''}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.6rem 0.75rem',
                      background: isInProgress ? 'transparent' : 'var(--color-surface)',
                      borderRadius: 'var(--chat-bubble-shape, 12px)',
                      border: `1px solid ${isInProgress ? 'color-mix(in srgb, var(--color-accent) 25%, var(--color-border))' : 'var(--color-border)'}`,
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: t.priority === 1 ? 'var(--color-red)' : t.priority === 2 ? 'var(--color-orange)' : 'var(--color-green)' }} />
                    <span style={{ flex: 1, fontWeight: 500, fontSize: '0.85rem' }}>{t.title}</span>
                    {t.time_estimate && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                        {t.time_estimate >= 60 ? `${t.time_estimate / 60}h` : `${t.time_estimate}m`}
                      </span>
                    )}
                    <EnergyBadge level={t.energy_level} />
                    {isInProgress ? (
                      <>
                        <span style={{ color: 'var(--color-accent)', fontSize: '0.7rem', fontWeight: 700 }}>⚡</span>
                        <ActionBtn onClick={() => handleTaskAction(t.id, 'complete')} color="var(--color-green)" label="Done">
                          <CheckCircle2 size={12} />
                        </ActionBtn>
                      </>
                    ) : (
                      <>
                        <ActionBtn onClick={() => handleTaskAction(t.id, 'start')} label="Start">
                          <Play size={12} />
                        </ActionBtn>
                        <ActionBtn onClick={() => handleTaskAction(t.id, 'complete')} color="var(--color-green)" label="Done">
                          <CheckCircle2 size={12} />
                        </ActionBtn>
                      </>
                    )}
                  </div>
                );
              })}
              {activeTasks.length > 8 && (
                <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', paddingTop: '0.25rem' }}>
                  +{activeTasks.length - 8} more in Tasks
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Triage modal ────────────────────────────────────── */}
      {showTriage && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '400px' }}>
            <h2 className="text-xl font-bold mb-4">Tomorrow's Triage</h2>
            <p className="text-sec mb-6">Great work today. Let's set the intent for tomorrow.</p>
            <div className="flex flex-col gap-5">
              {[
                { key: 'goalAchieved', label: 'Achieved primary goal?' },
                { key: 'carryOver',    label: 'Carry over unfinished tasks?' },
                { key: 'blockDeepWork', label: 'Block first hour for Deep Work?' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{label}</span>
                  <button
                    className={(triageData as any)[key] ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', minHeight: '36px' }}
                    onClick={() => setTriageData(d => ({ ...d, [key]: !(d as any)[key] }))}
                  >
                    {(triageData as any)[key] ? 'Yes' : 'No'}
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-8 flex gap-2">
              <button className="btn-primary w-full" onClick={() => {
                setShowTriage(false);
                window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: "Tomorrow's intent saved. Sign-off complete." } }));
              }}>
                <CheckCircle2 size={16} /> Complete Triage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict/Trim Modal ───────────────────────────────── */}
      {conflictTask && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="modal glass-card" style={{ maxWidth: '450px', border: '1px solid var(--color-accent)', padding: '2.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ background: 'var(--color-accent-soft)', width: '50px', height: '50px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <Timer size={24} color="var(--color-accent)" />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 900 }}>Schedule Conflict</h2>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                There isn't enough time left today to fit <strong>"{conflictTask.title}"</strong> as planned.
              </p>
            </div>

            <div style={{ background: 'var(--color-surface)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--color-border)', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: '1rem' }}>Squeeze it in?</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Suggested Trim:</span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 800 }}>{conflictTask.suggestion}m</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>Custom Duration (mins):</label>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <input 
                    type="range" min="10" max={conflictTask.time_estimate || 60} step="5"
                    value={customTrim} 
                    onChange={e => setCustomTrim(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--color-accent)' }}
                  />
                  <span style={{ minWidth: '40px', fontWeight: 800, fontSize: '0.9rem', color: 'var(--color-accent)' }}>{customTrim}m</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button 
                className="btn-primary" 
                style={{ width: '100%', padding: '1rem', borderRadius: '14px', fontSize: '0.95rem' }}
                onClick={() => handleConflictResolve('trim')}
              >
                Apply Trim & Schedule Today
              </button>
              <button 
                className="btn-secondary" 
                style={{ width: '100%', padding: '0.85rem', borderRadius: '14px', fontSize: '0.9rem', border: '1px dashed var(--color-border)' }}
                onClick={() => handleConflictResolve('defer')}
              >
                Move to Tomorrow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Small helper components ─────────────────────────────── */

function SectionHeader({ icon, label, color = 'var(--color-text-secondary)' }: { icon: React.ReactNode; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {icon}
      <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color }}>
        {label}
      </span>
    </div>
  );
}

function StatChip({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 600, color, background: `color-mix(in srgb, ${color} 10%, transparent)`, padding: '0.2rem 0.55rem', borderRadius: 'var(--radius-pill)', border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
      {icon}
      {label}
    </span>
  );
}

function ActionBtn({ onClick, label, color = 'var(--color-text-secondary)', children }: { onClick: () => void; label: string; color?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        padding: '0.3rem 0.55rem',
        minHeight: '28px',
        minWidth: '28px',
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
        borderRadius: 'var(--radius-sm)',
        color,
        fontSize: '0.72rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
        fontFamily: 'inherit',
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
      {message}
    </div>
  );
}
