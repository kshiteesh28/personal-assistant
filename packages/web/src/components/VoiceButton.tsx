import { useState } from 'react';
import { useMicVAD, utils } from '@ricky0123/vad-react';

export default function VoiceButton() {
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState('Off');
  
  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechStart: () => {
      if (isRecording) setFeedback('Listening...');
    },
    onSpeechEnd: async (audio: Float32Array) => {
      if (!isRecording) return;
      setFeedback('Processing...');
      
      try {
        // Encode to WAV and transcribe via /api/voice/transcribe
        const wavBlob = new Blob([utils.encodeWAV(audio)], { type: 'audio/wav' });
        const result = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('secretary_auth_token')}`, 'Content-Type': 'audio/wav' },
          body: wavBlob,
        });
        const json = await result.json();
        setFeedback(json.reply || 'Success');
        setTimeout(() => setFeedback('Listening...'), 3000);
      } catch (err: any) {
        setFeedback('Error');
        console.error(err);
      }
    }
  });

  const toggleVoice = () => {
    if (isRecording) {
      setIsRecording(false);
      setFeedback('Off');
      vad.pause();
    } else {
      setIsRecording(true);
      setFeedback('Ready');
      vad.start();
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: '2rem', right: '100px', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 90 }}>
      {isRecording && <div className="text-xs font-semibold mb-1 text-primary">{feedback}</div>}
      <button 
        onClick={toggleVoice}
        style={{
          background: isRecording ? 'var(--color-error)' : 'var(--color-surface)',
          color: isRecording ? 'white' : 'var(--color-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-pill)',
          width: '60px', height: '60px', fontSize: '24px',
          boxShadow: 'var(--shadow-md)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s'
        }}
      >
        🎤
      </button>
    </div>
  );
}
