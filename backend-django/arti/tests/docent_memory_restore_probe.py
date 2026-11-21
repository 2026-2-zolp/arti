"""Synthetic PostgreSQL backup fixture and API assertions for local rehearsal."""

import json
from datetime import timedelta
from uuid import uuid4

from django.conf import settings
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from arti.member import issue
from arti.models import Account, Artwork, Visit
from arti.tests.docent_browser_server import ensure_visitor_memory_fixture
from arti.tests.test_provider import endpoint


def exercise(phase):
    name = connection.settings_dict['NAME']
    prefix = 'arti_memory_seed_' if phase in ('seed', 'reset') else 'arti_memory_restore_'
    if settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES or not name.startswith(prefix):
        raise RuntimeError('Use a dedicated synthetic source or restored database.')
    if phase not in ('seed', 'reset', 'before', 'verify'):
        raise ValueError('Unknown probe phase')

    with override_settings(ARTI_DOCENT_MEMORY_DEMO=True, ARTI_LLM_PROVIDER='openai_compatible',
                           OPENAI_API_KEY='synthetic-restore', OPENAI_MODEL='synthetic-restore', ARTI_LLM_MODELS={}), endpoint():
        client = APIClient(HTTP_HOST='localhost')
        select = Account.objects.create if phase == 'seed' else Account.objects.get
        owner, other, fresh = [select(login_id=f'memory-probe-{who}@example.test', role='user')
                               for who in ('owner', 'expired', 'fresh')]

        def sign_in(account):
            token = issue(account).data['token']
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        if phase == 'seed':
            ensure_visitor_memory_fixture()
            work = Artwork.objects.get(pk='fixture-art03')
            for account in (owner, other, fresh):
                sign_in(account)
                response = client.post('/api/visits', {
                    'visitId': str(uuid4()), 'exhibitionId': work.exhibition_id,
                    'date': timezone.now().isoformat(), 'durationMin': 15, 'selectedDuration': None,
                    'visitMode': 'exhibition_order', 'recommendedCount': 3, 'requestGeneration': 1,
                    'viewedArtworkIds': [work.id], 'reactions': {work.id: 'like'},
                    'docentInterests': [{'artworkId': work.id, 'contentVersion': work.content_version,
                                         'topics': ['light'], 'style': 'simple'}],
                }, format='json')
                assert response.status_code == 201, response.content
            Visit.objects.filter(user=other).update(created_at=timezone.now() - timedelta(days=31))
            print(json.dumps({'phase': phase, 'receiptIds': {
                label: Visit.objects.get(user=user).pk
                for label, user in zip(('owner', 'expired', 'fresh'), (owner, other, fresh))
            }}))
            return

        state_path = f'/api/users/{owner.id}/docent-memory'
        sign_in(owner)
        if phase == 'reset':
            assert client.patch(state_path, {'enabled': False}, format='json').status_code == 200
            assert client.patch(state_path, {'reset': True}, format='json').status_code == 200
            print(json.dumps({'phase': phase, 'summaryRemoved': True}))
            return

        def asks_with_memory(account):
            sign_in(account)
            response = client.post('/api/artworks/fixture-memory-art01/ask', {
                'visitId': str(uuid4()), 'question': '이 작품에서 볼 지점을 알려주세요.',
                'visitorMemory': {'ownerId': account.id, 'earlier': [], 'preferredTags': []},
            }, format='json')
            assert response.status_code == 200, response.content
            return response.json().get('usedPreviousVisitMemory', False)

        controls = client.get(state_path).json()
        previous = asks_with_memory(owner)
        assert previous == (phase == 'before')
        assert controls['enabled'] == (phase == 'before')
        assert asks_with_memory(other) is False
        assert asks_with_memory(fresh) is True
        receipts = {label: Visit.objects.get(user=user)
                    for label, user in zip(('owner', 'expired', 'fresh'), (owner, other, fresh))}
        if phase == 'verify':
            assert controls['resetAt']
            assert all('works' in receipt.docent_memory for receipt in receipts.values())
            assert 'visit' not in receipts['owner'].docent_memory
            assert 'visit' not in receipts['expired'].docent_memory
            assert 'visit' in receipts['fresh'].docent_memory
            path = f'/api/visits/{receipts["owner"].id}'
            sign_in(other)
            assert client.get(path).status_code == 403
            sign_in(owner)
            assert client.get(path).json()['id'] == receipts['owner'].id
            assert client.get('/api/artworks/fixture-art03/liked-recap').json()['recap']['topics'] == ['빛과 명암']
        print(json.dumps({'phase': phase, 'receiptIds': {key: receipt.pk for key, receipt in receipts.items()},
                          'ownerMemory': previous, 'expiredMemory': False, 'freshMemory': True,
                          'ownerPermissionPreserved': phase == 'verify'}))
