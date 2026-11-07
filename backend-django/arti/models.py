import math
import secrets
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone
from .constants import AI_STATES, TAGS


def external_id():
    return secrets.token_hex(12)


def validate_point(x, y):
    if (x is None) != (y is None) or any(v is not None and (not math.isfinite(v) or not 0 <= v <= 100) for v in (x, y)):
        raise ValidationError('Coordinates must both be null or finite values from 0 to 100.')


class Exhibition(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=external_id)
    title = models.CharField(max_length=100)
    subtitle = models.CharField(max_length=200, blank=True)
    venue = models.CharField(max_length=100, blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=10, choices=[(v, v) for v in ('draft', 'running', 'closed')], default='draft')
    rooms = models.JSONField(default=list, blank=True)
    entrance_x = models.FloatField(default=0)
    entrance_y = models.FloatField(default=0)
    floor_plan = models.JSONField(null=True, default=None, blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.CheckConstraint(condition=Q(status__in=['draft', 'running', 'closed']), name='ex_status_valid'),
            models.CheckConstraint(condition=Q(end_date__gte=models.F('start_date')), name='ex_dates_ordered'),
            models.CheckConstraint(condition=Q(entrance_x__gte=0, entrance_x__lte=100, entrance_y__gte=0, entrance_y__lte=100), name='ex_entrance_bounds'),
            models.CheckConstraint(condition=Q(version__gte=1), name='ex_version_positive'),
        ]

    def clean(self):
        validate_point(self.entrance_x, self.entrance_y)
        if not isinstance(self.rooms, list) or len(self.rooms) > 50:
            raise ValidationError('rooms must be an array of at most 50 rooms.')
        ids = [room.get('id') for room in self.rooms if isinstance(room, dict)]
        if len(ids) != len(self.rooms) or len(set(ids)) != len(ids) or any(not isinstance(i, str) or not i for i in ids):
            raise ValidationError('Room IDs must be unique nonempty strings.')


class Artwork(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=external_id)
    exhibition = models.ForeignKey(Exhibition, on_delete=models.PROTECT, related_name='artworks')
    title = models.CharField(max_length=200)
    artist = models.CharField(max_length=100)
    year = models.CharField(max_length=50, blank=True)
    room_id = models.CharField(max_length=32, blank=True)
    position_x = models.FloatField(null=True, default=None, blank=True)
    position_y = models.FloatField(null=True, default=None, blank=True)
    palette = models.JSONField(default=list, blank=True)
    image_url = models.CharField(max_length=2000, blank=True)
    image_file = models.CharField(max_length=100, null=True, default=None, blank=True)
    show_image = models.BooleanField(default=True)
    tags = models.JSONField(default=list, blank=True)
    tag_scores = models.JSONField(null=True, default=None, blank=True)
    description = models.TextField(blank=True)
    guided_looking = models.JSONField(default=list, blank=True)
    guided_hints = models.JSONField(default=list, blank=True)
    guide_intro = models.TextField(blank=True)
    source = models.CharField(max_length=500, blank=True)
    reference_url = models.CharField(max_length=2000, blank=True)
    review_status = models.CharField(max_length=12, default='pending')
    analysis = models.JSONField(null=True, default=None, blank=True)
    summary = models.TextField(blank=True)
    summary_keywords = models.JSONField(default=list, blank=True)
    tag_status = models.CharField(max_length=10, default='none')
    emotion_status = models.CharField(max_length=10, default='none')
    summary_status = models.CharField(max_length=10, default='none')
    guide_status = models.CharField(max_length=10, default='none')
    version = models.PositiveIntegerField(default=1)
    source_version = models.PositiveIntegerField(default=1)
    content_version = models.PositiveIntegerField(default=1)
    summary_revision = models.PositiveIntegerField(default=1)
    guide_revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        indexes = [models.Index(fields=['exhibition', 'review_status'], name='art_ex_review_idx')]
        constraints = [
            models.CheckConstraint(condition=Q(review_status__in=['pending', 'source_check', 'approved']), name='art_review_valid'),
            models.CheckConstraint(condition=(Q(position_x__isnull=True, position_y__isnull=True) |
                Q(position_x__isnull=False, position_y__isnull=False, position_x__gte=0, position_x__lte=100, position_y__gte=0, position_y__lte=100)), name='art_position_bounds'),
            *[models.CheckConstraint(condition=Q(**{f'{field}__in': AI_STATES}), name=f'art_{field}_valid')
              for field in ('tag_status', 'emotion_status', 'summary_status', 'guide_status')],
            *[models.CheckConstraint(condition=Q(**{f'{field}__gte': 1}), name=f'art_{field}_positive')
              for field in ('version', 'source_version', 'content_version', 'summary_revision', 'guide_revision')],
        ]

    def clean(self):
        validate_point(self.position_x, self.position_y)
        if not isinstance(self.tags, list) or len(set(self.tags)) != len(self.tags) or any(t not in TAGS for t in self.tags):
            raise ValidationError('Invalid taste tags.')
        if self.room_id and self.exhibition_id and self.room_id not in {r['id'] for r in self.exhibition.rooms}:
            raise ValidationError('Room must belong to the artwork exhibition.')
        if len(self.guided_hints) != len(self.guided_looking):
            raise ValidationError('Guide questions and hints must have equal lengths.')
        for status, value in [(self.summary_status, self.summary), (self.guide_status, self.guide_intro or self.guided_looking)]:
            if status == 'confirmed' and not value:
                raise ValidationError('Confirmed content cannot be empty.')


class Account(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=external_id)
    login_id = models.CharField(max_length=254, unique=True)
    email = models.EmailField(blank=True)
    nickname = models.CharField(max_length=100, blank=True)
    role = models.CharField(max_length=5)
    password = models.CharField(max_length=128)
    status = models.CharField(max_length=8, default='active')
    tastes = models.JSONField(default=list, blank=True)
    taste_profile = models.JSONField(null=True, default=None, blank=True)
    taste_profile_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now)

    @property
    def is_authenticated(self):
        return self.status == 'active'

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(role__in=['user', 'admin']), name='account_role_valid'),
                       models.CheckConstraint(condition=Q(status__in=['active', 'dormant']), name='account_status_valid')]


class Session(models.Model):
    token_hash = models.CharField(primary_key=True, max_length=64)
    account = models.ForeignKey(Account, on_delete=models.CASCADE)
    expires_at = models.DateTimeField()


class Visit(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=external_id)
    user = models.ForeignKey(Account, on_delete=models.PROTECT)
    visit_id = models.UUIDField()
    exhibition = models.ForeignKey(Exhibition, on_delete=models.PROTECT)
    canonical_payload = models.JSONField(default=dict, blank=True)
    artwork_snapshots = models.JSONField(default=list, blank=True)
    interpretation = models.TextField(null=True, default=None)
    emotion_profile = models.JSONField(null=True, default=None, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'visit_id'], name='visit_actor_id_unique')]


class VisitReaction(models.Model):
    visit = models.ForeignKey(Visit, on_delete=models.CASCADE, related_name='reactions')
    artwork = models.ForeignKey(Artwork, on_delete=models.PROTECT)
    reaction = models.CharField(max_length=7)
    reason = models.CharField(max_length=500, blank=True)
    dwell_seconds = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['visit', 'artwork'], name='reaction_visit_art_unique'),
                       models.CheckConstraint(condition=Q(reaction__in=['like', 'dislike']), name='reaction_value_valid'),
                       models.CheckConstraint(condition=Q(dwell_seconds__lte=86400), name='reaction_dwell_bounds')]
