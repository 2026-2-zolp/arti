# 로컬 개발 설정 파일을 안전하게 준비합니다.
"""Generate local-only ignored Compose credentials, without overwriting existing settings."""
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
path = root/'.env.compose'
with path.open('x', encoding='utf-8') as output:
    output.write(f'ARTI_DB_PASSWORD={secrets.token_urlsafe(32)}\n'
                 f'DJANGO_SECRET_KEY={secrets.token_urlsafe(48)}\n'
                 'ARTI_ENV=development\nALLOW_TEST_FIXTURES=false\nARTI_API_PORT=4018\nARTI_UI_PORT=5178\n')
print('Created ignored .env.compose. Fixtures remain disabled; no credentials printed.')
