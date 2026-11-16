"""A fresh loopback Django process for each visit Chrome run."""

import re
import sys
from threading import Thread
from wsgiref.simple_server import make_server

from django.conf import settings
from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
from django.core.wsgi import get_wsgi_application


def require_visit_fixture():
    database = settings.DATABASES['default']
    if (settings.ARTI_ENV != 'test' or not settings.ALLOW_TEST_FIXTURES
            or not re.fullmatch(r'arti_visit_boundaries(?:_[a-z0-9_]{1,40})?', database['NAME'])
            or database['HOST'] not in ('127.0.0.1', 'localhost')
            or settings.ARTI_LLM_PROVIDER != 'disabled' or settings.ARTI_DRAFT_PROVIDER != 'default'
            or settings.ARTI_MODEL_SERVICE_URL):
        raise RuntimeError('Use a dedicated loopback visit fixture DB with both model providers disabled.')


def serve():
    require_visit_fixture()
    with make_server('127.0.0.1', 0, get_wsgi_application(),
                     ThreadedWSGIServer, WSGIRequestHandler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            print(f'ARTI_VISIT_BROWSER_PORT={server.server_port}', flush=True)
            # The runner owns this process through the pipe, including on Windows.
            sys.stdin.buffer.read()
        finally:
            server.shutdown()
            worker.join()
