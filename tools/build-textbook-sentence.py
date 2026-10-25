"""Build source-faithful Sentence skills missions from the supplied local PDFs.

No OCR text is injected into the product. Interactive items below were transcribed
and checked against the page images and supplied answer key on 2026-10-24.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--manifest", type=Path, required=True, help="Local OCR manifest JSON; source paths are read only")
parser.add_argument("--pages", type=Path, required=True, help="Directory containing the existing 11-###.png and 00-###.png pages")
parser.add_argument("--output-dir", type=Path, default=ROOT / "dist", help="Website dist output directory")
parser.add_argument("--verify-only", action="store_true", help="Check existing assets and data without writing any files")
args = parser.parse_args()
DIST = args.output_dir.resolve()
manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
book = next(x for x in manifest if x["id"] == 11)
key = next(x for x in manifest if x["id"] == 0)
assert book["pages"] == 32 and key["pages"] == 11, "Unexpected source page counts"
target = DIST / "textbook/sentence"
for source, name in [(book, "book.pdf"), (key, "key.pdf")]:
    if Path(source["path"]).resolve() == (target / name).resolve():
        parser.error("Output PDF would overwrite its original source. Choose a separate --output-dir.")
if not args.verify_only:
    target.mkdir(parents=True, exist_ok=True)


def page_refs(pages, answer=False):
    stem, offset, count = ("key", 29, 11) if answer else ("page", 161, 32)
    name = "答案" if answer else "教材"
    return [{"src": f"textbook/sentence/{stem}-{p:03}.webp", "page": p,
             "label": f"{name}第 {p + offset} 页 · PDF {p}/{count}"} for p in pages]


def mission(mid, title, pages, answers, instructions, items=None, partial=False):
    lo, hi = min(pages) + 161, max(pages) + 161
    value = {"id": mid, "title": title, "bookPages": str(lo) if lo == hi else f"{lo}–{hi}",
             "sourcePages": page_refs(pages), "answerPages": page_refs(answers, True),
             "instructions": instructions}
    if items:
        value.update(items=items, itemsPartial=partial)
    return value


def item(mid, number, prompt, answer, explanation, options, source_page, key_page):
    return {"id": f"{mid}-{number}", "prompt": f"原题 {number}：{prompt}",
            "options": [{"value": v, "label": label} for v, label in options],
            "answer": answer, "explanation": explanation,
            "sourceLabel": f"教材第 {source_page + 161} 页 / PDF {source_page}；答案第 {key_page + 29} 页 / PDF {key_page}"}


clause_options = [("independent", "Indep. — 独立分句"), ("dependent", "Dep. — 从属分句")]
clauses = [
    (3, "Jet lag affects most long-distance travelers", "independent", "主语 Jet lag 与谓语 affects 构成完整独立分句；原题还要求在句末加句号。", 2),
    (4, "Which is simply the urge to sleep at inappropriate times", "dependent", "Which 引导关系从句，离开所修饰的内容不能独立成句。", 2),
    (5, "During long journeys through several time zones, the body’s inner clock is disrupted", "independent", "During 引导介词短语；后面的 the body’s inner clock is disrupted 是完整主句，句末补句号。", 2),
    (6, "For some reason, travel from west to east causes greater jet lag than travel from east to west", "independent", "For some reason 是介词短语；主语 travel 与谓语 causes 构成完整主句，句末补句号。", 2),
    (7, "Also, changes in work schedules can cause jet lag", "independent", "Also 是连接副词，后面有完整主谓结构，句末补句号。", 3),
    (8, "When hospital nurses change from a day shift to a night shift, for example", "dependent", "When 引导时间从句；本句没有与它搭配的独立分句。", 3),
    (9, "Although there is no sure way to prevent jet lag", "dependent", "Although 引导让步从句；还缺少主句。", 3),
    (10, "There are some ways to minimize it", "independent", "There are 构成完整存在句，句末补句号。", 3),
    (11, "Because jet lag is caused at least partially by loss of sleep, not just a change in the time of sleep", "dependent", "Because 引导原因从句；从句内部虽有主谓结构，整体仍不能独立成句。", 3),
    (12, "A traveler should plan to arrive at his or her destination as late as possible", "independent", "A traveler should plan 是完整主谓结构，句末补句号。", 3),
    (13, "Upon arriving, he or she should immediately go to bed", "independent", "Upon arriving 是状语短语；he or she should go 是完整主句，句末补句号。", 3),
    (14, "Then the traveler should start to live in the new time zone immediately", "independent", "Then 不使分句从属化；the traveler should start 构成完整主句，句末补句号。", 3),
    (15, "Even when the traveler arrives early in the morning and cannot go to bed immediately", "dependent", "Even when 引导时间从句；两个谓语仍同属从句，没有独立主句。", 3),
]
clause_items = [item("ch10-p1", n, text, answer, why, clause_options, p, 1)
                for n, text, answer, why, p in clauses]

but_yet = [
    ("1a", "Too much sun damages the skin, ______ many people still do not use sunscreen.", "yet", "明知有害却仍不防晒，教材用 yet 强调出乎预期的延续。"),
    ("1b", "Too much sun damages the skin, ______ too little sun also causes health problems.", "but", "对照日晒过多与过少两种情形，教材答案为 but。"),
    ("2a", "The company’s sales increased last year, ______ its profits declined.", "yet", "销售增加却利润下降，教材用 yet 强调与预期相反的结果。"),
    ("2b", "The company moved its marketing division to Phoenix, ______ the operations division stayed in Boston.", "but", "对照两个部门的位置，教材答案为 but。"),
    ("3a", "Population growth has slowed in most developing countries, ______ it has not slowed enough to avoid serious problems.", "but", "后半句限制、修正前半句的判断；按随书答案选 but。"),
    ("3b", "The fertility rate in India has decreased from 6 to 3 births per female, ______ India’s population is expanding at the rate of 18 million per year.", "yet", "教材用 yet 表达出生率下降而人口仍扩张的反预期关系；原文数字为旧教材材料。"),
]
but_items = [item("ch10-p3", n, text, answer,
                  why + " 本题按教材对 but/yet 的训练目标判分；自然语言中二者有语义重叠，不能据此断言另一词在所有语境下均不合语法。",
                  [("but", "but"), ("yet", "yet")], 6, 1)
             for n, text, answer, why in but_yet]

errors = [
    (2, "An encyclopedia is a valuable source of information it contains summaries of every area of knowledge.", "RO", "information 与 it 之间没有标点或连词，两个独立分句直接相连。", 28),
    (3, "Because of the rapid expansion of human knowledge, it is difficult to keep encyclopedias current.", "correct", "Because of 引导介词短语，后面仅一个完整主句，没有连写或逗号拼接。", 28),
    (4, "A printed encyclopedia becomes out of date almost as soon as it is published also it is quite expensive to purchase.", "RO", "published 与 also it is 之间缺少分句连接标记；also 本身不能代替分号或并列连词。", 28),
    (5, "Online encyclopedias are available to everyone with access to the Internet.", "correct", "只有一个完整独立分句，结构正确。", 28),
    (6, "Articles in encyclopedias are written by experts in each subject, who are often university professors.", "correct", "who 引导非限制性定语从句，逗号并没有直接拼接两个独立分句。", 29),
    (7, "An editor of an encyclopedia does not write articles he only collects and edits articles written by subject experts.", "RO", "articles 与 he only collects 之间缺少连接标记，属于 run-on。", 29),
    (8, "To find a book on a certain subject, you used to look in a card catalog, to find a magazine article on a subject, you used to look in a periodical index.", "CS", "两个 you used to look 主句只用逗号连接；句首两个不定式短语不改变主句的独立性。", 29),
    (9, "Now, most libraries have thrown away their card catalogs, they have computerized catalogs that are much more efficient to use and update.", "CS", "catalogs 与 they have 之间只有逗号，属于 comma splice。", 29),
    (10, "Many periodical indexes, which list only titles of magazine articles and indicate where to find them, have been replaced by computer indexes, some of which display abstracts and even entire articles instantly.", "correct", "两处 which 均引导关系从句；长句本身不等于 run-on，主句与从句连接正确。", 29),
    (11, "If you cannot find any information on a subject, you can always ask a librarian to help you, they are paid to assist students.", "CS", "开头 If 从句与主句连接正确，但 help you 与 they are 之间只用逗号拼接独立分句。", 29),
]
error_items = [item("ch11-p4-b", n, text, answer, why + " 还需在整组作答中改正错误句，对照答案页检查。",
                    [("RO", "RO — 连写句"), ("CS", "CS — 逗号拼接"), ("correct", "Correct — 原句正确")], p, 9)
               for n, text, answer, why, p in errors]

missions = [
    mission("ch10-p1", "Chapter 10 · Practice 1 · 独立与从属分句", [2, 3], [1],
            "原题 1、2 已给出示例，不计入待答题。先完成原题 3–15 的独立/从属判断，再在整组作答中抄写独立分句并补上句号。题目保留教材无句末标点的形式。", clause_items, True),
    mission("ch10-p2", "Chapter 10 · Practice 2 · 简单句造句", [3], [1],
            "按原页四种结构各写两个原创简单句（共八句）：一个主语/一个谓语、一个主语/两个谓语、两个主语/一个谓语、两个主语/两个谓语。答案册注明 Individual responses；按结构自评。"),
    mission("ch10-p3", "Chapter 10 · Practice 3 · But versus Yet", [6], [1],
            "完成原题 1a–3b 共六个空。答案采用随书答案册，but 与 yet 在自然语言中存在重叠；本关重点是教材规定的对照与反预期关系。", but_items),
    mission("ch10-p4", "Chapter 10 · Practice 4 · 并列连词连接分句", [6, 7], [1, 2],
            "完成 A、B、C 三部分。A：给 2–10 补完整独立分句，圈连词并加标点；B：组合 2–8 的句对并按原页要求使用 FANBOYS；C：自写七个并列句，每个连词用一次。A1、B1 为已解示例。开放补写和造句存在多种合理答案。"),
    mission("ch10-p5", "Chapter 10 · Practice 5 · 连接副词", [9, 7], [2],
            "完成 A、B、C：A2–8 补独立分句、圈连接副词并标点；B 按第 170 页要求改写 Practice 4B 第 3、5、6、8 题（附第 168 页原题）；C 用 in addition、nevertheless、on the other hand、therefore、for instance 各造一句。原页第 1 题为示例。"),
    mission("ch10-p6", "Chapter 10 · Practice 6 · 分号连接分句", [10], [2],
            "完成 A 的三个句子：在两个独立分句之间加分号。B 自写三个由分号连接的并列句。比较语义是否紧密相关，分号两侧是否均为独立分句。"),
    mission("ch10-p7", "Chapter 10 · Practice 7 · Robots 段落编辑", [10], [2, 3],
            "改写 Robots 短文，尽可能组合过短句，三种连接方法各尝试至少一次；按原文提示用 otherwise 组合句 13、14。答案为示例，不要求逐字一致。"),
    mission("ch10-p8", "Chapter 10 · Practice 8 · 复合句", [11, 12], [3, 4],
            "A2–11：区分独立/从属分句，并标出从属连接词；有一句含两个从句。可在作答中用 [主句]、[从句]、SUB 标记代替画线。B2–10：为从句补合逻辑的主句并正确标点。A1、B1 为示例。"),
    mission("ch10-p9", "Chapter 10 · Practice 9 · 复合并列句标点", [13], [4],
            "完成全部五个句子：先区分主句与从句，再补需要的逗号或分号。作答可用括号标明从句，随后给出完整的加标点版本；对照原答案页的画线与标点。"),
    mission("ch10-p10", "Chapter 10 · Practice 10 · 多种方式合并句子", [15, 16], [4, 5],
            "A：改写 Equal Rights for Women，将过多并列句改成复合句，after、although、because、when 各用一次。B：改写 Nonverbal Communication，运用多种合句方式。上方 Rosa Parks Revised Essay 是讲解示范，不是本关待答题；两篇改写均可有多种答案。"),
    mission("ch11-p1", "Chapter 11 · Practice 1 · 平行结构", [20, 21, 22], [6],
            "A2–11：标出平行成分和连接词；B2–8：找出不平行部分并改写；C：按原页七个连接词各写一句。A1、B1 为示例。C 位于教材第 183 页，虽答案标题只写 181–182，已纳入本关。答案 A11 的末尾措辞与教材不同，按本书原页作答并核对平行结构。"),
    mission("ch11-p2", "Chapter 11 · Practice 2 · 修复句子片段", [23, 24], [6, 7],
            "A：判断全部 15 句是 Frag. 还是 Comp.，并将每个片段补成完整句。B：在 Women Drivers 短文中标记片段并改正。按语法结构自评；短文中的性别概括和旧统计仅为教材练习材料。"),
    mission("ch11-p3", "Chapter 11 · Practice 3 · 合并零碎短句", [25, 26, 27], [8],
            "原题 1 是完整示例；完成 2–6。每题写出两句地位是否相等、主要思想、句间逻辑关系，再给出组合后的句子。部分题允许并列或从属等不同合句方案，按逻辑与语法对照示例自评。"),
    mission("ch11-p4", "Chapter 11 · Practice 4 · 连写句与逗号拼接", [28, 29], [8, 9, 10],
            "本关包括 A、B、C。A 按指定方法改写五组原句；B 的第 1 题已解，先在下面判断 2–11，再在整组作答中改正所有错误句；C 找出两段中的四处错误、标 RO/CS 并重写。逐题选择仅覆盖 B 的分类部分，完成整组后再对照自评。", error_items, True),
    mission("ch11-p5", "Chapter 11 · Practice 5 · 修复冗长串联句", [30], [10],
            "改写全部五句 stringy sentences，适当拆分、合并或从属化，保持原意与清楚的逻辑关系。原页上方是讲解示例，下方 Review 是复习说明；待答题为中间编号 1–5。"),
    mission("ch11-editing", "Chapter 11 · Editing Practice · 段落综合纠错", [32], [10, 11],
            "完成 The United States: Melting Pot or Salad Bowl?：标出平行结构及各类句子问题并改正，再重写两段。并非每句都有错。答案页先列问题句，再给示例改写；旧教材的社会描述与预测不作为现时事实。"),
]

# Practice 5 references page 168, but its own printed exercise page is 170.
missions[4]["bookPages"] = "170（另附 168 页回指题目）"
course = {
    "id": "sentence", "sourceTitle": "Sentence skills · Chapters 10–11",
    "sourcePdf": "textbook/sentence/book.pdf", "answerTitle": "Sentence skills answer key · Chapters 10–11",
    "answerPdf": "textbook/sentence/key.pdf", "sourcePageCount": 32, "answerPageCount": 11,
    "missions": missions,
    "exerciseCoverageNote": "覆盖所给 32 页教材中的全部作答组：Chapter 10 Practice 1–10；Chapter 11 Practice 1–5 及末页 Editing Practice，共 16 关。每关均保留整组原页，含原题中的造句、段落改写与 A/B/C 分部。29 道为核对原页和答案后转录的逐题选择；其余采用原页作答及答案对照自评。Review（177–178、191–192 页）是知识归纳及已解示例，没有另列待答题；所给章节没有额外 Writing Assignment、Writing Practice 或 Try It Out 作答区。",
    "coverageNote": "教材印刷页 162–193 对应 PDF 1–32；答案印刷页 30–40 对应 PDF 1–11。全部页图及原 PDF 均保留，可通过完整教材入口阅读规则、Review 和示例。扫描原页可能已有示例答案或手写批注；这些已解示例不计入本关逐题数量。选择题按随书答案判分，开放题答案仅为参考。个别答案的末尾用词与题干不完全一致，训练以教材原题为准。教材中的旧数字、科学陈述及社会概括未作为现时事实核验。",
}

if not args.verify_only:
    for source, name, prefix in [(book, "book.pdf", "page"), (key, "key.pdf", "key")]:
        shutil.copy2(source["path"], target / name)
        for p in range(1, source["pages"] + 1):
            src = args.pages / f"{source['id']:02}-{p:03}.png"
            with Image.open(src) as image:
                image = image.convert("RGB")
                width = 1300
                image = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
                image.save(target / f"{prefix}-{p:03}.webp", "WEBP", quality=91, method=6)

out = DIST / "data/textbook-sentence.json"
if not args.verify_only:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"courses": [course]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
else:
    assert json.loads(out.read_text(encoding="utf-8")) == {"courses": [course]}, "Published JSON differs from checked source definitions"

# Evidence checks: no omitted links, no repeated IDs, all published files local.
assert len(missions) == 16
assert sum(len(x.get("items", [])) for x in missions) == 29
assert len({x["id"] for x in missions}) == 16
items = [item for m in missions for item in m.get("items", [])]
assert len({x["id"] for x in items}) == len(items)
for q in items:
    assert q["answer"] in {x["value"] for x in q["options"]}
for m in missions:
    for p in m["sourcePages"] + m["answerPages"]:
        assert (DIST / p["src"]).is_file(), p["src"]
for source, filename in [(book, "book.pdf"), (key, "key.pdf")]:
    assert hashlib.sha256(Path(source["path"]).read_bytes()).digest() == hashlib.sha256((target / filename).read_bytes()).digest()
assert len(list(target.glob("page-*.webp"))) == 32
assert len(list(target.glob("key-*.webp"))) == 11
for page in target.glob("*.webp"):
    with Image.open(page) as rendered:
        assert rendered.width == 1300
        rendered.verify()
assert {m["id"]: m.get("itemsPartial") for m in missions if m.get("items")} == {
    "ch10-p1": True, "ch10-p3": False, "ch11-p4": True,
}
print(json.dumps({"missions": 16, "interactiveItems": 29, "bookPages": 32, "answerPages": 11,
                  "assetBytes": sum(p.stat().st_size for p in target.iterdir()), "output": str(out)}, ensure_ascii=False))
