"""mkbook の本文に、日本語のガイド用レイアウトを適用する。"""
import html
import json
from pathlib import Path
import re
import shutil
import sys

root = Path(__file__).resolve().parent.parent
site = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'site'
sources = [root / 'docs-src/README.md', *sorted((root / 'docs-src').glob('[0-9]*.md'))]
pages = []
for source in sources:
    title = json.loads(re.search(r'^title = (".*")$', source.read_text(), re.M)[1])
    filename = 'index.html' if source.name == 'README.md' else source.stem + '.html'
    pages.append((filename, title))

for index, (filename, title) in enumerate(pages):
    path = site / filename
    original = path.read_text()
    content = re.search(r'<article>(.*?)</article>', original, re.S)[1]
    content = content.split('<div class="next-chapter">')[0].split('<footer>')[0].strip()
    content = re.sub(r'<h1 class="title">.*?</h1>', '', content, count=1, flags=re.S)
    # mkbook の見出しリンクの href と id を一致させる。
    content = re.sub(r'(<a href="#([^"]+)"[^>]*\bid=")[^"]+("[^>]*>)', r'\1\2\3', content)
    toc = ''.join(f'<li><a href="{name}"' + (' aria-current="page"' if name == filename else '') + f'>{html.escape(label)}</a></li>' for name, label in pages)
    navigation = f'<ul class="chapters">{toc}</ul>'
    cards = ''
    if index == 0:
        cards = '<section class="guide-index" aria-label="ガイドの目次">' + ''.join(f'<a class="chapter-card" href="{name}"><span class="chapter-number">{i:02}</span><span>{html.escape(label)}</span><span aria-hidden="true">→</span></a>' for i, (name, label) in enumerate(pages[1:], 1)) + '</section>'
    adjacent = []
    for offset, label in [(-1, '前のページ'), (1, '次のページ')]:
        n = index + offset
        if 0 <= n < len(pages):
            name, text = pages[n]
            adjacent.append(f'<a href="{name}"><small>{label}</small><span>{html.escape(text)}</span></a>')
    path.write_text(f'''<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} | mdnote</title><link rel="stylesheet" href="style.css">
<meta name="description" content="mdnote の使い方。起動から編集・保存・書き出しまで。"></head>
<body>
<a class="skip-link" href="#main">本文へ移動</a>
<header class="topbar"><a class="brand" href="index.html">mdnote <span>使い方ガイド</span></a><a class="repo-link" href="https://github.com/suke-toudara/mdnote">GitHub ↗</a></header>
<div class="layout"><aside class="sidebar"><nav aria-label="ガイドの目次"><p class="nav-label">使い方</p>{navigation}</nav></aside>
<details class="mobile-menu"><summary>目次を開く</summary><nav aria-label="ガイドの目次">{navigation}</nav></details>
<main id="main" tabindex="-1"><div class="eyebrow">MDNOTE / USER GUIDE</div><h1>{html.escape(title)}</h1><article>{content}</article>{cards}
<nav class="page-nav" aria-label="前後のページ">{''.join(adjacent)}</nav>
<footer>mdnote · 使い方ガイド</footer></main></div></body></html>
''')
shutil.copyfile(root / 'docs-src/docs-theme.css', site / 'style.css')
