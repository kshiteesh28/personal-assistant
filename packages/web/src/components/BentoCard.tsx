import { ReactNode } from 'react';

interface BentoCardProps {
  children?: ReactNode;
  className?: string;
  colSpan?: 1 | 2 | 3 | 4;
  rowSpan?: 1 | 2;
  /** Show a skeleton loading state instead of children */
  loading?: boolean;
  /** If the card represents an in-progress task, apply neon glow */
  active?: boolean;
  /** Inner padding override */
  padding?: string;
  style?: React.CSSProperties;
}

/**
 * BentoCard — the core design system primitive.
 * Glassmorphic card that slots into .bento-grid.
 * Has a built-in skeleton loading state for per-card loading UX.
 */
export function BentoCard({
  children,
  className = '',
  colSpan = 1,
  rowSpan = 1,
  loading = false,
  active = false,
  padding = '1.5rem',
  style,
}: BentoCardProps) {
  const spanClass = `col-span-${colSpan}${rowSpan > 1 ? ` row-span-${rowSpan}` : ''}`;
  const activeClass = active ? 'glass-card--active' : '';

  if (loading) {
    return (
      <div
        className={`glass-card ${spanClass} ${className}`}
        style={{ padding, ...style }}
        aria-busy="true"
        aria-label="Loading"
      >
        <div className="skeleton" style={{ height: '0.875rem', width: '40%', marginBottom: '1rem', borderRadius: '6px' }} />
        <div className="skeleton" style={{ height: '2.5rem', width: '65%', marginBottom: '0.75rem', borderRadius: '8px' }} />
        <div className="skeleton" style={{ height: '0.75rem', width: '80%', marginBottom: '0.5rem', borderRadius: '6px' }} />
        <div className="skeleton" style={{ height: '0.75rem', width: '55%', borderRadius: '6px' }} />
      </div>
    );
  }

  return (
    <div
      className={`glass-card ${spanClass} ${activeClass} ${className}`}
      style={{ padding, ...style }}
    >
      {children}
    </div>
  );
}

export default BentoCard;
