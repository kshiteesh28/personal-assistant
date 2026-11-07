interface ProgressRingProps {
  /** 0–100 */
  value: number;
  /** Total (for context label), e.g. total tasks */
  total?: number;
  /** Completed count */
  completed?: number;
  size?: number;
  strokeWidth?: number;
  /** Override accent color */
  color?: string;
  /** Optional center label */
  label?: string;
}

/**
 * ProgressRing — SVG circular progress indicator.
 * Replaces text-based "4 To Do" stats with a visual ring.
 */
export function ProgressRing({
  value,
  total,
  completed,
  size = 96,
  strokeWidth = 8,
  color = 'var(--color-accent)',
  label,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
      role="img"
      aria-label={`${clamped}% complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>

      {/* Center label */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1px',
        }}
      >
        {(completed !== undefined && total !== undefined) ? (
          <>
            <span style={{ fontSize: size * 0.22, fontWeight: 800, lineHeight: 1, color: 'var(--color-text-primary)' }}>
              {completed}
            </span>
            <span style={{ fontSize: size * 0.12, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
              / {total}
            </span>
          </>
        ) : label ? (
          <span style={{ fontSize: size * 0.16, fontWeight: 700, color: 'var(--color-text-primary)', textAlign: 'center', lineHeight: 1.2 }}>
            {label}
          </span>
        ) : (
          <span style={{ fontSize: size * 0.2, fontWeight: 800, lineHeight: 1, color: 'var(--color-text-primary)' }}>
            {clamped}%
          </span>
        )}
      </div>
    </div>
  );
}

export default ProgressRing;
