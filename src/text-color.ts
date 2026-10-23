// 文字の色。Markdown には色の記法がないので <span style="color: …">…</span> として保存する
// (多くの Markdown ビューアでもそのまま色が付く)。
//
// - 読み込み: 段落内の <span style="color: …"> と </span> の間を textColor ノードにまとめ、色のマークにする
// - 書き出し: 色のマークを <span style="color: …"> で囲む
// - 文字を選んだときのツールバーに色のボタンを足す

import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import type { MarkType } from '@milkdown/kit/prose/model';
import { $markSchema, $remark } from '@milkdown/kit/utils';
import type { Handle } from 'mdast-util-to-markdown';

// 明るいテーマでも暗いテーマでも読める中間の濃さにしている
export const TEXT_COLORS = [
  { name: '赤', value: '#e03e3e' },
  { name: 'オレンジ', value: '#d9730d' },
  { name: '黄', value: '#c29100' },
  { name: '緑', value: '#2e9e5b' },
  { name: '青', value: '#1f7fd6' },
  { name: '紫', value: '#9065b0' },
  { name: 'グレー', value: '#8a8a8a' },
] as const;

// HTML の書き出しにそのまま入るので、色として素直な値だけを受け付ける
const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
const OPEN_RE = /^<span\s+style\s*=\s*(["'])\s*color\s*:\s*([^;"']+?)\s*;?\s*\1\s*>$/i;
const CLOSE_RE = /^<\/span\s*>$/i;
const isColor = (value: string) => COLOR_RE.test(value);

type MdastNode = { type: string; value?: string; color?: string; children?: MdastNode[] };

// 同じ親の中で、<span style="color: …"> から対応する </span> までを 1 つのノードにまとめる
function groupSpans(children: MdastNode[]): MdastNode[] {
  const out: MdastNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const open = child.type === 'html' ? OPEN_RE.exec(child.value ?? '') : null;
    if (open && isColor(open[2])) {
      let depth = 0;
      let end = -1;
      for (let j = i + 1; j < children.length; j++) {
        const v = children[j].type === 'html' ? children[j].value ?? '' : '';
        if (/^<span[\s>]/i.test(v)) depth++;
        else if (CLOSE_RE.test(v) && depth-- === 0) {
          end = j;
          break;
        }
      }
      if (end > i) {
        out.push({ type: 'textColor', color: open[2], children: groupSpans(children.slice(i + 1, end)) });
        i = end;
        continue;
      }
    }
    out.push(child);
  }
  return out;
}

export const remarkTextColor = $remark('remarkTextColor', () => () => (tree: unknown) => {
  const walk = (node: MdastNode) => {
    if (!node.children) return;
    node.children = groupSpans(node.children);
    node.children.forEach(walk);
  };
  walk(tree as MdastNode);
});

export const textColorSchema = $markSchema('textColor', () => ({
  attrs: { color: { default: TEXT_COLORS[0].value } },
  inclusive: false,
  parseDOM: [
    {
      tag: 'span[data-text-color]',
      getAttrs: (dom) => {
        const color = (dom as HTMLElement).dataset.textColor ?? '';
        return isColor(color) ? { color } : false;
      },
    },
  ],
  toDOM: (mark) => ['span', { 'data-text-color': mark.attrs.color, style: `color: ${mark.attrs.color}` }],
  parseMarkdown: {
    match: (node) => node.type === 'textColor',
    runner: (state, node, markType) => {
      state.openMark(markType, { color: node.color });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'textColor',
    runner: (state, mark) => {
      state.withMark(mark, 'textColor', undefined, { color: mark.attrs.color });
    },
  },
}));

// remark-stringify で textColor ノードを書き出す
export const textColorHandler: Handle = (node, _parent, state, info) => {
  const color = (node as unknown as MdastNode).color ?? '';
  const open = `<span style="color: ${color}">`;
  const inner = state.containerPhrasing(node as never, { ...info, before: '>', after: '<' });
  return `${open}${inner}</span>`;
};

// 太字などの内側に色があると「と**<span …>」の形になり、直前の文字によっては太字と認識されなくなる。
// 中身が色の付いた文字だけなら、色を外側に出して <span …>**…**</span> と書く
export const colorOutside = (original: Handle): Handle => (node, parent, state, info) => {
  const children = (node as unknown as MdastNode).children ?? [];
  const only = children.length === 1 ? children[0] : null;
  if (only?.type !== 'textColor') return original(node, parent, state, info);
  const swapped = { ...only, children: [{ ...(node as unknown as MdastNode), children: only.children }] };
  return state.handle(swapped as never, parent, state, info);
};

// ---- 色を選ぶポップアップ ----

const markType = (ctx: Ctx): MarkType => textColorSchema.type(ctx);

export function setTextColor(ctx: Ctx, color: string | null) {
  const view = ctx.get(editorViewCtx);
  const { from, to, empty } = view.state.selection;
  if (empty) return;
  const type = markType(ctx);
  let tr = view.state.tr.removeMark(from, to, type);
  if (color) tr = tr.addMark(from, to, type.create({ color }));
  view.dispatch(tr);
  view.focus();
}

export function selectionColor(ctx: Ctx): string | null {
  const { state } = ctx.get(editorViewCtx);
  const { from, to } = state.selection;
  const type = markType(ctx);
  let color: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    const mark = type.isInSet(node.marks);
    if (mark) color ??= mark.attrs.color as string;
  });
  return color;
}

let popup: HTMLElement | null = null;

export function closeColorPopup() {
  popup?.remove();
  popup = null;
}

export function openColorPopup(ctx: Ctx) {
  closeColorPopup();
  const anchor = document.querySelector<HTMLElement>('.milkdown-toolbar');
  if (!anchor) return;
  const current = selectionColor(ctx);
  const el = document.createElement('div');
  el.className = 'text-color-popup';
  const choose = (color: string | null) => {
    closeColorPopup();
    setTextColor(ctx, color);
  };
  const button = (label: string, color: string | null) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    if (color) {
      b.className = `swatch${color === current ? ' current' : ''}`;
      b.style.setProperty('--swatch', color);
      b.textContent = 'A';
    } else {
      b.className = 'reset';
      b.textContent = '色なし';
    }
    // エディタの選択を保ったまま選べるよう、フォーカスを奪わない
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      choose(color);
    });
    return b;
  };
  for (const c of TEXT_COLORS) el.append(button(c.name, c.value));
  el.append(button('色を外す', null));
  document.body.append(el);
  // ツールバーの下は選んだ文字に重なるので、入るなら上に出す
  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const above = rect.top - el.offsetHeight - 4;
  el.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  el.style.top = `${above >= 4 ? above : rect.bottom + 4}px`;
  popup = el;
}

document.addEventListener('pointerdown', (e) => {
  if (popup && !popup.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.milkdown-toolbar')) closeColorPopup();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeColorPopup());
document.addEventListener('scroll', closeColorPopup, true);
window.addEventListener('blur', closeColorPopup);

// ツールバーの「A」と色の下線のアイコン
export const textColorIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M9.6 14h4.8l.9 2.5h2.1L13 4h-2L6.6 16.5h2.1L9.6 14zm2.4-6.9 1.8 5.1h-3.6l1.8-5.1z" fill="currentColor"/><rect x="5" y="18.5" width="14" height="2.5" rx="1" fill="#e03e3e"/></svg>`;
