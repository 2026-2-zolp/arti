"""Resolve narration only for the artwork text currently served to visitors."""
import hashlib
import json
import re

from django.conf import settings

from .docent_audio import enabled_for


def recording(work, kind, visible):
    if (kind not in ('description', 'guide') or not enabled_for(work)
            or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', work.pk)):
        return None
    if kind == 'guide':
        if visible['guideStatus'] != 'confirmed':
            return None
        text = ' '.join(filter(bool, [visible['guideIntro'].strip(), *visible['guidedLooking']]))
    else:
        text = visible['description'].strip()
    if not text:
        return None
    fingerprint = hashlib.sha256(text.encode()).hexdigest()
    stem = f'{work.pk}-{kind}'
    root = settings.MEDIA_ROOT / 'narration'
    try:
        entry = json.loads((root / f'{stem}.json').read_text(encoding='utf-8'))
        if (not isinstance(entry, dict) or entry.get('textSha256') != fingerprint
                or entry.get('artworkId') != work.pk or entry.get('kind') != kind
                or entry.get('voice') != 'marin' or entry.get('providerTranscriptMatched') is not True):
            return None
        file = entry.get('file')
        if not isinstance(file, str) or not re.fullmatch(re.escape(stem) + r'-[a-f0-9]{16}\.mp3', file):
            return None
        path = root / file
        return (path, fingerprint) if path.is_file() else None
    except (OSError, ValueError):
        return None
