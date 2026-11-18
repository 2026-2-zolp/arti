import json
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from arti.models import Account, KakaoIdentity, KakaoOAuthFlow, Session, SignupTermsAcceptance


class AuthRetentionTests(TestCase):
    def test_preview_and_purge_preserve_active_records_and_account_links(self):
        account = Account.objects.create(login_id='retention@example.test', role='user')
        SignupTermsAcceptance.objects.create(account=account, version='fixture-original')
        KakaoIdentity.objects.create(account=account, client_id='fixture-client', subject='fixture-subject')
        now = timezone.now()
        for key, expiry in (('expired', now - timedelta(seconds=1)), ('active', now + timedelta(hours=1))):
            Session.objects.create(account=account, token_hash=key, expires_at=expiry)
            KakaoOAuthFlow.objects.create(account=account, browser_hash=key, expires_at=expiry)

        output = StringIO()
        call_command('purge_expired_auth', stdout=output)
        self.assertEqual(json.loads(output.getvalue()), {'applied': False, 'sessions': 1, 'kakaoFlows': 1})
        self.assertEqual((Session.objects.count(), KakaoOAuthFlow.objects.count()), (2, 2))

        output = StringIO()
        call_command('purge_expired_auth', '--apply', stdout=output)
        self.assertEqual(json.loads(output.getvalue()), {'applied': True, 'sessions': 1, 'kakaoFlows': 1})
        self.assertEqual(list(Session.objects.values_list('token_hash', flat=True)), ['active'])
        self.assertEqual(list(KakaoOAuthFlow.objects.values_list('browser_hash', flat=True)), ['active'])
        self.assertTrue(Account.objects.filter(pk=account.pk).exists())
        self.assertTrue(KakaoIdentity.objects.filter(account=account).exists())
        self.assertEqual(SignupTermsAcceptance.objects.get(account=account).version, 'fixture-original')
