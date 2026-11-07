import React from 'react';

interface OrganicProps extends React.HTMLAttributes<HTMLDivElement> {
  priority?: 1 | 2 | 3;
  children: React.ReactNode;
}

export const OrganicContainer: React.FC<OrganicProps> = ({ priority = 2, children, style, className, ...props }) => {
  // Generative physics map based on Priority Level
  
  // Resolve current theme if possible (fallback to abyss for interactions)
  const isBrowser = typeof window !== 'undefined';
  const theme = isBrowser ? document.documentElement.getAttribute('data-theme') ?? 'archive' : 'archive';
  let interactionClass = '';
  if (theme === 'forge') interactionClass = 'thematic-interaction-clink';
  if (theme === 'archive') interactionClass = 'thematic-interaction-rustle';
  if (theme === 'abyss') interactionClass = 'thematic-interaction-wake';

  const weightClass = priority === 1 ? 'overlap-shadow-high' : priority === 3 ? 'overlap-shadow-low' : 'overlap-shadow-mid';

  let dynamicStyle: React.CSSProperties = {
    position: 'relative',
    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    overflow: 'hidden',
    ...style
  };

  const clipHigh = 'var(--task-clip-high)';
  const clipMid = 'var(--task-clip-mid)';
  const clipLow = 'var(--task-clip-low)';

  const radHigh = 'var(--task-radius-high)';
  const radMid = 'var(--task-radius-mid)';
  const radLow = 'var(--task-radius-low)';

  const shapeHigh = 'var(--task-shape-high)';
  const shapeMid = 'var(--task-shape-mid)';
  const shapeLow = 'var(--task-shape-low)';

  // Cast to strings to satisfy TS strict structural match
  if (priority === 1) {
    dynamicStyle.clipPath = clipHigh as string !== 'none' ? clipHigh : undefined;
    (dynamicStyle as any).shapeOutside = shapeHigh as string !== 'none' ? shapeHigh : undefined;
    if (!dynamicStyle.clipPath || dynamicStyle.clipPath === 'none') dynamicStyle.borderRadius = radHigh;
    dynamicStyle.animation = 'heavy-settle 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards';
  } else if (priority === 2) {
    dynamicStyle.clipPath = clipMid as string !== 'none' ? clipMid : undefined;
    (dynamicStyle as any).shapeOutside = shapeMid as string !== 'none' ? shapeMid : undefined;
    if (!dynamicStyle.clipPath || dynamicStyle.clipPath === 'none') dynamicStyle.borderRadius = radMid;
  } else {
    dynamicStyle.clipPath = clipLow as string !== 'none' ? clipLow : undefined;
    (dynamicStyle as any).shapeOutside = shapeLow as string !== 'none' ? shapeLow : undefined;
    if (!dynamicStyle.clipPath || dynamicStyle.clipPath === 'none') dynamicStyle.borderRadius = radLow;
    dynamicStyle.animation = 'float-up 0.8s ease-out forwards';
  }

  // Force NO standard rectangles. 
  // If style doesn't explicitly compute organic bounds, default to a soft pebble to prevent any accidental boxes.
  if (!dynamicStyle.clipPath && (!dynamicStyle.borderRadius || dynamicStyle.borderRadius === '0px' || dynamicStyle.borderRadius === '0')) {
    dynamicStyle.borderRadius = '24px 12px 24px 12px';
  }

  return (
    <div {...props} className={`thematic-object ${weightClass} ${interactionClass} ${className || ''}`} style={dynamicStyle}>
      {children}
    </div>
  );
};
