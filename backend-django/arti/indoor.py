from itertools import permutations
from math import hypot, inf, isfinite

from .http import ContractError

RECT_FIELDS = ('walkable', 'walls', 'pillars', 'doors', 'corridors')
SEAM_TOLERANCE = 1e-9


def invalid():
    raise ContractError(400, 'VALIDATION_ERROR', '이동 구역과 좌표가 도면 범위 안에 있는지 확인해 주세요.')


def normalize_layout(value, revision):
    if value is None:
        return None
    geometry = {*RECT_FIELDS, 'waypoints'}
    if (not isinstance(value, dict) or not geometry <= value.keys() <= (geometry | {'example'})
            or type(value.get('example', False)) is not bool):
        invalid()
    for field in (*RECT_FIELDS, 'waypoints'):
        points = value[field]
        if not isinstance(points, list) or len(points) > 32:
            invalid()
        for point in points:
            axes = {'x', 'y'} if field == 'waypoints' else {'x', 'y', 'w', 'h'}
            if (not isinstance(point, dict) or set(point) != axes or
                    any(type(v) not in (int, float) or not 0 <= v <= 100 for v in point.values())):
                invalid()
            if field != 'waypoints' and (
                    point['w'] <= 0 or point['h'] <= 0 or
                    point['x'] + point['w'] > 100 or point['y'] + point['h'] > 100):
                invalid()
    if not value['walkable']:
        invalid()
    return {**value, 'floorPlanRevision': revision}


def current_layout(exhibition):
    layout = exhibition.navigation_layout
    if not layout or layout.get('floorPlanRevision') != exhibition.floor_plan_revision:
        return None
    image = exhibition.floor_plan
    return {**layout, 'aspect': image['width'] / image['height'] if image else 1}


def inside_interval(origin, target, rect):
    low, high = 0, 1
    for axis, span, a, b in zip(('x', 'y'), ('w', 'h'), origin, target):
        start, end = rect[axis], rect[axis] + rect[span]
        delta = b - a
        if not delta:
            if not start <= a <= end:
                return None
            continue
        first, last = sorted(((start - a) / delta, (end - a) / delta))
        low, high = max(low, first), min(high, last)
        if low > high:
            return None
    return low, high


def shares_passage(first, second):
    width = min(first['x'] + first['w'], second['x'] + second['w']) - max(first['x'], second['x'])
    height = min(first['y'] + first['h'], second['y'] + second['h']) - max(first['y'], second['y'])
    return min(width, height) >= -SEAM_TOLERANCE and max(width, height) > SEAM_TOLERANCE


def connected_spans(spans, start_index=0):
    reached = [start_index]
    remaining = set(range(len(spans))) - {start_index}
    for index in reached:
        start, end, rect = spans[index]
        neighbors = [other for other in remaining
                     if spans[other][0] <= end + SEAM_TOLERANCE
                     and start <= spans[other][1] + SEAM_TOLERANCE
                     and shares_passage(rect, spans[other][2])]
        reached.extend(neighbors)
        remaining.difference_update(neighbors)
    return [spans[index] for index in reached]


def can_walk(origin, target, walkable, barriers):
    if any(inside_interval(origin, target, rect) is not None for rect in barriers):
        return False
    spans = [(*interval, rect) for rect in walkable if (interval := inside_interval(origin, target, rect)) is not None]
    starts = [span for span in spans if span[0] == 0]
    ends = [span for span in spans if span[1] == 1]
    if not starts or not ends:
        return False
    # 모서리에 놓인 연결점도 폭이 없는 접촉을 통로로 바꿀 수 없습니다.
    if len(starts) > 1 and len(connected_spans(starts)) != len(starts):
        return False
    if len(ends) > 1 and len(connected_spans(ends)) != len(ends):
        return False
    if any(end == 1 for _, end, _ in starts):
        return True
    return any(end == 1 for _, end, _ in connected_spans(spans, spans.index(starts[0])))


def distances_from(graph, start, stop_count):
    distances = [inf] * len(graph)
    distances[start] = 0
    remaining = set(range(len(graph)))
    while remaining:
        current = min(remaining, key=distances.__getitem__)
        if not isfinite(distances[current]):
            break
        remaining.remove(current)
        # 지도도 명시적으로 등록된 연결점만 경유합니다.
        if current != start and current < stop_count:
            continue
        for other, length in graph[current]:
            distances[other] = min(distances[other], distances[current] + length)
    return distances


def walking_order(exhibition, works):
    """선택된 최대 7점의 순서만 비교하고 입구에서 시작하는 열린 경로를 구합니다."""
    layout = current_layout(exhibition)
    if not layout or len(works) < 2 or len(works) > 7:
        return None
    stops = [(exhibition.entrance_x, exhibition.entrance_y), *((w.position_x, w.position_y) for w in works)]
    points = stops + [(point['x'], point['y']) for point in layout['waypoints']]
    walkable = layout['walkable'] + layout['doors'] + layout['corridors']
    barriers = layout['walls'] + layout['pillars']
    graph = [[] for _ in points]
    for index, point in enumerate(points):
        for other in range(index):
            peer = points[other]
            if can_walk(point, peer, walkable, barriers):
                length = hypot(point[0] - peer[0], (point[1] - peer[1]) / layout['aspect'])
                graph[index].append((other, length))
                graph[other].append((index, length))
    matrix = [distances_from(graph, index, len(stops)) for index in range(len(stops))]
    if any(not isfinite(distance) for row in matrix for distance in row[:len(stops)]):
        return None

    def cost(order):
        return sum(matrix[first][second] for first, second in zip((0, *order), order))

    return [index - 1 for index in min(permutations(range(1, len(stops))), key=cost)]
