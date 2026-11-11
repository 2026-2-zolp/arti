# 기존 라벨 도구와 원본 이미지로 비공개 핵심 3점 검수 묶음을 생성합니다.
import hashlib
import json
import re
from zipfile import ZIP_DEFLATED, ZipFile

from yoo_labels import MANIFEST, ROOT, core3_manifest


def main():
    manifest = core3_manifest(json.loads(MANIFEST.read_text(encoding='utf-8')))
    html = MANIFEST.with_name('labeling.html').read_text(encoding='utf-8')
    html, replacements = re.subn(
        r'^const manifest=.*;$',
        lambda _: 'const manifest=' + json.dumps(manifest, ensure_ascii=False) + ';',
        html,
        flags=re.MULTILINE,
    )
    if replacements != 1:
        raise ValueError('expected one embedded manifest')

    private = ROOT / 'data/private'
    files = {'labeling.html': html.encode('utf-8')}
    guide = ROOT / 'docs/review/yoo-core3-2026-11-11/reviewer.md'
    files['reviewer.md'] = guide.read_bytes()
    for index, row in enumerate(manifest['items'], start=1):
        original_number = int(row['id'].rsplit('-', 1)[-1])
        image = (private / 'yoo-intake-20261109' / f'{original_number:02}.png').read_bytes()
        if hashlib.sha256(image).hexdigest() != row['sha256']:
            raise ValueError(f'image hash differs from intake for {row["id"]}')
        files[f'images/image-{index}.png'] = image

    archive = private / 'independent-review-20261111/core3-blind.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as bundle:
        for name, data in files.items():
            bundle.writestr(name, data)
    print(archive)


if __name__ == '__main__':
    main()
