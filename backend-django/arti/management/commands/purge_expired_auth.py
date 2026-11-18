import json

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from arti.models import KakaoOAuthFlow, Session


class Command(BaseCommand):
    help = 'Count expired login sessions and Kakao flows. Use --apply to remove them.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Remove only the records that have expired.')

    def handle(self, *args, **options):
        cutoff = timezone.now()
        expired = {
            'sessions': Session.objects.filter(expires_at__lte=cutoff),
            'kakaoFlows': KakaoOAuthFlow.objects.filter(expires_at__lte=cutoff),
        }
        apply = options['apply']
        with transaction.atomic():
            counts = {name: rows.delete()[0] if apply else rows.count() for name, rows in expired.items()}
        return json.dumps({'applied': apply, **counts})
