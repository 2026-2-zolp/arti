# API 입력 검증과 공개·관리자 응답 변환을 정의합니다.
from rest_framework import serializers
from .constants import DURATION_COUNTS, EMOTIONS, TAGS


# 작품 쌍 선택 한 건의 입력을 검증합니다.
class PickInput(serializers.Serializer):
    pairIndex = serializers.IntegerField(min_value=0, max_value=4)
    artworkId = serializers.CharField(max_length=64)


# 취향 프로필의 출처·선택 이력·버전을 검증합니다.
class TasteProfileInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1, max_value=2)
    source = serializers.ChoiceField(choices=('picks', 'manual', 'saved'))
    poolVersion = serializers.CharField(max_length=64, allow_null=True, required=False, default=None)
    picks = PickInput(many=True, max_length=5, required=False, default=list)
    counts = serializers.DictField(child=serializers.IntegerField(min_value=0, max_value=5), required=False, default=dict)
    selectedTags = serializers.ListField(child=serializers.ChoiceField(choices=TAGS), max_length=8)
    savedProfileVersion = serializers.IntegerField(min_value=1, required=False)
    tieContextVersion = serializers.RegexField(r'\A[0-9a-f]{64}\Z', required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict) and ('tieEvidence' in data or 'tagOrder' in data):
            raise serializers.ValidationError({'tieEvidence': '서버가 계산하는 취향 근거는 제출할 수 없어요.'})
        value = super().to_internal_value(data)
        if value['version'] == 2:
            if type(data.get('version')) is not int:
                raise serializers.ValidationError({'version': '취향 프로필 버전을 확인해 주세요.'})
            if 'savedProfileVersion' in data and type(data['savedProfileVersion']) is not int:
                raise serializers.ValidationError({'savedProfileVersion': '저장된 취향 버전을 확인해 주세요.'})
            picks = data.get('picks', [])
            if isinstance(picks, list) and any(isinstance(p, dict) and type(p.get('pairIndex')) is not int for p in picks):
                raise serializers.ValidationError({'picks': '선택한 쌍 번호를 확인해 주세요.'})
        return value

    def validate(self, value):
        if any(k not in TAGS for k in value['counts']) or len(set(value['selectedTags'])) != len(value['selectedTags']):
            raise serializers.ValidationError('Invalid or duplicate taste tags.')
        if value['source'] == 'saved' and 'savedProfileVersion' not in value:
            raise serializers.ValidationError('savedProfileVersion is required.')
        if value['version'] == 2 and value['source'] == 'picks' and not value.get('tieContextVersion'):
            raise serializers.ValidationError('취향 조사 근거 버전이 필요해요.')
        return value


# 추천 요청의 전시·시간·취향을 검증합니다.
class RecommendInput(serializers.Serializer):
    exhibitionId = serializers.CharField(max_length=64)
    tastes = serializers.ListField(child=serializers.ChoiceField(choices=TAGS), max_length=8)
    duration = serializers.ChoiceField(choices=tuple(DURATION_COUNTS))
    tasteProfile = TasteProfileInput(required=False)

    def validate_tastes(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError('Duplicate tags are not allowed.')
        return value


# 관리자 로그인 입력을 검증합니다.
class AdminLoginInput(serializers.Serializer):
    id = serializers.CharField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


def exhibition_dto(ex):
    return {'id': ex.id, 'title': ex.title, 'subtitle': ex.subtitle, 'venue': ex.venue,
            'startDate': ex.start_date.isoformat(), 'endDate': ex.end_date.isoformat(), 'status': ex.status,
            'rooms': ex.rooms, 'entrance': {'x': ex.entrance_x, 'y': ex.entrance_y},
            'floorPlan': ex.floor_plan, 'version': ex.version}


def artwork_dto(w, admin=False):
    data = {
        'id': w.id, 'exhibitionId': w.exhibition_id, 'title': w.title, 'artist': w.artist,
        'year': w.year, 'roomId': w.room_id,
        'position': None if w.position_x is None else {'x': w.position_x, 'y': w.position_y},
        'palette': w.palette, 'imageUrl': w.image_url, 'imageFile': w.image_file, 'showImage': w.show_image,
        'tags': w.tags, 'tagScores': w.tag_scores, 'tagStatus': w.tag_status,
        'description': w.description, 'guidedLooking': w.guided_looking, 'guidedHints': w.guided_hints,
        'guideIntro': w.guide_intro, 'guideStatus': w.guide_status,
        'source': w.source, 'referenceUrl': w.reference_url, 'reviewStatus': w.review_status,
        'updatedAt': w.updated_at.isoformat(), 'analysis': w.analysis, 'emotionStatus': w.emotion_status,
        'summary': w.summary, 'summaryKeywords': w.summary_keywords, 'summaryStatus': w.summary_status,
        'version': w.version, 'sourceVersion': w.source_version, 'contentVersion': w.content_version,
        'summaryRevision': w.summary_revision, 'guideRevision': w.guide_revision,
    }
    if admin:
        return data
    if not w.show_image:
        data.update(imageUrl='', imageFile=None)
    if w.summary_status != 'confirmed':
        data.update(summary='', summaryKeywords=[], summaryStatus='none')
    if w.guide_status != 'confirmed':
        data.update(guideIntro='', guidedLooking=[], guidedHints=[], guideStatus='none')
    if w.tag_status != 'confirmed':
        data.update(tagScores=None, tagStatus='none')
    if w.emotion_status == 'confirmed' and isinstance(w.analysis, dict) and w.analysis.get('emotions'):
        # Suggested tags, image errors, and internal model input never enter the public DTO.
        data['analysis'] = {'emotions': {k: w.analysis['emotions'].get(k, 0) for k in EMOTIONS},
                            'models': w.analysis.get('models', {'image': '', 'text': ''}),
                            'usedImage': w.analysis.get('usedImage', False), 'imageError': None,
                            'analyzedAt': w.analysis.get('analyzedAt', '')}
    else:
        data.update(analysis=None, emotionStatus='none')
    return data
