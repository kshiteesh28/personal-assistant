import { useState, useEffect } from 'react';
import { Plus, CheckCircle2, Circle, Trash2, Pencil, GripVertical, X, Clock, Scissors, Zap, Calendar, AlignLeft } from 'lucide-react';
import { api } from '../services/api';
import { hapticFeedback } from '../services/capacitor';

import type { TimePreference, TaskType, EnergyLevel } from '@secretary/shared';

const PRIORITY_META: Record<number, { label: string; color: string }> = {
  1: { label: 'High',   color: 'var(--color-red)' },
  2: { label: 'Medium', color: 'var(--color-orange)' },
  3: { label: 'Low',    color: 'var(--color-green)' },
};
const ESTIMATE_PRESETS = [15, 30, 60, 120, 240];

interface TaskForm {
  id?: string; title: string; priority: 1|2|3; time_estimate: number;
  energy_level: EnergyLevel; task_type: TaskType; time_preference: TimePreference;
  is_splittable: boolean; due_ts?: number; project?: string; tags_str?: string;
  context?: string; pinned_time?: number; status: 'todo'|'done'|'cancelled';
}
const defaultForm: TaskForm = { title: '', priority: 2, time_estimate: 30, energy_level: 'medium', task_type: 'deep_work', time_preference: 'either', is_splittable: false, status: 'todo', tags_str: '' };

function EnergyDot({ level }: { level?: string }) {
  const colors: Record<string, string> = { high: 'var(--color-red)', medium: 'var(--color-orange)', low: 'var(--color-blue)' };
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[level ?? 'medium'] ?? 'var(--color-border)', flexShrink: 0, display: 'inline-block' }} title={`Energy: ${level}`} />;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: '0.7rem', background: 'var(--color-border)', color: 'var(--color-text-secondary)', padding: '0.15rem 0.45rem', borderRadius: 'var(--radius-pill)', fontWeight: 500 }}>{children}</span>;
}

export default function TasksPage() {
  const [tasks, setTasks]         = useState<any[]>([]);
  const [isModalOpen, setIsModal] = useState(false);
  const [form, setForm]           = useState<TaskForm>(defaultForm);
  const [isSaving, setIsSaving]   = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all'|'todo'|'done'>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = async () => {
    try { const d = await api.get<any[]>('/api/tasks'); setTasks(d.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))); }
    catch (e) { console.error(e); }
  };
  useEffect(() => { load(); }, []);

  const pf = <K extends keyof TaskForm>(k: K, v: TaskForm[K]) => setForm(p => ({ ...p, [k]: v }));
  const openCreate = () => { setForm(defaultForm); setIsModal(true); };
  const openEdit = (t: any) => { setForm({ ...defaultForm, ...t, tags_str: Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags ?? '') }); setIsModal(true); };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form.title.trim()) return;
    
    // Prevent past deadlines
    // We only check due_ts for "overdue" sanity, pinned_time can be near-past if the user is late starting.
    if (form.due_ts && form.due_ts < Date.now() - 3600000 * 24) { 
       // Only block if deadline is > 24h in the past
      window.dispatchEvent(new CustomEvent('flowstate.nudge', { 
        detail: { message: 'That deadline has already passed!' } 
      }));
      return;
    }

    setIsSaving(true);
    try {
      const { tags_str, ...base } = form;
      const payload = { ...base, tags: tags_str ? tags_str.split(',').map(s => s.trim()).filter(Boolean).join(',') : null };
      if (form.id) await api.put(`/api/tasks/${form.id}`, payload);
      else await api.post('/api/tasks', payload);
      setIsModal(false);
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: form.id ? 'Task updated' : 'Task created' } }));
      load();
    } catch (err: any) { alert(`Save failed: ${err.message}`); }
    finally { setIsSaving(false); }
  };

  const confirmDelete = (id: string) => {
    setDeleteConfirmId(id);
    hapticFeedback('medium');
  };

  const performDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await api.delete(`/api/tasks/${deleteConfirmId}`);
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: 'Task deleted permanently' } }));
      load();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleteConfirmId(null);
    }
  };
  const toggleDone  = async (t: any) => { const ns = t.status === 'done' ? 'todo' : 'done'; await api.put(`/api/tasks/${t.id}`, { ...t, status: ns, progress: ns === 'done' ? 100 : 0 }); load(); };
  const onDragStart = (e: React.DragEvent, id: string) => { setDraggedId(id); e.dataTransfer.setData('text/plain', id); };
  const onDrop      = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault(); const srcId = e.dataTransfer.getData('text/plain');
    if (srcId === targetId) return;
    const todo = tasks.filter(t => t.status === 'todo');
    const src = todo.findIndex(t => t.id === srcId), dst = todo.findIndex(t => t.id === targetId);
    if (src < 0 || dst < 0) return;
    const reordered = [...todo]; const [item] = reordered.splice(src, 1); reordered.splice(dst, 0, item);
    setTasks([...reordered, ...tasks.filter(t => t.status !== 'todo')]);
    try { await api.put('/api/tasks/reorder', { ordered_ids: reordered.map(t => t.id) }); } catch { load(); }
    setDraggedId(null);
  };

  const todo = tasks.filter(t => t.status === 'todo');
  const done = tasks.filter(t => t.status === 'done');
  const shown = filter === 'todo' ? todo : filter === 'done' ? done : tasks;

  const isBrowser = typeof window !== 'undefined';
  const theme = isBrowser ? document.documentElement.getAttribute('data-theme') ?? 'archive' : 'archive';
  const typoClass = 'typography-standard';

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>Tasks</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>
            {todo.length} pending · {done.length} completed
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {(['all','todo','done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-pill)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--color-border)', background: filter === f ? 'var(--color-accent)' : 'transparent', color: filter === f ? 'white' : 'var(--color-text-secondary)', fontFamily: 'inherit', transition: 'all 0.15s', minHeight: '36px' }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button className="btn-primary" onClick={openCreate} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            <Plus size={16} /> New Task
          </button>
        </div>
      </div>

      {/* Task list */}
      {shown.length === 0 ? (
        <div className="glass-card" style={{ padding: '4rem 2rem', textAlign: 'center', border: '2px dashed var(--color-border)' }}>
          <CheckCircle2 size={40} color="var(--color-text-tertiary)" style={{ margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '0.5rem', fontWeight: 500 }}>
            {filter === 'done' ? 'No completed tasks yet.' : 'No tasks — you\'re all clear!'}
          </p>
          {filter !== 'done' && (
            <button className="btn-primary" onClick={openCreate} style={{ marginTop: '1rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
              <Plus size={14} /> Add your first task
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', justifyContent: 'center', alignItems: 'flex-end', minHeight: '60vh', padding: '2rem 0' }}>
          {shown.map(task => {
            const priorityLevel = (task.priority ?? 2) as 1|2|3;
            const pm = PRIORITY_META[priorityLevel] ?? PRIORITY_META[2];
            const isDone = task.status === 'done';
            const isActive = !isDone && (task.progress ?? 0) > 0;
             return (
               <div
                 key={task.id}
                 draggable={!isDone}
                 onDragStart={e => onDragStart(e, task.id)}
                 onDragEnd={() => setDraggedId(null)}
                 onDragOver={e => e.preventDefault()}
                 onDrop={e => onDrop(e, task.id)}
                 className={`glass-card squircle-block ${isActive ? 'glass-card--active' : ''}`}
                 style={{ 
                   padding: '1.5rem', 
                   display: 'flex', 
                   flexDirection: 'column', 
                   gap: '1rem', 
                   opacity: draggedId === task.id ? 0.4 : isDone ? 0.6 : 1, 
                   cursor: isDone ? 'default' : 'grab', 
                   transition: 'opacity 0.2s, transform 0.2s, background 0.3s',
                   // High = Darker/Deeper Shade, Low = Lighter Shade
                   background: isDone 
                     ? 'var(--color-surface)' 
                     : priorityLevel === 1 
                        ? `color-mix(in srgb, ${pm.color} 18%, var(--color-surface))`
                        : priorityLevel === 2
                           ? `color-mix(in srgb, ${pm.color} 10%, var(--color-surface))`
                           : `color-mix(in srgb, ${pm.color} 4%, var(--color-surface))`,
                   border: `1px solid color-mix(in srgb, ${pm.color} ${priorityLevel === 1 ? '40%' : '20%'}, var(--color-border))`,
                   width: '320px',
                   minHeight: '200px', // Fluid size: allows expansion if text is long
                   height: 'auto',
                   position: 'relative',
                   overflow: 'hidden'
                 }}
               >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: pm.color, opacity: 0.6 }} />

                {!isDone && (
                  <div style={{ position: 'absolute', top: '1rem', right: '1rem', cursor: 'grab', color: 'color-mix(in srgb, var(--color-text-tertiary) 60%, transparent)' }} title="Drag to reorder">
                    <GripVertical size={18} />
                  </div>
                )}

                {/* Header Block: Checkbox + Title + Badges */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', paddingRight: '1.5rem' }}>
                  <button onClick={() => toggleDone(task)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', color: isDone ? 'var(--color-green)' : `color-mix(in srgb, ${pm.color} 60%, var(--color-text-tertiary))`, padding: 0, marginTop: '2px', transition: 'transform 0.15s' }}>
                    {isDone ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className={typoClass} style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.3, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--color-text-secondary)' : 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                      {task.title}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                      <span className={typoClass} style={{ fontSize: '0.75rem', padding: '0.2rem 0' }}>
                        {pm.label}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-secondary)', background: 'var(--color-surface-elevated)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                        <EnergyDot level={task.energy_level} /> <span style={{ textTransform: 'capitalize' }}>{task.energy_level}</span>
                      </span>
                      {isActive && <span style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', color: 'var(--color-accent)' }}>⚡ Active</span>}
                    </div>
                  </div>
                </div>

                {/* Context Notes (If Available) */}
                {task.context && !isDone && (
                  <div style={{ padding: '0.85rem', background: 'color-mix(in srgb, var(--color-text-primary) 3%, transparent)', borderRadius: '0.85rem', borderLeft: `3px solid color-mix(in srgb, ${pm.color} 40%, var(--glass-border))` }}>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {task.context}
                    </p>
                  </div>
                )}

                {/* Metadata Row */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {task.task_type && <Chip>{task.task_type.replace(/_/g, ' ')}</Chip>}
                  {task.time_estimate && <Chip><Clock size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px', marginTop: '-1px' }} />{task.time_estimate >= 60 ? `${task.time_estimate/60}h` : `${task.time_estimate}m`}</Chip>}
                  {task.project && <span style={{ fontSize: '0.72rem', color: 'var(--color-accent)', fontWeight: 800, padding: '0.2rem 0.6rem', background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', borderRadius: 'var(--radius-pill)' }}>#{task.project}</span>}
                  {task.due_ts && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: task.status === 'todo' && task.due_ts < Date.now() ? 'var(--color-red)' : 'var(--color-text-secondary)', padding: '0.15rem 0' }}>
                      due {new Date(task.due_ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {task.pinned_time && !isDone && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'white', background: 'var(--color-accent)', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-pill)', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 8px var(--color-accent-soft)' }}>
                      <Zap size={10} fill="white" /> {new Date(task.pinned_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {task.is_splittable && <Chip><Scissors size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px', marginTop: '-1px' }} />split</Chip>}
                </div>

                {/* Progress Bar (if active) */}
                {(task.progress ?? 0) > 0 && !isDone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--color-surface-elevated)', padding: '0.6rem 0.8rem', borderRadius: '0.85rem', border: '1px solid var(--color-border)' }}>
                    <div className="progress-bar" style={{ flex: 1, backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', height: '6px' }}>
                      <div className="progress-bar-fill" style={{ width: `${task.progress}%` }} />
                    </div>
                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--color-accent)' }}>{task.progress}%</span>
                  </div>
                )}

                {/* Footer Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: 'auto', paddingTop: '1.25rem', borderTop: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)' }}>
                  <button onClick={() => openEdit(task)} className="btn-secondary" style={{ padding: '0.5rem 0.85rem', fontSize: '0.78rem', gap: '6px', minHeight: 'auto', borderRadius: '0.6rem', background: 'var(--color-surface-elevated)' }}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => confirmDelete(task.id)} className="btn-secondary" style={{ padding: '0.5rem 0.85rem', fontSize: '0.78rem', gap: '6px', minHeight: 'auto', borderRadius: '0.6rem', color: 'var(--color-red)', borderColor: 'color-mix(in srgb, var(--color-red) 30%, var(--glass-border))', background: 'color-mix(in srgb, var(--color-red) 6%, transparent)' }}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
               </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModal(false)}>
          <div className="modal" style={{ maxWidth: '480px', padding: '1.75rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                   {form.id ? <Pencil size={20} /> : <Plus size={20} />}
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>{form.id ? 'Refine Task' : 'New Priority'}</h2>
              </div>
              <button 
                onClick={() => setIsModal(false)} 
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', padding: '8px', borderRadius: '10px' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label>Objective *</label>
                <input required value={form.title} onChange={e => pf('title', e.target.value)} placeholder="e.g. Finish performance report" autoFocus />
              </div>
              <div className="form-group" style={{ marginBottom: '0.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={13} /> Active Working Time (Budget)</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                  {ESTIMATE_PRESETS.map(p => (
                    <button key={p} type="button" onClick={() => pf('time_estimate', p)} style={{ flex: 1, minWidth: '60px', padding: '0.45rem 0.5rem', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700, border: '1px solid var(--color-border)', background: form.time_estimate === p ? 'var(--color-accent)' : 'var(--color-surface)', color: form.time_estimate === p ? 'white' : 'var(--color-text-secondary)', transition: 'all 0.2s' }}>
                      {p >= 60 ? `${p / 60}h` : `${p}m`}
                    </button>
                  ))}
                  <button 
                    type="button" 
                    onClick={() => pf('time_estimate', 45)} // Set a generic custom start
                    style={{ flex: 1, minWidth: '60px', padding: '0.45rem 0.5rem', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700, border: '1px solid var(--color-border)', background: !ESTIMATE_PRESETS.includes(form.time_estimate) ? 'var(--color-accent)' : 'var(--color-surface)', color: !ESTIMATE_PRESETS.includes(form.time_estimate) ? 'white' : 'var(--color-text-secondary)', transition: 'all 0.2s' }}
                  >
                    Custom...
                  </button>
                </div>
                {!ESTIMATE_PRESETS.includes(form.time_estimate) && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }} className="fade-in">
                    <input 
                      type="number" 
                      min={1} 
                      max={480} 
                      value={form.time_estimate} 
                      onChange={e => pf('time_estimate', +e.target.value)}
                      style={{ height: '36px', width: '80px', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>minutes total</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                   <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><EnergyDot level={form.energy_level} /> Energy Band</label>
                   <select value={form.energy_level} onChange={e => pf('energy_level', e.target.value as EnergyLevel)}>
                    <option value="high">High Velocity</option>
                    <option value="medium">Sustained</option>
                    <option value="low">Low Energy</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Zap size={13} /> Priority</label>
                  <select value={form.priority} onChange={e => pf('priority', +e.target.value as 1|2|3)}>
                    <option value={1}>High Intensity</option>
                    <option value={2}>Standard</option>
                    <option value={3}>Low Priority</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlignLeft size={13} /> Category</label>
                <select value={form.task_type} onChange={e => pf('task_type', e.target.value as TaskType)}>
                  <option value="deep_work">Deep Work</option>
                  <option value="communication">Communication</option>
                  <option value="admin">Admin / Logistics</option>
                  <option value="creative">Creative</option>
                  <option value="review">Review / Feedback</option>
                  <option value="meeting_prep">Meeting Prep</option>
                  <option value="personal">Personal</option>
                  <option value="fitness">Fitness</option>
                  <option value="mental_health">Mental Health</option>
                </select>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.9rem' }}><Calendar size={13} /> Target Deadline</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Modern Date Selection Row */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                     {[
                       { label: 'Today',     isMatch: (ts?: number) => ts && new Date(ts).toDateString() === new Date().toDateString(), offset: 0 },
                       { label: 'Tomorrow',  isMatch: (ts?: number) => ts && new Date(ts).toDateString() === new Date(Date.now() + 86400000).toDateString(), offset: 1 },
                     ].map(p => {
                       const isActive = p.isMatch(form.due_ts);
                       return (
                         <button key={p.label} type="button" onClick={() => {
                            const d = new Date(form.due_ts || Date.now());
                            const target = new Date();
                            target.setDate(target.getDate() + p.offset);
                            d.setFullYear(target.getFullYear(), target.getMonth(), target.getDate());
                            pf('due_ts', d.getTime());
                         }} style={{ padding: '0.45rem 1rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid var(--color-border)', background: isActive ? 'var(--color-accent)' : 'var(--color-surface)', color: isActive ? 'white' : 'var(--color-text-secondary)', transition: 'all 0.2s', flex: 1 }}>
                           {p.label}
                         </button>
                       );
                     })}
                     <div 
                        style={{ position: 'relative', flex: 1, cursor: 'pointer' }}
                        onClick={(e) => {
                          const input = e.currentTarget.querySelector('input');
                          if (input && (input as any).showPicker) (input as any).showPicker();
                        }}
                      >
                        <button type="button" style={{ pointerEvents: 'none', width: '100%', padding: '0.45rem 0.5rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid var(--color-border)', background: form.due_ts && !new Date(form.due_ts).toDateString().includes(new Date().toDateString()) && !new Date(form.due_ts).toDateString().includes(new Date(Date.now() + 86400000).toDateString()) ? 'var(--color-accent-soft)' : 'var(--color-surface)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                           <Calendar size={12} color="currentColor" /> {form.due_ts ? new Date(form.due_ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Pick...'}
                        </button>
                        <input type="date" value={form.due_ts ? new Date(form.due_ts).toLocaleDateString('en-CA') : ''} 
                          min={new Date().toLocaleDateString('en-CA')}
                          onChange={e => {
                             if (!e.target.value) return;
                             const [y,m,d] = e.target.value.split('-').map(Number);
                             const cur = new Date(form.due_ts || Date.now());
                             cur.setFullYear(y, m-1, d);
                             pf('due_ts', cur.getTime());
                          }}
                          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px' }} 
                        />
                      </div>
                  </div>

                  {/* Modern Time selection (New Time Bucket system) */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Morning', h: 9,  icon: '☀️' },
                      { label: 'Afternoon', h: 14, icon: '🌥️' },
                      { label: 'End of Day', h: 23, icon: '🌙' },
                    ].map(t => {
                      const isActive = form.due_ts && new Date(form.due_ts).getHours() === t.h;
                      return (
                        <button key={t.label} type="button" onClick={() => {
                          const d = new Date(form.due_ts || Date.now());
                          d.setHours(t.h, 0, 0, 0);
                          pf('due_ts', d.getTime());
                        }} style={{ flex: 1, minWidth: '94px', padding: '0.6rem 0.5rem', borderRadius: '14px', background: isActive ? 'var(--color-accent)' : 'var(--color-bg)', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: 'all 0.2s' }}>
                          <span style={{ fontSize: '1.2rem' }}>{t.icon}</span>
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: isActive ? 'white' : 'var(--color-text-tertiary)' }}>{t.label}</span>
                        </button>
                      );
                    })}
                    <div 
                        style={{ position: 'relative', flex: 1, minWidth: '94px', cursor: 'pointer' }}
                        onClick={(e) => {
                          const input = e.currentTarget.querySelector('input');
                          if (input && (input as any).showPicker) (input as any).showPicker();
                        }}
                     >
                        <button type="button" style={{ pointerEvents: 'none', width: '100%', height: '100%', borderRadius: '14px', background: !form.due_ts || [9,14,23].includes(new Date(form.due_ts).getHours()) ? 'var(--color-bg)' : 'var(--color-accent-soft)', border: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                           <Clock size={16} color="var(--color-text-tertiary)" />
                           <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Custom</span>
                        </button>
                        <input type="time" value={form.due_ts ? new Date(form.due_ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} 
                           onChange={e => {
                              if (!e.target.value) return;
                              const [h, m] = e.target.value.split(':').map(Number);
                              const d = new Date(form.due_ts || Date.now());
                              d.setHours(h, m, 0, 0);
                              pf('due_ts', d.getTime());
                           }}
                           style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px' }}
                         />
                     </div>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={13} /> Pinned Time (Strict Start)</label>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                  <div 
                    style={{ position: 'relative', flex: 1, cursor: 'pointer' }}
                    onClick={(e) => {
                      const input = e.currentTarget.querySelector('input');
                      if (input && (input as any).showPicker) (input as any).showPicker();
                    }}
                  >
                    <button type="button" style={{ pointerEvents: 'none', width: '100%', padding: '0.75rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 700, border: '1px solid var(--color-border)', background: form.pinned_time ? 'var(--color-accent-soft)' : 'var(--color-surface)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <Clock size={16} /> {form.pinned_time && !isNaN(new Date(form.pinned_time).getTime()) ? new Date(form.pinned_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Set Start Time...'}
                    </button>
                    <input 
                      type="time" 
                      value={form.pinned_time && !isNaN(new Date(form.pinned_time).getTime()) ? new Date(form.pinned_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} 
                      onChange={e => {
                        if (!e.target.value) {
                          pf('pinned_time', undefined);
                          return;
                        }
                        const [h, m] = e.target.value.split(':').map(Number);
                        const d = new Date();
                        d.setHours(h, m, 0, 0);
                        pf('pinned_time', d.getTime());
                      }} 
                      style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: '1px', height: '1px' }}
                    />
                  </div>
                  {form.pinned_time && (
                    <button type="button" onClick={() => pf('pinned_time', undefined)} style={{ background: 'none', border: 'none', color: 'var(--color-red)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: '0.5rem' }}>Clear</button>
                  )}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '0.4rem' }}>For Today: If set, the AI will prioritize this exact time for your schedule block.</p>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', padding: '0.85rem', background: 'var(--color-surface)', borderRadius: 'var(--chat-bubble-shape)', border: '1px solid var(--color-border)', transition: 'all 0.2s' }}>
                <div className="toggle-switch">
                  <input type="checkbox" checked={form.is_splittable} onChange={e => pf('is_splittable', e.target.checked)} />
                  <span className="toggle-slider"></span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Splittable Block</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>Allow splitting this task into multiple sessions</span>
                </div>
              </label>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><AlignLeft size={13} /> Contextual Notes</label>
                <textarea rows={2} value={form.context ?? ''} onChange={e => pf('context', e.target.value)} placeholder="Links, background info, or sub-tasks..." style={{ resize: 'vertical' }} />
              </div>

              <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '0.85rem', fontWeight: 700 }} disabled={isSaving}>
                  {isSaving ? 'Processing…' : form.id ? 'Update Task' : 'Add to Stack'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setIsModal(false)} style={{ padding: '0.85rem 1.25rem' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal glass-card" style={{ maxWidth: '340px', padding: '2rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'color-mix(in srgb, var(--color-red) 12%, transparent)', color: 'var(--color-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
              <Trash2 size={24} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '0.5rem' }}>Erase Task?</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '1.75rem', lineHeight: 1.5 }}>
              This will permanently remove the task from your stack. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                className="btn-primary" 
                onClick={performDelete}
                style={{ flex: 1, background: 'var(--color-red)', borderColor: 'var(--color-red)', padding: '0.75rem' }}
              >
                Delete
              </button>
              <button 
                className="btn-secondary" 
                onClick={() => setDeleteConfirmId(null)}
                style={{ flex: 1, padding: '0.75rem' }}
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
