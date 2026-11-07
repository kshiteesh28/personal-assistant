import React from 'react';
import { useThemeContext } from '../context/ThemeContext';

interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

interface GenerativeCalendarProps {
  events: CalEvent[];
  onEventClick?: (id: string) => void;
  onBackgroundClick?: () => void;
}

export const GenerativeCalendar: React.FC<GenerativeCalendarProps> = ({ events, onEventClick, onBackgroundClick }) => {
  const { theme } = useThemeContext();

  const renderAbyss = () => {
    // Tide Table: events are bubbles floating at different depths
    return (
      <svg width="100%" height="100%" viewBox="0 200 1000 600" preserveAspectRatio="xMidYMid slice" onClick={onBackgroundClick}>
        <defs>
          <radialGradient id="abyss-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0.4)" />
            <stop offset="100%" stopColor="rgba(14, 165, 233, 0)" />
          </radialGradient>
        </defs>
        {events.map((ev, i) => {
          // Map 0-24h to 10-90% of SVG height
          const startHours = new Date(ev.start).getHours();
          const startMins = new Date(ev.start).getMinutes();
          const dayProgress = (startHours + startMins/60) / 24;
          
          const depthY = 100 + (dayProgress * 600);
          const x = 150 + (i * 200) % 700;
          const r = ev.allDay ? 50 : 25 + Math.min(60, (new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 3600000 * 15);
          return (
            <g key={ev.id} transform={`translate(${x}, ${depthY})`}>
              <g style={{ cursor: 'pointer', animation: `float-up ${3 + (i % 2)}s infinite alternate ease-in-out` }} onClick={(e) => { e.stopPropagation(); onEventClick?.(ev.id); }}>
                <circle r={r * 2.5} fill="url(#abyss-glow)" />
                <circle r={r * 1.5} fill="rgba(14, 165, 233, 0.2)" stroke="rgba(56, 189, 248, 0.6)" strokeWidth="3" />
                <text y="8" textAnchor="middle" fill="#bae6fd" fontSize="18" fontWeight="900" style={{ pointerEvents: 'none', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{ev.title}</text>
              </g>
            </g>
          );
        })}
      </svg>
    );
  };

  const renderArchive = () => {
    // Branching Vine Timeline
    const pathD = "M 100 800 Q 300 600 200 400 T 500 100";
    return (
      <svg width="100%" height="100%" viewBox="0 200 1000 600" preserveAspectRatio="xMidYMid slice" onClick={onBackgroundClick}>
        <path d={pathD} fill="none" stroke="rgba(22, 101, 52, 0.3)" strokeWidth="12" strokeLinecap="round" />
        <path d={pathD} fill="none" stroke="#4ade80" strokeWidth="4" strokeLinecap="round" />
        
        {events.map((ev, i) => {
          const progress = (i + 1) / (events.length + 1);
          const x = 100 + (progress * 700);
          const y = 700 - (progress * 500); // Keep within 100-800
          const isLeft = i % 2 === 0;
          
          return (
            <g key={ev.id} transform={`translate(${x}, ${y})`}>
              <g style={{ cursor: 'pointer', animation: 'sway 4s infinite alternate ease-in-out' }} onClick={(e) => { e.stopPropagation(); onEventClick?.(ev.id); }}>
                <path d={isLeft ? "M0,0 Q-60,-30 -90,0 Q-60,30 0,0" : "M0,0 Q60,-30 90,0 Q60,30 0,0"} fill="rgba(22, 101, 52, 0.9)" stroke="#84cc16" strokeWidth="3" />
                <text x={isLeft ? -100 : 100} y="6" textAnchor={isLeft ? "end" : "start"} fill="#dcfce7" fontSize="20" fontWeight="900" style={{ pointerEvents: 'none', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{ev.title}</text>
              </g>
            </g>
          );
        })}
      </svg>
    );
  };

  const renderForge = () => {
    // Star Map Constellation
    return (
      <svg width="100%" height="100%" viewBox="0 100 1000 700" preserveAspectRatio="xMidYMid slice" onClick={onBackgroundClick}>
        {/* Draw Constellation Lines */}
        {events.map((ev, i) => {
          if (i === events.length - 1) return null;
          const x1 = 150 + (i * 120) % 700;
          const y1 = 150 + ((i * 87) % 500);
          const x2 = 150 + ((i + 1) * 120) % 700;
          const y2 = 150 + (((i + 1) * 87) % 500);
          
          return (
            <line key={`line-${ev.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(220, 38, 38, 0.3)" strokeWidth="2" strokeDasharray="4 4" />
          );
        })}
        {/* Draw Stars */}
        {events.map((ev, i) => {
          const x = 150 + (i * 180) % 700;
          const y = 100 + ((i * 130) % 600); // Controlled range
          const size = ev.allDay ? 15 : 8;
          return (
            <g key={ev.id} transform={`translate(${x}, ${y})`}>
              <g style={{ cursor: 'pointer', animation: 'flicker 2s infinite alternate' }} onClick={(e) => { e.stopPropagation(); onEventClick?.(ev.id); }}>
                <circle r={size * 4} fill="url(#forge-glow)" opacity="0.6" />
                <polygon points={`0,-${size*1.5} ${size*0.5},-${size*0.5} ${size*1.5},0 ${size*0.5},${size*0.5} 0,${size*1.5} -${size*0.5},${size*0.5} -${size*1.5},0 -${size*0.5},-${size*0.5}`} fill="#fca5a5" />
                <text y={size + 35} textAnchor="middle" fill="#fca5a5" fontSize="18" fontWeight="900" style={{ pointerEvents: 'none', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{ev.title}</text>
              </g>
            </g>
          );
        })}
        <defs>
          <radialGradient id="forge-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="rgba(127, 29, 29, 0)" />
          </radialGradient>
        </defs>
      </svg>
    );
  };

  const resolvedTheme = ['forge', 'archive', 'abyss'].includes(theme) ? theme : 'archive';

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: '500px', overflow: 'hidden', position: 'relative' }}>
      {events.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center', padding: '2rem' }}>
          <p style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
            {resolvedTheme === 'forge' && "The forge is cold today. No stars in the sky."}
            {resolvedTheme === 'archive' && "The archive is quiet. No vines have grown yet."}
            {resolvedTheme === 'abyss' && "The waters are still. No bubbles rising."}
          </p>
          <button className="btn-secondary" style={{ pointerEvents: 'auto', marginTop: '1rem' }} onClick={onBackgroundClick}>
            Schedule an Event
          </button>
        </div>
      )}
      {resolvedTheme === 'abyss' && renderAbyss()}
      {resolvedTheme === 'archive' && renderArchive()}
      {resolvedTheme === 'forge' && renderForge()}
    </div>
  );
};
