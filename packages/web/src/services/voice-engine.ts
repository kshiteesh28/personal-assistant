// Voice Engine: VAD-based speech capture and whisper transcription
// Uses @ricky0123/vad-web for voice activity detection in the browser

export type VoiceEngineState = 'idle' | 'listening' | 'transcribing' | 'speaking';

export interface VoiceEngineOptions {
  wakeWord?: string;
  onCommand?: (text: string) => void;
  onStateChange?: (state: VoiceEngineState) => void;
  onError?: (err: Error) => void;
}

// Wake word matching: normalized Levenshtein ≤ 0.3 for first word/two words, or substring
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

export function matchesWakeWord(text: string, wakeWord: string): boolean {
  if (!wakeWord) return false;
  const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
  const t = norm(text), w = norm(wakeWord);
  if (!w) return false;
  // Substring check
  if (t.includes(w) || w.includes(t)) return true;
  // First word match
  const firstWord = t.split(' ')[0];
  const dist = levenshtein(firstWord, w);
  if (dist / Math.max(firstWord.length, w.length) <= 0.3) return true;
  // First two words
  const twoWords = t.split(' ').slice(0, 2).join(' ');
  const dist2 = levenshtein(twoWords, w);
  if (dist2 / Math.max(twoWords.length, w.length) <= 0.3) return true;
  return false;
}

export function stripWakeWord(text: string, wakeWord: string): string {
  const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
  const w = norm(wakeWord);
  if (!w) return text;
  const t = text.trim();
  const idx = t.toLowerCase().indexOf(w);
  if (idx >= 0) return t.slice(idx + w.length).trim();
  // Strip first word/two words
  const words = t.split(' ');
  if (words.length > 1) return words.slice(1).join(' ');
  return '';
}

// Encode Float32Array audio to 16-bit PCM WAV blob (for whisper)
export function float32ToWav(samples: Float32Array, sampleRate: number = 16000): Blob {
  const headerLen = 44;
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(headerLen + dataLen);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  const offset = headerLen;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
