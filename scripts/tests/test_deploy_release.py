import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / 'ops/aws/deploy-release.sh'
REGISTRY = '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com'


def release(letter):
    return [letter * 40, *(f'{REGISTRY}/arti-{part}@sha256:' + letter * 64 for part in ('api', 'web'))]


STUB = r'''
import json
import os
import sys
from pathlib import Path

root = Path(os.environ['ARTI_RELEASE_ROOT'])
program = Path(sys.argv[0]).name
args = sys.argv[1:]
api = os.environ.get('ARTI_API_IMAGE')
web = os.environ.get('ARTI_WEB_IMAGE')
active = root / 'mock-running'
with (root / 'calls.jsonl').open('a') as log:
    log.write(json.dumps([program, args, api, web]) + '\n')

if program == 'aws':
    print('mock')
elif program == 'curl':
    if '--fail' not in args:
        sys.exit(60 if os.environ.get('FAIL_TLS') else 0)
    current = json.loads(active.read_text())
    if current['api'] != os.environ['OLD_API'] and os.environ.get('FAIL_SMOKE'):
        sys.exit(22)
    if args[-1].endswith('/api/ready'):
        print('{"database":"postgresql"}')
    elif args[-1].endswith('/password/reset'):
        print('Cache-Control: no-store\nReferrer-Policy: no-referrer')
    elif args[-1].endswith('/assets/index-release.js'):
        print('200 ' + ('text/html' if current['api'] != os.environ['OLD_API'] and os.environ.get('FAIL_BUNDLE')
                         else 'application/javascript'))
    elif current['api'] != os.environ['OLD_API'] and os.environ.get('STALE_INDEX'):
        print('<script src="/assets/index-stale.js"></script>')
    else:
        print('<script src="/assets/index-release.js"></script>')
elif program == 'docker':
    if args[0] == 'compose':
        cmd = args[9:]
        if cmd[0] == 'up' and os.environ.get('EXPECT_NO_AUTH_DIR') and list((root / 'state').glob('docker-auth.*')):
            sys.exit(77)
        if cmd[0] == 'pull' and api == os.environ['OLD_API']:
            if os.environ.get('FAIL_PREVIOUS_PULL'):
                sys.exit(1)
            (root / 'previous-image-pulled').touch()
        if cmd[0] == 'ps':
            if active.exists():
                current = json.loads(active.read_text())
                if cmd[1] == '-a':
                    print('existing')
                else:
                    print(current[cmd[-1]].split('@')[-1])
        elif cmd[0] == 'exec':
            if cmd[2] == 'web':
                print('<script src="/assets/index-release.js"></script>')
            else:
                print(os.environ.get('TABLE_COUNT', '0'))
        elif cmd[0] == 'run':
            if cmd[-1] == 'migrate':
                (root / 'migrated').touch()
            elif (api != os.environ['OLD_API'] and os.environ.get('MISMATCH')) or not (root / 'migrated').exists():
                sys.exit(3)
        elif cmd[0] == 'up' and cmd[-1] in ('api', 'web'):
            current = json.loads(active.read_text()) if active.exists() else {}
            current[cmd[-1]] = api if cmd[-1] == 'api' else web
            active.write_text(json.dumps(current))
        elif cmd[0] == 'rm':
            active.unlink(missing_ok=True)
    elif args[0] == 'image' and args[1] == 'inspect':
        digest = args[-1].split('@')[-1]
        if (args[-1] == os.environ['OLD_API'] and os.environ.get('OLD_IMAGE_MISSING')
                and not (root / 'previous-image-pulled').exists()):
            sys.exit(1)
        if args[3] != '{{.Id}}' and args[-1] != os.environ['OLD_API'] and os.environ.get('WRONG_REVISION'):
            print('f' * 40)
            sys.exit(0)
        print(digest if args[3] == '{{.Id}}' else digest.split(':')[1][:40])
    elif args[0] == 'inspect':
        print(args[-1])
    elif args[0] == 'login':
        sys.stdin.read()
'''


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('bash') and shutil.which('flock'),
                     'Tests the Linux deployment entry point with isolated command doubles.')
class DeployReleaseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / 'bin').mkdir()
        (self.root / 'state').mkdir()
        for name in ('compose.env', 'compose.yaml', 'compose.deploy.yaml', 'bin/check_release_schema.py'):
            (self.root / name).touch()
        (self.root / 'ecr-registry').write_text(REGISTRY + '\n')
        (self.root / 'https-origin').write_text('https://staging.example.test\n')
        for name in ('aws', 'docker', 'curl', 'sleep'):
            path = self.root / 'bin' / name
            path.write_text(f'#!{sys.executable}\n' + STUB)
            path.chmod(0o700)
        self.previous = release('a')
        self.candidate = release('b')

    def set_previous(self):
        (self.root / 'migrated').touch()
        (self.root / 'mock-running').write_text(json.dumps(dict(zip(('api', 'web'), self.previous[1:]))))
        (self.root / 'state/current').write_text('\n'.join(self.previous) + '\n')

    def run_release(self, candidate=None, **extra_env):
        env = os.environ | {
            'ARTI_RELEASE_ROOT': str(self.root),
            'PATH': f'{self.root / "bin"}{os.pathsep}{os.environ["PATH"]}',
            'OLD_API': self.previous[1],
        } | extra_env
        return subprocess.run(['bash', str(SCRIPT), *(candidate or self.candidate)], env=env,
                              capture_output=True, text=True, timeout=15)

    def read_state(self, name):
        return (self.root / 'state' / name).read_text().splitlines()

    def compose_calls(self):
        events = (self.root / 'calls.jsonl').read_text().splitlines()
        return [args[9:] for program, args, _, _ in map(json.loads, events)
                if program == 'docker' and args[0] == 'compose']

    def test_first_release_runs_migration_once_and_records_digests(self):
        result = self.run_release(EXPECT_NO_AUTH_DIR='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read_state('current'), self.candidate)
        self.assertEqual(sum(cmd[-1] == 'migrate' for cmd in self.compose_calls()), 1)
        self.assertTrue(any('--no-recreate' in cmd and cmd[-1] == 'db' for cmd in self.compose_calls()))
        self.assertEqual(list((self.root / 'state').glob('docker-auth.*')), [])

    def test_same_schema_release_preserves_previous_pair(self):
        self.set_previous()
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read_state('current'), self.candidate)
        self.assertEqual(self.read_state('previous'), self.previous)
        self.assertFalse(any(cmd[-1] == 'migrate' for cmd in self.compose_calls()))

    def test_failed_first_release_can_retry_without_reapplying_migrations(self):
        failed = self.run_release(FAIL_SMOKE='1')
        self.assertIn('database is retained', failed.stderr)
        self.assertNotEqual(failed.returncode, 0)
        self.assertFalse((self.root / 'state/current').exists())
        self.assertFalse((self.root / 'state/first-pending').exists())
        self.assertIn(['rm', '-fs', 'api', 'web'], self.compose_calls())

        retried = self.run_release()
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assertEqual(self.read_state('current'), self.candidate)
        self.assertEqual(sum(cmd[-1] == 'migrate' for cmd in self.compose_calls()), 1)

    def test_interrupted_first_release_resumes_with_local_digests_and_same_database(self):
        (self.root / 'migrated').touch()
        (self.root / 'state/first-pending').write_text('\n'.join(self.candidate) + '\n')
        (self.root / 'mock-running').write_text(json.dumps({'api': self.candidate[1]}))
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('recorded local images', result.stdout)
        self.assertEqual(self.read_state('current'), self.candidate)
        self.assertFalse((self.root / 'state/first-pending').exists())
        self.assertFalse(any(cmd[-1] == 'migrate' or cmd[0] == 'pull' for cmd in self.compose_calls()))
        calls = map(json.loads, (self.root / 'calls.jsonl').read_text().splitlines())
        self.assertNotIn('aws', [name for name, *_ in calls])

    def test_first_release_does_not_replace_unrecorded_or_different_images(self):
        (self.root / 'mock-running').write_text(json.dumps({'api': self.candidate[1]}))
        unmanaged = self.run_release()
        self.assertIn('require an active release record', unmanaged.stderr)
        (self.root / 'state/first-pending').write_text('\n'.join(self.candidate) + '\n')
        different = self.run_release(release('c'))
        self.assertNotEqual(different.returncode, 0)
        self.assertIn('requires the same commit and image digests', different.stderr)
        self.assertEqual(self.read_state('first-pending'), self.candidate)
        self.assertFalse(any(cmd[0] in ('up', 'rm', 'pull') for cmd in self.compose_calls()))

    def test_failed_certificate_blocks_pulls_and_preserves_running_release(self):
        self.set_previous()
        result = self.run_release(FAIL_TLS='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('listener or certificate failed before deployment', result.stderr)
        self.assertEqual(self.read_state('current'), self.previous)
        self.assertEqual(self.compose_calls(), [['config', '--quiet']])
        calls = map(json.loads, (self.root / 'calls.jsonl').read_text().splitlines())
        self.assertEqual([name for name, *_ in calls], ['docker', 'curl'])

    def test_failed_https_probe_restores_previous_and_reports_failure(self):
        self.set_previous()
        result = self.run_release(FAIL_SMOKE='1', FAIL_PREVIOUS_PULL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('is serving again', result.stderr)
        self.assertEqual(self.read_state('current'), self.previous)
        running = json.loads((self.root / 'mock-running').read_text())
        self.assertEqual(list(running.values()), self.previous[1:])
        self.assertEqual(self.compose_calls().count(['pull', 'api', 'web']), 1)

    def test_mismatched_image_revision_stops_before_database_start(self):
        result = self.run_release(WRONG_REVISION='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('downloaded images do not match', result.stderr)
        self.assertEqual(self.compose_calls(), [['config', '--quiet'], ['ps', '-a', '-q', 'api', 'web'], ['pull', 'api', 'web']])
        self.assertFalse((self.root / 'migrated').exists())

    def test_rollback_pulls_when_previous_digest_is_missing_locally(self):
        self.set_previous()
        result = self.run_release(FAIL_SMOKE='1', OLD_IMAGE_MISSING='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('is serving again', result.stderr)
        self.assertEqual(self.compose_calls().count(['pull', 'api', 'web']), 2)
        self.assertEqual(self.read_state('current'), self.previous)

    def test_rejects_html_fallback_for_a_missing_bundle(self):
        self.set_previous()
        result = self.run_release(FAIL_BUNDLE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('is serving again', result.stderr)
        self.assertEqual(self.read_state('current'), self.previous)

    def test_stale_https_index_halts_cutover_despite_successful_status(self):
        self.set_previous()
        result = self.run_release(STALE_INDEX='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('HTTPS page does not match the running web image', result.stderr)
        self.assertIn('is serving again', result.stderr)
        self.assertEqual(self.read_state('current'), self.previous)
        running = json.loads((self.root / 'mock-running').read_text())
        self.assertEqual(list(running.values()), self.previous[1:])

    def test_schema_or_nonempty_initial_database_blocks_cutover(self):
        for established in (False, True):
            with self.subTest(established=established):
                if established:
                    self.set_previous()
                result = self.run_release(MISMATCH='1', TABLE_COUNT='7')
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(cmd[-1] == 'migrate' or (cmd[0] == 'up' and cmd[-1] in ('api', 'web'))
                                     for cmd in self.compose_calls()))

    def test_rejects_a_nonexact_registry_ref_before_docker(self):
        invalid = self.candidate.copy()
        invalid[1] = invalid[1] + '@sha256:' + 'f' * 64
        result = self.run_release(invalid)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'calls.jsonl').exists())
