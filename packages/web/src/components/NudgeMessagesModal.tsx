import { useState } from 'react';
import { useEventStream } from '../services/sse';

export default function NudgeMessagesModal() {
  const [nudge, setNudge] = useState<any>(null);

  useEventStream((type, payload) => {
    if (type === 'flowstate.nudge' || type === 'secretary.nudge' || type === 'break.suggested') {
      setNudge(payload);
    }
  });

  if (!nudge) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div className="surface-card w-full max-w-md p-6 fade-in scale-in relative" style={{ borderRadius: 'var(--chat-bubble-shape)' }}>
        <button 
          onClick={() => setNudge(null)}
          style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem'}}
        >✕</button>
        
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>👋</div>
        <h2 className="text-xl font-semibold mb-2 text-primary">Secretary Nudge</h2>
        
        <p className="text-sec mb-6 text-lg">
          {nudge.message || nudge.suggestion}
        </p>

        {nudge.actionItems && nudge.actionItems.length > 0 && (
          <div className="flex flex-col gap-2 mb-6">
            <h4 className="font-medium text-sm text-tertiary uppercase tracking-wider">Suggested Actions</h4>
            {nudge.actionItems.map((ai: string, idx: number) => (
              <div key={idx} className="bg-bg p-3 rounded-md text-sm text-primary border border-border">
                {ai}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={() => setNudge(null)}>Dismiss</button>
          <button className="btn-primary" onClick={() => {
            // In a real app, this would dispatch the suggested action to the /api/chat or router
            setNudge(null);
          }}>Acknowledge</button>
        </div>
      </div>
    </div>
  );
}
