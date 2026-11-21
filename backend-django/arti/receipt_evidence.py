# 관람 화면에서 확인한 공개 작품의 영수증용 정보만 서명합니다.
from datetime import timedelta

from django.core import signing

from .taste_evidence import MAX_AGE

SALT = 'arti.receipt-artwork.v1'
MAX_BYTES = 4096
RECEIPT_PROTECTION_PERIOD = timedelta(seconds=MAX_AGE)


def issue_artwork_evidence(actor, visit_id, exhibition, artwork):
    return signing.dumps({
        'actor': actor.id,
        'visitId': visit_id,
        'exhibition': exhibition,
        'artwork': {key: artwork[key] for key in ('id', 'title', 'artist', 'year', 'tags')},
    }, salt=SALT, compress=True)


def read_artwork_evidence(token, actor, visit_id, exhibition_id, artwork_id):
    if not isinstance(token, str) or not token.isascii() or not 0 < len(token) <= MAX_BYTES:
        return None
    try:
        value = signing.loads(token, salt=SALT, max_age=MAX_AGE)
    except signing.BadSignature:
        return None
    if (value['actor'], value['visitId'], value['exhibition']['id'], value['artwork']['id']) != (
        actor.id, visit_id, exhibition_id, artwork_id
    ):
        return None
    return value
