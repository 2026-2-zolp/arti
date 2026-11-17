"""Check ARTI auth routes and privacy headers without contacting SMTP or Kakao."""
import argparse
import http.client
import json
import ssl
from urllib.parse import urlsplit


def check(connection, path, status, *, private=False, html=False):
    connection.request('GET', path)
    response = connection.getresponse()
    body = response.read(64 * 1024)
    if response.status != status:
        raise ValueError(f'{path}: expected HTTP {status}, got {response.status}')
    if html and (not response.getheader('Content-Type', '').startswith('text/html') or not body):
        raise ValueError(f'{path}: expected the HTML application')
    if private and ('no-store' not in response.getheader('Cache-Control', '').lower()
                    or response.getheader('Referrer-Policy', '').lower() != 'no-referrer'):
        raise ValueError(f'{path}: expected no-store and no-referrer')
    return response, body


def run(origin, feature, enabled, local_ca):
    url = urlsplit(origin)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path not in ('', '/') or url.query or url.fragment or url.port == 0):
        raise ValueError('Provide a browser HTTPS origin without a path or credentials')
    if local_ca and url.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Custom test certificates are accepted for loopback only')
    context = ssl.create_default_context(cafile=local_ca)
    connection = http.client.HTTPSConnection(url.hostname, url.port, context=context, timeout=10)
    try:
        check(connection, '/api/ready', 200)
        status_route = '/api/auth/' + ('password-reset' if feature == 'mail' else 'kakao') + '/status'
        _, payload = check(connection, status_route, 200, private=True)
        if json.loads(payload).get('enabled') is not enabled:
            raise ValueError(f'{status_route}: feature state did not match')
        if feature == 'mail':
            check(connection, '/password/reset', 200, private=True, html=True)
        else:
            check(connection, '/auth/kakao/complete', 200, html=True)
            # Without a state or a code, the callback cannot exchange credentials.
            response, _ = check(connection, '/api/auth/kakao/callback', 302 if enabled else 404, private=True)
            if enabled and response.getheader('Location') != '/auth/kakao/complete':
                raise ValueError('Empty Kakao callback should return to the same-origin completion screen')
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin')
    parser.add_argument('feature', choices=('mail', 'kakao'))
    parser.add_argument('--expect-disabled', action='store_true')
    parser.add_argument('--local-ca', help='Trusted PEM for a loopback-only HTTPS rehearsal')
    args = parser.parse_args()
    try:
        run(args.origin, args.feature, not args.expect_disabled, args.local_ca)
    except (OSError, ValueError, AttributeError, http.client.HTTPException) as exc:
        parser.exit(1, f'Account HTTPS check failed: {exc}\n')
    print(f'{args.feature}: HTTPS, routes, privacy headers and feature state passed')


if __name__ == '__main__':
    main()
