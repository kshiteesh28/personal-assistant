import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api';
import { matchesWakeWord, stripWakeWord, float32ToWav } from './voice-engine';

export const BG_VOICE_COMMAND_EVENT = 'bg-voice-command';

export interface UseBackgroundVoiceResult {
  isActive: boolean;
  isListening: boolean;
  wakeWord: string;
  start: () => void;
  stop: () => void;
}

export function useBackgroundVoice(
  enabled: boolean = false,
  wakeWord: string = 'Secretary',
  onCommand?: (text: string) => void
): UseBackgroundVoiceResult {
  const [isActive, setIsActive]     = useState(false);
  const [isListening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    if (isActive) return;
    try {
      // Request mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      let silenceFrames = 0;
      let speaking = false;

      processor.onaudioprocess = async (e) => {
        const data = e.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(data.reduce((acc, v) => acc + v * v, 0) / data.length);
        if (rms > 0.01) {
          speaking = true;
          silenceFrames = 0;
          chunks.push(new Float32Array(data));
        } else if (speaking) {
          silenceFrames++;
          if (silenceFrames > 20) { // ~0.5s silence
            speaking = false;
            silenceFrames = 0;
            // Process segment
            const combined = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
            let offset = 0;
            for (const c of chunks) { combined.set(c, offset); offset += c.length; }
            chunks.length = 0;
            try {
              const wav = float32ToWav(combined);
              const result = await api.postBlob<{ text: string }>('/api/voice/transcribe', wav, 'audio/wav');
              if (result.text && matchesWakeWord(result.text, wakeWord)) {
                const cmd = stripWakeWord(result.text, wakeWord);
                if (cmd) {
                  if (onCommand) onCommand(cmd);
                  window.dispatchEvent(new CustomEvent(BG_VOICE_COMMAND_EVENT, { detail: cmd }));
                }
              }
            } catch {}
          }
        }
      };

      src.connect(processor);
      processor.connect(ctx.destination);
      setIsActive(true);
      setListening(true);

      stopRef.current = () => {
        processor.disconnect();
        src.disconnect();
        stream.getTracks().forEach(t => t.stop());
        ctx.close();
        setIsActive(false);
        setListening(false);
      };
    } catch (err) {
      console.error('Background voice error', err);
    }
  }, [isActive, wakeWord, onCommand]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return () => { stop(); };
  }, [enabled]);

  return { isActive, isListening, wakeWord, start, stop };
}
