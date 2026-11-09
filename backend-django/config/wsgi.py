# 웹 서버가 Django 애플리케이션을 실행할 진입점입니다.
import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
application = get_wsgi_application()
