"""Bounded, read-only docent tools for approved collection records and synthetic rehearsals."""

import hashlib
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from django.conf import settings


SAMPLE_IMAGE_SHA256 = '6c9d5d318256835d0af4c05a9c4d0603168212f397a55ec399711eb54fcb4ef3'
SAMPLE_OBSERVATIONS = {
    'color': '등록된 합성 도판의 파란 바탕과 노란 부분을 번갈아 비교해 보세요.',
    'shape': '등록된 합성 도판에서 노란 원의 윤곽과 아래쪽 가는 선을 살펴보세요.',
    'placement': '등록된 합성 도판에서 왼쪽 위의 노란 원과 화면 아래쪽의 빨간 선을 비교해 보세요.',
}
MAX_SAMPLE_BYTES = 2 * 1024 * 1024
MAX_CATALOG_BYTES = 1024 * 1024
CATALOG_TIMEOUT = 2


class NoCatalogRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CatalogText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skipping = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skipping = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skipping = False

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def official_catalog_url(raw):
    """Build a GET target for a known collection-document route."""
    try:
        parsed = urlsplit(raw)
        host = parsed.hostname
        if parsed.scheme != 'https' or parsed.username is not None or parsed.port not in (None, 443):
            return None
        path = parsed.path
        if host == 'www.boe.es' and path == '/diario_boe/txt.php':
            query = parse_qsl(parsed.query, strict_parsing=True, max_num_fields=1)
            if len(query) != 1 or query[0][0] != 'id' or not re.fullmatch(r'BOE-A-\d{4}-\d{1,8}', query[0][1]):
                return None
            return urlunsplit(('https', host, path, f'id={query[0][1]}', ''))
        allowed = {
            'projects.mcah.columbia.edu': r'/hispanic/monographs/[a-z0-9-]+\.php',
            'hispanicsociety.emuseum.com': r'/objects/\d+(?:/[a-z0-9-]+)?/?',
        }
        if host in allowed and re.fullmatch(allowed[host], path):
            return urlunsplit(('https', host, path, '', ''))
    except (TypeError, ValueError):
        return None
    return None


def fetch_catalog_text(url):
    # One request to the registered institution, with no tokens, user data or redirects.
    opener = build_opener(ProxyHandler({}), NoCatalogRedirects())
    deadline = monotonic() + CATALOG_TIMEOUT
    try:
        request = Request(url, headers={'Accept': 'text/html', 'Accept-Encoding': 'identity'})
        with opener.open(request, timeout=CATALOG_TIMEOUT) as response:
            if response.headers.get_content_type() != 'text/html':
                return None
            page = bytearray()
            while monotonic() < deadline and len(page) <= MAX_CATALOG_BYTES:
                part = response.read1(min(16384, MAX_CATALOG_BYTES + 1 - len(page)))
                if not part:
                    parser = CatalogText()
                    parser.feed(page.decode(response.headers.get_content_charset() or 'utf-8', errors='replace'))
                    return ' '.join(parser.parts)
                page.extend(part)
    except HTTPError as error:
        error.close()
        return None
    except (URLError, OSError, LookupError, ValueError):
        return None
    return None


def check_catalog_accession(collection):
    url = official_catalog_url(collection['url'])
    accession = collection['accession']
    if not url or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 -]{0,39}', accession):
        return 'unverified'
    page = fetch_catalog_text(url)
    if page and re.search(rf'(?<![A-Za-z0-9_-]){re.escape(accession)}(?![A-Za-z0-9_-])', page, re.I):
        return 'accession_found'
    return 'unverified'


@dataclass(frozen=True)
class ToolObservation:
    text: str


@dataclass(frozen=True)
class DemoTool:
    name: str
    description: str
    topics: tuple[str, ...]
    work: object
    collection: dict | None
    approved_catalog: bool = False

    def definition(self):
        return {'type': 'function', 'function': {
            'name': self.name,
            'description': self.description,
            'strict': True,
            'parameters': {'type': 'object', 'properties': {'topic': {'type': 'string', 'enum': list(self.topics)}},
                           'required': ['topic'], 'additionalProperties': False},
        }}

    def run(self, topic):
        if self.name == 'lookup_museum_record':
            # The demo catalog has a single registered identity. New findings are held for A-04.
            if not self.collection:
                return None
            if not self.approved_catalog and (self.work.id != 'fixture-art03'
                    or self.collection['accession'] != 'ARTI-5690-03'):
                return None
            result = {'status': 'approved', 'excerpt': self.collection['excerpt']}
            live_exhibitions = getattr(settings, 'ARTI_DOCENT_LIVE_COLLECTION_EXHIBITIONS', ())
            if self.approved_catalog and self.work.exhibition_id in live_exhibitions:
                result['currentRecord'] = check_catalog_accession(self.collection)
            return result
        if self.work.id != 'fixture-art03' or not self.work.show_image or not self.work.image_file:
            return None
        name = self.work.image_file
        root = Path(settings.MEDIA_ROOT).resolve()
        path = (root / name).resolve()
        if Path(name).name != name or not path.is_relative_to(root):
            return None
        try:
            with path.open('rb') as stream:
                sample = stream.read(MAX_SAMPLE_BYTES + 1)
        except OSError:
            return None
        if len(sample) > MAX_SAMPLE_BYTES or hashlib.sha256(sample).hexdigest() != SAMPLE_IMAGE_SHA256:
            return None
        return ToolObservation(SAMPLE_OBSERVATIONS[topic])


def execute_call(tool, calls):
    if not isinstance(calls, list) or len(calls) != 1 or not isinstance(calls[0], dict):
        raise ValueError('Expected one tool call.')
    call = calls[0]
    call_id = call.get('id')
    function = call.get('function')
    if (not isinstance(call_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', call_id)
            or call.get('type') != 'function' or not isinstance(function, dict) or function.get('name') != tool.name):
        raise ValueError('Unexpected tool identity.')
    arguments = function.get('arguments')
    if not isinstance(arguments, str) or len(arguments) > 256:
        raise ValueError('Invalid tool arguments.')
    decoded = json.loads(arguments)
    if not isinstance(decoded, dict) or set(decoded) != {'topic'} or decoded['topic'] not in tool.topics:
        raise ValueError('Invalid tool topic.')
    accepted = {'id': call_id, 'type': 'function',
                'function': {'name': tool.name, 'arguments': json.dumps(decoded)}}
    return accepted, tool.run(decoded['topic'])


def demo_tool_for(work, question, collection):
    """Expose tools only on the allowlisted test fixture and explicit demo question."""
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not getattr(settings, 'ARTI_DOCENT_TOOL_DEMO', False)
            or work.exhibition_id != 'fixture-ex01' or work.id not in ('fixture-art01', 'fixture-art03')
            or not question.startswith('[합성 도구]')):
        return None
    try:
        provider = urlsplit(settings.OPENAI_BASE_URL).hostname
    except ValueError:
        return None
    if provider not in ('localhost', '127.0.0.1', '::1'):
        return None
    if '도판' in question:
        return DemoTool('inspect_approved_artwork', '현재 도판의 색·윤곽·배치를 확인합니다.',
                        ('color', 'shape', 'placement'), work, None)
    if '소장처' in question:
        return DemoTool('lookup_museum_record', '현재 작품의 승인된 소장 기록을 확인합니다.',
                        ('creation',), work, collection)
    return None


def collection_tool_for(work, question, collection):
    if (not collection or work.exhibition_id not in settings.ARTI_DOCENT_COLLECTION_TOOL_EXHIBITIONS
            or not re.search(r'소장번호|소장\s*기록|소장처.{0,8}(?:자료|기록)', question)):
        return None
    return DemoTool('lookup_museum_record', '이 작품의 승인된 소장처 자료를 확인합니다.',
                    ('collection',), work, collection, approved_catalog=True)
