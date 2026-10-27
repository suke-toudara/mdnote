// 画像 (段落に画像だけがあるもの) の表示幅を、右下の角のドラッグで変える。
//
// 幅は Obsidian と同じく代替テキストの末尾に「|幅」として書く: ![説明|320](images/a.png)
// Crepe の画像ブロックは代替テキストの欄に高さの比率 (「1.00」など) を書き込み、元の代替テキストを
// 消してしまうので、代替テキストを保つように読み書きを置き換え、高さ方向のつまみは隠している。

import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const WITH_WIDTH = /^([\s\S]*)\|(\d+)$/;
// Crepe が比率を書き込んだもの (代替テキストではない)
const LEGACY_RATIO = /^\d+\.\d{2}$/;
const MIN_WIDTH = 48;

export const imageBlockWithWidth = imageBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: {
      ...base.attrs,
      alt: { default: '' },
      width: { default: null },
    },
    parseMarkdown: {
      match: ({ type }) => type === 'image-block',
      runner: (state, node, type) => {
        const raw = String(node.alt ?? '');
        const sized = WITH_WIDTH.exec(raw);
        state.addNode(type, {
          src: node.url as string,
          caption: (node.title as string | null) ?? '',
          ratio: 1,
          alt: sized ? sized[1] : LEGACY_RATIO.test(raw) ? '' : raw,
          width: sized ? Number(sized[2]) : null,
        });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'image-block',
      runner: (state, node) => {
        const { alt, width, caption, src } = node.attrs;
        state.openNode('paragraph');
        state.addNode('image', undefined, undefined, { title: caption, url: src, alt: width ? `${alt}|${width}` : alt });
        state.closeNode();
      },
    },
  };
});

const imageOf = (dom: globalThis.Node | null) => (dom instanceof HTMLElement ? dom.querySelector<HTMLImageElement>('img[data-type="image-block"]') : null);

function applyWidth(img: HTMLImageElement, width: number | null) {
  if (width) {
    img.style.setProperty('width', `${width}px`, 'important');
    img.style.setProperty('height', 'auto', 'important');
  } else {
    img.style.removeProperty('width');
    // 高さは Crepe が読み込み時に決めるので、自分で付けた指定だけ外す
    if (img.style.getPropertyPriority('height') === 'important') img.style.removeProperty('height');
  }
}

function applyAll(view: EditorView) {
  view.state.doc.descendants((node: Node, pos: number) => {
    if (node.type.name !== 'image-block') return true;
    const img = imageOf(view.nodeDOM(pos));
    if (img) applyWidth(img, node.attrs.width as number | null);
    return false;
  });
}

function blockPos(view: EditorView, block: HTMLElement) {
  let found: number | null = null;
  view.state.doc.descendants((node: Node, pos: number) => {
    if (found !== null) return false;
    if (node.type.name === 'image-block' && view.nodeDOM(pos) === block) found = pos;
    return node.isBlock;
  });
  return found;
}

export const imageWidthHandle = $prose(
  () =>
    new Plugin({
      view(view) {
        const handle = document.createElement('div');
        handle.className = 'image-width-handle';
        handle.title = 'ドラッグで幅を変える (ダブルクリックで元の大きさ)';
        handle.hidden = true;
        document.body.append(handle);
        let target: HTMLImageElement | null = null;
        let dragging = false;

        const place = () => {
          if (!target || !target.isConnected || !view.editable) {
            handle.hidden = true;
            return;
          }
          const r = target.getBoundingClientRect();
          handle.style.left = `${r.right - 7}px`;
          handle.style.top = `${r.bottom - 7}px`;
          handle.hidden = false;
        };
        const onMove = (e: MouseEvent) => {
          if (dragging || e.target === handle) return;
          const img = (e.target as HTMLElement).closest?.('.milkdown-image-block')?.querySelector<HTMLImageElement>('img[data-type="image-block"]') ?? null;
          target = img;
          place();
        };
        const commit = (width: number | null) => {
          const block = target?.closest<HTMLElement>('.milkdown-image-block');
          const pos = block ? blockPos(view, block) : null;
          if (pos === null) return;
          view.dispatch(view.state.tr.setNodeAttribute(pos, 'width', width));
        };
        handle.addEventListener('pointerdown', (e) => {
          if (!target) return;
          e.preventDefault();
          e.stopPropagation();
          dragging = true;
          handle.setPointerCapture(e.pointerId);
          const img = target;
          const startX = e.clientX;
          const startWidth = img.getBoundingClientRect().width;
          const box = img.closest('.milkdown-image-block')?.getBoundingClientRect();
          const maxWidth = box?.width ?? Infinity;
          // 中央に置かれた画像は左右に同じだけ広がるので、角がマウスに付いてくるよう 2 倍にする
          const rect = img.getBoundingClientRect();
          const centered = !!box && Math.abs(rect.left + rect.right - box.left - box.right) < 4;
          let width = startWidth;
          const move = (ev: PointerEvent) => {
            const delta = (ev.clientX - startX) * (centered ? 2 : 1);
            width = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta)));
            applyWidth(img, width);
            place();
          };
          const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            dragging = false;
            if (Math.abs(width - startWidth) >= 1) commit(width);
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
          handle.addEventListener('pointercancel', up);
        });
        handle.addEventListener('dblclick', () => commit(null));
        view.dom.addEventListener('mousemove', onMove);
        view.dom.addEventListener('mouseleave', (e) => {
          if (!dragging && e.relatedTarget !== handle) handle.hidden = true;
        });
        // 画像の読み込みで Crepe が高さを付け直すので、そのたびに幅を当て直す
        const onLoad = (e: Event) => {
          if (e.target instanceof HTMLImageElement) applyAll(view);
        };
        view.dom.addEventListener('load', onLoad, true);
        const onScroll = () => !dragging && place();
        document.addEventListener('scroll', onScroll, true);
        applyAll(view);
        return {
          update: () => {
            applyAll(view);
            if (!dragging) place();
          },
          destroy: () => {
            handle.remove();
            view.dom.removeEventListener('mousemove', onMove);
            view.dom.removeEventListener('load', onLoad, true);
            document.removeEventListener('scroll', onScroll, true);
          },
        };
      },
    }),
);
