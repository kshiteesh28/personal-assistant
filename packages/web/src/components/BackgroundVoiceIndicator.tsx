// BackgroundVoiceIndicator: small floating indicator when always-on voice is listening
export default function BackgroundVoiceIndicator({ isListening }: { isListening: boolean }) {
  if (!isListening) return null;
  return (
    <div style={{
      position: 'fixed', bottom: '5.5rem', right: '1.75rem',
      background: 'var(--color-red)',
      color: 'white',
      borderRadius: 'var(--radius-pill)',
      padding: '0.3rem 0.75rem',
      fontSize: '0.75rem',
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      gap: '0.4rem',
      boxShadow: 'var(--shadow-md)',
      zIndex: 500,
      animation: 'pulse 1.5s infinite',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'white', display: 'inline-block' }} />
      Listening
    </div>
  );
}
