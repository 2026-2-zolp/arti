"""Run at most 18 synthetic comparison requests and prepare a blind review.

There is no connection to the live ARTI application or visitor database.
"""

import argparse
import hashlib
import json
import secrets
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


FIXTURES = Path(__file__).resolve().parents[1] / 'docs/review/docent-2026-11-15'
API_BASE = 'https://api.openai.com/v1'
MODEL = 'gpt-6-luna'
WORKS = {'L01': 'fixture-art01', 'L02': 'fixture-memory-art01'}
ENV_KEYS = {'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'ARTI_LLM_MODEL_ANSWER',
            'ARTI_LLM_TOKEN_PARAMETER', 'ARTI_LLM_JSON_MODE'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def settings_from(path):
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() in ENV_KEYS:
            values[key.strip()] = value.strip().strip('"').strip("'")
    api_key = values.get('OPENAI_API_KEY', '')
    model = values.get('ARTI_LLM_MODEL_ANSWER') or values.get('OPENAI_MODEL')
    base = values.get('OPENAI_BASE_URL', '').rstrip('/')
    parameter = values.get('ARTI_LLM_TOKEN_PARAMETER', 'max_completion_tokens')
    if not api_key or base != API_BASE or model != MODEL or parameter not in ('max_completion_tokens', 'max_tokens'):
        raise ValueError('OpenAI, Luna 또는 도슨트 토큰 한도 설정을 확인해 주세요.')
    return api_key, parameter, values.get('ARTI_LLM_JSON_MODE', 'true').lower() == 'true'


def load_comparison(path):
    capture = json.loads(path.read_text(encoding='utf-8'))
    protocol = (FIXTURES / 'visitor-memory-protocol.json').read_bytes()
    protocol_hash = hashlib.sha256(protocol).hexdigest()
    if capture.get('scope') != 'synthetic-visitor-memory' or capture.get('protocolSha256') != protocol_hash:
        raise ValueError('현재 평가 프로토콜에서 캡처한 합성 입력이 필요해요.')
    cases = {item['id']: item for item in json.loads(protocol)['cases'][:9]}
    originals = {name: (FIXTURES / 'luna-fixtures' / f'{name}-source-v1.txt').read_text(encoding='utf-8').strip()
                 for name in WORKS}
    inputs = {}
    for item in capture['cases']:
        case_id, memory, source = item['id'], item['memory'], item['source']
        payload = item['payload']
        system, user = payload['messages']
        prompt = json.loads(user['content'])
        work = prompt['artworkData']
        if (case_id not in cases or type(memory) is not bool or (case_id, memory) in inputs
                or (system['role'], user['role']) != ('system', 'user')
                or prompt['history'] != [] or prompt['entry'] is not None
                or prompt['question'] != cases[case_id]['question']
                or work['id'] != WORKS[source] or work['description'] != originals[source]
                or work['source'] != f'{source} 합성 원문 v1'
                or set(prompt) - {'artworkData', 'entry', 'history', 'question', 'visitorContext'}
                or set(prompt.get('visitorContext', {})) != set(cases[case_id]['expected'] if memory else [])):
            raise ValueError('승인된 합성 작품과 고정 질문의 요청만 평가할 수 있어요.')
        inputs[case_id, memory] = {'source': source, 'messages': payload['messages']}
    if set(inputs) != {(case_id, memory) for case_id in cases for memory in (False, True)}:
        raise ValueError('고정 질문 9개의 켬·끔 입력이 모두 필요해요.')
    return cases, originals, protocol_hash, inputs


def ask(opener, messages, api_key, parameter, json_mode):
    payload = {'model': MODEL, 'messages': messages, parameter: 2000, 'stream': False}
    if json_mode:
        payload['response_format'] = {'type': 'json_object'}
    request = Request(API_BASE + '/chat/completions', method='POST', data=json.dumps(payload, ensure_ascii=False).encode(),
                      headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'})
    started = time.monotonic()
    with opener.open(request, timeout=25) as response:
        raw = response.read(256 * 1024 + 1)
        request_id = response.headers.get('x-request-id')
    result = json.loads(raw) if len(raw) <= 256 * 1024 else {}
    choice = result['choices'][0]
    answer = json.loads(choice['message']['content'])
    text = answer.get('answer')
    if choice['finish_reason'] != 'stop' or not isinstance(text, str) or not 0 < len(text.strip()) <= 1000:
        raise ValueError('평가 응답이 예상한 도슨트 JSON 형식과 다릅니다.')
    usage = result.get('usage') or {}
    return {'answer': text, 'insufficientEvidence': answer.get('insufficientEvidence', False),
            'sourceRefs': answer.get('sourceRefs', []), 'requestId': request_id,
            'latencyMs': round((time.monotonic() - started) * 1000),
            'inputTokens': usage.get('prompt_tokens'), 'outputTokens': usage.get('completion_tokens')}


def write_json(path, content):
    path.write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(args):
    cases, originals, protocol_hash, inputs = load_comparison(args.capture)
    api_key, parameter, json_mode = settings_from(args.env_file)
    if not args.send:
        print(f'{MODEL} 합성 입력 검증 완료. 9쌍, 프로토콜 {protocol_hash}.')
        return
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    progress = output / 'results.local.json'
    if progress.exists():
        raise ValueError('기존 결과가 있는 폴더입니다. 중복 실호출을 막기 위해 새 폴더를 사용해 주세요.')

    opener = build_opener(NoRedirect())
    recorded = {'model': MODEL, 'protocolSha256': protocol_hash, 'cases': []}
    write_json(progress, recorded)
    blind = ['# ARTI 도슨트 관람 기억 가림 답안',
             '사례별로 감상 도움·자연스러움·근거 적합성을 0~2점으로 평가해 주세요.']
    for case_id, case in cases.items():
        first_memory = bool(secrets.randbelow(2))
        source = inputs[case_id, first_memory]['source']
        blind.extend([f'## {case_id}', f'합성 승인 자료 {source} v1\n\n{originals[source]}', case['question']])
        for option, memory in zip(('A', 'B'), (first_memory, not first_memory)):
            try:
                result = ask(opener, inputs[case_id, memory]['messages'], api_key, parameter, json_mode)
            except (HTTPError, OSError, ValueError, KeyError, IndexError, TypeError) as e:
                status = e.code if isinstance(e, HTTPError) else type(e).__name__
                return f'{case_id}/{option} 호출 중단 ({status}). 완료한 응답 {len(recorded["cases"])}건을 보관했습니다.'
            recorded['cases'].append({'id': case_id, 'option': option, 'memory': memory, **result})
            write_json(progress, recorded)
            blind.extend([f'### 답안 {option}', result['answer']])
        print(f'{case_id} 응답 2건 완료', flush=True)
    (output / '가림답안.md').write_text('\n\n'.join(blind) + '\n', encoding='utf-8')
    print(f'{MODEL} 완료 {len(recorded["cases"])}건. 가림 답안을 생성했습니다.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--send', action='store_true', help='실제 합성 요청을 보냅니다.')
    try:
        error = run(parser.parse_args())
    except (ValueError, KeyError, OSError, TypeError) as e:
        parser.exit(1, '평가 입력 또는 설정을 확인해 주세요 (' + type(e).__name__ + ').\n')
    if error:
        parser.exit(1, error + '\n')
