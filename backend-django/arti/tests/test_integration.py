# 검수·회원·도슨트·관람 기록 API의 통합 회귀를 검증합니다.
import copy
import hashlib
import io
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from arti.http import ContractError
from arti.member import SIGNUP_TERMS_VERSION
from arti.models import Account, Artwork, Exhibition, Session, Visit, VisitReaction
from arti.serializers import artwork_dto, exhibition_dto


class Helpers:
    def setup_clients(self):
        import tempfile
        from pathlib import Path
        media=tempfile.TemporaryDirectory();self.addCleanup(media.cleanup)
        override=override_settings(MEDIA_ROOT=Path(media.name));override.enable();self.addCleanup(override.disable)
        cache.clear()
        call_command('load_test_fixture',stdout=io.StringIO())
        self.public=APIClient(HTTP_HOST='localhost');self.admin=APIClient(HTTP_HOST='localhost');self.a=APIClient(HTTP_HOST='localhost');self.b=APIClient(HTTP_HOST='localhost')
        self.actors=[]
        for label,client,role in [('a',self.a,'user'),('b',self.b,'user'),('admin',self.admin,'admin')]:
            a=Account.objects.create(login_id=label,email=label+'@example.test',nickname=label,role=role,password=make_password('test-password-strong'))
            token='synthetic-token-'+label
            Session.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(),account=a,expires_at=timezone.now()+timedelta(days=1))
            client.credentials(**({'HTTP_X_ADMIN_TOKEN':token} if role=='admin' else {'HTTP_AUTHORIZATION':'Bearer '+token}))
            self.actors.append(a)

    def payload(self):
        return dict(visitId=str(uuid.uuid4()),exhibitionId='fixture-ex01',date='2026-11-08T01:00:00Z',durationMin=10,
                    recommendedCount=3,selectedDuration='30m',requestGeneration=1,tastes=['landscape','warm'],
                    viewedArtworkIds=['fixture-art01'],reactions={'fixture-art01':'like'},reactionReasons={'fixture-art01':'색감'},dwell={'fixture-art01':21})

    def put(self,w,**changes):
        return self.admin.put('/api/admin/artworks/'+w.id,{**artwork_dto(w,True),**changes},format='json')


@override_settings(ARTI_ENV='test',ALLOW_TEST_FIXTURES=True)
class IntegrationTests(Helpers,TestCase):
    def setUp(self):self.setup_clients()

    def test_postgres_is_real(self):self.assertEqual(connection.vendor,'postgresql')

    def test_exhibition_order_receipt_uses_actual_duration_without_a_selected_duration(self):
        payload = {**self.payload(), 'visitMode': 'exhibition_order', 'tastes': [], 'selectedDuration': None}
        for changes in ({'selectedDuration': '30m'}, {'tastes': ['warm']}, {'visitMode': 'unrecognized'}):
            self.assertEqual(self.a.post('/api/visits', {**payload, **changes}, format='json').status_code, 400)
        saved = self.a.post('/api/visits', payload, format='json')
        self.assertEqual(saved.status_code, 201, saved.content)
        self.assertEqual(saved.json()['durationMin'], 10)
        self.assertIsNone(saved.json()['selectedDuration'])
        self.assertEqual(saved.json()['visitMode'], 'exhibition_order')
        replay = self.a.post('/api/visits', payload, format='json')
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()['id'], saved.json()['id'])
        self.assertEqual(self.a.post('/api/visits', {**payload, 'visitMode': None}, format='json').status_code, 409)
        self.assertEqual(Visit.objects.count(), 1)

    def test_blank_source_or_description_can_be_saved_but_not_approved(self):
        works_url = '/api/admin/artworks'
        fixture = Artwork.objects.get(pk='fixture-art01')
        artwork = {**artwork_dto(fixture, True), 'title': '승인 검수용 합성 초안',
                   'source': '', 'description': '', 'referenceUrl': '', 'summaryStatus': 'none', 'guideStatus': 'none'}
        draft = self.admin.post(works_url, {**artwork, 'reviewStatus': 'pending'}, format='json')
        self.assertEqual(draft.status_code, 200, draft.content)
        work = Artwork.objects.get(pk=draft.json()['id'])
        review = self.put(work, reviewStatus='source_check')
        self.assertEqual(review.status_code, 200, review.content)
        self.assertEqual(review.json()['reviewStatus'], 'source_check')
        work.refresh_from_db()
        saved_version = work.version
        count = Artwork.objects.count()
        for source, description, reference_url in (
            ('', '', ''), (' \t', '가상 해설', 'https://example.test/catalog'), ('합성 출처', '\n ', ''),
        ):
            with self.subTest(source=source, description=description):
                approval = {'reviewStatus': 'approved', 'source': source, 'description': description,
                            'referenceUrl': reference_url}
                create = self.admin.post(works_url, {**artwork, **approval}, format='json')
                update = self.put(work, **approval)
                for response in (create, update):
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertEqual(response.json()['code'], 'VALIDATION_ERROR')
                work.refresh_from_db()
                self.assertEqual((work.review_status, work.version, work.source, work.description),
                                 ('source_check', saved_version, '', ''))
                self.assertEqual(Artwork.objects.count(), count)
                self.assertEqual(self.public.get('/api/artworks/' + work.id).status_code, 404)

    def test_only_latest_approved_source_and_confirmed_material_reach_docent(self):
        work = Artwork.objects.get(pk='fixture-art01')
        path = '/api/artworks/' + work.id
        previous = self.public.get(path).json()
        question = '이 작품에서 무엇을 먼저 관찰할까요?'
        new_description = '새 합성 원문에서 가운데에 밝은 사각형이 보입니다.'
        new_source = '시험용 도록 2판'

        def ask(kind, content_version):
            entry = {'tab': 'guided' if kind == 'guide' else 'desc', 'kind': kind, 'contentVersion': content_version}
            if kind == 'guide':
                entry.update(questionIndex=0, question='클라이언트가 보낸 문구')
            return self.public.post(path + '/ask', {'question': question, 'entryContext': entry}, format='json')

        with patch('arti.providers.generate', return_value={'answer': '모의 답변'}) as provider:
            response = self.put(work, description=new_description, source=new_source, reviewStatus='approved')
            self.assertEqual(response.status_code, 200, response.content)
            edited = response.json()
            self.assertEqual(edited['sourceVersion'], previous['sourceVersion'] + 1)
            self.assertEqual(edited['reviewStatus'], 'source_check')
            self.assertEqual(edited['summaryStatus'], 'suggested')
            self.assertEqual(self.public.get(path).status_code, 404)
            listing = self.public.get('/api/artworks', {'exhibitionId': work.exhibition_id}).json()
            self.assertNotIn(work.id, [item['id'] for item in listing])
            self.assertEqual(ask('summary', previous['contentVersion']).status_code, 404)

            work.refresh_from_db()
            approved = self.put(work, reviewStatus='approved', version=previous['version'])
            self.assertEqual(approved.status_code, 409, approved.content)
            self.assertEqual(self.public.get(path).status_code, 404)
            approved = self.put(work, reviewStatus='approved')
            self.assertEqual(approved.status_code, 200, approved.content)
            self.assertEqual(approved.json()['reviewStatus'], 'approved')
            published = self.public.get(path).json()
            self.assertEqual((published['description'], published['source']), (new_description, new_source))
            self.assertEqual((published['summary'], published['guidedLooking'], published['guidedHints']), ('', [], []))
            stale = ask('summary', previous['contentVersion'])
            self.assertEqual(stale.status_code, 409, stale.content)
            self.assertEqual(stale.json()['code'], 'CONTENT_CHANGED')
            self.assertEqual(ask('summary', published['contentVersion']).status_code, 400)
            self.assertEqual(ask('guide', published['contentVersion']).status_code, 400)
            provider.assert_not_called()

            work.refresh_from_db()
            saved = self.put(work, summary='새 쉬운 요약', summaryStatus='confirmed', guideStatus='confirmed',
                             guidedLooking=['밝은 사각형은 어디에 있나요?'], guidedHints=['가운데를 보세요.'])
            self.assertEqual(saved.status_code, 200, saved.content)
            published = self.public.get(path).json()
            self.assertEqual(published['summary'], '새 쉬운 요약')
            self.assertEqual(published['guidedLooking'], ['밝은 사각형은 어디에 있나요?'])
            self.assertEqual(published['guidedHints'], ['가운데를 보세요.'])
            for kind, context, revision in (
                ('original', {'kind': 'original', 'text': new_description}, published['sourceVersion']),
                ('summary', {'kind': 'summary', 'text': published['summary']}, published['summaryRevision']),
                ('guide', {'kind': 'guide', 'question': published['guidedLooking'][0]}, published['guideRevision']),
            ):
                with self.subTest(kind=kind):
                    answer = ask(kind, published['contentVersion'])
                    self.assertEqual(answer.status_code, 200, answer.content)
                    self.assertEqual(answer.json()['sourceRefs'], [{'artworkId': work.id, 'kind': kind,
                                     'sourceVersion': published['sourceVersion'], 'revision': revision}])
                    provider.assert_called_with('answer', published, entry=context, history=[], question=question)
            self.assertEqual(provider.call_count, 3)

    def test_personalized_explanation_rejects_source_changed_during_generation(self):
        work = Artwork.objects.get(pk='fixture-art01')
        path = '/api/artworks/' + work.id + '/explanation'

        def edit_during_generation(kind, artwork):
            self.assertEqual(kind, 'explanation')
            self.assertEqual(artwork['description'], work.description)
            edited = self.put(work, description='검수 중인 새 원문')
            self.assertEqual(edited.status_code, 200, edited.content)
            return {'text': '이전 원문으로 생성한 해설'}

        with patch('arti.providers.generate', side_effect=edit_during_generation) as provider:
            stale = self.public.post(path, {}, format='json')
            self.assertEqual(stale.status_code, 409, stale.content)
            self.assertEqual(stale.json()['code'], 'CONTENT_CHANGED')
            self.assertNotIn('text', stale.json())
            self.assertEqual(self.public.post(path, {}, format='json').status_code, 404)
            provider.assert_called_once()

    def test_roundtrip_guide_and_independent_confirmation(self):
        w=Artwork.objects.get(pk='fixture-art01');r=self.put(w,guideIntro='도입 수정',guidedLooking=['관찰 질문'],guidedHints=['힌트'],guideStatus='confirmed')
        self.assertEqual(r.status_code,200,r.content)
        result=self.public.get('/api/artworks/'+w.id).json();self.assertEqual(result['guideIntro'],'도입 수정');self.assertEqual(result['guidedHints'],['힌트'])
        r=self.put(w,guideIntro='오래된 수정');self.assertEqual(r.status_code,409)

    def test_missing_version_and_full_edit_fields(self):
        w=Artwork.objects.get(pk='fixture-art01')
        self.assertEqual(self.admin.put('/api/admin/artworks/'+w.id,{'version':1,'title':'삭제 안 됨'},format='json').status_code,400)
        self.assertEqual(self.put(w,version=None).status_code,400)
        self.assertEqual(self.put(w,analysis={'emotions':{}},imageFile='injected.png',sourceVersion=400).status_code,200)
        w.refresh_from_db();self.assertNotEqual(w.image_file,'injected.png');self.assertEqual(w.source_version,1)

    def test_confirm_batch_is_atomic_and_explicit(self):
        self.assertEqual(self.admin.post('/api/admin/exhibitions/fixture-ex01/confirm-ai',{},format='json').status_code,400)
        items=[{'id':'fixture-art01','version':1,'fields':['summary']},{'id':'fixture-art02','version':999,'fields':['guide']}]
        self.assertEqual(self.admin.post('/api/admin/exhibitions/fixture-ex01/confirm-ai',{'items':items},format='json').status_code,409)
        self.assertEqual(Artwork.objects.get(pk='fixture-art01').version,1)

    def test_analysis_preserves_confirmed_independently_and_conflicts(self):
        w=Artwork.objects.get(pk='fixture-art01');w.guide_status='none';w.summary_status='confirmed';w.summary='확정 요약';w.save()
        def fake(kind,*args,**kw):
            if kind=='guide':return {'intro':'가짜 시험 초안','questions':['질문'],'hints':['']}
            raise ContractError(503,'AI_UNAVAILABLE','test')
        with patch('arti.providers.generate',side_effect=fake) as provider:
            r=self.admin.post('/api/admin/artworks/'+w.id+'/analyze',{'version':1},format='json')
        self.assertEqual(r.status_code,200,r.content);data=r.json()['artwork'];self.assertEqual(data['summaryStatus'],'confirmed');self.assertEqual(data['summary'],w.summary);self.assertEqual(data['guideStatus'],'suggested')
        def changed(kind,*args,**kw):
            Artwork.objects.filter(pk=w.id).update(version=99)
            return {'intro':'late','questions':['질문'],'hints':['']}
        with patch('arti.providers.generate',side_effect=changed):
            self.assertEqual(self.admin.post('/api/admin/artworks/'+w.id+'/analyze',{'version':data['version']},format='json').status_code,409)

    def test_explicit_regeneration_keeps_confirmed_text_until_each_review(self):
        work = Artwork.objects.get(pk='fixture-art01')
        work.analysis = {'emotions': {'calm': 1}}
        work.save(update_fields=['analysis'])
        setup = self.put(work, summary='확정 요약', summaryKeywords=['기존 키워드'],
                         summaryStatus='confirmed', guideStatus='confirmed', guideIntro='확정 도입',
                         guidedLooking=['확정 질문'], guidedHints=['확정 힌트'],
                         tagStatus='confirmed', emotionStatus='confirmed')
        self.assertEqual(setup.status_code, 200, setup.content)
        public_path = '/api/artworks/' + work.id
        analyze_path = '/api/admin/artworks/' + work.id + '/analyze'
        previous = self.public.get(public_path).json()
        public_fields = ('summary', 'summaryKeywords', 'summaryStatus', 'summaryRevision', 'guideIntro',
                         'guidedLooking', 'guidedHints', 'guideStatus', 'guideRevision', 'contentVersion')

        def verify_published():
            published = self.public.get(public_path).json()
            self.assertEqual({key: published[key] for key in public_fields},
                             {key: previous[key] for key in public_fields})

        draft = setup.json()
        for kind, result in (
            ('summary', {'summary': '새 요약 제안', 'keywords': ['새 키워드']}),
            ('guide', {'intro': '새 도입', 'questions': ['새 질문'], 'hints': ['새 힌트']}),
        ):
            with patch('arti.providers.generate', return_value=result) as provider:
                response = self.admin.post(analyze_path, {'version': draft['version'], 'regenerateFields': [kind]}, format='json')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual([call.args[0] for call in provider.call_args_list], [kind])
            draft = response.json()['artwork']
            self.assertEqual(draft[kind + 'Status'], 'suggested')
            verify_published()

        with patch('arti.providers.generate', side_effect=ContractError(502, 'PROVIDER_ERROR', '시험 실패')):
            failed = self.admin.post(analyze_path, {'version': draft['version'], 'regenerateFields': ['guide']}, format='json')
        self.assertEqual(failed.status_code, 502, failed.content)
        verify_published()
        self.assertEqual(self.admin.get('/api/admin/artworks/' + work.id).json(), draft)

        with patch('arti.providers.generate', return_value={'answer': '모의 답변'}) as provider:
            for kind, context in (
                ('summary', {'tab': 'desc', 'kind': 'summary'}),
                ('guide', {'tab': 'guided', 'kind': 'guide', 'questionIndex': 0}),
            ):
                answer = self.public.post(public_path + '/ask', {
                    'question': '같은 작품을 어떻게 볼까요?',
                    'entryContext': {**context, 'contentVersion': previous['contentVersion']},
                }, format='json')
                self.assertEqual(answer.status_code, 200, answer.content)
                self.assertEqual(answer.json()['sourceRefs'][0]['revision'], previous[kind + 'Revision'])
                self.assertEqual(provider.call_args.kwargs['entry'],
                                 {'kind': 'summary', 'text': previous['summary']} if kind == 'summary'
                                 else {'kind': 'guide', 'question': previous['guidedLooking'][0]})

        work.refresh_from_db()
        approved = self.put(work, summaryStatus='confirmed')
        self.assertEqual(approved.status_code, 200, approved.content)
        published = self.public.get(public_path).json()
        self.assertEqual((published['summary'], published['summaryKeywords']), ('새 요약 제안', ['새 키워드']))
        self.assertEqual(published['guidedHints'], previous['guidedHints'])
        self.assertGreater(published['contentVersion'], previous['contentVersion'])
        batch = self.admin.post('/api/admin/exhibitions/fixture-ex01/confirm-ai', {
            'items': [{'id': work.id, 'version': approved.json()['version'], 'fields': ['guide']}],
        }, format='json')
        self.assertEqual(batch.status_code, 200, batch.content)
        published = self.public.get(public_path).json()
        self.assertEqual((published['guidedLooking'], published['guidedHints']), (['새 질문'], ['새 힌트']))

    def test_invalid_generated_guide_returns_502_without_changing_published_guide(self):
        work = Artwork.objects.get(pk='fixture-art01')
        public_path = '/api/artworks/' + work.id
        admin_path = '/api/admin/artworks/' + work.id
        setup = self.put(work, guideStatus='confirmed', guideIntro='공개 가이드',
                         guidedLooking=['공개 질문'], guidedHints=['공개 힌트'])
        self.assertEqual(setup.status_code, 200, setup.content)
        original_public = self.public.get(public_path).json()
        original_admin = setup.json()

        def generate(questions, hints, version):
            result = {'intro': '합성 가이드', 'questions': questions, 'hints': hints}
            with patch('arti.providers.generate', return_value=result) as provider:
                response = self.admin.post(admin_path + '/analyze', {
                    'version': version, 'regenerateFields': ['guide'],
                }, format='json')
            self.assertEqual([call.args[0] for call in provider.call_args_list], ['guide'])
            return response

        for questions, hints in (
            ([], []),
            (['질문'] * 4, ['힌트'] * 4),
            ([' \t\n'], ['힌트']),
            (['질문'], []),
            (['질문'], ['힌트', '남는 힌트']),
        ):
            with self.subTest(questions=questions, hints=hints):
                response = generate(questions, hints, original_admin['version'])
                self.assertEqual(response.status_code, 502, response.content)
                self.assertEqual(response.json()['code'], 'PROVIDER_ERROR')
                self.assertEqual(self.public.get(public_path).json(), original_public)
                self.assertEqual(self.admin.get(admin_path).json(), original_admin)

        newest = generate(['첫 질문', '두 번째 질문', '세 번째 질문'], ['', '힌트', ''], original_admin['version'])
        self.assertEqual(newest.status_code, 200, newest.content)
        saved = newest.json()['artwork']
        self.assertEqual(saved['guideStatus'], 'suggested')
        self.assertEqual(saved['guidedHints'], ['', '힌트', ''])
        self.assertEqual(saved['contentVersion'], original_public['contentVersion'])
        self.assertEqual(self.public.get(public_path).json()['guidedLooking'], ['공개 질문'])

    def test_discard_text_proposals_preserves_public_revisions_and_other_fields(self):
        work = Artwork.objects.get(pk='fixture-art01')
        public_path = '/api/artworks/' + work.id
        admin_path = '/api/admin/artworks/' + work.id
        discard_path = admin_path + '/discard-ai'
        setup = self.put(work, summaryStatus='confirmed', summary='원래 공개 요약', summaryKeywords=['원래'],
                         guideStatus='none', guidedLooking=[], guidedHints=[], guideIntro='')
        self.assertEqual(setup.status_code, 200, setup.content)

        def text_state(dto):
            return {key: value for key, value in dto.items() if key not in ('version', 'updatedAt')}

        mock = {
            'summary': {'summary': '새 요약', 'keywords': ['새 키워드']},
            'guide': {'intro': '새 도입', 'questions': ['새 질문'], 'hints': ['새 힌트']},
        }
        public = self.public.get(public_path).json()
        with patch('arti.providers.generate', side_effect=lambda kind, snapshot, **context: mock[kind]):
            generated = self.admin.post(admin_path + '/analyze', {
                'version': setup.json()['version'], 'regenerateFields': list(mock),
            }, format='json')
        self.assertEqual(generated.status_code, 200, generated.content)
        proposal = generated.json()['artwork']
        public_after_generation = self.public.get(public_path).json()
        self.assertEqual(public_after_generation['summaryRevision'], public['summaryRevision'])
        self.assertEqual(proposal['savedTextProposals'], ['summary', 'guide'])

        def discard(kind, version):
            return self.admin.post(discard_path, {'kind': kind, 'version': version}, format='json')

        unauthorized = self.public.post(discard_path, {'kind': 'summary', 'version': proposal['version']}, format='json')
        self.assertIn(unauthorized.status_code, (401, 403))
        discarded_summary = discard('summary', proposal['version'])
        self.assertEqual(discarded_summary.status_code, 200, discarded_summary.content)
        restored = discarded_summary.json()
        self.assertEqual(restored['version'], proposal['version'] + 1)
        self.assertEqual((restored['summaryStatus'], restored['summary'], restored['summaryKeywords']),
                         ('confirmed', '원래 공개 요약', ['원래']))
        self.assertEqual(restored['savedTextProposals'], ['guide'])
        self.assertEqual(restored['guidedLooking'], ['새 질문'])
        self.assertEqual(text_state(self.public.get(public_path).json()), text_state(public_after_generation))

        for kind, revision, expected in (('guide', proposal['version'], 409), ('summary', restored['version'], 400)):
            response = discard(kind, revision)
            self.assertEqual(response.status_code, expected, response.content)
            self.assertEqual(self.admin.get(admin_path).json(), restored)

        discarded_guide = discard('guide', restored['version'])
        self.assertEqual(discarded_guide.status_code, 200, discarded_guide.content)
        self.assertEqual(discarded_guide.json()['guideStatus'], 'none')
        self.assertEqual(discarded_guide.json()['guidedLooking'], [])
        self.assertEqual(discarded_guide.json()['guidedHints'], [])
        self.assertEqual(discarded_guide.json()['guideIntro'], '')
        self.assertEqual(discarded_guide.json()['savedTextProposals'], [])
        self.assertEqual(text_state(self.public.get(public_path).json()), text_state(public_after_generation))

    def test_retained_summary_is_not_restored_after_source_change(self):
        work = Artwork.objects.get(pk='fixture-art01')
        work.summary_status = 'confirmed'
        work.save(update_fields=['summary_status'])
        analyze_path = '/api/admin/artworks/' + work.id + '/analyze'
        public_path = '/api/artworks/' + work.id
        previous = self.public.get(public_path).json()
        with patch('arti.providers.generate', return_value={'summary': '공개 전 새 요약', 'keywords': []}):
            generated = self.admin.post(analyze_path, {'version': work.version, 'regenerateFields': ['summary']}, format='json')
        self.assertEqual(generated.status_code, 200, generated.content)
        self.assertEqual(self.public.get(public_path).json()['summary'], previous['summary'])

        work.refresh_from_db()
        revised = self.put(work, description='출처 재검수용 새 원문')
        self.assertEqual(revised.json()['reviewStatus'], 'source_check')
        self.assertEqual(self.public.get(public_path).status_code, 404)
        work.refresh_from_db()
        self.assertEqual(self.put(work, reviewStatus='approved').status_code, 200)
        self.assertEqual(self.public.get(public_path).json()['summary'], '')

    def test_guest_member_and_invalid_token_are_distinct(self):
        p=self.payload();r=self.public.post('/api/visits',p,format='json');self.assertEqual(r.status_code,200,r.content);self.assertFalse(r.json()['persisted']);self.assertEqual(Visit.objects.count(),0)
        self.public.credentials(HTTP_AUTHORIZATION='Bearer expired');self.assertEqual(self.public.post('/api/visits',p,format='json').status_code,401)
        self.assertEqual(self.public.get('/api/artworks/fixture-art01').status_code,200)
        r=self.a.post('/api/visits',{**p,'userId':self.actors[1].id},format='json');self.assertEqual(r.status_code,201,r.content);self.assertEqual(r.json()['userId'],self.actors[0].id)

    def test_idempotency_reasons_snapshot_and_ai_independence(self):
        p=self.payload();r=self.a.post('/api/visits',p,format='json');self.assertEqual(r.status_code,201,r.content);pk=r.json()['id']
        self.assertEqual(r.json()['keywords'],['풍경','따뜻한 색감'])
        self.assertEqual(self.a.post('/api/visits',p,format='json').status_code,200)
        self.assertEqual(self.a.post('/api/visits',{**p,'durationMin':11},format='json').status_code,409)
        self.assertEqual(Visit.objects.count(),1);self.assertEqual(VisitReaction.objects.get().reason,'색감');self.assertEqual(VisitReaction.objects.get().dwell_seconds,21)
        inp={k:p[k] for k in ['exhibitionId','visitId','viewedArtworkIds','reactions','dwell']}
        self.assertEqual(self.a.post('/api/visits/interpret',inp,format='json').status_code,503)
        self.assertEqual(self.a.get('/api/visits/'+pk).status_code,200)
        Exhibition.objects.filter(pk='fixture-ex01').update(status='closed')
        record=self.a.get('/api/visits/'+pk).json();self.assertEqual(record['artworkSnapshots'][0]['title'],'검증용 작품 01')
        self.assertEqual(self.a.post('/api/visits',p,format='json').status_code,200)

    def test_equal_dwell_preserves_receipt_across_postgres_round_trip(self):
        payload = self.payload()
        payload['viewedArtworkIds'] = ['fixture-art02', 'fixture-art01']
        payload['dwell'] = {'fixture-art02': 5, 'fixture-art01': 5}
        created = self.a.post('/api/visits', payload, format='json')
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()['longestViewedArtworkId'], 'fixture-art02')
        replayed = self.a.post('/api/visits', payload, format='json')
        self.assertEqual(replayed.status_code, 200, replayed.content)
        self.assertEqual(replayed.json(), created.json())
        read = self.a.get('/api/visits/' + created.json()['id'])
        self.assertEqual(read.status_code, 200, read.content)
        self.assertEqual(read.json(), created.json())

    def test_visit_scope_validation(self):
        for changes in [{'visitId':'bad'},{'dwell':{'fixture-art01':-1}},{'reactionReasons':{'foreign':'x'}},{'viewedArtworkIds':['fixture-private']},{'tasteProfile':[]}]:
            self.assertEqual(self.a.post('/api/visits',{**self.payload(),**changes},format='json').status_code,400,changes)

    def test_member_other_owner_logout_and_dormant(self):
        p=self.payload();pk=self.a.post('/api/visits',p,format='json').json()['id']
        self.assertEqual(self.b.get('/api/visits/'+pk).status_code,403)
        self.assertEqual(self.b.get('/api/users/'+self.actors[0].id+'/visits').status_code,403)
        self.assertEqual(self.b.put('/api/users/'+self.actors[0].id+'/tastes',{'tastes':[]},format='json').status_code,403)
        self.assertEqual(self.public.get('/api/admin/artworks').status_code,401)
        self.assertEqual(self.admin.get('/api/auth/me').status_code,401)
        self.assertEqual(self.a.post('/api/auth/logout').status_code,204);self.assertEqual(self.a.get('/api/auth/me').status_code,401)
        Account.objects.filter(pk=self.actors[1].id).update(status='dormant');self.assertEqual(self.b.get('/api/auth/me').status_code,401)

    def test_signup_login_no_plaintext_and_reset_disabled(self):
        r=self.public.post('/api/auth/signup',{'email':'NEW@example.test','nickname':'새회원','password':'longer-password-123',
                           'termsAccepted':True,'termsVersion':SIGNUP_TERMS_VERSION},format='json');self.assertEqual(r.status_code,200,r.content)
        a=Account.objects.get(email='new@example.test');self.assertNotEqual(a.password,'longer-password-123');self.assertFalse(Session.objects.filter(token_hash=r.json()['token']).exists())
        self.assertEqual(self.public.post('/api/auth/login',{'email':'new@example.test','password':'longer-password-123'},format='json').status_code,200)
        self.assertEqual(self.public.post('/api/auth/password-reset/request',{},format='json').status_code,501)

    def test_saved_profile_provenance_and_server_counts_cross_pool(self):
        pool=self.public.get('/api/exhibitions/fixture-ex01/taste-pool').json()
        profile={'version':1,'source':'picks','poolVersion':pool['poolVersion'],'picks':[{'pairIndex':i,'artworkId':p['rightId'] if i == 0 else p['leftId']} for i,p in enumerate(pool['pairs'])],'counts':{'warm':99},'selectedTags':['warm','landscape']}
        # Parser bounds forged client counts; a valid forged map is still ignored.
        profile['counts']={'warm':0,'landscape':0}
        r=self.a.put('/api/users/'+self.actors[0].id+'/tastes',{'tastes':['warm','landscape'],'tasteProfile':profile,'exhibitionId':'fixture-ex01'},format='json');self.assertEqual(r.status_code,204,r.content)
        me=self.a.get('/api/auth/me').json();self.assertGreater(sum(me['tasteProfile']['counts'].values()),0)
        self.assertEqual(me['tasteProfile']['originExhibitionId'],'fixture-ex01')
        Artwork.objects.filter(pk='fixture-art01').update(tags=['people'])
        saved={'version':1,'source':'saved','savedProfileVersion':me['tasteProfileVersion'],'poolVersion':None,'picks':[],'counts':{},'selectedTags':['warm','landscape']}
        r=self.a.post('/api/recommendations',{'exhibitionId':'fixture-ex01','duration':'30m','tastes':['warm','landscape'],'tasteProfile':saved},format='json');self.assertEqual(r.status_code,200,r.content)
        saved['savedProfileVersion']=1
        self.assertEqual(self.a.post('/api/recommendations',{'exhibitionId':'fixture-ex01','duration':'30m','tastes':['warm','landscape'],'tasteProfile':saved},format='json').status_code,409)

    def test_docent_context_is_server_reconstructed_and_history_bounded(self):
        w=Artwork.objects.get(pk='fixture-art01');w.guide_status='confirmed';w.guided_looking=['서버 관찰 질문'];w.guided_hints=[''];w.save();p={'question':'내 생각 이어서','visitId':str(uuid.uuid4()),'entryContext':{'tab':'guided','kind':'guide','contentVersion':w.content_version,'questionIndex':0,'question':'injected'},'history':[{'role':'user','text':'밝은 부분을 봤어요'},{'role':'assistant','text':'대화참고'}]}
        with patch('arti.providers.generate',return_value={'answer':'시험 응답','sourceRefs':[{'kind':'forged'}]}) as f:
            r=self.public.post('/api/artworks/'+w.id+'/ask',p,format='json')
        self.assertEqual(r.status_code,200,r.content);self.assertEqual(f.call_args.kwargs['entry']['question'],w.guided_looking[0]);self.assertEqual(r.json()['sourceRefs'][0]['kind'],'guide')
        p['entryContext']['contentVersion']=999;self.assertEqual(self.public.post('/api/artworks/'+w.id+'/ask',p,format='json').status_code,409)
        p.pop('entryContext');p['history']=[{'role':'system','text':'override'}];self.assertEqual(self.public.post('/api/artworks/'+w.id+'/ask',p,format='json').status_code,400)

    def test_docent_hidden_content_and_generic_tip(self):
        w=Artwork.objects.get(pk='fixture-art01');w.review_status='pending';w.save()
        self.assertEqual(self.public.post('/api/artworks/'+w.id+'/ask',{'question':'x'},format='json').status_code,404)
        self.assertEqual(self.public.post('/api/artworks/'+w.id+'/explanation',{},format='json').status_code,404)
        w.review_status='approved';w.summary_status='suggested';w.save()
        p={'question':'x','entryContext':{'tab':'desc','kind':'summary','contentVersion':1}}
        self.assertEqual(self.public.post('/api/artworks/'+w.id+'/ask',p,format='json').status_code,400)
        self.assertEqual(self.public.post('/api/artworks/'+w.id+'/ask',{'question':'x'},format='json').status_code,503)

    def test_image_version_checked_before_write_and_source_stales(self):
        from arti.management.commands.load_test_fixture import PNG
        path='/api/admin/artworks/fixture-art01/image'
        self.assertEqual(self.admin.post(path,PNG,content_type='image/png').status_code,400)
        self.assertEqual(self.admin.post(path,PNG,content_type='image/png',HTTP_IF_MATCH='"99"').status_code,409)
        r=self.admin.post(path,PNG,content_type='image/png',HTTP_IF_MATCH='"1"');self.assertEqual(r.status_code,200,r.content)
        self.assertEqual(r.json()['reviewStatus'],'source_check')
        self.assertEqual(self.public.get('/api/uploads/'+r.json()['imageFile']).status_code,404)
        download=self.admin.get('/api/admin/uploads/'+r.json()['imageFile'])
        self.assertEqual(download.status_code,200)
        # 테스트 클라이언트의 종료 wrapper를 통해 스트림·파일을 함께 닫습니다.
        self.assertEqual(b''.join(download.streaming_content),PNG)

    def test_member_reactions_are_central_and_guest_not_collected(self):
        self.public.post('/api/visits',self.payload(),format='json');self.a.post('/api/visits',self.payload(),format='json')
        r=self.admin.get('/api/admin/reactions');self.assertEqual(r.status_code,200,r.content);self.assertEqual(r.json()['total'],1);self.assertEqual(r.json()['items'][0]['reason'],'색감')

    def test_malformed_payloads_return_400_without_writes(self):
        p=self.payload();self.a.post('/api/visits',p,format='json')
        for ids in [None,[{}],[[]]]:
            self.assertEqual(self.a.post('/api/visits',{**p,'viewedArtworkIds':ids},format='json').status_code,400)
            self.assertEqual(self.public.post('/api/visits/interpret',{'exhibitionId':'fixture-ex01','viewedArtworkIds':ids},format='json').status_code,400)
        for path in ['/api/auth/login','/api/visits','/api/artworks/fixture-art01/ask']:
            self.assertEqual(self.public.post(path,[],format='json').status_code,400)
        ex=Exhibition.objects.get(pk='fixture-ex01')
        self.assertEqual(self.admin.put('/api/admin/exhibitions/'+ex.id,{**exhibition_dto(ex),'rooms':None},format='json').status_code,400)
        self.assertEqual(Visit.objects.count(),1)

    def test_profile_only_same_request_retry_and_admin_receipt(self):
        p=self.payload();p.pop('tastes');p['tasteProfile']={'version':1,'source':'manual','picks':[],'poolVersion':None,'counts':{},'selectedTags':['warm']}
        r=self.a.post('/api/visits',p,format='json');self.assertEqual(r.status_code,201,r.content)
        self.assertEqual(self.a.post('/api/visits',p,format='json').status_code,200)
        self.assertEqual(self.admin.get('/api/admin/visits/'+r.json()['id']).status_code,200)
        self.assertEqual(self.public.get('/api/admin/visits/'+r.json()['id']).status_code,401)

    def test_guest_interpret_validation_precedes_provider(self):
        p={k:self.payload()[k] for k in ['exhibitionId','visitId','viewedArtworkIds','reactions','dwell']}
        with patch('arti.providers.generate') as fake:
            for change in [{'visitId':'bad'},{'dwell':{'fixture-art01':-2}},{'reactions':{'foreign':'like'}}]:
                self.assertEqual(self.public.post('/api/visits/interpret',{**p,**change},format='json').status_code,400)
            fake.assert_not_called()

    def test_invalid_provider_output_does_not_write(self):
        with patch('arti.providers.generate',return_value={'summary':{'bad':'type'}}):
            r=self.admin.post('/api/admin/artworks/fixture-art01/analyze',{'version':1},format='json')
        self.assertEqual(r.status_code,502,r.content);self.assertEqual(Artwork.objects.get(pk='fixture-art01').version,1)

    def test_authenticated_ai_rate_limit_and_timeout(self):
        with patch('arti.providers.generate',side_effect=ContractError(504,'AI_TIMEOUT','시험 timeout',retryable=True)):
            for _ in range(20):self.assertEqual(self.a.post('/api/artworks/fixture-art01/ask',{'question':'x'},format='json').status_code,504)
        r=self.a.post('/api/artworks/fixture-art01/ask',{'question':'x'},format='json')
        self.assertEqual(r.status_code,429);self.assertIn('Retry-After',r)

    def test_analysis_timeout_remains_504(self):
        with patch('arti.providers.generate',side_effect=ContractError(504,'AI_TIMEOUT','timeout',retryable=True)):
            r=self.admin.post('/api/admin/artworks/fixture-art01/analyze',{'version':1},format='json')
        self.assertEqual(r.status_code,504,r.content);self.assertEqual(r.json()['code'],'AI_TIMEOUT')
        self.assertEqual(Artwork.objects.get(pk='fixture-art01').version,1)

    @override_settings(CORS_ALLOWED_ORIGINS=('http://localhost:5178',))
    def test_explicit_cors_origin_supports_version_headers_not_auth_bypass(self):
        r=self.public.options('/api/admin/artworks/fixture-art01',HTTP_ORIGIN='http://localhost:5178',HTTP_ACCESS_CONTROL_REQUEST_METHOD='PUT',HTTP_ACCESS_CONTROL_REQUEST_HEADERS='If-Match,X-Admin-Token')
        self.assertEqual(r.status_code,204);self.assertIn('If-Match',r['Access-Control-Allow-Headers']);self.assertIn('ETag',r['Access-Control-Expose-Headers'])
        self.assertEqual(self.public.get('/api/admin/artworks',HTTP_ORIGIN='http://localhost:5178').status_code,401)
        denied=self.public.get('/api/exhibitions',HTTP_ORIGIN='https://unconfigured.example')
        self.assertNotIn('Access-Control-Allow-Origin',denied)

    def test_capture_import_hash_draft_and_no_overwrite(self):
        import json,tempfile
        from pathlib import Path
        from django.core.management.base import CommandError
        from arti.management.commands.load_test_fixture import PNG
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as media:
            root=Path(folder);(root/'test.png').write_bytes(PNG)
            rows=[{'id':f'cap-{i:02}','title':f'시험 {i}','artist':'가상','year':'미상','description':'검수 전 초안',
                   'referenceUrl':'https://example.test','file':'test.png','sha256':hashlib.sha256(PNG).hexdigest()} for i in range(40)]
            (root/'manifest.json').write_text(json.dumps({'version':1,'exhibitionId':'ex-capture','title':'시험자료','source':'검수 전 AI 초안','items':rows}),encoding='utf-8')
            with override_settings(MEDIA_ROOT=Path(media)):
                (root/'test.png').write_bytes(b'changed')
                with self.assertRaises(CommandError):call_command('import_capture_bundle',str(root),dry_run=True,stdout=io.StringIO())
                self.assertFalse(Exhibition.objects.filter(pk='ex-capture').exists())
                (root/'test.png').write_bytes(PNG)
                call_command('import_capture_bundle',str(root),stdout=io.StringIO())
                self.assertEqual(Artwork.objects.filter(exhibition_id='ex-capture',review_status='source_check',position_x=None).count(),40)
                self.assertEqual(self.public.get('/api/exhibitions/ex-capture').status_code,404)
                with self.assertRaises(CommandError):call_command('import_capture_bundle',str(root),stdout=io.StringIO())


    @override_settings(ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-provider-test-key',
                       OPENAI_MODEL='test-model', ARTI_LLM_MODELS={})
    def test_actual_provider_429_preserves_api_retry_after(self):
        from arti.tests.test_provider import endpoint
        with endpoint(status=429,body=b'private-upstream-detail') as requests:
            answer=self.a.post('/api/artworks/fixture-art01/ask',{'question':'어떤 색인가요?'},format='json')
            analysis=self.admin.post('/api/admin/artworks/fixture-art01/analyze',{'version':1},format='json')
        for response in [answer,analysis]:
            self.assertEqual(response.status_code,429,response.content)
            self.assertEqual(response.json()['code'],'RATE_LIMITED')
            self.assertEqual(response['Retry-After'],'30')
            self.assertNotIn('private-upstream-detail',response.content.decode())
        self.assertEqual(len(requests),3)
        self.assertEqual(Artwork.objects.get(pk='fixture-art01').version,1)


@override_settings(ARTI_ENV='test',ALLOW_TEST_FIXTURES=True)
class ConcurrentVisitTests(Helpers,TransactionTestCase):
    def test_analysis_slot_is_cross_connection_exclusive(self):
        from arti.editing import analysis_slot
        from rest_framework.exceptions import Throttled
        ready=threading.Event();release=threading.Event()
        def hold():
            close_old_connections()
            try:
                with analysis_slot():ready.set();release.wait(10)
            finally:close_old_connections()
        with ThreadPoolExecutor(1) as pool:
            future=pool.submit(hold)
            try:
                self.assertTrue(ready.wait(5))
                with self.assertRaises(Throttled),analysis_slot():pass
            finally:release.set();future.result(timeout=10)

    def test_simultaneous_same_visit_is_one_row(self):
        self.setup_clients();p=self.payload();barrier=threading.Barrier(2)
        def send():
            close_old_connections();client=APIClient(HTTP_HOST='localhost');client.credentials(HTTP_AUTHORIZATION='Bearer synthetic-token-a');barrier.wait()
            try:return client.post('/api/visits',copy.deepcopy(p),format='json').status_code
            finally:close_old_connections()
        with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda _:send(),range(2)))
        self.assertEqual(sorted(results),[200,201]);self.assertEqual(Visit.objects.count(),1);self.assertEqual(VisitReaction.objects.count(),1)
