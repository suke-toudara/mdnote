// フォルダ内検索: 開いているフォルダの Markdown ファイルをまとめて検索し、結果をファイルごとに並べる

import type { Vault } from './vault';

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  useRegex: boolean;
}

export interface FolderSearchHandlers {
  // path を開き、そのファイルの中で index 番目の一致へ移動する
  open(path: string, query: SearchQuery, index: number): void;
}

// 一度に出す件数の上限 (多すぎると一覧が重くなる)
const MAX_MATCHES = 2000;
const SNIPPET = 80;

export class FolderSearch {
  private input: HTMLInputElement;
  private caseBtn: HTMLButtonElement;
  private regexBtn: HTMLButtonElement;
  private status: HTMLElement;
  private results: HTMLElement;
  private vault: Vault;
  private handlers: FolderSearchHandlers;
  private caseSensitive = false;
  private useRegex = false;
  // 新しい検索を始めたら、前の検索の結果は捨てる
  private generation = 0;
  private timer: number | undefined;

  constructor(root: HTMLElement, vault: Vault, handlers: FolderSearchHandlers) {
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.input = q('.folder-search-input');
    this.caseBtn = q('.folder-search-case');
    this.regexBtn = q('.folder-search-regex');
    this.status = q('.folder-search-status');
    this.results = q('.folder-search-results');
    this.vault = vault;
    this.handlers = handlers;

    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        void this.run();
      }
    });
    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle('active', this.caseSensitive);
      void this.run();
    });
    this.regexBtn.addEventListener('click', () => {
      this.useRegex = !this.useRegex;
      this.regexBtn.classList.toggle('active', this.useRegex);
      void this.run();
    });
  }

  focus(initial?: string) {
    if (initial && !initial.includes('\n')) {
      this.input.value = initial;
      void this.run();
    }
    this.input.focus();
    this.input.select();
  }

  // フォルダを開き直したときなどに、いまの条件で検索し直す
  refresh() {
    if (this.input.value) this.schedule();
    else this.clear();
  }

  private clear() {
    this.generation++;
    this.status.textContent = this.vault.root ? '' : 'フォルダを開くと、その中のファイルをまとめて検索できます';
    this.results.replaceChildren();
  }

  private schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), 250);
  }

  private regex(): RegExp | null {
    const text = this.input.value;
    if (!text) return null;
    try {
      this.input.classList.remove('invalid');
      return new RegExp(this.useRegex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), `g${this.caseSensitive ? '' : 'i'}u`);
    } catch {
      this.input.classList.add('invalid');
      return null;
    }
  }

  async run() {
    window.clearTimeout(this.timer);
    const re = this.regex();
    if (!re || !this.vault.root) {
      this.clear();
      if (this.input.value && this.vault.root) this.status.textContent = '正規表現が正しくありません';
      return;
    }
    const generation = ++this.generation;
    const query: SearchQuery = { text: this.input.value, caseSensitive: this.caseSensitive, useRegex: this.useRegex };
    this.status.textContent = '検索しています…';
    this.results.replaceChildren();
    let files: string[];
    try {
      files = await this.vault.list();
    } catch {
      this.status.textContent = 'ファイルの一覧を読み込めませんでした';
      return;
    }
    let total = 0;
    let fileCount = 0;
    for (const path of files) {
      if (generation !== this.generation) return;
      if (total >= MAX_MATCHES) break;
      let text: string;
      try {
        text = await this.vault.read(path);
      } catch {
        continue;
      }
      if (generation !== this.generation) return;
      const matches = [...text.matchAll(re)].filter((m) => m[0].length > 0);
      if (!matches.length) continue;
      fileCount++;
      total += matches.length;
      this.results.append(this.renderFile(path, text, matches.slice(0, MAX_MATCHES), query));
    }
    this.status.textContent = total
      ? `${fileCount} ファイル · ${total} 件${total >= MAX_MATCHES ? ' (多いため途中まで)' : ''}`
      : '見つかりませんでした';
  }

  private renderFile(path: string, text: string, matches: RegExpMatchArray[], query: SearchQuery) {
    const li = document.createElement('li');
    li.className = 'search-file';
    const head = document.createElement('button');
    head.className = 'search-file-head';
    head.title = path;
    const name = document.createElement('span');
    name.className = 'search-file-name';
    name.textContent = this.vault.relative(path);
    const count = document.createElement('span');
    count.className = 'search-count';
    count.textContent = String(matches.length);
    head.append(name, count);
    const hits = document.createElement('ul');
    head.addEventListener('click', () => {
      hits.hidden = !hits.hidden;
      li.classList.toggle('collapsed', hits.hidden);
    });
    matches.forEach((m, index) => {
      const start = m.index!;
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = text.indexOf('\n', start);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const col = start - lineStart;
      const lineNo = text.slice(0, start).split('\n').length;
      // 一致した部分が見えるよう、長い行は前後を省く
      const from = Math.max(0, col - 24);
      const before = (from > 0 ? '…' : '') + line.slice(from, col);
      const hitText = line.slice(col, col + m[0].length);
      const after = line.slice(col + m[0].length, col + m[0].length + SNIPPET);
      const hit = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'search-hit';
      button.title = `${lineNo} 行目`;
      const mark = document.createElement('mark');
      mark.textContent = hitText;
      button.append(before, mark, after);
      button.addEventListener('click', () => this.handlers.open(path, query, index));
      hit.append(button);
      hits.append(hit);
    });
    li.append(head, hits);
    return li;
  }
}
