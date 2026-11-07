// Text-to-speech (TTS) service using Web Speech API
export function speak(text: string, voice?: string, lang: string = 'en-US'): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang;
    utt.rate = 1.0;
    utt.pitch = 1.0;
    utt.volume = 0.9;
    if (voice) {
      const voices = window.speechSynthesis.getVoices();
      const matched = voices.find(v => v.name.toLowerCase().includes(voice.toLowerCase()));
      if (matched) utt.voice = matched;
    }
    utt.onend = () => resolve();
    utt.onerror = () => resolve(); // Don't reject on TTS errors
    window.speechSynthesis.cancel(); // Cancel any ongoing speech
    window.speechSynthesis.speak(utt);
  });
}

export function cancelSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
