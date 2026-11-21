"""Compact the synthetic visitor's interests without retaining question or answer text."""

import re
from collections import Counter
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .constants import LABELS, TAGS
from .models import Session, Visit


DEMO_EXHIBITIONS = ('fixture-ex01', 'fixture-ex-memory')
DEMO_RETENTION_DAYS = 30
TOPICS = {
    'light': ('빛과 명암', r'빛|명암|밝[은기]|어두[운움]|그림자'),
    'color': ('색감', r'색[감채상깔]|무슨 색|어떤 색|팔레트|색의|이 색'),
    'composition': ('구도와 형태', r'구도|형태|윤곽|배치|시선|원근'),
    'technique': ('표현 기법', r'기법|붓[질터]|질감|재료'),
    'background': ('제작 배경', r'제작|시대|배경|언제|작가의 의도'),
}
STYLES = {
    'simple': ('쉬운 설명', r'쉽게|쉬운 말|쉬운 설명|간단히|짧게'),
    'detailed': ('자세한 설명', r'자세히|구체적(?:으로)?|전문 용어|심층'),
}
FACT_QUESTION = re.compile(
    r'언제|누가|제작\s*(?:연도|년도|시기)|몇\s*년|소장처|소장번호|'
    r'작가(?:의\s*의도|는\s*왜|가\s*왜|는\s*누구)|왜[^?]*그렸|제작\s*배경|크기는'
)
LOOKING_REQUEST = re.compile(
    r'어디(?:부터|를\s*먼저)|무엇부터|어떻게\s*(?:보|감상)|볼\s*지점|'
    r'관찰\s*(?:지점|포인트)|눈여겨|살펴볼|(?:앞|이전|직전)\s*작품|지난\s*전시'
)
TAG_TOPIC = {
    'landscape': 'composition', 'people': 'composition', 'abstract': 'composition', 'light': 'light',
    'vivid': 'color', 'cool': 'color', 'warm': 'color', 'soft': 'color',
}


def memory_demo_enabled(exhibition_id):
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not getattr(settings, 'ARTI_DOCENT_MEMORY_DEMO', False)
            or exhibition_id not in DEMO_EXHIBITIONS):
        return False
    try:
        return urlsplit(settings.OPENAI_BASE_URL).hostname in ('localhost', '127.0.0.1', '::1')
    except ValueError:
        return False


def visit_context_enabled(exhibition_id):
    return exhibition_id in settings.ARTI_DOCENT_VISIT_CONTEXT_EXHIBITIONS or memory_demo_enabled(exhibition_id)


def cross_visit_records():
    return Visit.objects.filter(exhibition_id__in=DEMO_EXHIBITIONS, docent_memory__has_key='visit')


def cross_visit_cutoff(now=None):
    return (now or timezone.now()) - timedelta(days=DEMO_RETENTION_DAYS)


def account_memory_state(account):
    return {
        'enabled': account.docent_cross_visit_enabled,
        'revision': account.docent_memory_revision,
        'resetAt': account.docent_memory_reset_at.isoformat() if account.docent_memory_reset_at else None,
        'retentionDays': DEMO_RETENTION_DAYS,
    }


def cross_visit_storage_enabled(account, visit_date):
    if not account.docent_cross_visit_enabled:
        return False
    cutoff = cross_visit_cutoff()
    if account.docent_memory_reset_at:
        cutoff = max(cutoff, account.docent_memory_reset_at)
    return parse_datetime(visit_date) > cutoff


def discard_cross_visit_memory(records):
    """Run inside a transaction, retaining artwork recaps and the original receipt fields."""
    changed = 0
    for visit in records.select_for_update().only('docent_memory').order_by('pk').iterator():
        visit.docent_memory.pop('visit', None)
        visit.save(update_fields=['docent_memory'])
        changed += 1
    return changed


def previous_memory_is_current(account, session):
    return Session.objects.filter(
        pk=session.pk, account_id=account.pk, expires_at__gt=timezone.now(),
        account__status='active', account__docent_cross_visit_enabled=True,
        account__docent_memory_revision=account.docent_memory_revision,
    ).exists()


def interest_signal(question, entry=None):
    guide_question = (entry or {}).get('question', '') if '힌트' in question else ''
    topics = [key for key, (_, pattern) in TOPICS.items() if re.search(pattern, question + ' ' + guide_question)][:3]
    # Use expressed preference about the explanation instead of assigning a skill level.
    styles = [(match.start(), key) for key, (_, pattern) in STYLES.items() for match in re.finditer(pattern, question)]
    style = max(styles)[1] if styles else None
    return {'topics': topics, 'style': style} if topics or style else None


def known_values(values, allowed, limit=3):
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(value for value in values[:12] if isinstance(value, str) and value in allowed))[:limit]


def verified_interests(raw, works, limit):
    """The browser reports a small enum set. Rebind records to the public catalog here."""
    if not isinstance(raw, list):
        return {}
    supplied = {}
    for item in raw[-limit:]:
        if not isinstance(item, dict):
            continue
        artwork_id = item.get('artworkId')
        if isinstance(artwork_id, str) and 1 <= len(artwork_id) <= 64:
            supplied[artwork_id] = item
    result = {}
    for work in works.filter(pk__in=supplied).only('title', 'content_version'):
        item = supplied[work.pk]
        version = item.get('contentVersion')
        topics = known_values(item.get('topics'), TOPICS)
        style = item.get('style') if isinstance(item.get('style'), str) and item['style'] in STYLES else None
        if type(version) is int and work.content_version == version and (topics or style):
            result[work.pk] = ({'topics': topics, 'style': style, 'contentVersion': version}, work.title)
    return {artwork_id: result[artwork_id] for artwork_id in supplied if artwork_id in result}


def visit_recap(payload, snapshots, works, raw):
    works = works.filter(pk__in=payload['viewedArtworkIds'])
    interests = {key: value[0] for key, value in verified_interests(raw, works, 12).items()}
    tag_counts = Counter(payload['tastes'])
    for work in snapshots:
        if payload['reactions'].get(work['id']) == 'like':
            tag_counts.update(tag for tag in work['tags'] if tag in TAGS)
    topics = Counter(topic for signal in interests.values() for topic in signal['topics'])
    styles = Counter(signal['style'] for signal in interests.values() if signal['style'])
    if not interests and not tag_counts:
        return {}
    return {
        'works': interests,
        'visit': {
            'topics': [key for key, _ in topics.most_common(3)],
            'style': styles.most_common(1)[0][0] if styles else None,
            'tags': [key for key, _ in tag_counts.most_common(3)],
            'viewedCount': len(payload['viewedArtworkIds']),
            'durationMin': payload['durationMin'],
            'mode': payload.get('visitMode', 'recommendation'),
        },
    }


def visitor_context(work, account, raw, exhibition_works, question, entry=None, *, include_previous=True):
    if not visit_context_enabled(work.exhibition_id) or not isinstance(raw, dict):
        return {}
    if raw.get('ownerId') != (account.pk if account else None) or FACT_QUESTION.search(question):
        return {}

    signal = interest_signal(question, entry) or {}
    topics = set(signal.get('topics', [])) - {'background'}
    if not topics and not LOOKING_REQUEST.search(question):
        return {}
    current_style = signal.get('style')
    interests = verified_interests(raw.get('earlier'), exhibition_works.exclude(pk=work.pk), 3)
    result = {}
    earlier = []
    for item, title in interests.values():
        related = [TOPICS[key][0] for key in item['topics'] if key != 'background' and (not topics or key in topics)]
        style = item['style'] if not current_style else None
        if related or (not topics and style):
            earlier.append({'artwork': title, 'topics': related, 'style': STYLES[style][0] if style else None})
    if earlier:
        result['earlierInExhibition'] = earlier
    tags = known_values(raw.get('preferredTags'), LABELS, len(TAGS))
    matching = [LABELS[tag] for tag in tags
                if tag in work.tags and (not topics or TAG_TOPIC[tag] in topics)][:3]
    if matching:
        result['matchingTasteTags'] = matching
    if account and account.docent_cross_visit_enabled and include_previous and not earlier and memory_demo_enabled(work.exhibition_id):
        cutoff = cross_visit_cutoff()
        if account.docent_memory_reset_at:
            cutoff = max(cutoff, account.docent_memory_reset_at)
        latest = (cross_visit_records().filter(user=account, created_at__gt=cutoff)
                  .exclude(exhibition_id=work.exhibition_id)
                  .order_by('-created_at', '-pk').values_list('docent_memory', flat=True).first())
        previous = (latest or {}).get('visit')
        if previous:
            related = [TOPICS[key][0] for key in previous['topics'] if key != 'background' and (not topics or key in topics)]
            relevant_tags = [LABELS[tag] for tag in previous['tags']
                             if tag in work.tags and (not topics or TAG_TOPIC[tag] in topics)]
            if related or relevant_tags:
                style = previous['style'] if not current_style else None
                result['previousVisit'] = {
                    'topics': related, 'style': STYLES[style][0] if style else None,
                    'tags': relevant_tags, 'viewedCount': previous['viewedCount'],
                    'durationMin': previous['durationMin'], 'mode': previous['mode'],
                }
    return result


def artwork_recap(visit, artwork_id):
    signal = visit.docent_memory.get('works', {}).get(artwork_id)
    if not signal:
        return None
    return {'topics': [TOPICS[key][0] for key in signal['topics']],
            'style': STYLES[signal['style']][0] if signal['style'] else None}
