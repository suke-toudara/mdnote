// ソース (生 Markdown) 編集用 textarea の入力補助。

const INDENT = '  ';
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

// execCommand を使うと textarea の元に戻す (Ctrl+Z) 履歴が保たれる
export function replaceRange(ta: HTMLTextAreaElement, start: number, end: number, text: string, select?: [number, number]) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // 空文字の insertText はキャレット位置がずれるので、削除は delete で行う
  const ok = text ? document.execCommand('insertText', false, text) : start === end || document.execCommand('delete');
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input'));
  }
  if (select) ta.setSelectionRange(select[0], select[1]);
}

function lineStart(value: string, pos: number) {
  return value.lastIndexOf('\n', pos - 1) + 1;
}

function lineEnd(value: string, pos: number) {
  const i = value.indexOf('\n', pos);
  return i === -1 ? value.length : i;
}

function indentLines(ta: HTMLTextAreaElement, outdent: boolean) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  if (!outdent && s === e) {
    replaceRange(ta, s, e, INDENT);
    return;
  }
  const from = lineStart(value, s);
  const to = lineEnd(value, e > s && value[e - 1] === '\n' ? e - 1 : e);
  const lines = value.slice(from, to).split('\n');
  const changed = lines.map((l) => (outdent ? l.replace(/^ {1,2}|^\t/, '') : INDENT + l));
  const text = changed.join('\n');
  const firstDelta = changed[0].length - lines[0].length;
  replaceRange(ta, from, to, text, [Math.max(from, s + firstDelta), from + text.length]);
}

// リストの行で Enter を押したら次の行頭に記号を続ける。空の項目ならリストを終える。
function continueList(ta: HTMLTextAreaElement): boolean {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e) return false;
  const from = lineStart(value, s);
  const line = value.slice(from, s);
  const m = LIST_RE.exec(line);
  if (!m) return false;

  if (line.length === m[0].length && lineEnd(value, s) === s) {
    replaceRange(ta, from, s, '');
    return true;
  }
  const [, indent, marker, space, check] = m;
  const num = /^(\d+)([.)])$/.exec(marker);
  const nextMarker = num ? `${Number(num[1]) + 1}${num[2]}` : marker;
  replaceRange(ta, s, s, `\n${indent}${nextMarker}${space}${check ? '[ ] ' : ''}`);
  return true;
}

// カーソル位置がコードブロック (``` や ~~~ で囲まれた範囲) の中か
function inCodeFence(value: string, pos: number) {
  let fence: string | null = null;
  for (const line of value.slice(0, lineStart(value, pos)).split('\n')) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    if (!fence) fence = m[1];
    else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
  }
  return fence !== null;
}

// 段落の中の改行を、行末に半角スペース 2 つを付けた改行 (Markdown の改行) にする。
// 空の行で Enter を押したときは段落の区切りとし、直前の行末のスペースを取り除く。
// 見出し・表・コードブロック・区切り線の行では何もしない。
function hardBreak(ta: HTMLTextAreaElement): boolean {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e || inCodeFence(value, s)) return false;
  const from = lineStart(value, s);
  const line = value.slice(from, lineEnd(value, s));
  if (/^\s{0,3}(#{1,6}\s|\||`{3,}|~{3,}|([-*_])\s*(\2\s*){2,}$)/.test(line)) return false;
  const quote = /^(\s*>\s?)+/.exec(line)?.[0] ?? '';
  const before = value.slice(from, s);

  if (!before.slice(quote.length).trim()) {
    // 空の行: 直前の行末の改行用スペースを取り除いて、普通の改行にする
    const prevEnd = from - 1;
    if (prevEnd > 0 && / {2,}$/.test(value.slice(lineStart(value, prevEnd), prevEnd)) && !line.slice(quote.length).trim()) {
      const trimmed = value.slice(0, prevEnd).replace(/ +$/, '');
      replaceRange(ta, trimmed.length, s, `\n${quote}\n${quote}`);
      return true;
    }
    return false;
  }
  // カーソルの前の空白は 2 つのスペースに揃える
  const spaces = /[ \t]*$/.exec(before)![0].length;
  replaceRange(ta, s - spaces, s, `  \n${quote}`);
  return true;
}

function wrapSelection(ta: HTMLTextAreaElement, before: string, after = before) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const selected = value.slice(s, e);
  if (value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
    replaceRange(ta, s - before.length, e + after.length, selected, [s - before.length, e - before.length]);
    return;
  }
  replaceRange(ta, s, e, before + selected + after, [s + before.length, e + before.length]);
}

function insertLink(ta: HTMLTextAreaElement) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const label = value.slice(s, e) || 'リンク';
  const text = `[${label}](url)`;
  const urlStart = s + label.length + 3;
  replaceRange(ta, s, e, text, [urlStart, urlStart + 3]);
}

export interface SourceEditorOptions {
  // Enter を段落内の改行 (行末に半角スペース 2 つ) にするか
  hardBreakOnEnter: () => boolean;
}

export function setupSourceEditor(ta: HTMLTextAreaElement, options: SourceEditorOptions) {
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      indentLines(ta, e.shiftKey);
    } else if (e.key === 'Enter' && !mod && !e.shiftKey) {
      if (continueList(ta) || (options.hardBreakOnEnter() && hardBreak(ta))) e.preventDefault();
    } else if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') wrapSelection(ta, '**');
      else if (key === 'i') wrapSelection(ta, '*');
      else if (key === 'k') insertLink(ta);
      else if (key === 'e') wrapSelection(ta, '`');
      else return;
      e.preventDefault();
    }
  });
}

// ---- textarea 内の位置計測と、検索結果の背景ハイライト ----

const MIRRORED_PROPS = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'tabSize',
  'whiteSpace',
  'wordWrap',
  'overflowWrap',
] as const;

function copyStyle(from: HTMLElement, to: HTMLElement) {
  const cs = getComputedStyle(from);
  for (const p of MIRRORED_PROPS) to.style[p] = cs[p];
  to.style.whiteSpace = 'pre-wrap';
  to.style.overflowWrap = 'break-word';
}

// 文字位置 (昇順) それぞれの textarea 内での y 座標 (スクロール 0 基準)
export function offsetTopsOf(ta: HTMLTextAreaElement, positions: number[]): number[] {
  const mirror = document.createElement('div');
  copyStyle(ta, mirror);
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.width = `${ta.clientWidth}px`;
  const markers: HTMLSpanElement[] = [];
  let last = 0;
  for (const pos of positions) {
    mirror.append(ta.value.slice(last, pos));
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.append(marker);
    markers.push(marker);
    last = pos;
  }
  document.body.appendChild(mirror);
  const tops = markers.map((m) => m.offsetTop);
  mirror.remove();
  return tops;
}

export function scrollToPos(ta: HTMLTextAreaElement, pos: number) {
  const [top] = offsetTopsOf(ta, [pos]);
  ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
}

// textarea の背後に同じ文字組みの層を敷き、検索一致箇所に <mark> を描く
export class SourceHighlighter {
  private ta: HTMLTextAreaElement;
  private backdrop: HTMLDivElement;

  constructor(ta: HTMLTextAreaElement) {
    this.ta = ta;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'source-backdrop';
    this.backdrop.setAttribute('aria-hidden', 'true');
    ta.parentElement!.insertBefore(this.backdrop, ta);
    ta.addEventListener('scroll', () => this.syncScroll());
    new ResizeObserver(() => this.syncStyle()).observe(ta);
  }

  private syncStyle() {
    copyStyle(this.ta, this.backdrop);
    this.backdrop.style.width = `${this.ta.clientWidth}px`;
    this.backdrop.style.height = `${this.ta.clientHeight}px`;
  }

  private syncScroll() {
    this.backdrop.scrollTop = this.ta.scrollTop;
  }

  render(ranges: [number, number][], current: number) {
    this.backdrop.replaceChildren();
    if (!ranges.length) return;
    this.syncStyle();
    const value = this.ta.value;
    let last = 0;
    ranges.forEach(([s, e], i) => {
      this.backdrop.append(value.slice(last, s));
      const mark = document.createElement('mark');
      if (i === current) mark.className = 'current';
      mark.textContent = value.slice(s, e);
      this.backdrop.append(mark);
      last = e;
    });
    // 末尾改行の高さを揃えるため 1 文字足す
    this.backdrop.append(value.slice(last) + ' ');
    this.syncScroll();
  }
}
