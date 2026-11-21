from base64 import b64decode

from django.test import TestCase, override_settings

from arti.models import Artwork, Exhibition

from .test_integration import Helpers


@override_settings(ARTI_ENV='test', ALLOW_TEST_FIXTURES=True)
class ExhibitionPosterTests(Helpers, TestCase):
    def test_poster_upload_publication_and_removal_leave_the_map_unchanged(self):
        self.setup_clients()
        exhibition = Exhibition.objects.get(pk='fixture-ex01')
        work = Artwork.objects.get(pk='fixture-art03')
        coords = (work.position_x, work.position_y)
        public_url = f'/api/exhibitions/{exhibition.id}'
        admin_url = f'/api/admin/exhibitions/{exhibition.id}'
        poster_url = admin_url + '/poster'
        png = b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==')
        self.assertIsNone(self.public.get(public_url).json()['posterFile'])
        self.assertIn(self.a.post(poster_url, png, content_type='image/png').status_code, (401, 403))

        invalid = self.admin.post(poster_url, b'invalid', content_type='image/png', HTTP_IF_MATCH=f'"{exhibition.version}"')
        self.assertEqual(invalid.status_code, 415)
        saved = self.admin.post(poster_url, png, content_type='image/png', HTTP_IF_MATCH=f'"{exhibition.version}"')
        self.assertEqual(saved.status_code, 200, saved.content)
        body = saved.json()
        filename = body['posterFile']
        self.assertEqual(self.public.get(public_url).json()['posterFile'], filename)
        media_url = f'/api/uploads/{filename}'
        media = self.public.get(media_url)
        self.assertEqual(media.status_code, 200)
        self.assertEqual(media.headers['Cache-Control'], 'no-store')
        self.assertEqual(b''.join(media.streaming_content), png)

        stale = self.admin.delete(poster_url, HTTP_IF_MATCH=f'"{exhibition.version}"')
        self.assertEqual(stale.status_code, 409)
        draft = self.admin.put(admin_url, {**body, 'status': 'draft'}, format='json')
        self.assertEqual(draft.status_code, 200, draft.content)
        self.assertEqual(self.public.get(public_url).status_code, 404)
        self.assertEqual(self.public.get(media_url).status_code, 404)
        private_media = self.admin.get(f'/api/admin/uploads/{filename}')
        self.assertEqual(private_media.status_code, 200)
        self.assertEqual(b''.join(private_media.streaming_content), png)

        removed = self.admin.delete(poster_url, HTTP_IF_MATCH=f'"{draft.json()["version"]}"')
        self.assertEqual(removed.status_code, 200, removed.content)
        self.assertIsNone(removed.json()['posterFile'])
        self.assertEqual(self.public.get(media_url).status_code, 404)
        self.assertEqual(removed.json()['floorPlanRevision'], exhibition.floor_plan_revision)
        work.refresh_from_db()
        self.assertEqual((work.position_x, work.position_y), coords)
