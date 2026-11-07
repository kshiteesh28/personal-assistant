import { Handshake, ShieldAlert, Calendar, X } from 'lucide-react';
import { api } from '../services/api';
import { hapticFeedback } from '../services/capacitor';

interface NegotiatorModalProps {
  conflictingTask: any;
  eventData: any;
  onClose: () => void;
  onResolve: () => void;
}

export default function NegotiatorModal({ conflictingTask, eventData, onClose, onResolve }: NegotiatorModalProps) {
  const handleMoveTask = async () => {
    try {
      await api.post(`/api/tasks/${conflictingTask.id}/negotiate-reschedule`, {});
      // Now save the event since we resolved the conflict by moving the task
      await api.post('/api/events?force=true', eventData);
      hapticFeedback('medium');
      window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: `Moved "${conflictingTask.title}" and scheduled "${eventData.title}"` } }));
      onResolve();
    } catch (err) {
      alert('Failed to reschedule task');
      hapticFeedback('heavy');
    }
  };

  const handleDeclineMeeting = () => {
    onClose();
    hapticFeedback('light');
    window.dispatchEvent(new CustomEvent('flowstate.success', { detail: { message: `Meeting "${eventData.title}" declined to preserve deep work.` } }));
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal" style={{ maxWidth: '440px', padding: '2rem' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', boxShadow: '0 0 20px color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
            <Handshake size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.04em', color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>Conflict Negotiator</h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            This meeting overlaps with your bulky task:<br/>
            <strong style={{ color: 'var(--color-accent)' }}>{conflictingTask.title}</strong>
          </div>
        </div>
        
        <div style={{ marginBottom: '2rem', background: 'var(--color-surface)', borderRadius: 'var(--chat-bubble-shape)', border: '1px solid var(--glass-border)', padding: '1.25rem' }}>
          <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={16} color="var(--color-orange)" />
            System Suggestion
          </p>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            To protect your flow state, I recommend rescheduling the task to tomorrow.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button className="btn-primary" onClick={handleMoveTask} style={{ padding: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, borderRadius: 'var(--chat-bubble-shape)' }}>
            <Calendar size={18} /> Reschedule Task & Accept
          </button>
          <button className="btn-secondary" onClick={handleDeclineMeeting} style={{ padding: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, borderRadius: 'var(--chat-bubble-shape)' }}>
            <X size={18} /> Keep Focus & Decline
          </button>
          <button onClick={onClose} style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
            Decide Later
          </button>
        </div>
      </div>
    </div>
  );
}
