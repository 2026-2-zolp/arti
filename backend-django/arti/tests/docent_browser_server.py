"""Serve the product API with a loopback-only docent provider for browser tests."""

import io
import json
import os
import wave
from contextlib import contextmanager
from datetime import date
from threading import Event, Lock
from time import sleep
from uuid import UUID
from unittest.mock import patch
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from arti.docent_memory import interest_signal
from arti.models import Artwork, Exhibition
from arti.tests.test_provider import endpoint


GUIDE_HINT_REQUEST = '이 관찰 질문에 답할 수 있도록 작품에서 볼 지점 하나를 힌트로 알려 주세요.'
EVIDENCE_QUESTION = '[합성 근거 부족] 이 작품을 그리던 날 작가에게 어떤 사건이 있었나요?'
OBSERVATION_QUESTIONS = (
    '[합성 근거 부족] 어떤 색이 쓰였나요?',
    '[합성 근거 부족] 윤곽이 어떤 모양인가요?',
    '[합성 근거 부족] 색의 차이는 어디에서 살펴볼까요?',
    '[합성 근거 부족] 빛을 자세히 설명해 주세요.',
)
SOURCE_QUESTION = '[합성 소장처] 어떤 배경에서 제작되었나요?'
COLLECTION_QUESTION = '[합성 보강] 어떤 배경에서 제작되었나요?'
SOURCE_FACT = '합성 소장처 목록에는 색면 구성을 연구하기 위해 제작했다고 적혀 있어요.'
SOURCE_URL = 'https://museum.example.test/works/fixture-art03'


def ensure_visitor_memory_fixture():
    exhibition, _ = Exhibition.objects.get_or_create(pk='fixture-ex-memory', defaults={
        'title': '관람 기억 검증 전시', 'venue': '가상 전시실', 'status': 'running',
        'start_date': date(2026, 1, 1), 'end_date': date(2027, 12, 31),
        'rooms': [{'id': 'room-1', 'name': '검증실'}],
    })
    Artwork.objects.get_or_create(pk='fixture-memory-art01', defaults={
        'exhibition': exhibition, 'title': '다음 전시 검증 작품', 'artist': '가상 작가', 'room_id': 'room-1',
        'position_x': 15, 'position_y': 20, 'palette': ['#C99572', '#415363'], 'tags': ['warm', 'landscape'],
        'description': '빛과 색을 함께 감상하는 합성 검수 작품입니다.', 'review_status': 'approved',
    })


@contextmanager
def listening_fixture(enabled):
    if not enabled:
        yield
        return

    output = io.BytesIO()
    with wave.open(output, 'wb') as clip:
        clip.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        clip.writeframes(b'\0\0' * 48000)

    def synthesize(_reply, *, on_done=None):
        return output.getvalue()

    # Only the loopback fixture receives grants. Keep signed requests and the real product endpoint in the test.
    with override_settings(ARTI_DOCENT_LISTENING_EXHIBITIONS=frozenset({'fixture-ex01'})), patch(
        'arti.docent_audio.available', side_effect=lambda work: work.exhibition_id == 'fixture-ex01',
    ), patch('arti.docent_audio.synthesize', side_effect=synthesize):
        yield


def serve(host='0.0.0.0', port=8000):
    if settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES:
        raise RuntimeError('Use an isolated ARTI test database with synthetic fixtures.')

    pending = {}
    faults = {'502': 500, '429': 429, '504': 200}
    races = os.environ.get('ARTI_DOCENT_RACE_TESTS') == '1'
    entries = os.environ.get('ARTI_DOCENT_ENTRY_TESTS') == '1'
    tools = os.environ.get('ARTI_DOCENT_AGENT_TESTS') == '1'
    memory = os.environ.get('ARTI_DOCENT_MEMORY_TESTS') == '1'
    listening = os.environ.get('ARTI_DOCENT_LISTENING_TESTS') == '1'
    narration_file = settings.MEDIA_ROOT / 'fixture-narration-work.json'
    if memory:
        ensure_visitor_memory_fixture()
    if listening and not narration_file.is_file():
        Artwork.objects.filter(pk='fixture-art03', exhibition_id='fixture-ex01').update(
            guide_status='confirmed', guide_intro='밝은 색면을 먼저 살펴보세요.',
            guided_looking=['어두운 색과 나란히 있는 부분은 어디인가요?'],
            guided_hints=['화면 가운데를 살펴보세요.'],
        )
    if entries:
        # The first request fails, then the same question can be sent with the newly confirmed evidence.
        faults['갱신'] = 500
    narration = json.loads(narration_file.read_text(encoding='utf-8')) if narration_file.is_file() else None
    narrated_answers = {} if narration is None else {
        narration['openingQuestion'].rstrip('?.!'): narration['openingAnswer'],
        '이 작품은 어디부터 보면 좋을까요': narration['openingAnswer'],
        **{turn['question'].rstrip('?.!'): turn['answer'] for turn in narration['turns'] + narration.get('extraTurns', [])},
    }
    gates = {}
    gates_lock = Lock()

    def gate_for(value):
        key = str(UUID(value))
        with gates_lock:
            return gates.setdefault(key, (Event(), Event()))

    def respond(attempt):
        wire = requests[attempt - 1]
        payload = wire['body']
        prompt = json.loads(wire['body']['messages'][1]['content'])
        question = prompt.get('question') or ''
        entry = prompt.get('entry') or {}
        parts = question.split(' ', 3)
        fault = parts[1] if len(parts) == 4 and parts[0] == '[합성' else ''
        retry_key = question
        if entries and question == GUIDE_HINT_REQUEST:
            fault = '502'
            retry_key = question, entry.get('question')
        if fault in faults:
            previous = pending.pop(retry_key, None)
            if previous is None:
                pending[retry_key] = wire['raw']
                if fault == '504':
                    sleep(1.5)  # The real HTTP read exceeds the shortened adapter timeout.
                else:
                    return faults[fault], b'upstream-private-debug'
            elif fault != '갱신' and previous != wire['raw']:
                return 400, b'the provider retry did not preserve the original prompt'

        if tools and payload.get('tools') and payload.get('tool_choice') != 'none':
            name = payload['tools'][0]['function']['name']
            topic = 'creation'
            if name == 'inspect_approved_artwork':
                topic = next((value for word, value in (('윤곽', 'shape'), ('색', 'color')) if word in question), 'placement')
            return 200, json.dumps({'choices': [{'finish_reason': 'tool_calls', 'message': {'tool_calls': [{
                'id': 'call-docent-demo', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps({'topic': topic})},
            }]}}]}).encode()
        unsupported = question == EVIDENCE_QUESTION or question in OBSERVATION_QUESTIONS
        text = '합성 답변입니다. 밝은 부분을 살펴보세요. <img src=x>'
        if memory and question == '이 대화를 시작할 때 제가 붙인 관찰 이름은 뭐였나요?':
            remarks = prompt.get('earlierUserRemarks', [])
            unsupported = not any('갈색등불47' in remark for remark in remarks)
            text = '처음 붙인 관찰 이름은 갈색등불47이에요.'
        collection = prompt.get('collectionEvidence') if question == COLLECTION_QUESTION else None
        if question == COLLECTION_QUESTION:
            unsupported = not collection
            if collection:
                text = collection['excerpt'] + ' 작가의 구체적인 의도는 확인되지 않아요.'
        if tools and payload.get('tool_choice') == 'none':
            collection = json.loads(payload['messages'][-1]['content'])
            text = collection['excerpt'] + ' 작가의 구체적인 의도는 확인되지 않아요.'
        if question == SOURCE_QUESTION:
            work = prompt['artworkData']
            unsupported = work.get('referenceUrl') != SOURCE_URL or SOURCE_FACT not in work.get('description', '')
            text = SOURCE_FACT + ' 작가의 구체적인 의도는 확인되지 않아요.'
        if entries and entry.get('kind') in ('guide', 'summary'):
            text = '합성 근거 · ' + (entry.get('question') or entry['text'])
        if listening:
            text = '합성 음성 검수 답변이에요.'
        if narration and prompt['artworkData']['id'] == narration['artworkId'] and not unsupported:
            demo_question = question.rstrip('?.!')
            if demo_question in narrated_answers:
                text = narrated_answers[demo_question]
            elif demo_question in ('작가는 어떤 사람인가요', '왜 유명한 작품인가요'):
                unsupported = True
        visitor = prompt.get('visitorContext') or {}
        looking_question = any(phrase in question for phrase in ('어디부터', '볼 지점'))
        if memory and visitor and not unsupported and not collection and (looking_question or interest_signal(question)):
            earlier = visitor.get('earlierInExhibition', [])
            previous = visitor.get('previousVisit')
            details = [topic for item in earlier for topic in item['topics']]
            if details:
                text = f'앞 작품에서 살펴본 {details[0]}에 주목하면서 이 작품의 밝은 부분도 찾아보세요.'
            elif previous and previous['topics']:
                text = f'지난 전시에서는 {previous["topics"][0]}에 관심을 두셨어요. 이번 작품에서는 밝은 부분부터 살펴볼까요?'
            if visitor.get('matchingTasteTags'):
                text += f' {visitor["matchingTasteTags"][0]}도 눈여겨보세요.'
        if races and len(parts) == 4 and parts[:2] == ['[합성', '대기']:
            started, release = gate_for(parts[2])
            started.set()
            try:
                if not release.wait(20):
                    return 500, b'synthetic gate expired'
            finally:
                with gates_lock:
                    gates.pop(parts[2], None)
            text = f'합성 지연 답변 · {prompt["artworkData"]["description"]}'
        answer = {
            'answer': '다른 합성 작품에 기록된 사건 때문에 제작했습니다.' if unsupported else text,
            'insufficientEvidence': unsupported,
            'collectionEvidenceUsed': bool(collection),
            'sourceRefs': [
                {'artworkId': prompt['artworkData']['id'], 'kind': 'summary', 'sourceVersion': 99, 'revision': 99},
                {'artworkId': 'fixture-art02', 'kind': 'guide', 'sourceVersion': 1, 'revision': 1},
                {'artworkId': 'forged-work', 'kind': 'summary'},
            ],
        }
        response = {'choices': [{
            'finish_reason': 'stop', 'message': {'content': json.dumps(answer, ensure_ascii=False)},
        }]}
        return 200, json.dumps(response, ensure_ascii=False).encode()

    application = get_wsgi_application()

    def mock_application(environ, start_response):
        def mark(status, headers, exc_info=None):
            synthetic = [('X-Arti-Docent-Mock', '1')]
            if listening:
                synthetic.append(('X-Arti-Docent-Listening-Mock', '1'))
            return start_response(status, [*headers, *synthetic], exc_info)

        prefix = '/api/__docent_test__/gate/'
        if races and environ['PATH_INFO'].startswith(prefix):
            try:
                started, release = gate_for(environ['PATH_INFO'][len(prefix):])
            except ValueError:
                mark('404 Not Found', [('Content-Length', '0')])
                return [b'']
            if environ['REQUEST_METHOD'] == 'POST':
                release.set()
            body = json.dumps({'started': started.is_set(), 'released': release.is_set()}).encode()
            mark('200 OK', [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
            return [body]
        return application(environ, mark)

    with override_settings(
        ARTI_LLM_PROVIDER='openai_compatible', OPENAI_API_KEY='synthetic-browser-only',
        OPENAI_MODEL='synthetic-browser-only', ARTI_LLM_MODELS={}, ARTI_DRAFT_PROVIDER='default', ARTI_MODEL_SERVICE_URL='',
        ARTI_DOCENT_TOOL_DEMO=tools, ARTI_DOCENT_MEMORY_DEMO=memory,
    ), endpoint(respond=respond) as requests, listening_fixture(listening), patch(
        'arti.llm.TIMEOUT_SECONDS', 22 if races else 1,
    ), make_server(
        host, port, mock_application, ThreadedWSGIServer, WSGIRequestHandler,
    ) as server:
        server.serve_forever()
