// 被リンク: 開いているフォルダの中で、いまの文書へリンクしている文書を一覧にする

import { markdownLinks } from './links';
import { type Vault, dirOf, nameOf, resolvePath } from './vault';

export interface BacklinkHandlers {
  // path を開き、そのファイルの中で text の index 番目の出現へ移動する
  open(path: string, text: string, index: number): void;
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href);

export class BacklinksPanel {
  private title: HTMLElement;
  private list: HTMLElement;
  private vault: Vault;
  private handlers: BacklinkHandlers;
  private generation = 0;
  private timer: number | undefined;

  constructor(root: HTMLElement, vault: Vault, handlers: BacklinkHandlers) {
    this.title = root.querySelector('.backlinks-title')!;
    this.list = root.querySelector('.backlinks-list')!;
    this.vault = vault;
    this.handlers = handlers;
  }

  // 文書の切り替えや保存のたびに呼ぶ (続けて呼ばれたらまとめる)
  refresh(target: string | null) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(target), 200);
  }

  private message(text: string) {
    const li = document.createElement('li');
    li.className = 'outline-empty';
    li.textContent = text;
    this.list.replaceChildren(li);
  }

  private async run(target: string | null) {
    const generation = ++this.generation;
    if (!this.vault.root) {
      this.title.textContent = '被リンク';
      this.message('フォルダを開くと、この文書へリンクしている文書を表示します');
      return;
    }
    if (!target) {
      this.title.textContent = '被リンク';
      this.message('文書を保存すると表示します');
      return;
    }
    this.title.textContent = `「${nameOf(target)}」へのリンク`;
    let files: string[];
    try {
      files = await this.vault.list();
    } catch {
      this.message('ファイルの一覧を読み込めませんでした');
      return;
    }
    const groups: HTMLElement[] = [];
    for (const path of files) {
      if (path === target) continue;
      let text: string;
      try {
        text = await this.vault.read(path);
      } catch {
        continue;
      }
      if (generation !== this.generation) return;
      const links = markdownLinks(text).filter((l) => !isExternal(l.href) && resolvePath(dirOf(path), l.href.replace(/^file:\/\//i, '')) === target);
      if (links.length) groups.push(this.renderFile(path, text, links));
    }
    if (generation !== this.generation) return;
    if (groups.length) this.list.replaceChildren(...groups);
    else this.message('この文書へのリンクはありません');
  }

  private renderFile(path: string, text: string, links: { label: string; index: number }[]) {
    const li = document.createElement('li');
    li.className = 'search-file';
    const head = document.createElement('div');
    head.className = 'search-file-head';
    head.title = path;
    const name = document.createElement('span');
    name.className = 'search-file-name';
    name.textContent = this.vault.relative(path);
    head.append(name);
    const hits = document.createElement('ul');
    for (const link of links) {
      const lineStart = text.lastIndexOf('\n', link.index - 1) + 1;
      const lineEnd = text.indexOf('\n', link.index);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
      // 移動先は、プレビューにも見えるリンクの文字で探す。同じ文字が前に何回出てくるかを数えておく
      const search = link.label || nameOf(path);
      const index = text.slice(0, link.index).split(search).length - 1;
      const hit = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'search-hit';
      button.textContent = line.length > 120 ? `${line.slice(0, 120)}…` : line;
      button.addEventListener('click', () => this.handlers.open(path, search, index));
      hit.append(button);
      hits.append(hit);
    }
    li.append(head, hits);
    return li;
  }
}
