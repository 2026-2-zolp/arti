import os
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '')
if len(SECRET_KEY) < 32 or SECRET_KEY.startswith('replace-'):
    raise ImproperlyConfigured('DJANGO_SECRET_KEY must contain at least 32 characters.')
ARTI_ENV = os.environ.get('ARTI_ENV', 'production')
DEBUG = os.environ.get('DJANGO_DEBUG', 'false').lower() == 'true' and ARTI_ENV == 'development'
ALLOW_TEST_FIXTURES = os.environ.get('ALLOW_TEST_FIXTURES', 'false').lower() == 'true'
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,api').split(',')
CORS_ALLOWED_ORIGINS = tuple(v.strip() for v in os.environ.get('ARTI_ALLOWED_ORIGINS','').split(',') if v.strip())
INSTALLED_APPS = ['django.contrib.contenttypes', 'rest_framework', 'arti']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'arti.http.RequestIdMiddleware',
              'django.middleware.common.CommonMiddleware']
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
APPEND_SLASH = False
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': os.environ.get('PGDATABASE', 'arti'),
    'USER': os.environ.get('PGUSER', 'arti'),
    'PASSWORD': os.environ.get('PGPASSWORD', ''),
    'HOST': os.environ.get('PGHOST', 'db'),
    'PORT': os.environ.get('PGPORT', '5432'),
    'CONN_MAX_AGE': 0,
    'OPTIONS': {'connect_timeout': 5},
}}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = 'UTC'
LANGUAGE_CODE = 'ko-kr'
MEDIA_ROOT = Path(os.environ.get('MEDIA_ROOT', '/app/media'))
REST_FRAMEWORK = {
    'DEFAULT_PARSER_CLASSES': ['arti.http.ObjectJSONParser'],
    'DEFAULT_AUTHENTICATION_CLASSES': ['arti.authentication.OpaqueAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
    'UNAUTHENTICATED_USER': None,
    'EXCEPTION_HANDLER': 'arti.http.exception_handler',
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
}
DATA_UPLOAD_MAX_MEMORY_SIZE = 200 * 1024
SECURE_CONTENT_TYPE_NOSNIFF = True
PASSWORD_HASHERS = ['django.contrib.auth.hashers.PBKDF2PasswordHasher']
