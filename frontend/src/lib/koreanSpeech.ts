function language(voice: SpeechSynthesisVoice) {
  return voice.lang.toLowerCase().replaceAll('_', '-');
}

/** Explicitly select a Korean voice even when the browser defaults to another language. */
export function koreanVoice(voices: readonly SpeechSynthesisVoice[]) {
  const korean = voices.filter(voice => /^ko(?:-|$)/.test(language(voice)));
  const preferred = (matches: readonly SpeechSynthesisVoice[]) => matches.find(voice => voice.default) ?? matches[0];
  return preferred(korean.filter(voice => voice.localService && language(voice) === 'ko-kr'))
    ?? preferred(korean.filter(voice => voice.localService))
    ?? preferred(korean.filter(voice => language(voice) === 'ko-kr'))
    ?? preferred(korean);
}

/** Keep short sentences together so the speech engine can apply natural pauses. */
export function koreanSpeechParts(text: string) {
  const limit = 180;
  const readings = text
    .replace(/(\d)\s*[–—~]\s*(?=\d)/g, '$1에서 ')
    .replace(/(\d)\s*×\s*(?=\d)/g, '$1 곱하기 ')
    .replace(/(\d)\s*cm\b/gi, '$1 센티미터')
    .split(/(?:\r?\n)+/);
  const parts: string[] = [];
  for (const reading of readings) {
    let remaining = reading.trim();
    while (remaining.length > limit) {
      const phrase = Array.from(remaining.slice(0, limit + 1).matchAll(/[.!?。！？](?=\s)/g)).at(-1);
      const space = phrase ? phrase.index + 1 : remaining.lastIndexOf(' ', limit);
      const end = space > 0 ? space : limit;
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) parts.push(remaining);
  }
  return parts;
}
