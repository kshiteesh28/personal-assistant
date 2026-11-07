import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * NetworkStatus — shows a dismissible banner when the device goes offline.
 * Uses the browser's navigator.onLine + online/offline events.
 * On Android via Capacitor, this works natively via the WebView.
 */
export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const online  = () => { setIsOnline(true);  setDismissed(false); };
    const offline = () => { setIsOnline(false);  setDismissed(false); };
    window.addEventListener('online',  online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  if (isOnline || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 10000,
        background: 'color-mix(in srgb, var(--color-red) 90%, black)',
        color: 'white',
        padding: '0.65rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.6rem',
        fontSize: '0.85rem',
        fontWeight: 600,
        animation: 'slideInDown 0.3s ease-out',
      }}
    >
      <WifiOff size={15} />
      <span>You're offline — changes may not sync</span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.75rem', fontFamily: 'inherit', marginLeft: '0.25rem' }}
      >
        Dismiss
      </button>
    </div>
  );
}

export default NetworkStatus;
