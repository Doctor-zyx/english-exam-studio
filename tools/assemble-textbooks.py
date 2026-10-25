"""Assemble reviewed textbook transcription fragments without touching source PDFs.

The explicit sources.json manifest prevents accidental duplicate/unfinished inputs.
--verify-only compares the deployment artifact with the reviewed content.
"""
from pathlib import Path
import argparse
import copy
import json

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'tools/content'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def is_auto(q):
    return q.get('autoGrade') is not False and bool(q.get('options') or q.get('autoGrade') or q.get('answerMode') == 'exact')


def apply_course(base, patch):
    indexed = {m['id']: m for m in patch['missions']}
    assert set(indexed) == {m['id'] for m in base['missions']}, f"Incomplete mission set: {base['id']}"
    assert len(indexed) == len(patch['missions']), 'Duplicate mission patch'
    for m in base['missions']:
        m.update(copy.deepcopy(indexed[m['id']]))
        m['contentVersion'] = 2
        assert m.get('items'), f"Empty transcription: {m['id']}"
        for q in m['items']:
            assert all(q.get(k) for k in ['id', 'prompt', 'sourceNumber', 'sourceLabel']), q.get('id')
            if q.get('blocked'):
                assert q.get('missingReason'), q['id']
            else:
                assert q.get('answer') is not None and q.get('explanation'), q['id']
            if q.get('options'):
                choices = {str(o['value']) for o in q['options']}
                answers = q['answer'] if isinstance(q['answer'], list) else [q['answer']]
                assert all(str(a) in choices for a in answers), q['id']
    ids = [q['id'] for m in base['missions'] for q in m.get('items', [])]
    assert len(ids) == len(set(ids)), f"Duplicate item IDs: {base['id']}"
    base['contentVersion'] = 2
    missing = [m for m in base['missions'] if m.get('missingTasks') or any(q.get('blocked') for q in m.get('items', []))]
    n = sum(not q.get('blocked') for m in base['missions'] for q in m['items'])
    blocked = len(ids) - n
    base['coverageNote'] = (
        f"教材与配套答案逐题核对，{len(base['missions'])}组练习整理为{n}个可作答项，原书已填写的编号题也恢复为待答。"
        + (f'另有{blocked}项缺少原材料，单独列明等待补充。' if blocked else '')
        +
        '同一原题的分类、改写等步骤可能分开呈现，作答项数不等于原书独立题号数或考试题量。'
        '客观题自动核对；改写、造句及作文允许不同表达，按参考和具体标准自评。'
        + (f'其中{len(missing)}组引用的附录或材料未提供，具体缺项在练习中列明，不计作已补齐。' if missing else '当前所列练习所需题面已转为文字。')
        + '个别教材与答案的差异在对应讲解中说明。旧教材中的事实和数字仅用于原文练习。'
    )
    base['exerciseCoverageNote'] = base['coverageNote']
    return base


def assemble():
    sources = read(CONTENT / 'sources.json')
    sentence = read(CONTENT / 'sentence-meta.json')
    sp = {'missions': [m for name in sources['sentence'] for m in read(CONTENT / name)['missions']]}
    apply_course(sentence['courses'][0], sp)
    core = read(CONTENT / 'core-meta.json')
    writing = read(ROOT / 'dist/data/writing.json')
    next(l for l in writing['lessons'] if l['id'] == 'sentence')['rules'] = read(CONTENT / sources['lessons'])['rules']
    patched = set()
    for name in sources['core']:
        for patch in read(CONTENT / name)['courses']:
            cid = patch['id']
            assert cid not in patched, f'Duplicate content source: {cid}'
            patched.add(cid)
            base = next(c for c in core['courses'] if c['id'] == cid)
            apply_course(base, patch)
            if patch.get('rules'):
                lesson = next(l for l in writing['lessons'] if l['id'] == cid)
                assert len(lesson['rules']) == len(patch['rules']), f'Rule index migration required: {cid}'
                lesson['rules'] = copy.deepcopy(patch['rules'])
    assert patched == {c['id'] for c in core['courses']}, 'All seven core chapters must have reviewed transcription sources'
    return {'data/textbook-sentence.json': sentence, 'data/textbook-core.json': core, 'data/writing.json': writing}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    outputs = assemble()
    for name, value in outputs.items():
        dest = ROOT / 'dist' / name
        if args.verify_only:
            assert read(dest) == value, f'Assembled content differs: {name}'
        else:
            dest.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    courses = outputs['data/textbook-sentence.json']['courses'] + outputs['data/textbook-core.json']['courses']
    print(json.dumps({'courses': len(courses), 'transcribedCourses': sum(c.get('contentVersion') == 2 for c in courses), 'items': sum(len(m.get('items', [])) for c in courses for m in c['missions']), 'automatic': sum(is_auto(q) for c in courses for m in c['missions'] for q in m.get('items', []))}))
