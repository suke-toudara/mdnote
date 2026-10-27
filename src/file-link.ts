// 「[[」と打つと、開いているフォルダのファイルを選んでリンクを入れる

import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

// 選ぶ窓を開いたら true を返す (開けないときは「[[」をそのまま入力させる)。
// 選んだら insert、選ばずに閉じたら cancel を呼ぶ
type Trigger = (insert: (label: string, destination: string) => void, cancel: () => void) => boolean;

let trigger: Trigger | null = null;
export function setFileLinkTrigger(fn: Trigger) {
  trigger = fn;
}

export function insertLinkInEditor(view: EditorView, label: string, href: string) {
  const { schema } = view.state;
  const link = schema.marks.link.create({ href });
  const tr = view.state.tr.replaceSelectionWith(schema.text(label, [link]), false).removeStoredMark(schema.marks.link);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export const fileLinkInput = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== '[' || !trigger || from < 1) return false;
          const { state } = view;
          if (state.selection.$from.parent.type.spec.code) return false;
          if (state.doc.textBetween(from - 1, from) !== '[') return false;
          const start = from - 1;
          const opened = trigger(
            (label, destination) => {
              view.dispatch(view.state.tr.delete(start, start + 1));
              insertLinkInEditor(view, label, destination);
            },
            () => {
              // 取り消したら、打った「[[」に戻す
              view.dispatch(view.state.tr.insertText('[', start + 1));
              view.focus();
            },
          );
          if (!opened) return false;
          // 2 つ目の「[」はまだ入れない (選んだらリンクに置き換える)
          if (from !== to) view.dispatch(state.tr.delete(from, to));
          return true;
        },
      },
    }),
);
