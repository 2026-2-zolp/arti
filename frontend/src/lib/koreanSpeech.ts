function language(voice: SpeechSynthesisVoice) {
  return voice.lang.toLowerCase().replaceAll('_', '-');
}

/** Explicitly select a Korean voice even when the browser defaults to another language. */
export function koreanVoice(voices: readonly SpeechSynthesisVoice[]) {
  const korean = voices.filter(voice => /^ko(?:-|$)/.test(language(voice)));
  return korean.find(voice => voice.localService && language(voice) === 'ko-kr')
    ?? korean.find(voice => voice.localService)
    ?? korean.find(voice => language(voice) === 'ko-kr')
    ?? korean[0];
}

/** Short utterances keep paragraph pauses and avoid clipping long captions on mobile. */
export function koreanSpeechParts(text: string) {
  const limit = 180;
  const readings = text
    .replace(/(\d)\s*[–—~]\s*(?=\d)/g, '$1에서 ')
    .replace(/(\d)\s*×\s*(?=\d)/g, '$1 곱하기 ')
    .replace(/(\d)\s*cm\b/gi, '$1 센티미터')
    .split(/(?:\r?\n)+|(?<=[.!?。！？])\s+/);
  const parts: string[] = [];
  for (const reading of readings) {
    let remaining = reading.trim();
    while (remaining.length > limit) {
      const space = remaining.lastIndexOf(' ', limit);
      const end = space > 0 ? space : limit;
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) parts.push(remaining);
  }
  return parts;
}
