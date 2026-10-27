// 集中モード: ツールバーやサイドバーを隠し、プレビュー編集では編集中の段落以外を薄く表示する

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const key = new PluginKey('focus-mode');
const isOn = () => document.body.classList.contains('focus-mode');

// カーソルのある一番外側のブロック (段落・見出し・リスト全体など) に印を付ける
export const focusCurrentBlock = $prose(
  () =>
    new Plugin({
      key,
      props: {
        decorations(state) {
          if (!isOn()) return null;
          const $head = state.selection.$head;
          if ($head.depth < 1) return null;
          const start = $head.before(1);
          return DecorationSet.create(state.doc, [Decoration.node(start, start + $head.node(1).nodeSize, { class: 'focus-current' })]);
        },
      },
    }),
);

export function setFocusMode(view: EditorView, on: boolean) {
  document.body.classList.toggle('focus-mode', on);
  // 印を付け直す
  view.dispatch(view.state.tr.setMeta(key, on));
}

export const focusModeOn = isOn;
