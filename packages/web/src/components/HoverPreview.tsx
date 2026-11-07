// HoverPreview components for showing details on hover
import type { Task } from '@secretary/shared';

function PreviewCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', zIndex: 1000, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--chat-bubble-shape)', padding: '1rem', boxShadow: 'var(--shadow-lg)', minWidth: '220px', maxWidth: '300px', animation: 'scaleIn 0.15s ease-out' }}>
      {children}
    </div>
  );
}

export function TaskPreview({ task }: { task: Task }) {
  return (
    <PreviewCard>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>{task.title}</div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
        {task.priority && <span>Priority: {task.priority === 1 ? 'High' : task.priority === 2 ? 'Medium' : 'Low'}</span>}
        {task.time_estimate && <span>⏱ {task.time_estimate}m</span>}
        {task.energy_level && <span>Energy: {task.energy_level}</span>}
        {task.task_type && <span>{task.task_type.replace(/_/g, ' ')}</span>}
        {task.due_ts && <span>Due: {new Date(task.due_ts).toLocaleDateString()}</span>}
      </div>
      {task.context && <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>{task.context}</div>}
      {task.tags && (task.tags as any)?.length > 0 && (
        <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {(task.tags as any).map((tag: string) => (
            <span key={tag} style={{ fontSize: '0.7rem', background: 'var(--color-border)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>#{tag}</span>
          ))}
        </div>
      )}
    </PreviewCard>
  );
}

export function EventPreview({ event }: { event: any }) {
  return (
    <PreviewCard>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>📅 {event.title}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
        <div>{new Date(event.start_ts).toLocaleString()} – {new Date(event.end_ts).toLocaleTimeString()}</div>
        {event.location && <div>📍 {event.location}</div>}
        {event.description && <div style={{ marginTop: '0.3rem', color: 'var(--color-text-tertiary)' }}>{event.description}</div>}
      </div>
    </PreviewCard>
  );
}

export function ReminderPreview({ reminder }: { reminder: any }) {
  return (
    <PreviewCard>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>⏰ {reminder.title}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
        <div>Triggers: {new Date(reminder.trigger_ts).toLocaleString()}</div>
        {reminder.repeat_rule && <div>Repeats: {reminder.repeat_rule}</div>}
      </div>
    </PreviewCard>
  );
}

export function NotePreview({ note }: { note: any }) {
  return (
    <PreviewCard>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem', fontSize: '0.9rem' }}>📝 {note.title}</div>
      {note.body && <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, maxHeight: '80px', overflow: 'hidden' }}>{note.body}</div>}
    </PreviewCard>
  );
}

// Wrapper to handle hover state with delay
import { useState, useRef } from 'react';

export function HoverPreview({ children, preview }: { children: React.ReactNode; preview: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 400); }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setShow(false); }}>
      {children}
      {show && <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', zIndex: 1000 }}>{preview}</div>}
    </div>
  );
}
