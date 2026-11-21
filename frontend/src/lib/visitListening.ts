import { load, save } from './storage';
import { scopeKey } from './visitScope';

type VisitScope = Parameters<typeof scopeKey>[0];
const listeningKey = (scope: VisitScope) => scopeKey(scope, 'docent-listening', 0);

export function visitListening(scope: VisitScope) {
  const preference = load<string | null>(listeningKey(scope), null, 'session');
  if (preference === 'audio-played') return 'on';
  return preference === 'off' ? 'off' : null;
}

export function disableVisitListening(scope: VisitScope) {
  save(listeningKey(scope), 'off', 'session');
}

export function noteArtworkAudioStarted(scope: VisitScope) {
  if (visitListening(scope) === null) save(listeningKey(scope), 'audio-played', 'session');
}
