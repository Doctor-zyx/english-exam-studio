"""Rebuild or verify source-faithful Sentence skills assets and assembled text.

Original files are read-only. Text comes from reviewed tools/content fragments.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', type=Path, required=True)
parser.add_argument('--pages', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist')
parser.add_argument('--verify-only', action='store_true')
args = parser.parse_args()
dist = args.output_dir.resolve()
target = dist / 'textbook/sentence'
manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
book = next(x for x in manifest if x['id'] == 11)
key = next(x for x in manifest if x['id'] == 0)
assert book['pages'] == 32 and key['pages'] == 11
spec = importlib.util.spec_from_file_location('assemble', ROOT / 'tools/assemble-textbooks.py')
assembler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembler)
data = assembler.assemble()['data/textbook-sentence.json']
for source, filename, prefix in [(book, 'book.pdf', 'page'), (key, 'key.pdf', 'key')]:
    src = Path(source['path']).resolve()
    assert src != (target / filename).resolve(), 'Output would overwrite original source'
    if not args.verify_only:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target / filename)
        for n in range(1, source['pages'] + 1):
            with Image.open(args.pages / f"{source['id']:02}-{n:03}.png") as image:
                image = image.convert('RGB')
                image = image.resize((1300, round(image.height * 1300 / image.width)), Image.Resampling.LANCZOS)
                image.save(target / f'{prefix}-{n:03}.webp', 'WEBP', quality=91, method=6)
    assert hashlib.sha256(src.read_bytes()).digest() == hashlib.sha256((target / filename).read_bytes()).digest()
    assert len(list(target.glob(f'{prefix}-*.webp'))) == source['pages']
    for page in target.glob(f'{prefix}-*.webp'):
        with Image.open(page) as image:
            assert image.width == 1300
            image.verify()
out = dist / 'data/textbook-sentence.json'
if args.verify_only:
    assert json.loads(out.read_text(encoding='utf-8-sig')) == data, 'Text differs from reviewed fragments'
else:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
course = data['courses'][0]
assert len(course['missions']) == 16
for mission in course['missions']:
    assert mission['textComplete'] and not mission['itemsPartial']
    for page in mission['sourcePages'] + mission['answerPages']:
        assert (dist / page['src']).is_file()
print(json.dumps({'missions': 16, 'interactiveItems': sum(len(m['items']) for m in course['missions']), 'bookPages': 32, 'answerPages': 11, 'verified': True}))
