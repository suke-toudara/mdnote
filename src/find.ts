// 検索・置換バー。ソース (textarea) とプレビュー編集 (ProseMirror) の両方に対応する。

import type { EditorView } from '@milkdown/kit/prose/view';
import { TextSelection } from '@milkdown/kit/prose/state';
import { SourceHighlighter, replaceRange, scrollToPos } from './source-editor';

interface Match {
  from: number;
  to: number;
  text: string;
}

export interface SearchTarget {
  find(re: RegExp): Match[];
  reveal(m: Match): void;
  highlight(matches: Match[], current: number): void;
  replace(matches: Match[], replacements: string[]): void;
}

export class SourceTarget implements SearchTarget {
  private ta: HTMLTextAreaElement;
  private highlighter: SourceHighlighter;

  constructor(ta: HTMLTextAreaElement) {
    this.ta = ta;
    this.highlighter = new SourceHighlighter(ta);
  }

  find(re: RegExp) {
    return [...this.ta.value.matchAll(re)]
      .filter((m) => m[0].length > 0)
      .map((m) => ({ from: m.index!, to: m.index! + m[0].length, text: m[0] }));
  }

  reveal(m: Match) {
    this.ta.setSelectionRange(m.from, m.to);
    scrollToPos(this.ta, m.from);
  }

  highlight(matches: Match[], current: number) {
    this.highlighter.render(
      matches.map((m) => [m.from, m.to]),
      current,
    );
  }

  replace(matches: Match[], replacements: string[]) {
    if (!matches.length) return;
    // 一回の入力として置換し、Ctrl+Z でまとめて戻せるようにする
    const first = matches[0].from;
    const last = matches[matches.length - 1].to;
    let text = '';
    let pos = first;
    matches.forEach((m, i) => {
      text += this.ta.value.slice(pos, m.from) + replacements[i];
      pos = m.to;
    });
    const scroll = this.ta.scrollTop;
    replaceRange(this.ta, first, last, text);
    this.ta.scrollTop = scroll;
  }
}

type HighlightRegistry = Map<string, unknown> & { delete(name: string): boolean };
const highlights = (globalThis.CSS as unknown as { highlights?: HighlightRegistry }).highlights;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

export class EditorTarget implements SearchTarget {
  private getView: () => EditorView;

  constructor(getView: () => EditorView) {
    this.getView = getView;
  }

  // テキストブロックごとに文字列を組み立てて検索する (太字などの書式をまたいでも一致する)
  find(re: RegExp) {
    const { doc } = this.getView().state;
    const matches: Match[] = [];
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      let text = '';
      const positions: number[] = [];
      node.forEach((child, offset) => {
        const start = pos + 1 + offset;
        if (child.isText) {
          for (let i = 0; i < child.text!.length; i++) positions.push(start + i);
          text += child.text;
        } else {
          positions.push(start);
          text += '￼';
        }
      });
      for (const m of text.matchAll(re)) {
        if (!m[0].length) continue;
        const s = m.index!;
        const e = s + m[0].length;
        matches.push({ from: positions[s], to: positions[e - 1] + 1, text: m[0] });
      }
      return false;
    });
    return matches;
  }

  reveal(m: Match) {
    const view = this.getView();
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to));
    view.dispatch(tr.scrollIntoView());
  }

  private range(view: EditorView, m: Match) {
    try {
      const start = view.domAtPos(m.from);
      const end = view.domAtPos(m.to);
      const r = document.createRange();
      r.setStart(start.node, start.offset);
      r.setEnd(end.node, end.offset);
      return r;
    } catch {
      return null;
    }
  }

  highlight(matches: Match[], current: number) {
    if (!highlights || !HighlightCtor) return;
    highlights.delete('find-all');
    highlights.delete('find-current');
    if (!matches.length) return;
    const view = this.getView();
    const ranges = matches.map((m) => this.range(view, m));
    highlights.set('find-all', new HighlightCtor(...(ranges.filter(Boolean) as Range[])));
    const cur = ranges[current];
    if (cur) highlights.set('find-current', new HighlightCtor(cur));
  }

  replace(matches: Match[], replacements: string[]) {
    const view = this.getView();
    const { tr } = view.state;
    // 後ろから置換すると前方の位置がずれない
    for (let i = matches.length - 1; i >= 0; i--) {
      const { from, to } = matches[i];
      if (replacements[i]) tr.insertText(replacements[i], from, to);
      else tr.delete(from, to);
    }
    view.dispatch(tr);
  }
}

export class FindBar {
  private bar: HTMLElement;
  private query: HTMLInputElement;
  private replacement: HTMLInputElement;
  private caseBtn: HTMLButtonElement;
  private regexBtn: HTMLButtonElement;
  private count: HTMLElement;
  private matches: Match[] = [];
  private current = -1;
  private caseSensitive = false;
  private useRegex = false;
  private getTarget: () => SearchTarget;

  constructor(root: HTMLElement, getTarget: () => SearchTarget) {
    this.bar = root;
    this.getTarget = getTarget;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.query = q('.find-query');
    this.replacement = q('.find-replace');
    this.caseBtn = q('.find-case');
    this.regexBtn = q('.find-regex');
    this.count = q('.find-count');

    this.query.addEventListener('input', () => this.search(true));
    this.query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      }
    });
    this.replacement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) this.replaceAll();
        else this.replaceCurrent();
      }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.caseBtn.addEventListener('click', () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseBtn.classList.toggle('active', this.caseSensitive);
      this.search(true);
    });
    this.regexBtn.addEventListener('click', () => {
      this.useRegex = !this.useRegex;
      this.regexBtn.classList.toggle('active', this.useRegex);
      this.search(true);
    });
    q('.find-prev').addEventListener('click', () => this.step(-1));
    q('.find-next').addEventListener('click', () => this.step(1));
    q('.find-replace-one').addEventListener('click', () => this.replaceCurrent());
    q('.find-replace-all').addEventListener('click', () => this.replaceAll());
    q('.find-close').addEventListener('click', () => this.close());
  }

  get isOpen() {
    return !this.bar.hidden;
  }

  open(withReplace: boolean, initial?: string) {
    this.bar.hidden = false;
    this.bar.classList.toggle('with-replace', withReplace);
    if (initial && !initial.includes('\n')) this.query.value = initial;
    this.query.focus();
    this.query.select();
    this.search(true);
  }

  close() {
    this.getTarget().highlight([], -1);
    this.matches = [];
    this.bar.hidden = true;
  }

  private regex(): RegExp | null {
    const source = this.query.value;
    if (!source) return null;
    const flags = this.caseSensitive ? 'g' : 'gi';
    try {
      this.query.classList.remove('invalid');
      return new RegExp(this.useRegex ? source : source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags + 'u');
    } catch {
      this.query.classList.add('invalid');
      return null;
    }
  }

  // 文書が変わったときにも呼ぶ。reveal=false なら選択を動かさずハイライトだけ更新する
  search(reveal = false) {
    if (!this.isOpen) return;
    const target = this.getTarget();
    const re = this.regex();
    const prev = this.matches[this.current];
    this.matches = re ? target.find(re) : [];
    if (!this.matches.length) this.current = -1;
    else if (prev) this.current = Math.max(0, this.matches.findIndex((m) => m.from >= prev.from));
    else this.current = 0;
    if (this.current >= this.matches.length) this.current = 0;
    this.update(reveal);
  }

  private update(reveal: boolean) {
    const target = this.getTarget();
    const n = this.matches.length;
    this.count.textContent = this.query.value ? (n ? `${this.current + 1} / ${n}` : '0 件') : '';
    if (reveal && n) target.reveal(this.matches[this.current]);
    target.highlight(this.matches, this.current);
  }

  private step(dir: number) {
    const n = this.matches.length;
    if (!n) return;
    this.current = (this.current + dir + n) % n;
    this.update(true);
  }

  private replacementFor(m: Match) {
    const repl = this.replacement.value;
    if (!this.useRegex) return repl;
    const re = this.regex();
    if (!re) return repl;
    return m.text.replace(new RegExp(re.source, re.flags.replace('g', '')), repl);
  }

  private replaceCurrent() {
    const m = this.matches[this.current];
    if (!m) return;
    this.getTarget().replace([m], [this.replacementFor(m)]);
    this.search(true);
    this.replacement.focus();
  }

  private replaceAll() {
    if (!this.matches.length) return;
    this.getTarget().replace(
      this.matches,
      this.matches.map((m) => this.replacementFor(m)),
    );
    this.search();
    this.replacement.focus();
  }
}
